/**
 * Groq API helpers — TPD/TPM-aware retries, sticky model fallback, capped waits.
 *
 * Groq API helpers — TPD/TPM-aware retries, sticky model fallback, capped waits.
 * Once that model is exhausted, stick to GROQ_FALLBACK_MODEL for the rest of the run.
 */
import axios from "axios";
import { jsonrepair } from "jsonrepair";

const GROQ_API_KEY = process.env.GROQ_API_KEY;
export const GROQ_MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";
export const GROQ_FALLBACK_MODEL =
  process.env.GROQ_FALLBACK_MODEL ?? "openai/gpt-oss-20b";

/** Hard cap so CI never stalls for 10–15 minutes on a single 429. */
const MAX_429_WAIT_MS = Number(process.env.GROQ_MAX_429_WAIT_SEC ?? 60) * 1000;

/** Once primary TPD is hit, never call it again in this process. */
let stickyModel = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getActiveGroqModel() {
  return stickyModel || GROQ_MODEL;
}

export function isUsingFallbackModel() {
  return getActiveGroqModel() === GROQ_FALLBACK_MODEL;
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

function errorBodyMessage(err) {
  return String(err.response?.data?.error?.message ?? err.message ?? "");
}

/** Daily quota exhausted for this model (not fixed by waiting 1–2 minutes). */
export function isDailyTokenLimit(err) {
  const msg = errorBodyMessage(err).toLowerCase();
  return (
    msg.includes("tokens per day") ||
    msg.includes("(tpd)") ||
    msg.includes("tpd:") ||
    msg.includes("daily token")
  );
}

function isTokenBudgetError(err) {
  const msg = errorBodyMessage(err).toLowerCase();
  if (isDailyTokenLimit(err)) return false;
  return (
    msg.includes("request too large") ||
    msg.includes("please reduce your message size") ||
    (msg.includes("tokens per minute") && msg.includes("requested"))
  );
}

function groqErrorMessage(err, model) {
  const status = err.response?.status;
  const msg = errorBodyMessage(err);
  if (status === 429 && isDailyTokenLimit(err)) {
    return (
      `Groq daily token limit (TPD) hit on model \`${model}\`: ${msg}\n` +
      `Tip: wait until the daily quota resets, set GROQ_MODEL to another model, ` +
      `or upgrade at https://console.groq.com/settings/billing`
    );
  }
  if (status === 429) {
    return (
      `Groq rate limit (429) on \`${model}\`: ${msg}\n` +
      `Tip: re-run in a few minutes, or raise GROQ_PART_DELAY_SEC.`
    );
  }
  return msg;
}

function resolve429WaitMs(err, attempt) {
  const header = err.response?.headers?.["retry-after"];
  let suggestedMs = 0;

  if (header) {
    const sec = parseInt(String(header), 10);
    if (!Number.isNaN(sec) && sec > 0) suggestedMs = sec * 1000;
  }

  if (!suggestedMs) {
    const msg = errorBodyMessage(err);
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

  const backoffMs = Math.min(45000, 6000 * (attempt + 1));
  const raw = suggestedMs > 0 ? suggestedMs : backoffMs;
  return Math.min(raw, MAX_429_WAIT_MS);
}

function switchToFallback(fromModel) {
  if (stickyModel === GROQ_FALLBACK_MODEL) return;
  stickyModel = GROQ_FALLBACK_MODEL;
  console.warn(
    `Groq TPD exhausted on \`${fromModel}\` — sticky fallback for this run: \`${GROQ_FALLBACK_MODEL}\``
  );
}

async function postChat({ model, prompt, temperature, maxTokens }) {
  return axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model,
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
}

/**
 * @param {object} [options]
 * @param {number} [options.maxTokens]
 * @param {number} [options.maxRetries]
 * @param {string} [options.model]
 */
export async function callGroq(prompt, temperature = 0.6, options = {}) {
  if (!GROQ_API_KEY) throw new Error("Missing GROQ_API_KEY");

  let maxTokens = Math.min(options.maxTokens ?? 3000, Number(process.env.GROQ_MAX_TOKENS ?? 4500));
  const maxRetries = options.maxRetries ?? 3;
  let model = options.model || stickyModel || GROQ_MODEL;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await postChat({ model, prompt, temperature, maxTokens });
      return res.data.choices?.[0]?.message?.content ?? "";
    } catch (err) {
      const status = err.response?.status;
      const dailyHit = status === 429 && isDailyTokenLimit(err);
      const tokenBudgetHit = isTokenBudgetError(err);
      const isRetryable = status === 429 || status === 503 || tokenBudgetHit;

      if (dailyHit && model !== GROQ_FALLBACK_MODEL) {
        switchToFallback(model);
        model = GROQ_FALLBACK_MODEL;
        maxTokens = Math.min(Math.max(maxTokens, 3500), 4500);
        await sleep(1000);
        continue;
      }

      if (dailyHit) {
        const error = new Error(groqErrorMessage(err, model));
        error.status = 429;
        error.code = "GROQ_TPD";
        throw error;
      }

      if (isRetryable && attempt < maxRetries) {
        if (tokenBudgetHit) {
          const next = Math.max(1800, Math.floor(maxTokens * 0.7));
          console.warn(
            `Groq request too large (max_tokens=${maxTokens}) — retrying with ${next}...`
          );
          maxTokens = next;
          await sleep(2000);
          continue;
        }

        const waitMs = resolve429WaitMs(err, attempt);
        console.warn(
          `Groq ${status} on \`${model}\` — waiting ${Math.round(waitMs / 1000)}s ` +
            `(retry ${attempt + 1}/${maxRetries})...`
        );
        await sleep(waitMs);
        maxTokens = Math.max(1800, Math.floor(maxTokens * 0.85));
        continue;
      }

      const error = new Error(groqErrorMessage(err, model));
      error.status = status;
      throw error;
    }
  }

  throw new Error("Groq call failed after retries");
}

export { sleep };
