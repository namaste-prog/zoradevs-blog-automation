/**
 * Dynamic competitor discovery — Google CSE + static India fallback.
 * Clutch often returns 403 from GitHub Actions IPs (expected).
 */
import axios from "axios";

const GOOGLE_CSE_KEY = process.env.GOOGLE_CSE_API_KEY;
const GOOGLE_CSE_CX = process.env.GOOGLE_CSE_CX;

/** Used when CSE + Clutch both fail — still gives competitor scrape targets. */
const FALLBACK_INDIAN_COMPETITORS = [
  { name: "Appinventiv", domain: "https://appinventiv.com", source: "fallback-india" },
  { name: "ValueCoders", domain: "https://www.valuecoders.com", source: "fallback-india" },
  { name: "Radixweb", domain: "https://radixweb.com", source: "fallback-india" },
];

function extractDomain(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host;
  } catch {
    return null;
  }
}

async function googleCustomSearch(query, num = 5) {
  if (!GOOGLE_CSE_KEY || !GOOGLE_CSE_CX) return [];

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
    if (competitors.length >= 3) break;
  }

  if (competitors.length === 0) {
    console.log(
      "No competitors from Google CSE — using fallback Indian dev company domains (Clutch 403 is normal on CI)."
    );
    return FALLBACK_INDIAN_COMPETITORS;
  }

  return competitors;
}
