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

KEYWORDS / METADATA RULES (geo lives HERE only — never in titles or headings):
- Return EXACTLY 5 keywords — no more, no less
- EVERY keyword MUST be a multi-word phrase (2–6 words). Ban single words like "AI", "Noida", "Growth"
- ALL 5 must directly relate to the candidate blog topic — not generic agency lists
- Write 3–4 topic-specific phrases + up to 2 local Noida/Delhi NCR phrases only when they match the topic
- NEVER use generic unrelated phrases like "IT company Noida" unless the topic is about vendor selection
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
      "keywords": ["AI e-commerce growth strategies", "retail customer experience automation", "B2B software scale India", "hire AI developers Noida", "custom web app ROI"],
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

KEYWORDS (mandatory — exactly 5, blog-specific only):
- Return EXACTLY 5 keywords/phrases — no more, no less
- EVERY keyword MUST be a multi-word phrase (2–6 words). Ban single words like "AI", "Development", "Noida", "Growth"
- ALL 5 must directly relate to THIS blog title and service — nothing generic or off-topic
- Write 3–4 phrases about the blog subject (industry + AI angle from the title)
- Add 1–2 phrases with Noida or Delhi NCR ONLY if they still match this blog topic (e.g. "AI retail automation Noida" for a retail blog)
- NEVER use generic unrelated phrases like "IT company Noida" or "software development company Noida" unless the blog is about hiring a vendor
- Location words belong ONLY in the keywords array — NEVER in title, excerpt, or headings
- Output keywords strictly as a JSON array of exactly 5 strings
- Tags: 5 short multi-word tags related to this blog (separate from keywords; do not duplicate keywords as tags)

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
  "keywords": ["AI e-commerce growth strategies", "retail customer experience automation", "AI checkout personalization tools", "ecommerce conversion rate optimization", "AI retail automation Noida"],
  "tags": ["AI product engineering", "e-commerce automation", "B2B software delivery", "founder growth playbook", "retail tech stack"],
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
  const linkGuide = `INTERNAL LINKS (mandatory across the full article — use markdown links):
Include natural in-body links to ZoraDevs pages. Across ALL 3 parts combined there must be at least 4–5 unique https://zoradevs.com/... links.
Preferred targets (pick what fits the topic):
- [AI Development](https://zoradevs.com/services/ai-development)
- [Custom Software Development](https://zoradevs.com/services/custom-software-development)
- [Web App Development](https://zoradevs.com/services/web-app-development)
- [Mobile App Development](https://zoradevs.com/services/mobile-app-development)
- [Hire Software Developers](https://zoradevs.com/services/hire-software-developers)
- [Website Development](https://zoradevs.com/services/website-development)
- [Contact ZoraDevs](https://zoradevs.com/contact)
- [ZoraDevs Blog](https://zoradevs.com/blog)
Do NOT dump a raw link list. Weave links into sentences naturally.`;

  const formatGuide = `FORMATTING (mandatory):
- Prefer bullet points (- item) and short numbered steps over long paragraphs
- Keep each paragraph to 2–3 sentences maximum — never write dense walls of text
- After a short intro sentence under a heading, switch to bullets for details, benefits, steps, and tips
- Step-by-Step, Tech Stack, Mistakes, Checklist, and ROI sections MUST be mostly bullet lists
- Leave clear spacing: one blank line between headings, short paragraphs, and lists`;

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
You may mention local Indian business context in the body prose where it fits naturally. Weave AI organically. Focus on ROI and software scale.
Include 1–2 natural ZoraDevs internal links in this part.
Under each H2 after Introduction: 1 short paragraph max, then bullet points.`,
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

Be detailed and actionable. Include 2–3 natural ZoraDevs service page links (markdown) in this part.
Step-by-Step and Tech Stack MUST use bullet or numbered lists as the main content.`,
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

Impact, Mistakes, and Checklist MUST be bullet-heavy (pointers, not long paragraphs).
Include at least 1 natural link to https://zoradevs.com/contact in Conclusion.
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

${formatGuide}

${linkGuide}

Rules:
- Output JSON only: { "content": "markdown here with \\n for newlines" }
- Use ## and ### headings only
- No FAQ section in content
- No title/H1 at the top
- Dense, scannable B2B writing — bullets first, short paragraphs second — not filler
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

const ABSTRACT_IMAGE_TERMS = new Set([
  "concept",
  "abstract",
  "background",
  "futuristic",
  "matrix",
  "innovation",
  "transformation",
  "neon",
  "glow",
  "hologram",
  "metaverse",
]);

function normalizeImageQuery(raw, fallbackPhrase = "") {
  const cleaned = String(raw || "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const words = cleaned
    .split(" ")
    .filter(Boolean)
    .filter((w) => !ABSTRACT_IMAGE_TERMS.has(w))
    .slice(0, 8);

  if (words.length >= 3) return words.join(" ");

  const fallback = String(fallbackPhrase || "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .filter((w) => !ABSTRACT_IMAGE_TERMS.has(w))
    .slice(0, 8)
    .join(" ");

  return fallback || "retail analytics dashboard team meeting";
}

/**
 * Generate imageQuery AFTER the final title + content exist.
 * Highly specific, domain-relevant stock-photo phrase (not generic office fluff).
 */
export async function generateImageQueryFromBlog({ title, content, topic, service }) {
  const summary = String(content || "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*_`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);

  console.log("Generating dynamic imageQuery from final title + content summary...");
  await sleep(partDelayMs());

  const text = await callGroq(
    `You create stock-photo search queries for Unsplash/Pexels.

Analyze this FINAL blog heading and content summary, then return ONE highly specific, descriptive, professional visual search phrase for a landscape cover image.

BLOG TITLE: ${title}
TOPIC: ${topic || ""}
SERVICE: ${service || ""}
CONTENT SUMMARY: ${summary}

Rules:
- 5 to 8 words
- Match the blog's actual domain visually (e.g. AI e-commerce → "modern retail dashboard online shopping analytics" or "smart logistics warehouse management technology")
- Real, high-impact, professional-grade scenes from that tech domain
- DO NOT use generic office filler unless the blog is literally about office work
- AVOID low-quality abstract terms: concept, abstract background, futuristic matrix, innovation, digital transformation, neon, hologram, cyber
- No brand names, no quotes, no punctuation
- Return JSON only: { "imageQuery": "five to eight word phrase" }`,
    0.35,
    { maxTokens: 200, maxRetries: 3 }
  );

  let query = "";
  try {
    const parsed = parseJson(text);
    query = normalizeImageQuery(parsed.imageQuery || parsed.query || "", title);
  } catch {
    query = normalizeImageQuery(extractContentFromResponse(text), title);
  }

  console.log(`Dynamic imageQuery: "${query}"`);
  return query;
}

const ZORADEVS_LINK_POOL = [
  { label: "AI Development", url: "https://zoradevs.com/services/ai-development" },
  { label: "Custom Software Development", url: "https://zoradevs.com/services/custom-software-development" },
  { label: "Web App Development", url: "https://zoradevs.com/services/web-app-development" },
  { label: "Mobile App Development", url: "https://zoradevs.com/services/mobile-app-development" },
  { label: "Hire Software Developers", url: "https://zoradevs.com/services/hire-software-developers" },
  { label: "Website Development", url: "https://zoradevs.com/services/website-development" },
  { label: "IT Consulting", url: "https://zoradevs.com/services/consulting" },
  { label: "Contact ZoraDevs", url: "https://zoradevs.com/contact" },
];

function countZoradevsLinks(content) {
  const matches = String(content || "").match(/https?:\/\/(?:www\.)?zoradevs\.com[^\s)\]]*/gi) || [];
  return new Set(matches.map((u) => u.replace(/[.,;:!?]+$/, "").toLowerCase())).size;
}

function pickServiceLinks(brief, needed = 5) {
  const blob = `${brief.service || ""} ${brief.category || ""} ${brief.topic || ""}`.toLowerCase();
  const scored = ZORADEVS_LINK_POOL.map((item) => {
    let score = 0;
    if (/ai|automation|llm|agent/.test(blob) && item.url.includes("ai-development")) score += 5;
    if (/mobile|app/.test(blob) && item.url.includes("mobile-app")) score += 4;
    if (/web app|saas/.test(blob) && item.url.includes("web-app")) score += 4;
    if (/website|seo/.test(blob) && item.url.includes("website-development")) score += 4;
    if (/custom|software|crm|erp/.test(blob) && item.url.includes("custom-software")) score += 4;
    if (/hire|staff|augment/.test(blob) && item.url.includes("hire-software")) score += 4;
    if (item.url.includes("/contact")) score += 2;
    return { ...item, score };
  }).sort((a, b) => b.score - a.score);

  const picked = [];
  const seen = new Set();
  for (const item of scored) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    picked.push(item);
    if (picked.length >= needed) break;
  }
  return picked;
}

/**
 * Weave simple in-content ZoraDevs redirects into existing paragraphs.
 * Never adds a separate "Explore Related Services" section.
 */
export function ensureZoradevsInternalLinks(content, brief, minLinks = 5) {
  let body = String(content || "").trim();
  const existing = countZoradevsLinks(body);
  if (existing >= minLinks) {
    console.log(`ZoraDevs internal links OK: ${existing}`);
    return body;
  }

  const needed = minLinks - existing;
  const existingLower = body.toLowerCase();
  const toAdd = pickServiceLinks(brief, minLinks + 2)
    .filter((l) => !existingLower.includes(l.url.toLowerCase()))
    .slice(0, needed);

  if (!toAdd.length) return body;

  const bridgeFor = (link) => {
    if (link.url.includes("/contact")) {
      return ` If you want a practical next step, [contact ZoraDevs](${link.url}) to discuss scope and timelines.`;
    }
    if (link.url.includes("hire-software")) {
      return ` Many teams also [hire software developers](${link.url}) from ZoraDevs to accelerate delivery.`;
    }
    if (link.url.includes("ai-development")) {
      return ` For implementation support, ZoraDevs offers dedicated [AI development](${link.url}) services.`;
    }
    if (link.url.includes("mobile-app")) {
      return ` Product teams often extend this with ZoraDevs [mobile app development](${link.url}).`;
    }
    if (link.url.includes("web-app")) {
      return ` This pairs well with ZoraDevs [web app development](${link.url}) for scalable product builds.`;
    }
    if (link.url.includes("website-development")) {
      return ` Growth teams also use ZoraDevs [website development](${link.url}) to improve conversion journeys.`;
    }
    if (link.url.includes("custom-software")) {
      return ` Founders usually validate this through ZoraDevs [custom software development](${link.url}).`;
    }
    if (link.url.includes("consulting")) {
      return ` A short [IT consulting](${link.url}) engagement with ZoraDevs can clarify architecture choices.`;
    }
    return ` ZoraDevs can help through [${link.label.toLowerCase()}](${link.url}).`;
  };

  // Split into blocks; inject into real paragraphs only (not headings / closing).
  const blocks = body.split(/\n{2,}/);
  const eligibleIdx = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i].trim();
    if (!b) continue;
    if (/^#{1,6}\s/.test(b)) continue;
    if (/^[-*+]\s/m.test(b) && b.split("\n").length <= 6) continue; // skip short lists
    if (/^At ZoraDevs, an AI development company based in Noida/i.test(b)) continue;
    if (/zoradevs\.com/i.test(b)) continue;
    if (b.length < 80) continue;
    eligibleIdx.push(i);
  }

  // Spread injections across the article (start / middle / later), not one dump.
  const slots = [];
  if (eligibleIdx.length === 0) {
    // Fallback: append short inline sentences before closing paragraph.
    const closingIdx = body.search(/\nAt ZoraDevs, an AI development company based in Noida/i);
    const inline = toAdd.map((l) => bridgeFor(l).trim()).join(" ");
    if (closingIdx >= 0) {
      body = `${body.slice(0, closingIdx).trim()} ${inline}\n\n${body.slice(closingIdx).trim()}`;
    } else {
      body = `${body}\n\n${inline}`;
    }
  } else {
    const step = Math.max(1, Math.floor(eligibleIdx.length / toAdd.length));
    for (let i = 0; i < toAdd.length; i++) {
      const pick = eligibleIdx[Math.min(i * step, eligibleIdx.length - 1)];
      if (!slots.includes(pick)) slots.push(pick);
      else {
        const alt = eligibleIdx.find((idx) => !slots.includes(idx));
        slots.push(alt ?? pick);
      }
    }

    toAdd.forEach((link, i) => {
      const idx = slots[i] ?? eligibleIdx[eligibleIdx.length - 1];
      const block = blocks[idx].trimEnd();
      // Attach as a simple continuation sentence inside the paragraph.
      blocks[idx] = /[.!?]$/.test(block)
        ? `${block}${bridgeFor(link)}`
        : `${block}.${bridgeFor(link)}`;
    });

    body = blocks.join("\n\n");
  }

  console.log(
    `Wove ZoraDevs redirects into content (had ${existing}, now ${countZoradevsLinks(body)})`
  );
  return body;
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
- Prefer bullet points and short paragraphs (2–3 sentences max). Weave AI naturally.
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
      question: String(f?.question || "").trim().slice(0, 300),
      // Keep under website/API limits so FAQs are never dropped on publish.
      answer: String(f?.answer || "").trim().slice(0, 1800),
    }))
    .filter((f) => f.question.length >= 5 && f.answer.length >= 10)
    .slice(0, TARGET_FAQ_COUNT);
}

function wordCountPhrase(phrase) {
  return String(phrase || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function isValidSeoKeyword(phrase) {
  const cleaned = String(phrase || "").trim().replace(/\s+/g, " ");
  if (!cleaned) return false;
  if (wordCountPhrase(cleaned) < 2) return false;
  if (wordCountPhrase(cleaned) > 6) return false;
  return true;
}

const GENERIC_BANNED_KEYWORDS = [
  /^it company noida$/i,
  /^software development company noida$/i,
  /^ai development company noida$/i,
  /^app development delhi ncr$/i,
  /^b2b software scale india$/i,
  /^pan india ai software/i,
  /^ai automation for businesses$/i,
  /^ai product engineering roi$/i,
];

function isBannedGenericKeyword(phrase) {
  const cleaned = String(phrase || "").trim();
  return GENERIC_BANNED_KEYWORDS.some((re) => re.test(cleaned));
}

/** Meaningful terms from blog title/topic for relevance checks. */
function extractBlogTerms(title, topic, service) {
  const stop = new Set([
    "the", "a", "an", "and", "or", "for", "in", "to", "with", "of", "is", "how",
    "why", "what", "your", "are", "that", "this", "from", "into", "using", "via",
  ]);
  return new Set(
    `${title || ""} ${topic || ""} ${service || ""}`
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stop.has(w))
  );
}

/** Keyword must relate to this specific blog — not generic agency fluff. */
export function keywordRelatesToBlog(kw, title, topic, service) {
  const phrase = String(kw || "").trim();
  if (!isValidSeoKeyword(phrase) || isBannedGenericKeyword(phrase)) return false;

  const blogTerms = extractBlogTerms(title, topic, service);
  const kwWords = phrase
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const overlap = kwWords.filter((w) => blogTerms.has(w)).length;
  if (overlap >= 1) return true;

  // Local Noida/Delhi phrase is OK only if it also mentions the blog's domain (AI + topic word).
  const isLocal = /noida|delhi ncr|gurgaon|delhi/.test(phrase.toLowerCase());
  const hasAi = /\bai\b|artificial intelligence|machine learning/.test(phrase.toLowerCase());
  if (isLocal && hasAi && overlap >= 1) return true;

  return false;
}

/** Build fallbacks derived ONLY from this blog's title/topic/service. */
function buildTopicFallbacks(brief, title) {
  const blogTitle = title || brief.title || brief.titleAngle || brief.topic || "";
  const service = String(brief.service || brief.category || "software development").trim();
  const terms = [...extractBlogTerms(blogTitle, brief.topic, service)];
  const primary = terms.find((t) => !["ai", "ml"].includes(t)) || terms[0] || "software";
  const secondary = terms.find((t) => t !== primary && t !== "ai") || "business";

  const candidates = [
    `AI ${primary} growth strategies`,
    `${primary} ${secondary} automation`,
    `AI ${service.toLowerCase()} solutions`,
    `AI ${primary} development Noida`,
    `${primary} ROI for founders`,
    `AI ${secondary} platform scaling`,
  ]
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(isValidSeoKeyword)
    .filter((k) => !isBannedGenericKeyword(k));

  return candidates;
}

/**
 * Enforce exactly 5 multi-word keywords tied to this blog (not generic lists).
 */
export function normalizeSeoKeywords(keywords = [], brief = {}, title = "") {
  const blogTitle = title || brief.title || brief.titleAngle || "";
  const seen = new Set();
  const out = [];

  const rawList = Array.isArray(keywords)
    ? keywords
    : String(keywords || "")
        .split(",")
        .map((k) => k.trim());

  for (const raw of rawList) {
    const cleaned = String(raw || "")
      .trim()
      .replace(/\s+/g, " ")
      .replace(/^[,;]+|[,;]+$/g, "");
    if (!isValidSeoKeyword(cleaned) || isBannedGenericKeyword(cleaned)) continue;
    if (!keywordRelatesToBlog(cleaned, blogTitle, brief.topic, brief.service)) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length === 5) break;
  }

  for (const fb of buildTopicFallbacks(brief, blogTitle)) {
    if (out.length >= 5) break;
    if (!keywordRelatesToBlog(fb, blogTitle, brief.topic, brief.service)) continue;
    const key = fb.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fb);
  }

  const hasAi = out.some((k) => /\bai\b|artificial intelligence|machine learning/i.test(k));
  if (!hasAi && out.length) {
    const patched = `AI ${out[0]}`.replace(/\s+/g, " ").trim();
    if (isValidSeoKeyword(patched) && keywordRelatesToBlog(patched, blogTitle, brief.topic, brief.service)) {
      out[0] = patched;
    }
  }

  return out.slice(0, 5);
}

function keywordsPassQualityCheck(keywords, title, topic, service) {
  if (keywords.length !== 5) return false;
  if (!keywords.every(isValidSeoKeyword)) return false;
  const related = keywords.filter((k) =>
    keywordRelatesToBlog(k, title, topic, service)
  );
  return related.length >= 4;
}

export async function ensureQualityKeywords(brief, title, existingKeywords = [], excerpt = "") {
  let keywords = normalizeSeoKeywords(existingKeywords, { ...brief, title }, title);

  if (keywordsPassQualityCheck(keywords, title, brief.topic, brief.service)) {
    return keywords;
  }

  console.warn(
    `Keyword quality check failed (${keywords.length}/5 blog-specific) — regenerating...`
  );

  const text = await callGroq(
    `Generate EXACTLY 5 SEO keyword phrases for THIS ONE blog post only.

BLOG TITLE: ${title}
TOPIC: ${brief.topic}
SERVICE: ${brief.service}
EXCERPT: ${excerpt || brief.primaryKeyword || ""}

MANDATORY RULES:
1. Exactly 5 phrases — no more, no less
2. Every phrase must be 2–6 words (multi-word only). Ban single words like "AI", "Noida", "Growth"
3. ALL 5 must directly relate to THIS blog title and topic — nothing generic or off-topic
4. Write 3–4 phrases about the blog subject (the industry/service angle from the title + AI)
5. Add 1–2 local phrases with Noida or Delhi NCR ONLY if they still match this blog (e.g. "AI ecommerce automation Noida" for an e-commerce blog)
6. NEVER use generic agency keywords unrelated to the blog, such as "IT company Noida", "software development company Noida", "app development Delhi NCR" unless the blog is specifically about choosing a vendor
7. Do NOT copy the blog title verbatim
8. Location words (Noida/Delhi NCR) belong ONLY in keywords — never suggest them for headings
9. Return JSON only: { "keywords": ["phrase one", "phrase two", "phrase three", "phrase four", "phrase five"] }`,
    0.3,
    { maxTokens: 450, maxRetries: 3 }
  );

  const parsed = parseJson(text);
  keywords = normalizeSeoKeywords(parsed.keywords || [], { ...brief, title }, title);

  if (!keywordsPassQualityCheck(keywords, title, brief.topic, brief.service)) {
    throw new Error(
      `Keyword generation returned ${keywords.length} blog-specific phrases (need exactly 5 related to: ${title})`
    );
  }
  return keywords;
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
- Answers 2–4 sentences, practical, under 150 words each
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
  meta.keywords = await ensureQualityKeywords(brief, meta.title, meta.keywords);
  meta.tags = Array.isArray(meta.tags)
    ? [...new Set(meta.tags.map((t) => String(t).trim()).filter(Boolean))].slice(0, 5)
    : meta.keywords.slice(0, 5);
  console.log(`Metadata FAQs ready: ${meta.faqs.length}`);
  console.log(`Metadata keywords (exactly 5, blog-specific): ${meta.keywords.join(" | ")}`);
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
  content = ensureZoradevsInternalLinks(content, brief, 5);
  // Keep exact closing last after link injection.
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

  const imageQuery = await generateImageQueryFromBlog({
    title: meta.title,
    content,
    topic: brief.topic,
    service: brief.service,
  });

  const keywords = normalizeSeoKeywords(meta.keywords, { ...brief, title: meta.title }, meta.title);

  return {
    title: meta.title,
    slug: meta.slug,
    excerpt: meta.excerpt,
    content,
    meta_title: meta.meta_title,
    meta_description: meta.meta_description,
    keywords,
    tags: meta.tags,
    faqs: meta.faqs,
    imageQuery,
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
