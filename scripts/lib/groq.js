/**
 * Groq API helpers — retries on 429 + robust JSON parsing.
 */
import axios from "axios";
import { jsonrepair } from "jsonrepair";

const GROQ_API_KEY = process.env.GROQ_API_KEY;
export const GROQ_MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";

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
    return `Groq rate limit (429): ${msg}. Free tier allows limited requests per minute — retries were attempted.`;
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
 * @param {object} [options]
 * @param {number} [options.maxTokens]
 * @param {number} [options.maxRetries]
 */
export async function callGroq(prompt, temperature = 0.6, options = {}) {
  if (!GROQ_API_KEY) throw new Error("Missing GROQ_API_KEY");

  // Free/on_demand tier TPM is often 12k (prompt + max_tokens). Keep headroom for the prompt.
  let maxTokens = Math.min(options.maxTokens ?? 4096, Number(process.env.GROQ_MAX_TOKENS ?? 8000));
  const maxRetries = options.maxRetries ?? 5;

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
          const next = Math.max(3500, Math.floor(maxTokens * 0.7));
          console.warn(
            `Groq token budget exceeded (requested max_tokens=${maxTokens}) — retrying with ${next}...`
          );
          maxTokens = next;
          await sleep(2000);
          continue;
        }

        const retryAfterHeader = err.response?.headers?.["retry-after"];
        const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 0;
        const waitMs =
          retryAfterSec > 0
            ? retryAfterSec * 1000
            : Math.min(120000, 20000 * (attempt + 1));

        console.warn(
          `Groq ${status} — waiting ${Math.round(waitMs / 1000)}s (retry ${attempt + 1}/${maxRetries})...`
        );
        await sleep(waitMs);
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
