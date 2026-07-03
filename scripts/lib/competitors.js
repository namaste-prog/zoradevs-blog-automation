/**
 * Dynamic competitor discovery — Google Custom Search + Clutch fallback.
 */
import axios from "axios";
import * as cheerio from "cheerio";

const GOOGLE_CSE_KEY = process.env.GOOGLE_CSE_API_KEY;
const GOOGLE_CSE_CX = process.env.GOOGLE_CSE_CX;

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

async function clutchSearch() {
  const url = "https://clutch.co/in/developers";
  try {
    const { data: html } = await axios.get(url, {
      timeout: 20000,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Zoradevs-B2B-Bot/1.0)" },
    });
    const $ = cheerio.load(html);
    const links = [];
    $("a[href*='/profile/']").each((_, el) => {
      const href = $(el).attr("href");
      const title = $(el).text().trim();
      if (href && title && links.length < 8) {
        links.push({
          title,
          url: href.startsWith("http") ? href : `https://clutch.co${href}`,
          source: "Clutch India",
        });
      }
    });
    return links;
  } catch (err) {
    console.warn("Clutch scrape failed:", err.message);
    return [];
  }
}

export async function discoverCompetitors(config) {
  const queries = config.competitorSearchQueries ?? [
    "top software development companies India site:clutch.co",
    "custom software development company India B2B",
    "AI development company India startups",
  ];

  const results = [];
  for (const query of queries.slice(0, 3)) {
    const items = await googleCustomSearch(query, 5);
    results.push(...items);
  }

  if (results.length < 3) {
    results.push(...(await clutchSearch()));
  }

  const domains = new Set();
  const competitors = [];

  for (const item of results) {
    const domain = extractDomain(item.url);
    if (!domain) continue;
    if (domain.includes("zoradevs.com")) continue;
    if (domains.has(domain)) continue;
    domains.add(domain);
    competitors.push({
      name: item.title,
      domain: `https://${domain}`,
      source: item.source,
    });
    if (competitors.length >= 5) break;
  }

  return competitors;
}
