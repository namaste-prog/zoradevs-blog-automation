/**
 * Layer 2 & 4 — Service-based topic generation + B2B content engine.
 * Blog body is written in 3 parts so we hit 2000+ words under Groq's ~12k TPM cap.
 */
import { callGroq, parseJson, sleep } from "./groq.js";

const BLOCKED = ["politics", "crypto hype", "celebrity gossip", "adult content", "US-only consumer tech"];
const MIN_WORDS = 2000;
const MAX_WORDS = 2800;
const PART_MAX_TOKENS = Number(process.env.GROQ_PART_MAX_TOKENS ?? 4500);
const META_MAX_TOKENS = Number(process.env.GROQ_META_MAX_TOKENS ?? 3500);
const TITLE_YEAR = 2026;

/** Exact closing paragraph required on every published blog (SEO roadmap). */
export const ZORADEVS_CLOSING_PARAGRAPH =
  "At ZoraDevs, an AI development company based in Noida, we build AI-powered solutions for Indian businesses across fintech, e-commerce, healthcare, and B2B services. Whether you need a complete AI system built, an AI feature added to your existing product, or a dedicated AI developer on your team through staff augmentation, we work with businesses across Noida, Delhi NCR, and pan-India. Contact us at zoradevs.com/contact or DM us directly to discuss your requirement.";

function countWords(text) {
  return String(text || "").split(/\s+/).filter(Boolean).length;
}

export function titleContainsAi(title) {
  return /ai/i.test(String(title || ""));
}

function regionInstruction(regionFocus) {
  return regionFocus === "pan-india"
    ? "Use Pan-India framing, but still mention Delhi NCR / Noida presence of Zoradevs where natural."
    : "PRIMARY GEO FOCUS: Delhi NCR (Noida, Gurgaon/Gurugram, Delhi, Greater Noida). Mention local business context, hiring, and delivery advantages. Pan-India only as supporting context.";
}

function briefBlock(brief) {
  return `SERVICE FOCUS: ${brief.service}
TOPIC: ${brief.topic}
PRIMARY KEYWORD: ${brief.primaryKeyword}
SECONDARY KEYWORDS: ${brief.secondaryKeywords.join(", ")}
CATEGORY: ${brief.category}
TITLE ANGLE: ${brief.titleAngle}
REGION ANGLE: ${brief.indiaAngle}
REGION FOCUS: ${brief.regionFocus || "delhi-ncr"}

${regionInstruction(brief.regionFocus || "delhi-ncr")}`;
}

/**
 * Ensure the blog ends with the exact ZoraDevs closing paragraph (word-for-word).
 */
export function ensureZoradevsClosing(content) {
  const body = String(content || "").trim();
  if (!body) return ZORADEVS_CLOSING_PARAGRAPH;

  // Strip a trailing closing that already starts like our template (avoid duplicates).
  const stripped = body
    .replace(
      /\n*At ZoraDevs, an AI development company based in Noida[\s\S]*$/i,
      ""
    )
    .trim();

  return `${stripped}\n\n${ZORADEVS_CLOSING_PARAGRAPH}`;
}

/**
 * Build topic-selection prompt from core services (no Google Trends).
 * Titles must follow Pattern 1 or Pattern 2 with a 2026 anchor.
 */
export function buildTrendFilterPrompt({
  services,
  industryVerticals,
  scrapedText,
  recentTopics,
}) {
  const serviceList = (services || [])
    .map((s) => `- ${s.title} (${s.category}): stacks ${(s.stacks || []).join(", ")}`)
    .join("\n");

  const industries = (industryVerticals || []).join(", ") || "Fintech, Healthcare, E-Commerce, B2B SaaS";

  const recentList =
    recentTopics?.length > 0
      ? recentTopics.map((t) => `- ${t.title} [${t.topicKey}]`).join("\n")
      : "None";

  const scrapedSample = String(scrapedText || "").slice(0, 2500);

  return `You are a B2B SEO strategist for ZoraDevs (AI / software development company in Noida / Delhi NCR, India).

TARGET AUDIENCE (priority order):
1. PRIMARY: Delhi NCR buyers — Noida, Gurgaon (Gurugram), Delhi, Greater Noida founders, CTOs, and SME operators
2. SECONDARY: Pan-India businesses evaluating software / AI partners

Buyers care about ROI, software scale, hiring developers, product velocity, and AI-powered growth — NOT spammy keyword stuffing.

ZORADEVS CORE SERVICES (map EVERY candidate to one of these):
${serviceList || "- Software Development\n- AI Development\n- Mobile App Development\n- Website Development"}

INDUSTRY VERTICALS: ${industries}

WEBSITE INTELLIGENCE (Zoradevs + competitors — titles, H1/H2, meta):
${scrapedSample || "Use service list only."}

TOPICS USED IN LAST 6 MONTHS (DO NOT REPEAT — no same topic, title, or keyword combo):
${recentList}

BLOCKED: ${BLOCKED.join(", ")}

STRICT TITLE FORMULA (2026 anchor — every candidate topic / title_angle MUST match ONE pattern):
- Pattern 1: [Service/Industry] + AI + in [India/Noida/Delhi NCR] + ${TITLE_YEAR}
  Example: "Fintech AI in Delhi NCR ${TITLE_YEAR}"
- Pattern 2: AI + [Service/Industry] + in [India/Noida/Delhi NCR] + ${TITLE_YEAR}
  Example: "AI Mobile App Development in Noida ${TITLE_YEAR}"

HARD RULES:
- Derive topics ONLY from the core services list (and industry verticals), never from news/trends feeds
- Prefer Noida / Delhi NCR in the geo slot; use India when a broader angle is clearer
- EVERY keywords array MUST include AI (e.g. "AI", "AI automation") AND business-intent phrases (founders, ROI, software scale, hire developers, product growth)
- Keywords must sound natural and commercial — DO NOT look spammy or stuffed
- Never repeat or closely rephrase any topic from the 6-month list

Task: Return 5 unique B2B blog topic candidates mapped to core services.

Return JSON only. CRITICAL: escape all newlines inside string values as \\n (no raw line breaks inside JSON strings).

Return JSON only:
{
  "candidates": [
    {
      "topic": "must match Pattern 1 or Pattern 2 with ${TITLE_YEAR}",
      "service": "exact service title from list",
      "category": "blog category",
      "keywords": ["business-intent primary with AI + region", "kw2", "kw3", "kw4", "kw5"],
      "topic_key": "url-slug-dedup-key",
      "title_angle": "same Pattern 1 or Pattern 2 as topic",
      "india_angle": "why Noida / Delhi NCR / India founders care (ROI, scale)",
      "region_focus": "delhi-ncr | pan-india"
    }
  ]
}`;
}

function buildMetaPrompt(brief) {
  return `You are an expert B2B SEO writer for ZoraDevs (Noida / Delhi NCR).

${briefBlock(brief)}

STRICT TITLE RULES:
- Title MUST contain the substring "AI" (case-insensitive)
- Title MUST follow ONE of these patterns with ${TITLE_YEAR}:
  Pattern 1: [Service/Industry] + AI + in [India/Noida/Delhi NCR] + ${TITLE_YEAR}
  Pattern 2: AI + [Service/Industry] + in [India/Noida/Delhi NCR] + ${TITLE_YEAR}
- Keywords must be business-intent (founders, ROI, software scale) — not spammy

Also return imageQuery: a 4-5 word LITERAL physical scene for stock photography
(e.g. "software developers working laptops office"). NEVER abstract concepts like "innovation" or "digital transformation".

Return ONLY metadata JSON (no full article body yet). CRITICAL: escape newlines in strings as \\n.

{
  "title": "must include AI and ${TITLE_YEAR} per Pattern 1 or 2",
  "slug": "lowercase-hyphens-only",
  "excerpt": "max 300 chars",
  "meta_title": "50-60 chars including Zoradevs",
  "meta_description": "150-160 chars",
  "keywords": ["5 SEO keywords", "must include AI", "business intent", "...", "..."],
  "tags": ["5 tags", "include AI", "...", "...", "..."],
  "imageQuery": "four or five word physical scene",
  "faqs": [
    { "question": "...", "answer": "..." },
    { "question": "...", "answer": "..." },
    { "question": "...", "answer": "..." },
    { "question": "...", "answer": "..." },
    { "question": "...", "answer": "..." }
  ]
}`;
}

function buildPartPrompt(brief, title, part) {
  const parts = {
    1: {
      label: "PART 1 of 3",
      target: "700-900 words",
      sections: `Write ONLY these sections in markdown:
## Introduction
## Why This Matters for Delhi NCR Businesses
## The Core Problem Startups Face
## Market Context in India and Delhi NCR

Include practical examples for Noida / Gurgaon / Delhi founders. Weave AI naturally. Focus on ROI and software scale.`,
    },
    2: {
      label: "PART 2 of 3",
      target: "700-900 words",
      sections: `Continue the SAME article titled "${title}". Do NOT repeat the intro.
Write ONLY these sections in markdown:
## Solution Approach with AI
## Step-by-Step Implementation Guide
## Recommended Tech Stack and Architecture
## How Zoradevs Helps (${brief.service})

Be detailed and actionable. Include one soft CTA to contact Zoradevs.`,
    },
    3: {
      label: "PART 3 of 3",
      target: "700-900 words",
      sections: `Continue the SAME article titled "${title}". Do NOT repeat earlier sections.
Write ONLY these sections in markdown:
## Business Impact and ROI
## Common Mistakes to Avoid
## Checklist for Decision Makers
## Conclusion and Next Steps

After the Conclusion section, end the article with EXACTLY this paragraph word-for-word (no edits, no extras):
"${ZORADEVS_CLOSING_PARAGRAPH}"

Do not invent a different closing CTA.`,
    },
  };

  const cfg = parts[part];
  return `You are an expert B2B content writer for ZoraDevs.

${briefBlock(brief)}

ARTICLE TITLE: ${title}
${cfg.label} — write ${cfg.target} of markdown body only.

${cfg.sections}

Rules:
- Output JSON only: { "content": "markdown here with \\n for newlines" }
- Use ## and ### headings only
- No FAQ section in content
- No title/H1 at the top
- Dense, useful B2B writing — not filler`;
}

/**
 * Service-mapped topic candidates (replaces Google Trends filtering).
 * Kept export name for compatibility with the orchestrator.
 */
export async function filterTrendsWithGroq(ctx) {
  const text = await callGroq(
    buildTrendFilterPrompt({
      services: ctx.services,
      industryVerticals: ctx.industryVerticals,
      scrapedText: ctx.scrapedText,
      recentTopics: ctx.recentTopics,
    }),
    0.4,
    {
      maxTokens: 2048,
      maxRetries: 4,
    }
  );
  const result = parseJson(text);
  if (!result.candidates?.length) {
    throw new Error("Groq topic generator returned no candidates");
  }

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

function extractContentFromResponse(text) {
  if (!text?.trim()) return "";

  try {
    const parsed = parseJson(text);
    const fromJson = String(
      parsed.content ?? parsed.body ?? parsed.markdown ?? parsed.text ?? ""
    ).trim();
    if (fromJson) return fromJson;
  } catch {
    // Fall through to markdown extraction.
  }

  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  if (/^##\s/m.test(cleaned) || /^#\s/m.test(cleaned)) {
    return cleaned.replace(/^\{[\s\S]*?"content"\s*:\s*"/, "").replace(/"\s*\}$/, "");
  }

  const contentMatch = cleaned.match(/"content"\s*:\s*"([\s\S]*)"\s*[,}]/);
  if (contentMatch?.[1]) {
    return contentMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').trim();
  }

  return cleaned;
}

function normalizeImageQuery(raw, fallbackKeywords = []) {
  const cleaned = String(raw || "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const words = cleaned.split(" ").filter(Boolean).slice(0, 5);
  if (words.length >= 3) return words.join(" ");

  const fallback = String(fallbackKeywords[0] || "software developers working laptops office")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .slice(0, 5)
    .join(" ");

  return fallback || "software developers working laptops office";
}

async function writeContentPart(brief, title, part) {
  const minWords = 300;
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const useMarkdownOnly = attempt >= 2;
      const prompt = useMarkdownOnly
        ? `${buildPartPrompt(brief, title, part)}

IMPORTANT: Return ONLY markdown body text. Do NOT wrap in JSON. Do NOT use code fences. Start directly with ## heading.`
        : buildPartPrompt(brief, title, part);

      const text = await callGroq(prompt, 0.55, {
        maxTokens: PART_MAX_TOKENS,
        maxRetries: 6,
      });

      const content = extractContentFromResponse(text);
      const words = countWords(content);

      if (!content || words < minWords) {
        throw new Error(`Part ${part} too short (${words} words)`);
      }

      console.log(`Part ${part} word count: ${words}${useMarkdownOnly ? " (markdown mode)" : ""}`);
      return content;
    } catch (err) {
      lastError = err;
      console.warn(`Part ${part} attempt ${attempt} failed:`, err.message);
      if (attempt < 3) await sleep(15000);
    }
  }

  throw lastError ?? new Error(`Part ${part} failed after retries`);
}

async function expandIfNeeded(brief, title, content) {
  const words = countWords(content);
  if (words >= MIN_WORDS) return content;

  const needed = MIN_WORDS - words + 150;
  console.log(`Expanding blog by ~${needed} words (currently ${words})...`);
  await sleep(15000);

  const text = await callGroq(
    `Expand this Zoradevs B2B blog. Keep existing sections. Add deeper detail under existing H2/H3 headings and/or add:
## Real-World Use Cases in Delhi NCR
## Budget and Timeline Considerations

Target: add about ${needed} words. Return ONLY the full expanded markdown body (no JSON, no code fences).
Do NOT change or remove the final ZoraDevs closing paragraph if present.

TITLE: ${title}
TOPIC: ${brief.topic}
PRIMARY KEYWORD: ${brief.primaryKeyword}

CURRENT CONTENT:
${content.slice(0, 9000)}`,
    0.5,
    { maxTokens: PART_MAX_TOKENS, maxRetries: 5 }
  );

  const expanded = extractContentFromResponse(text);
  return countWords(expanded) > countWords(content) ? expanded : content;
}

/**
 * Single metadata + FAQ pass (used by orchestrator for AI-title validation).
 */
export async function writeBlogMetadata(brief) {
  const metaText = await callGroq(buildMetaPrompt(brief), 0.45, {
    maxTokens: META_MAX_TOKENS,
    maxRetries: 6,
  });
  const meta = parseJson(metaText);
  if (!meta.title || !meta.faqs?.length) {
    throw new Error("Groq writer returned incomplete metadata");
  }

  meta.imageQuery = normalizeImageQuery(meta.imageQuery, meta.keywords || brief.secondaryKeywords);
  return meta;
}

/**
 * Write multi-part body from already-validated metadata.
 */
export async function writeB2BBlogBody(brief, meta) {
  const title = meta.title;
  console.log("Writer pass: content part 1/3...");
  await sleep(12000);
  const part1 = await writeContentPart(brief, title, 1);

  console.log("Writer pass: content part 2/3...");
  await sleep(12000);
  const part2 = await writeContentPart(brief, title, 2);

  console.log("Writer pass: content part 3/3...");
  await sleep(12000);
  const part3 = await writeContentPart(brief, title, 3);

  let content = [part1, part2, part3].join("\n\n").trim();
  let words = countWords(content);
  console.log(`Combined blog word count: ${words}`);

  if (words < MIN_WORDS) {
    content = await expandIfNeeded(brief, title, content);
    words = countWords(content);
    console.log(`Expanded blog word count: ${words}`);
  }

  if (words < MIN_WORDS) {
    console.log("Running second expand pass...");
    await sleep(15000);
    content = await expandIfNeeded(brief, title, content);
    words = countWords(content);
    console.log(`Second expand word count: ${words}`);
  }

  content = ensureZoradevsClosing(content);
  words = countWords(content);

  if (words < 1500) {
    throw new Error(`Blog too short after multi-part write (${words} words, need at least 1500)`);
  }
  if (words < MIN_WORDS) {
    console.warn(`Accepting ${words} words (target ${MIN_WORDS}+) after multi-part + expand`);
  }
  if (words > MAX_WORDS + 400) {
    console.warn(`Blog is ${words} words (target ${MIN_WORDS}-${MAX_WORDS})`);
  }

  return {
    title: meta.title,
    slug: meta.slug,
    excerpt: meta.excerpt,
    content,
    meta_title: meta.meta_title,
    meta_description: meta.meta_description,
    keywords: meta.keywords,
    tags: meta.tags,
    faqs: meta.faqs,
    imageQuery: normalizeImageQuery(meta.imageQuery, meta.keywords),
  };
}

export async function writeB2BBlog(brief, { maxTitleRetries = 3 } = {}) {
  const delaySec = Number(process.env.GROQ_CALL_DELAY_SEC ?? 40);
  console.log(`Waiting ${delaySec}s before Groq writer (avoids 429 rate limit)...`);
  await sleep(delaySec * 1000);

  let meta = null;
  for (let attempt = 1; attempt <= maxTitleRetries; attempt++) {
    console.log(`Writer pass: metadata + FAQs (attempt ${attempt}/${maxTitleRetries})...`);
    meta = await writeBlogMetadata(brief);
    if (titleContainsAi(meta.title)) {
      console.log(`Title AI check passed: ${meta.title}`);
      break;
    }
    console.warn(
      `Title missing "AI" (attempt ${attempt}): "${meta.title}" — regenerating metadata...`
    );
    meta = null;
    if (attempt < maxTitleRetries) await sleep(10000);
  }

  if (!meta || !titleContainsAi(meta.title)) {
    throw new Error(`Title must contain "AI" after ${maxTitleRetries} metadata retries`);
  }

  return writeB2BBlogBody(brief, meta);
}
