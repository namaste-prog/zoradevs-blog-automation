/**
 * Layer 2 & 4 — Groq trend filter + B2B content engine.
 */
import { callGroq, parseJson, sleep } from "./groq.js";

const BLOCKED = ["politics", "crypto hype", "celebrity gossip", "adult content", "US-only consumer tech"];
const MIN_WORDS = 2000;
const MAX_WORDS = 2600;

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

  return `You are a B2B SEO strategist for Zoradevs (software development company in Noida / Delhi NCR, India).

TARGET AUDIENCE (priority order):
1. PRIMARY: Delhi NCR buyers — Noida, Gurgaon (Gurugram), Delhi, Greater Noida, Faridabad startups/SMEs/enterprises
2. SECONDARY: Pan-India only if the topic is not strongly localizable to Delhi NCR

Buyers care about Web Dev, Mobile Apps, AI/ML automation, staff augmentation.

ZORADEVS SERVICES:
${serviceList}

INDUSTRY VERTICALS: ${industryVerticals.join(", ")}

GOOGLE TRENDS INDIA (live):
${trendsList || "No live trends — infer from market text pool."}

WEBSITE INTELLIGENCE (Zoradevs + competitors — titles, H1/H2, meta):
${scrapedSample}

TOPICS USED IN LAST 6 MONTHS (DO NOT REPEAT — no same topic, title, or keyword combo):
${recentList}

BLOCKED: ${BLOCKED.join(", ")}

HARD RULES:
- Prefer Delhi NCR angles (Noida / Gurgaon / Delhi) in topic + keywords whenever possible
- Fall back to Pan-India only when Delhi NCR does not fit
- EVERY candidate keywords array MUST include AI (e.g. "AI", "AI automation", "artificial intelligence") because AI is trending
- Never repeat or closely rephrase any topic from the 6-month list

Task: Return 5 unique B2B blog topic candidates (Delhi NCR first, then Pan-India).

Return JSON only. CRITICAL: escape all newlines inside string values as \\n (no raw line breaks inside JSON strings).

Return JSON only:
{
  "candidates": [
    {
      "topic": "one sentence angle with Delhi NCR or India focus",
      "service": "exact service title from list",
      "category": "blog category",
      "keywords": ["primary with AI + region", "kw2", "kw3", "kw4", "kw5"],
      "topic_key": "url-slug-dedup-key",
      "title_angle": "B2B title direction",
      "india_angle": "why Delhi NCR (or Pan-India) businesses care",
      "region_focus": "delhi-ncr | pan-india"
    }
  ]
}`;
}

export function buildBlogWriterPrompt(brief) {
  const regionFocus = brief.regionFocus || "delhi-ncr";
  const regionInstruction =
    regionFocus === "pan-india"
      ? "Use Pan-India framing, but still mention Delhi NCR / Noida presence of Zoradevs where natural."
      : "PRIMARY GEO FOCUS: Delhi NCR (Noida, Gurgaon/Gurugram, Delhi, Greater Noida). Mention local business context, hiring, and delivery advantages. Pan-India only as supporting context.";

  return `You are an expert B2B content writer for Zoradevs, a software development company in Noida (Delhi NCR), India.

Write a fresh, original blog for B2B buyers (startups, CTOs, founders).

SERVICE FOCUS: ${brief.service}
TOPIC: ${brief.topic}
PRIMARY KEYWORD: ${brief.primaryKeyword}
SECONDARY KEYWORDS: ${brief.secondaryKeywords.join(", ")}
CATEGORY: ${brief.category}
TITLE ANGLE: ${brief.titleAngle}
REGION ANGLE: ${brief.indiaAngle}
REGION FOCUS: ${regionFocus}

${regionInstruction}

Requirements:
- 2000-2600 words in "content" (strict minimum 2000 words — aim for more depth, not filler)
- Cover: intro, market context (Delhi NCR / India), problem, solution approach, implementation steps, AI angle, ROI/business impact, common mistakes, conclusion
- Use markdown headings: ## for main sections (H2), ### for subsections (H3) — never show raw # symbols as plain text
- Use bullet lists with "- " prefix where helpful
- Strong B2B tone — practical, Delhi NCR / India-market specific
- Naturally weave AI into the narrative (AI is trending — every post must connect to AI)
- Include 2-3 natural CTAs to contact Zoradevs for ${brief.service}
- Do NOT include FAQ section in content (use "faqs" array only)
- meta_title: 50-60 chars, include Zoradevs
- meta_description: 150-160 chars
- excerpt: max 300 chars
- slug: lowercase hyphens only
- tags: 5 tags (at least one must include AI)
- keywords: exactly 5 SEO keywords — at least one MUST contain "AI" or "artificial intelligence"
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

  // Prefer Delhi NCR candidates first, then Pan-India.
  const ranked = [...result.candidates].sort((a, b) => {
    const score = (c) => {
      const region = String(c.region_focus || "").toLowerCase();
      const blob = `${c.topic || ""} ${c.india_angle || ""} ${(c.keywords || []).join(" ")}`.toLowerCase();
      const isNcr =
        region.includes("delhi") ||
        /noida|gurgaon|gurugram|delhi ncr|greater noida|faridabad/.test(blob);
      return isNcr ? 0 : 1;
    };
    return score(a) - score(b);
  });

  return ranked;
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
