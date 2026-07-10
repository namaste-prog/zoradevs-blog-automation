/**
 * Layer 2 & 4 — Service-based topic generation + B2B content engine.
 * Blog body is written in 3 parts so we hit 2000+ words under Groq's ~12k TPM cap.
 */
import { callGroq, parseJson, sleep, isUsingFallbackModel } from "./groq.js";

const BLOCKED = ["politics", "crypto hype", "celebrity gossip", "adult content", "US-only consumer tech"];
const MIN_WORDS = 2000;
const MAX_WORDS = 2800;
/** Absolute floor — publish rather than fail when fallback model writes shorter. */
const ABSOLUTE_MIN_WORDS = Number(process.env.GROQ_ABSOLUTE_MIN_WORDS ?? 1400);
const PART_MAX_TOKENS = Number(process.env.GROQ_PART_MAX_TOKENS ?? 3200);
const META_MAX_TOKENS = Number(process.env.GROQ_META_MAX_TOKENS ?? 3500);
const TARGET_FAQ_COUNT = 10;
const MIN_FAQ_COUNT = 8;
/** Pause between large Groq writes so TPM (~12k/min) can refill. */
const PART_DELAY_MS = Number(process.env.GROQ_PART_DELAY_SEC ?? 25) * 1000;

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
    ? "Body prose may use Pan-India framing and mention Zoradevs' Delhi NCR / Noida presence where natural. Never put location or year into the title or H2/H3 headings."
    : "Body prose may reference Delhi NCR (Noida, Gurgaon/Gurugram, Delhi) business context where natural. Never put location or year into the title or H2/H3 headings — keep geo in keywords/metadata only.";
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
 * Titles/topics must read naturally — geo + year belong in keywords only.
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

  const scrapedSample = String(scrapedText || "").slice(0, 1200);

  return `You are a B2B SEO strategist for ZoraDevs (AI / software development company serving Indian businesses).

TARGET AUDIENCE:
Founders, CTOs, and SME operators evaluating software / AI partners. They care about ROI, software scale, hiring developers, product velocity, and AI-powered growth — NOT spammy keyword stuffing.

ZORADEVS CORE SERVICES (map EVERY candidate to one of these — primary context):
${serviceList || "- Software Development\n- AI Development\n- Mobile App Development\n- Website Development"}

INDUSTRY VERTICALS: ${industries}

LIGHTWEIGHT MARKET SIGNALS (homepage meta/H1/H2 only — compressed; do not invent deep-site claims):
${scrapedSample || "No competitor homepage signals — rely on core services only."}

TOPICS USED IN LAST 6 MONTHS (DO NOT REPEAT — no same topic, title, or keyword combo):
${recentList}

BLOCKED: ${BLOCKED.join(", ")}

TITLE / TOPIC RULES (critical):
- topic and title_angle must look 100% natural, professional, and human-appealing
- Good examples: "How AI is Transforming Modern E-Commerce Platforms", "Building Smarter Mobile Apps with AI", "Why AI Matters for Custom Software Teams"
- MUST organically include "AI" or a clear AI concept (artificial intelligence, machine learning, generative AI, etc.)
- MUST relate to one of our core services / industry verticals
- DO NOT force location words into topic or title_angle (no Noida, Delhi NCR, Gurgaon, India-as-geo-tag, etc.)
- DO NOT force a year into topic or title_angle (no 2026, 2025, etc.)
- DO NOT use rigid SEO formulas like "[Service] + AI + in [City] + [Year]"

KEYWORDS / METADATA RULES (geo lives HERE only):
- EVERY keywords array MUST include AI AND local/business-intent SEO terms
- Put location keywords ONLY in the keywords array (e.g. "AI development company Noida", "software development Delhi NCR", "IT company Noida")
- Also include business-intent phrases (founders, ROI, software scale, hire developers) — natural, not spammy
- Never repeat or closely rephrase any topic from the 6-month list
- Derive topics ONLY from the core services list (and industry verticals)

Task: Return 5 unique B2B blog topic candidates mapped to core services.

Return JSON only. CRITICAL: escape all newlines inside string values as \\n (no raw line breaks inside JSON strings).

Return JSON only:
{
  "candidates": [
    {
      "topic": "natural human title angle with AI, NO location, NO year",
      "service": "exact service title from list",
      "category": "blog category",
      "keywords": ["AI + business intent", "local SEO term e.g. Noida", "kw3", "kw4", "kw5"],
      "topic_key": "url-slug-dedup-key",
      "title_angle": "natural professional title direction (AI organic, no geo, no year)",
      "india_angle": "why Indian / Delhi NCR founders care (for body context only — not for the title)",
      "region_focus": "delhi-ncr | pan-india"
    }
  ]
}`;
}

function buildMetaPrompt(brief) {
  return `You are an expert B2B SEO writer for ZoraDevs.

${briefBlock(brief)}

STRICT TITLE RULES:
- Title must look 100% natural, professional, and appealing to humans
- Good example: "How AI is Transforming Modern E-Commerce Platforms"
- Title MUST organically include "AI" or a clear AI concept
- Title MUST relate to our core service / topic
- DO NOT put location in the title (no Noida, Delhi NCR, Gurgaon, India geo-tags)
- DO NOT put a year in the title (no 2026, etc.)
- DO NOT use formulaic SEO titles like "X AI in Noida 2026"

KEYWORDS / TAGS (geo belongs HERE only):
- Keywords must be business-intent (founders, ROI, software scale) — not spammy
- Include local SEO terms in keywords/tags only (Noida, Delhi NCR, etc.) — NEVER in title
- meta_title / meta_description may mention Zoradevs; keep them readable, not stuffed

Also return imageQuery: a 4-5 word LITERAL physical scene for stock photography
(e.g. "software developers working laptops office"). NEVER abstract concepts like "innovation" or "digital transformation".

FAQs (critical for SEO):
- Return EXACTLY 10 FAQ items
- Each question must be specific to the topic and useful for founders/CTOs
- Each answer must be 2–4 sentences, practical, not fluff

Return ONLY metadata JSON (no full article body yet). CRITICAL: escape newlines in strings as \\n.

{
  "title": "natural professional title with AI, no location, no year",
  "slug": "lowercase-hyphens-only",
  "excerpt": "max 300 chars",
  "meta_title": "50-60 chars including Zoradevs",
  "meta_description": "150-160 chars",
  "keywords": ["AI keyword", "local SEO e.g. Noida", "business intent", "...", "..."],
  "tags": ["5 tags", "include AI", "...", "...", "..."],
  "imageQuery": "four or five word physical scene",
  "faqs": [
    { "question": "FAQ 1?", "answer": "..." },
    { "question": "FAQ 2?", "answer": "..." },
    { "question": "FAQ 3?", "answer": "..." },
    { "question": "FAQ 4?", "answer": "..." },
    { "question": "FAQ 5?", "answer": "..." },
    { "question": "FAQ 6?", "answer": "..." },
    { "question": "FAQ 7?", "answer": "..." },
    { "question": "FAQ 8?", "answer": "..." },
    { "question": "FAQ 9?", "answer": "..." },
    { "question": "FAQ 10?", "answer": "..." }
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
## Why This Matters for Growing Businesses
## The Core Problem Startups Face
## Market Context and Opportunity

Use natural, professional H2/H3 headings — do NOT force "Noida", "Delhi NCR", or a year into headings.
You may mention local Indian business context in the body prose where it fits naturally. Weave AI organically. Focus on ROI and software scale.`,
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
- Dense, useful B2B writing — not filler
- HARD REQUIREMENT: this part must be at least 650 words (prefer ${cfg.target})`;
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
  const minWords = 400;
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const useMarkdownOnly = attempt >= 2;
      const prompt = useMarkdownOnly
        ? `${buildPartPrompt(brief, title, part)}

IMPORTANT: Return ONLY markdown body text. Do NOT wrap in JSON. Do NOT use code fences. Start directly with ## heading.
HARD REQUIREMENT: write at least 650 words for this part.`
        : buildPartPrompt(brief, title, part);

      const text = await callGroq(prompt, 0.55, {
        maxTokens: Math.max(PART_MAX_TOKENS, isUsingFallbackModel() ? 4000 : PART_MAX_TOKENS),
        maxRetries: 4,
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
      if (attempt < 3) await sleep(partDelayMs());
    }
  }

  throw lastError ?? new Error(`Part ${part} failed after retries`);
}

function partDelayMs() {
  // Fallback 8B models usually have higher TPM — shorter pause.
  if (isUsingFallbackModel()) {
    return Number(process.env.GROQ_FALLBACK_PART_DELAY_SEC ?? 8) * 1000;
  }
  return PART_DELAY_MS;
}

/**
 * Append-only expansion — small models often fail at rewriting the full article.
 */
async function expandIfNeeded(brief, title, content) {
  const words = countWords(content);
  if (words >= MIN_WORDS) return content;

  const needed = Math.max(400, MIN_WORDS - words + 100);
  console.log(`Appending ~${needed} words (currently ${words})...`);
  await sleep(partDelayMs());

  const text = await callGroq(
    `You are expanding a ZoraDevs B2B blog. Do NOT rewrite existing sections.
Write ONLY new markdown sections to APPEND (start with ##). Target about ${needed} words total across these headings:

## Real-World Use Cases
## Budget and Timeline Considerations
## Implementation Pitfalls and How to Avoid Them

Rules:
- Return ONLY the new sections (markdown). No JSON. No code fences.
- Do not repeat the title or earlier sections.
- Dense, practical B2B detail. Weave AI naturally.
- No location/year stuffing in headings.

ARTICLE TITLE: ${title}
TOPIC: ${brief.topic}
PRIMARY KEYWORD: ${brief.primaryKeyword}
EXISTING TAIL (context only — do not copy):
${content.slice(-1200)}`,
    0.55,
    {
      maxTokens: Math.max(PART_MAX_TOKENS, 4000),
      maxRetries: 4,
    }
  );

  const addition = extractContentFromResponse(text).trim();
  const addWords = countWords(addition);
  if (!addition || addWords < 120) {
    console.warn(`Expand append too short (${addWords} words) — keeping original length`);
    return content;
  }

  // Strip closing paragraph from body before append; re-added later.
  const body = content
    .replace(/\n*At ZoraDevs, an AI development company based in Noida[\s\S]*$/i, "")
    .trim();
  const merged = `${body}\n\n${addition}`;
  console.log(`Appended ${addWords} words → ${countWords(merged)} total`);
  return merged;
}

function normalizeFaqs(faqs) {
  if (!Array.isArray(faqs)) return [];
  return faqs
    .map((f) => ({
      question: String(f?.question || "").trim(),
      answer: String(f?.answer || "").trim(),
    }))
    .filter((f) => f.question.length >= 5 && f.answer.length >= 10)
    .slice(0, TARGET_FAQ_COUNT);
}

async function ensureTenFaqs(brief, title, existingFaqs = []) {
  let faqs = normalizeFaqs(existingFaqs);
  if (faqs.length >= MIN_FAQ_COUNT) {
    return faqs.slice(0, TARGET_FAQ_COUNT);
  }

  console.warn(
    `Only ${faqs.length} FAQs from metadata — generating dedicated FAQ set (target ${TARGET_FAQ_COUNT})...`
  );

  const text = await callGroq(
    `Generate EXACTLY ${TARGET_FAQ_COUNT} SEO FAQs for this ZoraDevs B2B blog.

TITLE: ${title}
TOPIC: ${brief.topic}
SERVICE: ${brief.service}
PRIMARY KEYWORD: ${brief.primaryKeyword}

Rules:
- Exactly ${TARGET_FAQ_COUNT} items
- Questions founders/CTOs would actually search
- Answers 2–4 sentences, practical
- Return JSON only: { "faqs": [ { "question": "...", "answer": "..." } ] }
- Escape newlines in strings as \\n`,
    0.4,
    { maxTokens: 3500, maxRetries: 4 }
  );

  const parsed = parseJson(text);
  faqs = normalizeFaqs(parsed.faqs);
  if (faqs.length < MIN_FAQ_COUNT) {
    throw new Error(`FAQ generation returned only ${faqs.length} valid items (need ${MIN_FAQ_COUNT}+)`);
  }
  return faqs.slice(0, TARGET_FAQ_COUNT);
}

/**
 * Single metadata + FAQ pass (used by orchestrator for AI-title validation).
 */
export async function writeBlogMetadata(brief) {
  const metaText = await callGroq(buildMetaPrompt(brief), 0.45, {
    maxTokens: META_MAX_TOKENS,
    maxRetries: 4,
  });
  const meta = parseJson(metaText);
  if (!meta.title) {
    throw new Error("Groq writer returned incomplete metadata (missing title)");
  }

  meta.faqs = await ensureTenFaqs(brief, meta.title, meta.faqs);
  meta.imageQuery = normalizeImageQuery(meta.imageQuery, meta.keywords || brief.secondaryKeywords);
  console.log(`Metadata FAQs ready: ${meta.faqs.length}`);
  return meta;
}

/**
 * Write multi-part body from already-validated metadata.
 */
export async function writeB2BBlogBody(brief, meta) {
  const title = meta.title;
  const delay = partDelayMs();

  console.log(`Writer pass: content part 1/3 (waiting ${delay / 1000}s for TPM)...`);
  await sleep(delay);
  const part1 = await writeContentPart(brief, title, 1);

  console.log(`Writer pass: content part 2/3 (waiting ${partDelayMs() / 1000}s for TPM)...`);
  await sleep(partDelayMs());
  const part2 = await writeContentPart(brief, title, 2);

  console.log(`Writer pass: content part 3/3 (waiting ${partDelayMs() / 1000}s for TPM)...`);
  await sleep(partDelayMs());
  const part3 = await writeContentPart(brief, title, 3);

  let content = [part1, part2, part3].join("\n\n").trim();
  let words = countWords(content);
  console.log(`Combined blog word count: ${words}`);

  // Up to 3 append-only expand passes.
  for (let pass = 1; pass <= 3 && words < MIN_WORDS; pass++) {
    console.log(`Expand pass ${pass}/3...`);
    content = await expandIfNeeded(brief, title, content);
    words = countWords(content);
    console.log(`After expand pass ${pass}: ${words} words`);
  }

  content = ensureZoradevsClosing(content);
  words = countWords(content);

  if (words < ABSOLUTE_MIN_WORDS) {
    throw new Error(
      `Blog too short after multi-part write (${words} words, need at least ${ABSOLUTE_MIN_WORDS})`
    );
  }
  if (words < MIN_WORDS) {
    console.warn(
      `Accepting ${words} words (target ${MIN_WORDS}+; absolute min ${ABSOLUTE_MIN_WORDS})` +
        (isUsingFallbackModel() ? " [fallback model]" : "")
    );
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
  const delaySec = Number(process.env.GROQ_CALL_DELAY_SEC ?? 15);
  console.log(`Waiting ${delaySec}s before Groq writer (TPM cooldown after topic pick)...`);
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
    if (attempt < maxTitleRetries) await sleep(partDelayMs());
  }

  if (!meta || !titleContainsAi(meta.title)) {
    throw new Error(`Title must contain "AI" after ${maxTitleRetries} metadata retries`);
  }

  return writeB2BBlogBody(brief, meta);
}
