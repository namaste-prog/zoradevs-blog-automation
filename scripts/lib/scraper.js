/**
 * Lightweight homepage scraper — meta + H1/H2 (or first ~300 words).
 * Competitors: homepage ONLY (no sitemap / sub-pages).
 * Zoradevs: homepage ONLY (core services come from config, not deep scrape).
 */
import axios from "axios";
import * as cheerio from "cheerio";

const MAX_COMPETITORS = 3;
const MAX_VISIBLE_WORDS = 300;
const MAX_H1 = 5;
const MAX_H2 = 8;

function normalizeUrl(base, path = "/") {
  const clean = path.startsWith("http")
    ? path
    : `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  return clean;
}

function firstNWords(text, n = MAX_VISIBLE_WORDS) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, n)
    .join(" ");
}

/**
 * Strip scripts/styles/nav noise and take visible body text.
 */
function extractVisibleText($, limit = MAX_VISIBLE_WORDS) {
  $("script, style, noscript, svg, iframe, nav, footer, header").remove();
  const raw = $("main").text() || $("body").text() || "";
  return firstNWords(raw, limit);
}

/**
 * Homepage-only intel: meta title, meta description, H1/H2, optional short body.
 * Never follows sitemaps or sub-pages.
 */
async function fetchHomepageIntel(baseUrl) {
  const url = normalizeUrl(baseUrl, "/");
  try {
    const { data: html } = await axios.get(url, {
      timeout: 15000,
      headers: { "User-Agent": "Zoradevs-B2B-Bot/1.0 (+https://zoradevs.com)" },
      maxRedirects: 3,
      validateStatus: (s) => s >= 200 && s < 400,
    });

    const $ = cheerio.load(html);
    const title = $("title").first().text().trim();
    const metaDescription =
      $('meta[name="description"]').attr("content")?.trim() ||
      $('meta[property="og:description"]').attr("content")?.trim() ||
      "";
    const h1 = $("h1")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean)
      .slice(0, MAX_H1);
    const h2 = $("h2")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean)
      .slice(0, MAX_H2);

    const hasHeadings = h1.length > 0 || h2.length > 0;
    const visibleText = hasHeadings ? "" : extractVisibleText($, MAX_VISIBLE_WORDS);

    return {
      url,
      title,
      metaDescription,
      h1,
      h2,
      visibleText,
    };
  } catch (err) {
    console.warn(`Homepage scrape failed (${url}):`, err.message);
    return null;
  }
}

/**
 * Compress one homepage into a tiny prompt-ready block.
 */
function compressPageIntel(label, page) {
  if (!page) return "";

  const lines = [`[${label}] ${page.url}`];
  if (page.title) lines.push(`title: ${page.title}`);
  if (page.metaDescription) lines.push(`meta: ${firstNWords(page.metaDescription, 60)}`);
  if (page.h1?.length) lines.push(`h1: ${page.h1.join(" | ")}`);
  if (page.h2?.length) lines.push(`h2: ${page.h2.slice(0, MAX_H2).join(" | ")}`);
  if (page.visibleText) lines.push(`text: ${page.visibleText}`);

  return lines.join("\n");
}

/**
 * Scrape a single site homepage only (no deep crawl).
 */
export async function scrapeWebsite(baseUrl) {
  const page = await fetchHomepageIntel(baseUrl);
  const host = (() => {
    try {
      return new URL(normalizeUrl(baseUrl)).hostname;
    } catch {
      return baseUrl;
    }
  })();

  if (!page) {
    console.log(`Scraped 0/1 homepage from ${host}`);
    return { domain: baseUrl, pages: [], textPool: "" };
  }

  console.log(`Scraped homepage only from ${host}`);
  return {
    domain: baseUrl,
    pages: [page],
    textPool: compressPageIntel(host, page),
  };
}

/**
 * Zoradevs homepage + TOP N competitor homepages only.
 * Deep-site / sitemap scraping is intentionally disabled.
 */
export async function scrapeZoradevsAndCompetitors(domain, competitorDomains = []) {
  const topCompetitors = [...new Set(competitorDomains.filter(Boolean))].slice(0, MAX_COMPETITORS);

  console.log(
    `Lightweight scrape: Zoradevs homepage + top ${topCompetitors.length} competitor homepage(s) only`
  );

  const own = await scrapeWebsite(domain);
  const competitors = await Promise.all(topCompetitors.map((d) => scrapeWebsite(d)));

  const combinedText = [own.textPool, ...competitors.map((c) => c.textPool)]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  const approxWords = combinedText.split(/\s+/).filter(Boolean).length;
  console.log(`Compressed scrape context: ~${approxWords} words (homepage meta/headings only)`);

  return { own, competitors, combinedText };
}
