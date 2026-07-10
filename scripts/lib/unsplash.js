/**
 * Unsplash cover image for automated blogs.
 * Requires UNSPLASH_ACCESS_KEY (GitHub Secret).
 *
 * Rules:
 * - Search using blog keywords (not random category fluff)
 * - Never reuse a photo ID already used in published blogs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";

const ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;
const UTM = "utm_source=zoradevs&utm_medium=referral";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");
const USED_IDS_FILE = path.join(ROOT, "used_unsplash_ids.json");

const CATEGORY_FALLBACK_IMAGES = {
  "Software Development": "https://zoradevs.com/img/services/saas.webp",
  "AI & Automation": "https://zoradevs.com/img/services/ai.webp",
  "Mobile Development": "https://zoradevs.com/img/services/automation.webp",
  "Web Development": "https://zoradevs.com/img/web-app.jpg",
  Fintech: "https://zoradevs.com/img/web-app.jpg",
  "Healthcare Tech": "https://zoradevs.com/img/web-app.jpg",
  "E-Commerce": "https://zoradevs.com/img/web-app.jpg",
  "Staff Augmentation": "https://zoradevs.com/img/services/automation.webp",
  "Case Studies": "https://zoradevs.com/img/web-app.jpg",
  "Tech Insights": "https://zoradevs.com/img/services/ui-ux.webp",
};

const DEFAULT_IMAGE =
  process.env.BLOG_DEFAULT_IMAGE_URL ?? "https://zoradevs.com/img/web-app.jpg";

function categoryFallback(category) {
  return {
    url: CATEGORY_FALLBACK_IMAGES[category] ?? DEFAULT_IMAGE,
    imageCredit: null,
    source: "category-fallback",
    unsplashId: null,
  };
}

export function loadUsedUnsplashIds(extraIds = []) {
  let fromFile = [];
  try {
    if (fs.existsSync(USED_IDS_FILE)) {
      const data = JSON.parse(fs.readFileSync(USED_IDS_FILE, "utf8"));
      fromFile = Array.isArray(data.ids) ? data.ids : [];
    }
  } catch {
    fromFile = [];
  }
  return new Set(
    [...fromFile, ...extraIds]
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  );
}

export function saveUsedUnsplashId(unsplashId) {
  if (!unsplashId) return;
  const used = loadUsedUnsplashIds();
  used.add(String(unsplashId));
  fs.writeFileSync(
    USED_IDS_FILE,
    JSON.stringify({ ids: [...used], updatedAt: new Date().toISOString() }, null, 2) + "\n"
  );
}

/**
 * Build keyword-first search queries (most relevant first).
 */
function buildSearchQueries({ keywords = [], keyword, category, title }) {
  const kw = keywords.map((k) => String(k || "").trim()).filter(Boolean);
  const primary = kw[0] || keyword || "";
  const secondary = kw.slice(1, 4);
  const queries = [];

  if (primary) queries.push(primary);
  for (const k of secondary) queries.push(k);
  if (primary && secondary[0]) queries.push(`${primary} ${secondary[0]}`);
  if (title) {
    const shortTitle = String(title)
      .replace(/[|:–—-].*$/, "")
      .trim()
      .split(/\s+/)
      .slice(0, 8)
      .join(" ");
    if (shortTitle) queries.push(shortTitle);
  }
  if (primary) queries.push(`${primary} artificial intelligence technology`);
  if (category) queries.push(`${category} AI technology business`);

  return [...new Set(queries.map((q) => q.trim()).filter(Boolean))];
}

async function triggerDownload(downloadLocation) {
  if (!downloadLocation || !ACCESS_KEY) return;
  try {
    await axios.get(downloadLocation, {
      headers: { Authorization: `Client-ID ${ACCESS_KEY}` },
      timeout: 10000,
    });
  } catch {
    // Non-fatal
  }
}

function toCoverResult(pick) {
  const photographer = pick.user?.name ?? "Unsplash Contributor";
  const photographerUrl = pick.user?.links?.html
    ? `${pick.user.links.html}?${UTM}`
    : `https://unsplash.com/?${UTM}`;

  return {
    url: pick.urls?.regular ?? pick.urls?.full,
    imageCredit: {
      photographer,
      photographerUrl,
      unsplashUrl: `https://unsplash.com/photos/${pick.id}?${UTM}`,
    },
    source: "unsplash",
    unsplashId: pick.id,
  };
}

/**
 * Search Unsplash and return the first unused photo (no random pick).
 */
async function searchUnsplash(query, usedIds) {
  const { data } = await axios.get("https://api.unsplash.com/search/photos", {
    params: {
      query,
      per_page: 30,
      orientation: "landscape",
      content_filter: "high",
      order_by: "relevant",
    },
    headers: { Authorization: `Client-ID ${ACCESS_KEY}` },
    timeout: 20000,
  });

  const results = data.results ?? [];
  for (const pick of results) {
    if (!pick?.id || !pick?.urls) continue;
    if (usedIds.has(pick.id)) {
      console.log(`Skipping already-used Unsplash photo: ${pick.id}`);
      continue;
    }
    await triggerDownload(pick.links?.download_location);
    return toCoverResult(pick);
  }
  return null;
}

/**
 * @param {{
 *   keywords?: string[],
 *   keyword?: string,
 *   category: string,
 *   service?: string,
 *   title?: string,
 *   excludeIds?: string[],
 * }} opts
 */
export async function fetchBlogCoverImage({
  keywords = [],
  keyword,
  category,
  service,
  title,
  excludeIds = [],
}) {
  if (!ACCESS_KEY) {
    console.warn("UNSPLASH_ACCESS_KEY not set — using category fallback image");
    return categoryFallback(category);
  }

  const usedIds = loadUsedUnsplashIds(excludeIds);
  const queries = buildSearchQueries({
    keywords: keywords.length ? keywords : [keyword, service].filter(Boolean),
    keyword,
    category,
    title,
  });

  console.log("Fetching Unsplash cover from keywords:", (keywords[0] || keyword || "").slice(0, 60));
  console.log(`Excluding ${usedIds.size} previously used Unsplash IDs`);

  for (const query of queries) {
    try {
      const result = await searchUnsplash(query, usedIds);
      if (result?.url) {
        console.log("Unsplash image:", result.url.slice(0, 60) + "...");
        console.log("Photo by:", result.imageCredit?.photographer, `(id: ${result.unsplashId})`);
        return result;
      }
      console.warn(`No unused Unsplash results for query: ${query}`);
    } catch (err) {
      console.warn(`Unsplash search failed (${query}):`, err.response?.data ?? err.message);
    }
  }

  console.warn("Unsplash returned no unused results — using category fallback");
  return categoryFallback(category);
}
