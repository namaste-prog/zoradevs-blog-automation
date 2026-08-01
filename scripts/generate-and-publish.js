#!/usr/bin/env node
/**
 * Zoradevs B2B Blog Automation — SEO Roadmap pipeline.
 * Layer 1: Competitor discovery + website scrape
 * Layer 2: Core-services topic generation (natural AI titles; geo in keywords only)
 * Layer 3: 6-month anti-duplication memory
 * Layer 4: Groq B2B content + FAQ schema + AI title validation
 * Layer 5: Landscape cover (Unsplash/Pexels) + publish + log
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import { discoverCompetitors } from "./lib/competitors.js";
import { scrapeZoradevsAndCompetitors } from "./lib/scraper.js";
import {
  filterTrendsWithGroq,
  writeBlogMetadata,
  writeB2BBlogBody,
  titleContainsAi,
  ensureQualityKeywords,
} from "./lib/pipeline.js";
import { pickUniqueCandidate, slugify, ensureAiInKeywords, isDuplicate } from "./lib/dedup.js";
import { buildFaqSchema } from "./lib/faq-schema.js";
import { fetchBlogCoverImage, saveUsedUnsplashId, loadUsedUnsplashIds } from "./lib/unsplash.js";
import { GROQ_MODEL, sleep } from "./lib/groq.js";
import { writeFailureReport, sendFailureEmail } from "./lib/alert-email.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const BLOG_API_URL = process.env.BLOG_API_URL ?? "https://zoradevs.com/api/blogs";
const BLOG_API_SECRET = process.env.BLOG_API_SECRET;
const BLOG_KEYWORDS_URL =
  process.env.BLOG_KEYWORDS_URL ??
  BLOG_API_URL.replace(/\/api\/blogs\/?$/, "/api/automation/keywords");
const BLOG_AUTOMATION_URL =
  process.env.BLOG_AUTOMATION_URL ??
  BLOG_API_URL.replace(/\/api\/blogs\/?$/, "/api/automation/config");

const TITLE_META_RETRIES = 3;
const PIPELINE_ATTEMPTS = Math.max(1, Number(process.env.PIPELINE_ATTEMPTS || 3));
const PUBLISH_ATTEMPTS = Math.max(1, Number(process.env.PUBLISH_ATTEMPTS || 3));

const authHeaders = {
  Authorization: `Bearer ${BLOG_API_SECRET}`,
  "Content-Type": "application/json",
};

function getWeekdaySlot() {
  const d = new Date().getDay();
  // Daily evening runs: Mon–Fri use that day; Sat/Sun fall back to Friday keywords.
  if (d >= 1 && d <= 5) return d;
  return 5;
}

/** Calendar date in IST (YYYY-MM-DD) — used for one-post-per-day guards. */
function todayISO() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/**
 * Tomorrow 07:00 AM IST as UTC ISO string.
 * IST = UTC+05:30 → 07:00 IST = 01:30 UTC.
 */
function tomorrowSevenAmIstIso() {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  const y = istNow.getUTCFullYear();
  const m = istNow.getUTCMonth();
  const d = istNow.getUTCDate();
  // Calendar tomorrow in IST, at 07:00 IST (= 01:30 UTC)
  return new Date(Date.UTC(y, m, d + 1, 1, 30, 0, 0)).toISOString();
}

function morningCatchUpEnabled() {
  return String(process.env.MORNING_CATCH_UP || "").toLowerCase() === "true";
}

/** True if today's IST calendar already has a generated or go-live post. */
function alreadyCoveredForToday(log) {
  const today = todayISO();
  for (const p of log.published || []) {
    if (
      p.date === today &&
      (p.status === "success" || p.status === "draft" || p.status === "scheduled")
    ) {
      return true;
    }
    if (p.publishAt) {
      const goLiveIst = new Date(p.publishAt).toLocaleDateString("en-CA", {
        timeZone: "Asia/Kolkata",
      });
      if (
        goLiveIst === today &&
        (p.status === "success" || p.status === "scheduled")
      ) {
        return true;
      }
    }
  }
  return false;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
}

function writeJson(file, data) {
  fs.writeFileSync(path.join(ROOT, file), JSON.stringify(data, null, 2) + "\n");
}

function appendLinkedInPost(text) {
  const file = path.join(ROOT, "linkedin_queue.txt");
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  fs.writeFileSync(file, existing + (existing.endsWith("\n") || !existing ? "" : "\n") + text + "\n\n");
}

function calcReadTime(content) {
  const words = content.split(/\s+/).filter(Boolean).length;
  return `${Math.max(1, Math.round(words / 200))} min read`;
}

const BLOG_AUTHORS = ["Mansi", "Parul", "Nikhil"];

function pickRandomAuthor() {
  return BLOG_AUTHORS[Math.floor(Math.random() * BLOG_AUTHORS.length)];
}

function forcePublishEnabled() {
  return String(process.env.FORCE_PUBLISH || "").toLowerCase() === "true";
}

/** Manual GitHub runs + morning catch-up go live immediately; evening cron schedules for tomorrow 07:00 IST. */
function shouldPublishImmediately() {
  if (String(process.env.PUBLISH_IMMEDIATELY || "").toLowerCase() === "true") return true;
  if (morningCatchUpEnabled()) return true;
  return process.env.GITHUB_EVENT_NAME === "workflow_dispatch";
}

/** Collect slugs already used in local publish log. */
function usedSlugsFromLog(log) {
  const used = new Set();
  for (const entry of log.published || []) {
    const fromUrl = String(entry.url || "").match(/\/blog\/([a-z0-9-]+)/i)?.[1];
    if (fromUrl) used.add(fromUrl.toLowerCase());
    if (entry.slug) used.add(String(entry.slug).toLowerCase());
    if (entry.title) used.add(slugify(entry.title));
  }
  return used;
}

/** Ensure slug is unique vs local history; append date stamp when needed. */
function ensureUniqueSlug(rawSlug, title, log) {
  const base = slugify(rawSlug || title || `ai-blog-${Date.now()}`) || `ai-blog-${Date.now()}`;
  const used = usedSlugsFromLog(log);
  if (!used.has(base)) return base;

  const stamp = todayISO().replace(/-/g, "");
  let candidate = `${base.slice(0, 60)}-${stamp}`.replace(/-+/g, "-").replace(/-$/, "");
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${base.slice(0, 55)}-${stamp}-${n}`.replace(/-+/g, "-").replace(/-$/, "");
    n += 1;
  }
  console.warn(`Slug already used — uniquified: ${base} → ${candidate}`);
  return candidate;
}

function isSlugConflictError(err) {
  const data = err?.response?.data;
  const msg = String(data?.error || data?.message || err?.message || "").toLowerCase();
  return err?.response?.status === 409 || msg.includes("slug already exists");
}

/** If topic collides with history, rewrite into a unique natural AI angle (geo stays in keywords). */
function uniquifyTopicEntry(entry, allRecent) {
  if (!isDuplicate(entry, allRecent)) return entry;

  const stamp = todayISO().slice(5).replace("-", ""); // MMDD
  const base = ensureAiInKeywords(entry.keywords || []);
  const serviceLabel = entry.category || entry.service || "Software Development";
  const uniqueKeywords = ensureAiInKeywords([
    `${base[0]} Delhi NCR`,
    `AI software development Noida ${stamp}`,
    "IT company Noida",
    ...base.slice(1, 3),
  ]);
  const topic = `How AI Is Reshaping ${serviceLabel} for Modern Businesses`;

  const next = {
    ...entry,
    topic,
    title_angle: topic,
    keywords: uniqueKeywords,
    topic_key: slugify(`${uniqueKeywords[0]}-${stamp}`),
    india_angle: "Delhi NCR (Noida, Gurgaon, Delhi) first; Pan-India secondary — body/keywords only",
    region_focus: "delhi-ncr",
  };

  console.warn("Topic overlapped with history — using unique angle:", next.topic);
  return next;
}

async function fetchAutomationConfig() {
  const res = await axios.get(BLOG_AUTOMATION_URL, {
    headers: { Authorization: `Bearer ${BLOG_API_SECRET}` },
    timeout: 30000,
  });
  return res.data;
}

async function logPublishToApi(payload) {
  try {
    const base = BLOG_AUTOMATION_URL.replace(/\/config\/?$/, "");
    await axios.post(`${base}/publish-log`, payload, {
      headers: authHeaders,
      timeout: 30000,
    });
  } catch (err) {
    console.warn("Could not save publish log:", err.response?.data ?? err.message);
  }
}

async function fetchKeywordEntry(daySlot) {
  try {
    const res = await axios.get(`${BLOG_KEYWORDS_URL}?day=${daySlot}`, {
      headers: { Authorization: `Bearer ${BLOG_API_SECRET}` },
      timeout: 30000,
    });
    const data = res.data;
    if (!data?.keywords?.length) throw new Error("No keywords");
    const withAi = ensureAiInKeywords(data.keywords);
    return {
      topic: data.topic ?? "",
      keywords: withAi,
      category: data.category,
      service: "Software Development",
      topic_key: slugify(withAi[0]),
      title_angle: data.topic || withAi[0],
      india_angle: "Delhi NCR startups and SMEs (Noida, Gurgaon, Delhi), then Pan-India",
      region_focus: "delhi-ncr",
      source: "manual-keywords",
    };
  } catch {
    const keywords = readJson("keywords.json");
    const entry = keywords.find((k) => k.day === daySlot);
    if (!entry) throw new Error(`No fallback keywords for day ${daySlot}`);
    const withAi = ensureAiInKeywords(entry.keywords);
    return {
      ...entry,
      keywords: withAi,
      service: entry.category,
      topic_key: slugify(withAi[0]),
      title_angle: entry.topic || withAi[0],
      india_angle: "Delhi NCR startups and SMEs (Noida, Gurgaon, Delhi), then Pan-India",
      region_focus: "delhi-ncr",
      source: "fallback",
    };
  }
}

async function runB2BPipeline(config) {
  const domain = config.domain ?? "https://zoradevs.com";

  console.log("Layer 1: Discovering competitors (Google CSE, dynamic)...");
  const competitors = await discoverCompetitors(config);
  const topCompetitors = competitors.slice(0, 3);
  console.log(
    `Using top ${topCompetitors.length} competitor(s):`,
    topCompetitors.map((c) => c.domain).join(", ") || "(none — services-only)"
  );

  console.log("Layer 1: Lightweight homepage scrape (meta + H1/H2 only, no sub-pages)...");
  const scraped = await scrapeZoradevsAndCompetitors(
    domain,
    topCompetitors.map((c) => c.domain)
  );

  console.log("Layer 2: Generating topics from core services (no Google Trends)...");
  const candidates = await filterTrendsWithGroq({
    services: config.services ?? [],
    industryVerticals: config.industryVerticals ?? [],
    scrapedText: scraped.combinedText,
    recentTopics: config.recentTopics ?? [],
  });

  // Force AI into every candidate keyword set before dedup.
  const withAi = candidates.map((c) => ({
    ...c,
    keywords: ensureAiInKeywords(c.keywords),
    topic_key: slugify(c.topic_key || c.keywords?.[0] || c.topic),
  }));

  console.log("Layer 3: Anti-duplication check...");
  const selected = pickUniqueCandidate(withAi, config.recentTopics ?? []);
  if (!selected) {
    throw new Error("All service topic candidates were duplicates (6-month memory)");
  }

  console.log("Selected topic:", selected.topic);
  console.log("Region focus:", selected.region_focus || "delhi-ncr");
  return {
    ...selected,
    keywords: ensureAiInKeywords(selected.keywords),
    region_focus: selected.region_focus || "delhi-ncr",
    source: "b2b-pipeline",
  };
}

/**
 * Metadata pass with strict AI-in-title validation (up to 3 regenerations).
 */
async function writeBlogWithTitleValidation(brief) {
  const delaySec = Number(process.env.GROQ_CALL_DELAY_SEC ?? 15);
  console.log(`Waiting ${delaySec}s before Groq writer (TPM cooldown after topic pick)...`);
  await sleep(delaySec * 1000);

  let meta = null;
  for (let attempt = 1; attempt <= TITLE_META_RETRIES; attempt++) {
    console.log(`Writer pass: metadata + FAQs (attempt ${attempt}/${TITLE_META_RETRIES})...`);
    meta = await writeBlogMetadata(brief);

    if (titleContainsAi(meta.title)) {
      console.log(`Title AI validation passed (attempt ${attempt}): ${meta.title}`);
      break;
    }

    console.warn(
      `Title missing "AI" (attempt ${attempt}): "${meta.title}" — forcing metadata regeneration...`
    );
    meta = null;
    if (attempt < TITLE_META_RETRIES) {
      const coolSec = Number(process.env.GROQ_PART_DELAY_SEC ?? 25);
      await sleep(coolSec * 1000);
    }
  }

  if (!meta || !titleContainsAi(meta.title)) {
    throw new Error(
      `Title must contain "AI" (case-insensitive) after ${TITLE_META_RETRIES} metadata retries`
    );
  }

  return writeB2BBlogBody(brief, meta);
}

function buildLinkedInPost(blog, category) {
  const date = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  return `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BLOG: ${blog.title}
DATE: ${date}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

New on the Zoradevs blog — ${blog.excerpt}

B2B tech insights for Delhi NCR (Noida, Gurgaon) and Indian growing businesses.

Link in comments 👇

#B2B #DelhiNCR #Noida #AI #SoftwareDevelopment #Zoradevs #${category.replace(/\s+/g, "")}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}

async function publishBlog(payload) {
  const res = await axios.post(BLOG_API_URL, payload, {
    headers: authHeaders,
    timeout: 60000,
  });
  return res.data;
}

/** Retry publish on slug conflict / transient API errors. */
async function publishBlogWithRetries(payload, blog, log) {
  let lastErr;
  for (let attempt = 1; attempt <= PUBLISH_ATTEMPTS; attempt++) {
    try {
      return await publishBlog(payload);
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status;
      const data = err?.response?.data;

      if (isSlugConflictError(err)) {
        const retrySlug = ensureUniqueSlug(
          `${blog.slug || "ai-blog"}-${Date.now().toString(36)}-${attempt}`,
          blog.title,
          log
        );
        console.warn(
          `Publish attempt ${attempt}/${PUBLISH_ATTEMPTS}: slug conflict — retrying as ${retrySlug}`
        );
        blog.slug = retrySlug;
        payload.slug = retrySlug;
        continue;
      }

      // Transient network / 5xx — wait and retry same payload
      if (!status || status >= 500 || status === 429) {
        const waitSec = Math.min(30, 5 * attempt);
        console.warn(
          `Publish attempt ${attempt}/${PUBLISH_ATTEMPTS} failed (${status || err.message}) — waiting ${waitSec}s...`
        );
        await sleep(waitSec * 1000);
        continue;
      }

      // Non-retryable 4xx (except slug handled above)
      console.error("Publish rejected:", data ?? err.message);
      throw err;
    }
  }
  throw lastErr;
}

async function main() {
  if (!BLOG_API_SECRET) {
    console.error("Missing BLOG_API_SECRET");
    process.exit(1);
  }

  if (!process.env.GROQ_API_KEY) {
    console.error("Missing GROQ_API_KEY");
    process.exit(1);
  }

  const daySlot = getWeekdaySlot();
  // Daily generation (evening IST) — no weekend skip.

  const date = todayISO();
  let config = {
    autoTrendEnabled: true,
    recentTopics: [],
    publishedToday: null,
    domain: "https://zoradevs.com",
    services: [],
    industryVerticals: [],
  };

  try {
    config = await fetchAutomationConfig();
  } catch (err) {
    console.warn("Config API unavailable, using defaults:", err.message);
  }

  const log = readJson("published_log.json");

  if (config.publishedToday?.title) {
    if (forcePublishEnabled()) {
      console.warn(
        `FORCE_PUBLISH=true — ignoring already-published-today marker: ${config.publishedToday.title}`
      );
    } else if (morningCatchUpEnabled() && alreadyCoveredForToday(log)) {
      console.log("Morning catch-up: today already covered — skipping.");
      process.exit(0);
    } else if (!morningCatchUpEnabled()) {
      console.log("Already published today:", config.publishedToday.title);
      console.log("Tip: re-run workflow with force_publish=true to publish another blog today.");
      process.exit(0);
    }
  }

  if (morningCatchUpEnabled()) {
    if (alreadyCoveredForToday(log) && !forcePublishEnabled()) {
      console.log("Morning catch-up: a post already covers today (generated or go-live) — skipping.");
      process.exit(0);
    }
    console.log("Morning catch-up mode: will publish LIVE if generation succeeds.");
  } else if (
    log.published?.find(
      (p) =>
        p.date === date &&
        (p.status === "success" || p.status === "draft" || p.status === "scheduled")
    )
  ) {
    if (forcePublishEnabled()) {
      console.warn("FORCE_PUBLISH=true — ignoring local published_log for today.");
    } else {
      console.log("Already generated a draft/post today (local log).");
      console.log("Tip: re-run workflow with force_publish=true to create another draft today.");
      process.exit(0);
    }
  }

  let lastError = null;

  for (let pipelineAttempt = 1; pipelineAttempt <= PIPELINE_ATTEMPTS; pipelineAttempt++) {
    console.log(`\n======== Pipeline attempt ${pipelineAttempt}/${PIPELINE_ATTEMPTS} ========`);

    try {
      let topicEntry;
      try {
        if (config.autoTrendEnabled !== false) {
          topicEntry = await runB2BPipeline(config);
        } else {
          console.log("B2B pipeline disabled — using manual fallback keywords");
          topicEntry = await fetchKeywordEntry(daySlot);
        }
      } catch (err) {
        if (err.code === "GROQ_TPD" || /tokens per day|\(tpd\)/i.test(err.message)) {
          throw err;
        }
        console.warn("B2B pipeline failed, hybrid fallback:", err.message);
        topicEntry = await fetchKeywordEntry(daySlot);
      }

      // Merge API recent topics + local log for stronger no-repeat guarantee.
      const localRecent = (log.published || [])
        .filter((p) => p.status === "success" || p.status === "scheduled")
        .map((p) => ({
          title: p.title,
          topicKey: slugify(p.keyword || p.title || ""),
          keywords: p.keywords || [p.keyword].filter(Boolean),
          keyword: p.keyword,
        }));
      const allRecent = [...(config.recentTopics ?? []), ...localRecent];
      topicEntry = uniquifyTopicEntry(topicEntry, allRecent);
      topicEntry.keywords = ensureAiInKeywords(topicEntry.keywords);

      if (isDuplicate(topicEntry, allRecent)) {
        topicEntry.topic_key = slugify(`${topicEntry.keywords[0]}-${Date.now()}`);
        topicEntry.keywords = ensureAiInKeywords([
          `AI software delivery strategies ${todayISO()}`,
          "AI product engineering for founders",
          "custom AI solutions for startups",
          "AI automation for growing businesses",
          "hire AI developers Noida",
        ]);
        topicEntry.topic = `How AI Is Transforming Modern Software Development ${todayISO().slice(5)}`;
        topicEntry.title_angle = topicEntry.topic;
        console.warn("Applied last-resort unique topic for today.");
      }

      // On retry, nudge topic so title/slug diverge from a previous conflict.
      if (pipelineAttempt > 1) {
        const stamp = `${todayISO().slice(5)}-${pipelineAttempt}`;
        topicEntry.topic_key = slugify(`${topicEntry.topic_key || topicEntry.topic}-${stamp}`);
        topicEntry.title_angle = `${topicEntry.title_angle || topicEntry.topic}`.replace(
          /\s+$/,
          ""
        );
        console.warn(`Retry uniqueness stamp applied: ${stamp}`);
      }

      const brief = {
        service: topicEntry.service ?? topicEntry.category,
        topic: topicEntry.topic || topicEntry.title_angle,
        primaryKeyword: topicEntry.keywords[0],
        secondaryKeywords: topicEntry.keywords.slice(1),
        category: topicEntry.category,
        titleAngle: topicEntry.title_angle ?? topicEntry.topic,
        indiaAngle:
          topicEntry.india_angle ??
          "Delhi NCR (Noida, Gurgaon, Delhi) first; Pan-India as secondary",
        regionFocus: topicEntry.region_focus || "delhi-ncr",
      };

      const source = topicEntry.source ?? "b2b-pipeline";
      console.log(`Layer 4: Writing blog with Groq (${GROQ_MODEL}) [${source}]...`);

      let blog = await writeBlogWithTitleValidation(brief);
      if (!blog.slug) blog.slug = slugify(blog.title);
      blog.slug = ensureUniqueSlug(blog.slug, blog.title, log);

      blog.keywords = await ensureQualityKeywords(
        { ...brief, title: blog.title, excerpt: blog.excerpt },
        blog.title,
        blog.keywords ?? topicEntry.keywords,
        blog.excerpt
      );

      if (!Array.isArray(blog.tags) || !blog.tags.length) {
        blog.tags = blog.keywords.slice(0, 5);
      }

      if (!titleContainsAi(blog.title)) {
        throw new Error(`Final title missing "AI": ${blog.title}`);
      }

      blog.faqs = (Array.isArray(blog.faqs) ? blog.faqs : [])
        .map((f) => ({
          question: String(f?.question || "").trim().slice(0, 300),
          answer: String(f?.answer || "").trim().slice(0, 1800),
        }))
        .filter((f) => f.question.length >= 5 && f.answer.length >= 10)
        .slice(0, 10);

      const faqSchema = buildFaqSchema(blog.faqs);
      if (!faqSchema?.mainEntity?.length) {
        throw new Error("FAQ schema missing — need FAQs for SEO");
      }
      console.log(`FAQ schema ready: ${faqSchema.mainEntity.length} questions`);

      const usedFromLog = (log.published || [])
        .map((p) => p.unsplashId)
        .filter(Boolean);
      const excludeIds = [...loadUsedUnsplashIds(usedFromLog)];

      console.log("Fetching landscape cover from dynamic imageQuery (Unsplash then Pexels)...");
      if (!blog.imageQuery) {
        console.warn("Missing imageQuery — cover search may be weak");
      } else {
        console.log("imageQuery:", blog.imageQuery);
      }

      let cover;
      try {
        cover = await fetchBlogCoverImage({
          imageQuery: blog.imageQuery,
          keywords: blog.keywords ?? topicEntry.keywords,
          keyword: topicEntry.keywords[0],
          category: topicEntry.category,
          service: topicEntry.service,
          excludeIds,
        });
      } catch (imgErr) {
        console.warn("Cover fetch failed — using category fallback:", imgErr.message);
        cover = {
          url: `https://zoradevs.com/img/web-app.jpg`,
          unsplashId: null,
          imageId: null,
          imageCredit: undefined,
        };
      }

      if (cover.unsplashId || cover.imageId) {
        saveUsedUnsplashId(cover.unsplashId || cover.imageId);
      }

      const publishKeywords = blog.keywords.slice(0, 5);
      blog.keywords = publishKeywords;
      console.log(`Publish keywords (exactly ${publishKeywords.length}): ${publishKeywords.join(" | ")}`);

      const imageAlt = publishKeywords[0] || blog.title;
      const author = pickRandomAuthor();
      console.log("Author:", author);
      console.log("Image alt:", imageAlt);
      console.log("Final imageQuery:", blog.imageQuery);
      console.log(
        "ZoraDevs links in content:",
        (blog.content.match(/https?:\/\/(?:www\.)?zoradevs\.com/gi) || []).length
      );

      const publishImmediately = shouldPublishImmediately();
      const publishAt = publishImmediately
        ? new Date().toISOString()
        : tomorrowSevenAmIstIso();

      if (publishImmediately) {
        console.log("Publishing LIVE immediately (manual or morning catch-up)");
      } else {
        console.log(`Scheduling go-live at ${publishAt} (tomorrow 07:00 AM IST)`);
      }

      const publishPayload = {
        title: blog.title,
        slug: blog.slug,
        excerpt: blog.excerpt,
        content: blog.content,
        image: cover.url,
        alt: imageAlt,
        image_alt: imageAlt,
        image_credit: cover.imageCredit ?? undefined,
        category: topicEntry.category,
        tags: blog.tags ?? blog.keywords,
        meta_title: blog.meta_title,
        meta_description: blog.meta_description,
        keywords: publishKeywords,
        faqs: blog.faqs,
        faqSchema,
        author,
        read_time: calcReadTime(blog.content),
        published: publishImmediately,
        status: publishImmediately ? "published" : "scheduled",
        publishAt,
        scheduledDate: publishAt,
        source: "automation",
        service: topicEntry.service ?? "",
      };

      console.log(
        publishImmediately
          ? "Layer 5: Publishing LIVE to"
          : "Layer 5: Saving SCHEDULED post to",
        BLOG_API_URL
      );

      const result = await publishBlogWithRetries(publishPayload, blog, log);
      const blogId = result.blog_id || result._id || result.id;
      const adminEditUrl = blogId
        ? `https://zoradevs.com/admin/blogs/${blogId}`
        : `https://zoradevs.com/admin/blogs`;
      const publicPath = result.url?.startsWith("http")
        ? result.url
        : `https://zoradevs.com${result.url || `/blog/${blog.slug}`}`;

      if (publishImmediately) {
        console.log("Published live:", publicPath);
      } else {
        console.log("Scheduled (not live yet):", publicPath);
        console.log("Goes live:", publishAt);
      }
      console.log("Admin preview:", adminEditUrl);

      const topicKey = topicEntry.topic_key ?? slugify(topicEntry.keywords[0]);
      const logStatus = publishImmediately ? "success" : "scheduled";
      const successLog = {
        date,
        topicKey,
        title: blog.title,
        keywords: publishKeywords,
        category: topicEntry.category,
        service: topicEntry.service ?? "",
        source,
        url: publishImmediately ? publicPath : adminEditUrl,
        status: logStatus,
      };

      log.published.push({
        date,
        keyword: publishKeywords[0],
        title: blog.title,
        keywords: publishKeywords,
        url: publishImmediately ? publicPath : adminEditUrl,
        status: logStatus,
        source,
        publishAt,
        unsplashId: cover.unsplashId || cover.imageId || null,
        imageQuery: blog.imageQuery || null,
        blogId: blogId || null,
        slug: blog.slug,
      });
      writeJson("published_log.json", log);
      await logPublishToApi(successLog);

      appendLinkedInPost(buildLinkedInPost(blog, topicEntry.category));
      console.log(`Pipeline succeeded on attempt ${pipelineAttempt}/${PIPELINE_ATTEMPTS}`);
      return;
    } catch (err) {
      lastError = err;
      const msg = err?.response?.data ?? err.message;
      console.error(`Pipeline attempt ${pipelineAttempt}/${PIPELINE_ATTEMPTS} failed:`, msg);

      if (err.code === "GROQ_TPD" || /tokens per day|\(tpd\)/i.test(String(err.message))) {
        console.error(
          "Groq daily token limit hit — further retries will also fail until reset."
        );
        break;
      }

      if (pipelineAttempt < PIPELINE_ATTEMPTS) {
        const waitSec = Math.min(60, 15 * pipelineAttempt);
        console.warn(`Retrying full pipeline in ${waitSec}s with a fresh topic/slug...`);
        await sleep(waitSec * 1000);
      }
    }
  }

  console.error("All pipeline attempts failed:", lastError?.response?.data ?? lastError?.message);

  const runUrl =
    process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : "";

  const report = writeFailureReport({
    error: lastError,
    eventName: process.env.GITHUB_EVENT_NAME || "local",
    runUrl,
  });
  await sendFailureEmail(report.body).catch(() => false);

  process.exit(1);
}

main();
