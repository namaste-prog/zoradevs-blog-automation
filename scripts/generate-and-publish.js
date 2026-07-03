#!/usr/bin/env node
/**
 * Zoradevs B2B Blog Automation — 5-layer Groq pipeline.
 * Layer 1: Competitor discovery + website scrape
 * Layer 2: India Google Trends + Groq trend filter
 * Layer 3: 6-month anti-duplication memory
 * Layer 4: Groq B2B content + FAQ schema
 * Layer 5: Auto-publish + log
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import { discoverCompetitors } from "./lib/competitors.js";
import { scrapeZoradevsAndCompetitors } from "./lib/scraper.js";
import { fetchIndiaTrends } from "./lib/india-trends.js";
import { filterTrendsWithGroq, writeB2BBlog } from "./lib/pipeline.js";
import { pickUniqueCandidate, slugify } from "./lib/dedup.js";
import { buildFaqSchema } from "./lib/faq-schema.js";
import { GROQ_MODEL } from "./lib/groq.js";

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
    return {
      topic: data.topic ?? "",
      keywords: data.keywords,
      category: data.category,
      service: "Software Development",
      topic_key: slugify(data.keywords[0]),
      title_angle: data.topic || data.keywords[0],
      india_angle: "Indian startups and SMEs",
      source: "manual-keywords",
    };
  } catch {
    const keywords = readJson("keywords.json");
    const entry = keywords.find((k) => k.day === daySlot);
    if (!entry) throw new Error(`No fallback keywords for day ${daySlot}`);
    return {
      ...entry,
      service: entry.category,
      topic_key: slugify(entry.keywords[0]),
      title_angle: entry.topic || entry.keywords[0],
      india_angle: "Indian startups and SMEs",
      source: "fallback",
    };
  }
}

async function runB2BPipeline(config) {
  const domain = config.domain ?? "https://zoradevs.com";

  console.log("Layer 1: Discovering competitors...");
  const competitors = await discoverCompetitors(config);
  console.log(`Found ${competitors.length} competitors:`, competitors.map((c) => c.domain).join(", "));

  console.log("Layer 1: Scraping Zoradevs + competitor sites...");
  const scraped = await scrapeZoradevsAndCompetitors(
    domain,
    competitors.map((c) => c.domain)
  );

  console.log("Layer 2: Fetching India Google Trends...");
  const indiaTrends = await fetchIndiaTrends(20);
  console.log(`India trends: ${indiaTrends.length} items`);

  console.log("Layer 2: Groq trend filter...");
  const candidates = await filterTrendsWithGroq({
    services: config.services ?? [],
    industryVerticals: config.industryVerticals ?? [],
    indiaTrends,
    scrapedText: scraped.combinedText,
    recentTopics: config.recentTopics ?? [],
  });

  console.log("Layer 3: Anti-duplication check...");
  const selected = pickUniqueCandidate(candidates, config.recentTopics ?? []);
  if (!selected) {
    throw new Error("All trend candidates were duplicates (6-month memory)");
  }

  console.log("Selected topic:", selected.topic);
  return { ...selected, source: "b2b-pipeline" };
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

B2B tech insights for Indian startups and growing businesses.

Link in comments 👇

#B2B #IndianStartups #SoftwareDevelopment #Zoradevs #${category.replace(/\s+/g, "")}
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
    console.log("Already published today:", config.publishedToday.title);
    process.exit(0);
  }

  const log = readJson("published_log.json");
  if (log.published?.find((p) => p.date === date && p.status === "success")) {
    console.log("Already published today (local log).");
    process.exit(0);
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

  const brief = {
    service: topicEntry.service ?? topicEntry.category,
    topic: topicEntry.topic || topicEntry.title_angle,
    primaryKeyword: topicEntry.keywords[0],
    secondaryKeywords: topicEntry.keywords.slice(1),
    category: topicEntry.category,
    titleAngle: topicEntry.title_angle ?? topicEntry.topic,
    indiaAngle: topicEntry.india_angle ?? "Indian B2B market",
  };

  const source = topicEntry.source ?? "b2b-pipeline";
  console.log(`Layer 4: Writing blog with Groq (${GROQ_MODEL}) [${source}]...`);

  let blog;
  try {
    blog = await writeB2BBlog(brief);
    if (!blog.slug) blog.slug = slugify(blog.title);
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
  const publishPayload = {
    title: blog.title,
    slug: blog.slug,
    excerpt: blog.excerpt,
    content: blog.content,
    category: topicEntry.category,
    tags: blog.tags ?? blog.keywords,
    meta_title: blog.meta_title,
    meta_description: blog.meta_description,
    keywords: blog.keywords,
    faqs: blog.faqs,
    faqSchema,
    author: "Zoradevs",
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
      keywords: blog.keywords ?? topicEntry.keywords,
      category: topicEntry.category,
      service: topicEntry.service ?? "",
      source,
      url: result.url?.startsWith("http") ? result.url : `https://zoradevs.com${result.url}`,
      status: "success",
    };

    log.published.push({
      date,
      keyword: topicEntry.keywords[0],
      title: blog.title,
      url: successLog.url,
      status: "success",
      source,
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
