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
} from "./lib/pipeline.js";
import { pickUniqueCandidate, slugify, ensureAiInKeywords, isDuplicate } from "./lib/dedup.js";
import { buildFaqSchema } from "./lib/faq-schema.js";
import { fetchBlogCoverImage, saveUsedUnsplashId, loadUsedUnsplashIds } from "./lib/unsplash.js";
import { GROQ_MODEL, sleep } from "./lib/groq.js";

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

/** Static local SEO keywords appended to every publish payload. */
const STATIC_LOCAL_KEYWORDS = [
  "AI development company Noida",
  "software development company Noida",
  "IT company Noida",
  "app development Delhi NCR",
];

const TITLE_META_RETRIES = 3;

const authHeaders = {
  Authorization: `Bearer ${BLOG_API_SECRET}`,
  "Content-Type": "application/json",
};

function getWeekdaySlot() {
  const d = new Date().getDay();
  if (d >= 1 && d <= 5) return d;
  return null;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
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

/** Deduped merge: existing keywords + required local SEO terms. */
function appendStaticLocalKeywords(keywords = []) {
  const merged = [];
  const seen = new Set();
  for (const kw of [...keywords, ...STATIC_LOCAL_KEYWORDS]) {
    const cleaned = String(kw || "").trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(cleaned);
  }
  return merged;
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
  if (daySlot === null) {
    console.log("Weekend — no blog scheduled.");
    process.exit(0);
  }

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

  if (config.publishedToday?.title) {
    if (forcePublishEnabled()) {
      console.warn(
        `FORCE_PUBLISH=true — ignoring already-published-today marker: ${config.publishedToday.title}`
      );
    } else {
      console.log("Already published today:", config.publishedToday.title);
      console.log("Tip: re-run workflow with force_publish=true to publish another blog today.");
      process.exit(0);
    }
  }

  const log = readJson("published_log.json");
  if (log.published?.find((p) => p.date === date && p.status === "success")) {
    if (forcePublishEnabled()) {
      console.warn("FORCE_PUBLISH=true — ignoring local published_log for today.");
    } else {
      console.log("Already published today (local log).");
      console.log("Tip: re-run workflow with force_publish=true to publish another blog today.");
      process.exit(0);
    }
  }

  let topicEntry;
  try {
    if (config.autoTrendEnabled !== false) {
      topicEntry = await runB2BPipeline(config);
    } else {
      console.log("B2B pipeline disabled — using manual fallback keywords");
      topicEntry = await fetchKeywordEntry(daySlot);
    }
  } catch (err) {
    console.warn("B2B pipeline failed, hybrid fallback:", err.message);
    topicEntry = await fetchKeywordEntry(daySlot);
  }

  // Merge API recent topics + local log for stronger no-repeat guarantee.
  const localRecent = (log.published || [])
    .filter((p) => p.status === "success")
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
    // Last resort unique key so we never hard-stop a weekday publish.
    topicEntry.topic_key = slugify(`${topicEntry.keywords[0]}-${Date.now()}`);
    topicEntry.keywords = ensureAiInKeywords([
      `AI development company Noida ${todayISO()}`,
      "AI automation Delhi NCR",
      "custom software Gurgaon AI",
      "hire AI developers Delhi",
      "Pan India AI software services",
    ]);
    topicEntry.topic = "How AI Is Transforming Modern Software Development";
    topicEntry.title_angle = topicEntry.topic;
    console.warn("Applied last-resort unique topic for today.");
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

  let blog;
  try {
    blog = await writeBlogWithTitleValidation(brief);
    if (!blog.slug) blog.slug = slugify(blog.title);
    blog.keywords = ensureAiInKeywords(blog.keywords ?? topicEntry.keywords);
    if (!blog.tags?.some((t) => /\bai\b|artificial intelligence/i.test(t))) {
      blog.tags = ensureAiInKeywords([...(blog.tags || []), "AI"]).slice(0, 5);
    }

    // Final safety: title must still contain AI after full write.
    if (!titleContainsAi(blog.title)) {
      throw new Error(`Final title missing "AI": ${blog.title}`);
    }
  } catch (err) {
    console.error("Groq writer failed:", err.message);
    if (err.status === 429) {
      console.error(
        "Tip: Groq free tier limits requests/minute. Re-run workflow in 2-3 minutes, or upgrade Groq plan."
      );
    }
    process.exit(1);
  }

  const faqSchema = buildFaqSchema(blog.faqs);

  const usedFromLog = (log.published || [])
    .map((p) => p.unsplashId)
    .filter(Boolean);
  const excludeIds = [...loadUsedUnsplashIds(usedFromLog)];

  console.log("Fetching landscape cover (imageQuery only — Unsplash then Pexels)...");
  const cover = await fetchBlogCoverImage({
    imageQuery: blog.imageQuery,
    keywords: blog.keywords ?? topicEntry.keywords,
    keyword: topicEntry.keywords[0],
    category: topicEntry.category,
    service: topicEntry.service,
    excludeIds,
  });

  if (cover.unsplashId || cover.imageId) {
    saveUsedUnsplashId(cover.unsplashId || cover.imageId);
  }

  // Append required local SEO keywords right before publish.
  const publishKeywords = appendStaticLocalKeywords(blog.keywords ?? topicEntry.keywords);
  blog.keywords = publishKeywords;

  // Auto alt text = first keyword in the (post-append) keywords array.
  const imageAlt = publishKeywords[0] || "AI development company Noida";

  const author = pickRandomAuthor();
  console.log("Author:", author);
  console.log("Image alt:", imageAlt);
  console.log("imageQuery:", blog.imageQuery);

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
    published: true,
    service: topicEntry.service ?? "",
  };

  try {
    console.log("Layer 5: Publishing to", BLOG_API_URL);
    const result = await publishBlog(publishPayload);
    console.log("Published:", result.url);

    const topicKey = topicEntry.topic_key ?? slugify(topicEntry.keywords[0]);
    const successLog = {
      date,
      topicKey,
      title: blog.title,
      keywords: publishKeywords,
      category: topicEntry.category,
      service: topicEntry.service ?? "",
      source,
      url: result.url?.startsWith("http") ? result.url : `https://zoradevs.com${result.url}`,
      status: "success",
    };

    log.published.push({
      date,
      keyword: publishKeywords[0],
      title: blog.title,
      keywords: publishKeywords,
      url: successLog.url,
      status: "success",
      source,
      unsplashId: cover.unsplashId || cover.imageId || null,
      imageQuery: blog.imageQuery || null,
    });
    writeJson("published_log.json", log);
    await logPublishToApi(successLog);

    appendLinkedInPost(buildLinkedInPost(blog, topicEntry.category));
  } catch (err) {
    console.error("Publish failed:", err.response?.data ?? err.message);
    process.exit(1);
  }
}

main();
