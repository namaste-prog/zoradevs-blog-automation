/**
 * Layer 2 & 4 — Groq trend filter + B2B content engine.
 * Blog body is written in 3 parts so we hit 2000+ words under Groq's ~12k TPM cap.
 */
import { callGroq, parseJson, sleep } from "./groq.js";

const BLOCKED = ["politics", "crypto hype", "celebrity gossip", "adult content", "US-only consumer tech"];
const MIN_WORDS = 2000;
const MAX_WORDS = 2800;
const PART_MAX_TOKENS = Number(process.env.GROQ_PART_MAX_TOKENS ?? 4500);
const META_MAX_TOKENS = Number(process.env.GROQ_META_MAX_TOKENS ?? 3500);

function countWords(text) {
  return String(text || "").split(/\s+/).filter(Boolean).length;
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

function buildMetaPrompt(brief) {
  return `You are an expert B2B SEO writer for Zoradevs (Noida / Delhi NCR).

${briefBlock(brief)}

Return ONLY metadata JSON (no full article body yet). CRITICAL: escape newlines in strings as \\n.

{
  "title": "...",
  "slug": "lowercase-hyphens-only",
  "excerpt": "max 300 chars",
  "meta_title": "50-60 chars including Zoradevs",
  "meta_description": "150-160 chars",
  "keywords": ["5 SEO keywords", "must include AI", "...", "...", "..."],
  "tags": ["5 tags", "include AI", "...", "...", "..."],
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

Include practical examples for Noida / Gurgaon / Delhi founders. Weave AI naturally.`,
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

End with a clear CTA to contact Zoradevs for ${brief.service}. Keep AI angle strong.`,
    },
  };

  const cfg = parts[part];
  return `You are an expert B2B content writer for Zoradevs.

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

export async function filterTrendsWithGroq(ctx) {
  const text = await callGroq(buildTrendFilterPrompt(ctx), 0.4, {
    maxTokens: 2048,
    maxRetries: 4,
  });
  const result = parseJson(text);
  if (!result.candidates?.length) {
    throw new Error("Groq trend filter returned no candidates");
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

  // Prefer explicit JSON content field when present.
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

  // If model returned markdown without JSON wrapper.
  if (/^##\s/m.test(cleaned) || /^#\s/m.test(cleaned)) {
    return cleaned.replace(/^\{[\s\S]*?"content"\s*:\s*"/, "").replace(/"\s*\}$/, "");
  }

  // Last resort: strip JSON braces if content leaked as broken JSON string.
  const contentMatch = cleaned.match(/"content"\s*:\s*"([\s\S]*)"\s*[,}]/);
  if (contentMatch?.[1]) {
    return contentMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').trim();
  }

  return cleaned;
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

export async function writeB2BBlog(brief) {
  const delaySec = Number(process.env.GROQ_CALL_DELAY_SEC ?? 40);
  console.log(`Waiting ${delaySec}s before Groq writer (avoids 429 rate limit)...`);
  await sleep(delaySec * 1000);

  console.log("Writer pass: metadata + FAQs...");
  const metaText = await callGroq(buildMetaPrompt(brief), 0.45, {
    maxTokens: META_MAX_TOKENS,
    maxRetries: 6,
  });
  const meta = parseJson(metaText);
  if (!meta.title || !meta.faqs?.length) {
    throw new Error("Groq writer returned incomplete metadata");
  }

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

  // Second expand pass if still short.
  if (words < MIN_WORDS) {
    console.log("Running second expand pass...");
    await sleep(15000);
    content = await expandIfNeeded(brief, title, content);
    words = countWords(content);
    console.log(`Second expand word count: ${words}`);
  }

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
  };
}
