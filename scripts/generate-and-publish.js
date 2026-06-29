#!/usr/bin/env node
/**
 * Zoradevs blog automation — reads today's keyword, calls Groq (Llama), publishes to zoradevs.com.
 * Requires: GROQ_API_KEY, BLOG_API_SECRET, BLOG_API_URL (GitHub Secrets).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const BLOG_API_URL = process.env.BLOG_API_URL ?? "https://zoradevs.com/api/blogs";
const BLOG_API_SECRET = process.env.BLOG_API_SECRET;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL ?? "llama3-70b-8192";

/** Mon=1 … Fri=5 (matches keywords.json) */
function getWeekdaySlot() {
  const d = new Date().getDay();
  if (d >= 1 && d <= 5) return d;
  return null;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80)
    .replace(/-$/, "");
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
  const mins = Math.max(1, Math.round(words / 200));
  return `${mins} min read`;
}

function buildSeoBrief(entry) {
  const primary = entry.keywords[0];
  const secondary = entry.keywords.slice(1);
  return {
    primaryKeyword: primary,
    secondaryKeywords: secondary,
    topic: entry.topic || "",
    category: entry.category,
  };
}

function buildBlogPrompt(brief) {
  return `You are an expert SEO content writer for Zoradevs, a software development company in India.

Write a complete blog post as JSON only (no markdown fences, no extra text before or after the JSON).

Primary keyword: ${brief.primaryKeyword}
Secondary keywords: ${brief.secondaryKeywords.join(", ")}
Category: ${brief.category}
${brief.topic ? `Suggested angle: ${brief.topic}` : "Pick the best SEO title from keyword intent."}

Requirements:
- 1000-1500 words in the "content" field as markdown (use ## for H2, ### for H3, bullet lists)
- Include an FAQs section at the end with 4-5 questions
- meta_title: 50-60 chars, include Zoradevs
- meta_description: 150-160 chars
- excerpt: max 300 chars for blog cards
- slug: lowercase, hyphens only, URL-safe
- tags: 5 relevant tags
- keywords: array of 5 SEO keywords

Return exactly this JSON shape:
{
  "title": "...",
  "slug": "...",
  "excerpt": "...",
  "content": "...",
  "meta_title": "...",
  "meta_description": "...",
  "keywords": ["...", "...", "...", "...", "..."],
  "tags": ["...", "...", "...", "...", "..."]
}`;
}

function parseBlogJson(text) {
  if (!text) throw new Error("Groq returned empty response");
  try {
    return JSON.parse(text);
  } catch {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Groq did not return valid JSON");
    return JSON.parse(jsonMatch[0]);
  }
}

async function callGroq(brief) {
  const res = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model: GROQ_MODEL,
      messages: [{ role: "user", content: buildBlogPrompt(brief) }],
      max_tokens: 8192,
      temperature: 0.7,
    },
    {
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 120000,
    }
  );

  const text = res.data.choices?.[0]?.message?.content ?? "";
  return parseBlogJson(text);
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

We break down ${category.toLowerCase()} insights for Indian startups and growing businesses.

Link in comments 👇

#SoftwareDevelopment #IndianStartups #TechStrategy #Zoradevs #${category.replace(/\s+/g, "")}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}

async function publishBlog(payload, category) {
  const body = {
    title: payload.title,
    slug: payload.slug,
    excerpt: payload.excerpt,
    content: payload.content,
    category,
    tags: payload.tags ?? payload.keywords,
    meta_title: payload.meta_title,
    meta_description: payload.meta_description,
    keywords: payload.keywords,
    author: "Zoradevs",
    read_time: calcReadTime(payload.content),
    published: true,
  };

  const res = await axios.post(BLOG_API_URL, body, {
    headers: {
      Authorization: `Bearer ${BLOG_API_SECRET}`,
      "Content-Type": "application/json",
    },
    timeout: 60000,
  });

  return res.data;
}

async function main() {
  if (!BLOG_API_SECRET) {
    console.error("Missing BLOG_API_SECRET");
    process.exit(1);
  }

  const daySlot = getWeekdaySlot();
  if (daySlot === null) {
    console.log("Weekend — no blog scheduled.");
    process.exit(0);
  }

  const keywords = readJson("keywords.json");
  const entry = keywords.find((k) => k.day === daySlot);
  if (!entry) {
    console.error(`No keywords.json entry for day ${daySlot}`);
    process.exit(1);
  }

  const log = readJson("published_log.json");
  const date = todayISO();
  const already = log.published.find(
    (p) => p.date === date || p.keyword === entry.keywords[0]
  );
  if (already?.status === "success") {
    console.log("Already published today:", already.title);
    process.exit(0);
  }

  if (!GROQ_API_KEY) {
    console.error(
      "Missing GROQ_API_KEY. Add it in GitHub Secrets (from console.groq.com)."
    );
    process.exit(1);
  }

  const brief = buildSeoBrief(entry);
  console.log(`Generating blog with Groq (${GROQ_MODEL}) for:`, entry.keywords[0]);

  let blogPayload;
  try {
    blogPayload = await callGroq(brief);
    if (!blogPayload.slug) blogPayload.slug = slugify(blogPayload.title);
  } catch (err) {
    console.error("Groq failed:", err.response?.data ?? err.message);
    log.published.push({
      date,
      keyword: entry.keywords[0],
      title: entry.topic || entry.keywords[0],
      status: "failed",
      error: String(err.message),
    });
    writeJson("published_log.json", log);
    process.exit(1);
  }

  try {
    const result = await publishBlog(blogPayload, entry.category);
    console.log("Published:", result.url);

    log.published.push({
      date,
      keyword: entry.keywords[0],
      title: blogPayload.title,
      url: result.url,
      status: "success",
    });
    writeJson("published_log.json", log);

    appendLinkedInPost(buildLinkedInPost(blogPayload, entry.category));
  } catch (err) {
    const msg = err.response?.data ?? err.message;
    console.error("Publish failed:", msg);
    log.published.push({
      date,
      keyword: entry.keywords[0],
      title: blogPayload.title,
      status: "failed",
      error: JSON.stringify(msg),
    });
    writeJson("published_log.json", log);
    process.exit(1);
  }
}

main();
