/**
 * Groq API helpers — retries on 429 rate limits.
 */
import axios from "axios";

const GROQ_API_KEY = process.env.GROQ_API_KEY;
export const GROQ_MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseJson(text) {
  if (!text) throw new Error("Groq returned empty response");
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Groq did not return valid JSON");
    return JSON.parse(jsonMatch[0]);
  }
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

/**
 * @param {object} [options]
 * @param {number} [options.maxTokens]
 * @param {number} [options.maxRetries]
 */
export async function callGroq(prompt, temperature = 0.6, options = {}) {
  if (!GROQ_API_KEY) throw new Error("Missing GROQ_API_KEY");

  const maxTokens = options.maxTokens ?? 4096;
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
      const isRetryable = status === 429 || status === 503;

      if (isRetryable && attempt < maxRetries) {
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
