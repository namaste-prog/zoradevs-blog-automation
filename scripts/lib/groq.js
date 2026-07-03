/**
 * Groq API helpers for B2B blog pipeline.
 */

import axios from "axios";

const GROQ_API_KEY = process.env.GROQ_API_KEY;
export const GROQ_MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";

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

export async function callGroq(prompt, temperature = 0.6) {
  if (!GROQ_API_KEY) throw new Error("Missing GROQ_API_KEY");

  const res = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model: GROQ_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 8192,
      temperature,
    },
    {
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 120000,
    }
  );

  return res.data.choices?.[0]?.message?.content ?? "";
}
