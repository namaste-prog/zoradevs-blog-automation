/**
 * Layer 2 & 4 — Groq trend filter + B2B content engine.
 */
import { callGroq, parseJson, sleep } from "./groq.js";

const BLOCKED = ["politics", "crypto hype", "celebrity gossip", "adult content", "US-only consumer tech"];
const MIN_WORDS = 1500;
const MAX_WORDS = 1800;

function countWords(text) {
  return String(text || "").split(/\s+/).filter(Boolean).length;
}

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

  const scrapedSample = scrapedText.slice(0, 2500);

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

Task: Return 5 unique B2B blog topic candidates for Indian market.

Return JSON only. CRITICAL: escape all newlines inside string values as \\n (no raw line breaks inside JSON strings).

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

Write a fresh, original blog for Indian B2B buyers (startups, CTOs, founders).

SERVICE FOCUS: ${brief.service}
TOPIC: ${brief.topic}
PRIMARY KEYWORD: ${brief.primaryKeyword}
SECONDARY KEYWORDS: ${brief.secondaryKeywords.join(", ")}
CATEGORY: ${brief.category}
TITLE ANGLE: ${brief.titleAngle}
INDIA ANGLE: ${brief.indiaAngle}

Requirements:
- 1500-1800 words in "content" (strict minimum 1500 words)
- Use markdown headings: ## for main sections (H2), ### for subsections (H3) — never show raw # symbols as plain text
- Use bullet lists with "- " prefix where helpful
- Strong B2B tone — practical, India-market specific
- Include 2-3 natural CTAs to contact Zoradevs for ${brief.service}
- Do NOT include FAQ section in content (use "faqs" array only)
- meta_title: 50-60 chars, include Zoradevs
- meta_description: 150-160 chars
- excerpt: max 300 chars
- slug: lowercase hyphens only
- tags: 5 tags
- keywords: 5 SEO keywords
- faqs: exactly 5 People Also Ask style Q&As

Return JSON only. CRITICAL: escape all newlines inside string values as \\n (no raw line breaks inside JSON strings).

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
  const text = await callGroq(buildTrendFilterPrompt(ctx), 0.4, {
    maxTokens: 2048,
    maxRetries: 4,
  });
  const result = parseJson(text);
  if (!result.candidates?.length) {
    throw new Error("Groq trend filter returned no candidates");
  }
  return result.candidates;
}

export async function writeB2BBlog(brief) {
  const delaySec = Number(process.env.GROQ_CALL_DELAY_SEC ?? 50);
  console.log(`Waiting ${delaySec}s before Groq writer (avoids 429 rate limit)...`);
  await sleep(delaySec * 1000);

  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const prompt =
        attempt === 1
          ? buildBlogWriterPrompt(brief)
          : `${buildBlogWriterPrompt(brief)}\n\nIMPORTANT: Previous response was invalid or too short. Return STRICT valid JSON with at least ${MIN_WORDS} words in "content". Use \\n for line breaks inside strings. Use ## and ### for headings only (not raw # in paragraph text).`;

      const text = await callGroq(prompt, 0.55, {
        maxTokens: 8192,
        maxRetries: 6,
      });
      const blog = parseJson(text);
      if (!blog.title || !blog.content || !blog.faqs?.length) {
        throw new Error("Groq writer returned incomplete blog");
      }
      const words = countWords(blog.content);
      console.log(`Blog word count: ${words}`);
      if (words < MIN_WORDS && attempt < 2) {
        throw new Error(`Blog too short (${words} words, need ${MIN_WORDS}+)`);
      }
      if (words > MAX_WORDS + 200) {
        console.warn(`Blog is ${words} words (target ${MIN_WORDS}-${MAX_WORDS})`);
      }
      return blog;
    } catch (err) {
      lastError = err;
      console.warn(`Groq writer attempt ${attempt} failed:`, err.message);
      if (attempt < 2) await sleep(10000);
    }
  }

  throw lastError ?? new Error("Groq writer failed");
}
