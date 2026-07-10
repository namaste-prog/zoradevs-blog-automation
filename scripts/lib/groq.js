/**
 * Groq API helpers — capped 429 backoff + robust JSON parsing.
 * Free/on-demand tier TPM is often ~12k; never sleep for 10+ minutes on Retry-After.
 */
import axios from "axios";
import { jsonrepair } from "jsonrepair";

const GROQ_API_KEY = process.env.GROQ_API_KEY;
export const GROQ_MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";

/** Hard cap so CI never stalls for 10–15 minutes on a single 429. */
const MAX_429_WAIT_MS = Number(process.env.GROQ_MAX_429_WAIT_SEC ?? 90) * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractJsonBlob(text) {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  return match ? match[0] : cleaned;
}

export function parseJson(text) {
  if (!text) throw new Error("Groq returned empty response");

  const blob = extractJsonBlob(text);
  const attempts = [
    () => JSON.parse(blob),
    () => JSON.parse(jsonrepair(blob)),
  ];

  let lastError;
  for (const attempt of attempts) {
    try {
      return attempt();
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(`Groq did not return valid JSON: ${lastError?.message ?? "parse failed"}`);
}

function groqErrorMessage(err) {
  const status = err.response?.status;
  const body = err.response?.data;
  const msg = body?.error?.message ?? err.message;
  if (status === 429) {
    return `Groq rate limit (429): ${msg}. Free tier TPM/RPM exhausted — re-run the workflow in 2–3 minutes, or raise GROQ_PART_DELAY_SEC.`;
  }
  return msg;
}

function isTokenBudgetError(err) {
  const msg = String(err.response?.data?.error?.message ?? err.message ?? "").toLowerCase();
  return (
    msg.includes("request too large") ||
    msg.includes("tokens per minute") ||
    msg.includes("tpm") ||
    msg.includes("please reduce your message size")
  );
}

/**
 * Parse Retry-After header or "try again in XmYs" from error body.
 * Always capped by MAX_429_WAIT_MS.
 */
function resolve429WaitMs(err, attempt) {
  const header = err.response?.headers?.["retry-after"];
  let suggestedMs = 0;

  if (header) {
    const sec = parseInt(String(header), 10);
    if (!Number.isNaN(sec) && sec > 0) suggestedMs = sec * 1000;
  }

  if (!suggestedMs) {
    const msg = String(err.response?.data?.error?.message ?? "");
    const minSec = msg.match(/try again in\s+(\d+)\s*m(?:in(?:ute)?s?)?\s*([\d.]+)?\s*s/i);
    const secOnly = msg.match(/try again in\s+([\d.]+)\s*s/i);
    if (minSec) {
      const mins = parseInt(minSec[1], 10) || 0;
      const secs = parseFloat(minSec[2] || "0") || 0;
      suggestedMs = (mins * 60 + secs) * 1000;
    } else if (secOnly) {
      suggestedMs = parseFloat(secOnly[1]) * 1000;
    }
  }

  const backoffMs = Math.min(60000, 8000 * (attempt + 1));
  const raw = suggestedMs > 0 ? suggestedMs : backoffMs;
  return Math.min(raw, MAX_429_WAIT_MS);
}

/**
 * @param {object} [options]
 * @param {number} [options.maxTokens]
 * @param {number} [options.maxRetries]
 */
export async function callGroq(prompt, temperature = 0.6, options = {}) {
  if (!GROQ_API_KEY) throw new Error("Missing GROQ_API_KEY");

  // Keep headroom under ~12k TPM (prompt + max_tokens).
  let maxTokens = Math.min(options.maxTokens ?? 3000, Number(process.env.GROQ_MAX_TOKENS ?? 4500));
  const maxRetries = options.maxRetries ?? 4;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          model: GROQ_MODEL,
          messages: [{ role: "user", content: prompt }],
          max_tokens: maxTokens,
          temperature,
        },
        {
          headers: {
            Authorization: `Bearer ${GROQ_API_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: 180000,
        }
      );

      return res.data.choices?.[0]?.message?.content ?? "";
    } catch (err) {
      const status = err.response?.status;
      const tokenBudgetHit = isTokenBudgetError(err);
      const isRetryable = status === 429 || status === 503 || tokenBudgetHit;

      if (isRetryable && attempt < maxRetries) {
        if (tokenBudgetHit) {
          const next = Math.max(2000, Math.floor(maxTokens * 0.7));
          console.warn(
            `Groq token budget exceeded (requested max_tokens=${maxTokens}) — retrying with ${next}...`
          );
          maxTokens = next;
          await sleep(3000);
          continue;
        }

        const waitMs = resolve429WaitMs(err, attempt);
        const headerRaw = err.response?.headers?.["retry-after"];
        console.warn(
          `Groq ${status} — waiting ${Math.round(waitMs / 1000)}s` +
            (headerRaw ? ` (server asked ${headerRaw}s, capped at ${MAX_429_WAIT_MS / 1000}s)` : "") +
            ` (retry ${attempt + 1}/${maxRetries})...`
        );
        await sleep(waitMs);

        // Shrink output budget after rate limit to reduce TPM pressure.
        maxTokens = Math.max(2000, Math.floor(maxTokens * 0.85));
        continue;
      }

      const error = new Error(groqErrorMessage(err));
      error.status = status;
      throw error;
    }
  }

  throw new Error("Groq call failed after retries");
}

export { sleep };
