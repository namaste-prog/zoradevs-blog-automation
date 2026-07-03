/**
 * Layer 2 & 4 — Groq trend filter + B2B content engine.
 */
import { callGroq, parseJson } from "./groq.js";

const BLOCKED = ["politics", "crypto hype", "celebrity gossip", "adult content", "US-only consumer tech"];

export function buildTrendFilterPrompt({
  services,
  industryVerticals,
  indiaTrends,
  scrapedText,
  recentTopics,
}) {
  const serviceList = services
    .map((s) => `- ${s.title} (${s.category}): stacks ${s.stacks?.join(", ")}`)
    .join("\n");

  const trendsList = indiaTrends
    .map((t, i) => `${i + 1}. ${t.title}${t.traffic ? ` (${t.traffic})` : ""}`)
    .join("\n");

  const recentList =
    recentTopics.length > 0
      ? recentTopics.map((t) => `- ${t.title} [${t.topicKey}]`).join("\n")
      : "None";

  const scrapedSample = scrapedText.slice(0, 6000);

  return `You are a B2B SEO strategist for Zoradevs (Indian software development company).

TARGET AUDIENCE: Indian startups, SMEs, and enterprises buying Web Dev, Mobile Apps, AI/ML automation.

ZORADEVS SERVICES:
${serviceList}

INDUSTRY VERTICALS: ${industryVerticals.join(", ")}

GOOGLE TRENDS INDIA (live):
${trendsList || "No live trends — infer from market text pool."}

WEBSITE INTELLIGENCE (Zoradevs + competitors — titles, H1/H2, meta):
${scrapedSample}

TOPICS USED IN LAST 6 MONTHS (DO NOT REPEAT):
${recentList}

BLOCKED: ${BLOCKED.join(", ")}

Task: Return 5 unique B2B blog topic candidates for Indian market. Focus on high-demand tech stacks and architectures like:
- React + Python integration for startups
- RAG framework for e-commerce in India
- Custom CRM for logistics companies
- Agentic AI for customer support
- MERN stack for SaaS MVPs

Each candidate must map to ONE Zoradevs service and be lead-gen focused.

Return JSON only:
{
  "candidates": [
    {
      "topic": "one sentence angle",
      "service": "exact service title from list",
      "category": "blog category",
      "keywords": ["primary", "kw2", "kw3", "kw4", "kw5"],
      "topic_key": "url-slug-dedup-key",
      "title_angle": "B2B title direction",
      "india_angle": "why Indian businesses care"
    }
  ]
}`;
}

export function buildBlogWriterPrompt(brief) {
  return `You are an expert B2B content writer for Zoradevs, a software development company in Noida, India.

Write a fresh, original long-form blog for Indian B2B buyers (startups, CTOs, founders).

SERVICE FOCUS: ${brief.service}
TOPIC: ${brief.topic}
PRIMARY KEYWORD: ${brief.primaryKeyword}
SECONDARY KEYWORDS: ${brief.secondaryKeywords.join(", ")}
CATEGORY: ${brief.category}
TITLE ANGLE: ${brief.titleAngle}
INDIA ANGLE: ${brief.indiaAngle}

Requirements:
- 1200-1800 words in "content" as markdown (## H2, ### H3, bullets)
- Strong B2B tone — practical, authoritative, India-market specific
- Include 3-4 natural CTAs inviting readers to contact Zoradevs for ${brief.service}
- Do NOT include an FAQ section in content (FAQs go in separate "faqs" array)
- meta_title: 50-60 chars, include Zoradevs
- meta_description: 150-160 chars
- excerpt: max 300 chars
- slug: lowercase hyphens only
- tags: 5 tags
- keywords: 5 SEO keywords
- faqs: 5 items in People Also Ask style (question + detailed answer mentioning Zoradevs services where relevant)

Return JSON only:
{
  "title": "...",
  "slug": "...",
  "excerpt": "...",
  "content": "...",
  "meta_title": "...",
  "meta_description": "...",
  "keywords": ["...", "...", "...", "...", "..."],
  "tags": ["...", "...", "...", "...", "..."],
  "faqs": [
    { "question": "...", "answer": "..." }
  ]
}`;
}

export async function filterTrendsWithGroq(ctx) {
  const text = await callGroq(buildTrendFilterPrompt(ctx), 0.4);
  const result = parseJson(text);
  if (!result.candidates?.length) {
    throw new Error("Groq trend filter returned no candidates");
  }
  return result.candidates;
}

export async function writeB2BBlog(brief) {
  const text = await callGroq(buildBlogWriterPrompt(brief), 0.65);
  const blog = parseJson(text);
  if (!blog.title || !blog.content || !blog.faqs?.length) {
    throw new Error("Groq writer returned incomplete blog");
  }
  return blog;
}
