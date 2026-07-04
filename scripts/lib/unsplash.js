/**
 * Unsplash cover image for automated blogs.
 * Requires UNSPLASH_ACCESS_KEY (GitHub Secret).
 */
import axios from "axios";

const ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;
const UTM = "utm_source=zoradevs&utm_medium=referral";

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
  };
}

function buildSearchQueries({ keyword, category, service, title }) {
  const base = [keyword, category, service, title].filter(Boolean);
  return [
    `${keyword} technology business office`,
    `${service || category} software development team`,
    `${category} startup india technology`,
    base.slice(0, 2).join(" "),
  ].filter((q, i, arr) => q && arr.indexOf(q) === i);
}

async function triggerDownload(downloadLocation) {
  if (!downloadLocation || !ACCESS_KEY) return;
  try {
    await axios.get(downloadLocation, {
      headers: { Authorization: `Client-ID ${ACCESS_KEY}` },
      timeout: 10000,
    });
  } catch {
    // Non-fatal — Unsplash guidelines prefer this call but image still works
  }
}

async function searchUnsplash(query) {
  const { data } = await axios.get("https://api.unsplash.com/search/photos", {
    params: {
      query,
      per_page: 15,
      orientation: "landscape",
      content_filter: "high",
    },
    headers: { Authorization: `Client-ID ${ACCESS_KEY}` },
    timeout: 20000,
  });

  const results = data.results ?? [];
  if (!results.length) return null;

  const pick = results[Math.floor(Math.random() * Math.min(5, results.length))];
  await triggerDownload(pick.links?.download_location);

  const photographer = pick.user?.name ?? "Unsplash Contributor";
  const photographerUrl = pick.user?.links?.html
    ? `${pick.user.links.html}?${UTM}`
    : `https://unsplash.com/?${UTM}`;

  return {
    url: pick.urls?.regular ?? pick.urls?.full,
    imageCredit: {
      photographer,
      photographerUrl,
      unsplashUrl: `https://unsplash.com/?${UTM}`,
    },
    source: "unsplash",
    unsplashId: pick.id,
  };
}

/**
 * @param {{ keyword: string, category: string, service?: string, title?: string }}
 */
export async function fetchBlogCoverImage({ keyword, category, service, title }) {
  if (!ACCESS_KEY) {
    console.warn("UNSPLASH_ACCESS_KEY not set — using category fallback image");
    return categoryFallback(category);
  }

  const queries = buildSearchQueries({ keyword, category, service, title });
  console.log("Fetching Unsplash cover for:", keyword);

  for (const query of queries) {
    try {
      const result = await searchUnsplash(query);
      if (result?.url) {
        console.log("Unsplash image:", result.url.slice(0, 60) + "...");
        console.log("Photo by:", result.imageCredit?.photographer);
        return result;
      }
    } catch (err) {
      console.warn(`Unsplash search failed (${query}):`, err.response?.data ?? err.message);
    }
  }

  console.warn("Unsplash returned no results — using category fallback");
  return categoryFallback(category);
}
