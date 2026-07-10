/**
 * Dynamic competitor discovery — Google Custom Search only.
 * Returns up to 3 live domains. No hardcoded competitor list.
 */
import axios from "axios";

const GOOGLE_CSE_KEY = process.env.GOOGLE_CSE_API_KEY;
const GOOGLE_CSE_CX = process.env.GOOGLE_CSE_CX;
const MAX_COMPETITORS = 3;

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function googleCustomSearch(query, num = 5) {
  if (!GOOGLE_CSE_KEY || !GOOGLE_CSE_CX) {
    console.warn("GOOGLE_CSE_API_KEY / GOOGLE_CSE_CX missing — competitor discovery skipped");
    return [];
  }

  try {
    const { data } = await axios.get("https://www.googleapis.com/customsearch/v1", {
      params: { key: GOOGLE_CSE_KEY, cx: GOOGLE_CSE_CX, q: query, num },
      timeout: 20000,
    });

    return (data.items ?? []).map((item) => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet ?? "",
      source: "Google CSE",
    }));
  } catch (err) {
    console.warn("Google CSE failed:", err.response?.data?.error?.message ?? err.message);
    return [];
  }
}

export async function discoverCompetitors(config) {
  const queries = config.competitorSearchQueries ?? [
    "custom software development company India",
    "mobile app development agency India B2B",
    "AI development company India startups",
  ];

  const results = [];
  for (const query of queries.slice(0, 2)) {
    results.push(...(await googleCustomSearch(query, 5)));
  }

  const domains = new Set();
  const competitors = [];

  for (const item of results) {
    const domain = extractDomain(item.url);
    if (!domain) continue;
    if (domain.includes("zoradevs.com")) continue;
    if (domain.includes("clutch.co")) continue;
    if (domains.has(domain)) continue;
    domains.add(domain);
    competitors.push({
      name: item.title,
      domain: `https://${domain}`,
      source: item.source,
    });
    if (competitors.length >= MAX_COMPETITORS) break;
  }

  if (competitors.length === 0) {
    console.warn(
      "No live competitors from Google CSE — continuing with ZoraDevs core services only (no hardcoded fallback)."
    );
    return [];
  }

  console.log(
    `Dynamic competitors (top ${competitors.length}):`,
    competitors.map((c) => c.domain).join(", ")
  );
  return competitors.slice(0, MAX_COMPETITORS);
}
