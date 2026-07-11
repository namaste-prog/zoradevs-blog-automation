/**
 * Cover image for automated blogs — Unsplash + Pexels.
 *
 * Rules:
 * - Search ONLY with Groq `imageQuery` (literal physical scene), never the full title
 * - Landscape orientation only (API param + reject portrait)
 * - Never reuse a photo ID already used in published blogs
 * - Try Unsplash first, then Pexels as co-provider / fallback
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";

const UNSPLASH_KEY = process.env.UNSPLASH_ACCESS_KEY;
const PEXELS_KEY = process.env.PEXELS_API_KEY;
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
    imageId: null,
  };
}

function isLandscape(width, height) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (!w || !h) return false;
  return w >= h;
}

function normalizeImageQuery(imageQuery) {
  const ABSTRACT = new Set([
    "concept",
    "abstract",
    "background",
    "futuristic",
    "matrix",
    "innovation",
    "transformation",
    "neon",
    "glow",
    "hologram",
    "metaverse",
  ]);

  return String(imageQuery || "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .filter((w) => !ABSTRACT.has(w))
    .slice(0, 8)
    .join(" ");
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

/** Persist any provider image id (unsplash:… or pexels:…). */
export function saveUsedImageId(imageId) {
  saveUsedUnsplashId(imageId);
}

async function triggerUnsplashDownload(downloadLocation) {
  if (!downloadLocation || !UNSPLASH_KEY) return;
  try {
    await axios.get(downloadLocation, {
      headers: { Authorization: `Client-ID ${UNSPLASH_KEY}` },
      timeout: 10000,
    });
  } catch {
    // Non-fatal
  }
}

function toUnsplashResult(pick) {
  const photographer = pick.user?.name ?? "Unsplash Contributor";
  const photographerUrl = pick.user?.links?.html
    ? `${pick.user.links.html}?${UTM}`
    : `https://unsplash.com/?${UTM}`;
  const id = `unsplash:${pick.id}`;

  return {
    url: pick.urls?.regular ?? pick.urls?.full,
    imageCredit: {
      photographer,
      photographerUrl,
      unsplashUrl: `https://unsplash.com/photos/${pick.id}?${UTM}`,
    },
    source: "unsplash",
    unsplashId: id,
    imageId: id,
  };
}

function toPexelsResult(pick) {
  const photographer = pick.photographer ?? "Pexels Contributor";
  const photographerUrl = pick.photographer_url || "https://www.pexels.com/";
  const id = `pexels:${pick.id}`;
  const url =
    pick.src?.large2x ||
    pick.src?.large ||
    pick.src?.landscape ||
    pick.src?.original;

  return {
    url,
    imageCredit: {
      photographer,
      photographerUrl,
      unsplashUrl: pick.url || `https://www.pexels.com/photo/${pick.id}/`,
    },
    source: "pexels",
    unsplashId: id,
    imageId: id,
  };
}

/**
 * Search Unsplash with landscape-only filter. Rejects portrait results.
 */
async function searchUnsplash(query, usedIds) {
  if (!UNSPLASH_KEY) return null;

  const { data } = await axios.get("https://api.unsplash.com/search/photos", {
    params: {
      query,
      per_page: 30,
      orientation: "landscape",
      content_filter: "high",
      order_by: "relevant",
    },
    headers: { Authorization: `Client-ID ${UNSPLASH_KEY}` },
    timeout: 20000,
  });

  const results = data.results ?? [];
  for (const pick of results) {
    if (!pick?.id || !pick?.urls) continue;
    if (!isLandscape(pick.width, pick.height)) {
      console.log(`Skipping portrait Unsplash photo: ${pick.id}`);
      continue;
    }
    const keyed = `unsplash:${pick.id}`;
    if (usedIds.has(keyed) || usedIds.has(pick.id)) {
      console.log(`Skipping already-used Unsplash photo: ${pick.id}`);
      continue;
    }
    await triggerUnsplashDownload(pick.links?.download_location);
    return toUnsplashResult(pick);
  }
  return null;
}

/**
 * Search Pexels with landscape-only filter. Rejects portrait results.
 */
async function searchPexels(query, usedIds) {
  if (!PEXELS_KEY) return null;

  const { data } = await axios.get("https://api.pexels.com/v1/search", {
    params: {
      query,
      per_page: 30,
      orientation: "landscape",
      size: "large",
    },
    headers: { Authorization: PEXELS_KEY },
    timeout: 20000,
  });

  const results = data.photos ?? [];
  for (const pick of results) {
    if (!pick?.id || !pick?.src) continue;
    if (!isLandscape(pick.width, pick.height)) {
      console.log(`Skipping portrait Pexels photo: ${pick.id}`);
      continue;
    }
    const keyed = `pexels:${pick.id}`;
    if (usedIds.has(keyed) || usedIds.has(String(pick.id))) {
      console.log(`Skipping already-used Pexels photo: ${pick.id}`);
      continue;
    }
    return toPexelsResult(pick);
  }
  return null;
}

/**
 * @param {{
 *   imageQuery?: string,
 *   keywords?: string[],
 *   keyword?: string,
 *   category: string,
 *   service?: string,
 *   title?: string,
 *   excludeIds?: string[],
 * }} opts
 */
export async function fetchBlogCoverImage({
  imageQuery,
  keywords = [],
  keyword,
  category,
  excludeIds = [],
}) {
  const query =
    normalizeImageQuery(imageQuery) ||
    normalizeImageQuery(keywords[0] || keyword) ||
    "retail analytics dashboard team meeting";

  if (!UNSPLASH_KEY && !PEXELS_KEY) {
    console.warn("No UNSPLASH_ACCESS_KEY or PEXELS_API_KEY — using category fallback image");
    return categoryFallback(category);
  }

  const usedIds = loadUsedUnsplashIds(excludeIds);
  console.log(`Cover imageQuery (topic-specific): "${query}"`);
  console.log(`Excluding ${usedIds.size} previously used image IDs`);

  // Unsplash first
  if (UNSPLASH_KEY) {
    try {
      const unsplash = await searchUnsplash(query, usedIds);
      if (unsplash?.url) {
        console.log("Unsplash image:", unsplash.url.slice(0, 60) + "...");
        console.log("Photo by:", unsplash.imageCredit?.photographer, `(id: ${unsplash.imageId})`);
        return unsplash;
      }
      console.warn(`No unused landscape Unsplash results for: ${query}`);
    } catch (err) {
      console.warn(`Unsplash search failed (${query}):`, err.response?.data ?? err.message);
    }
  } else {
    console.warn("UNSPLASH_ACCESS_KEY not set — trying Pexels");
  }

  // Pexels co-provider / fallback
  if (PEXELS_KEY) {
    try {
      const pexels = await searchPexels(query, usedIds);
      if (pexels?.url) {
        console.log("Pexels image:", pexels.url.slice(0, 60) + "...");
        console.log("Photo by:", pexels.imageCredit?.photographer, `(id: ${pexels.imageId})`);
        return pexels;
      }
      console.warn(`No unused landscape Pexels results for: ${query}`);
    } catch (err) {
      console.warn(`Pexels search failed (${query}):`, err.response?.data ?? err.message);
    }
  } else {
    console.warn("PEXELS_API_KEY not set — no Pexels fallback");
  }

  console.warn("No unused landscape stock results — using category fallback");
  return categoryFallback(category);
}
