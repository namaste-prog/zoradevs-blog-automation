/**
 * Website scraper — sitemap + page structure (titles, H1/H2, meta).
 */
import axios from "axios";
import * as cheerio from "cheerio";

const DEFAULT_PATHS = [
  "/",
  "/services/mobile-app-development",
  "/services/website-development",
  "/services/web-app-development",
  "/services/ai-development",
  "/services/software-development",
  "/services/custom-software-development",
  "/services/hire-software-developers",
  "/services/consulting",
  "/services/ui-ux-design",
  "/blog",
  "/about",
  "/contact",
];

function normalizeUrl(base, path) {
  const clean = path.startsWith("http") ? path : `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  return clean;
}

async function fetchPageIntel(url) {
  try {
    const { data: html } = await axios.get(url, {
      timeout: 20000,
      headers: { "User-Agent": "Zoradevs-B2B-Bot/1.0 (+https://zoradevs.com)" },
      maxRedirects: 3,
    });

    const $ = cheerio.load(html);
    const title = $("title").first().text().trim();
    const metaDescription = $('meta[name="description"]').attr("content")?.trim() ?? "";
    const h1 = $("h1").map((_, el) => $(el).text().trim()).get().filter(Boolean).slice(0, 5);
    const h2 = $("h2").map((_, el) => $(el).text().trim()).get().filter(Boolean).slice(0, 12);

    return { url, title, metaDescription, h1, h2 };
  } catch (err) {
    console.warn(`Scrape failed: ${url}`, err.message);
    return null;
  }
}

async function fetchSitemapPaths(baseUrl) {
  const sitemapUrl = normalizeUrl(baseUrl, "/sitemap.xml");
  try {
    const { data } = await axios.get(sitemapUrl, {
      timeout: 15000,
      headers: { "User-Agent": "Zoradevs-B2B-Bot/1.0" },
    });
    const $ = cheerio.load(data, { xmlMode: true });
    const locs = $("loc").map((_, el) => $(el).text().trim()).get();
    return locs.filter((loc) => loc.startsWith(baseUrl)).slice(0, 25);
  } catch {
    return [];
  }
}

export async function scrapeWebsite(baseUrl, extraPaths = []) {
  const sitemapPaths = await fetchSitemapPaths(baseUrl);
  const paths = [...new Set([...DEFAULT_PATHS, ...extraPaths, ...sitemapPaths.map((u) => u.replace(baseUrl, ""))])].slice(0, 20);

  const pages = await Promise.all(
    paths.map((p) => fetchPageIntel(normalizeUrl(baseUrl, p)))
  );

  const valid = pages.filter(Boolean);
  const textPool = valid
    .flatMap((p) => [p.title, p.metaDescription, ...p.h1, ...p.h2])
    .filter(Boolean)
    .join("\n");

  return {
    domain: baseUrl,
    pages: valid,
    textPool,
  };
}

export async function scrapeZoradevsAndCompetitors(domain, competitorDomains = []) {
  const own = await scrapeWebsite(domain);
  const competitors = await Promise.all(
    competitorDomains.slice(0, 3).map((d) => scrapeWebsite(d))
  );

  const combinedText = [
    own.textPool,
    ...competitors.map((c) => c.textPool),
  ].filter(Boolean).join("\n\n");

  return { own, competitors, combinedText };
}
