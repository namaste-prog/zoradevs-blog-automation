/**
 * Google Trends RSS — India (geo=IN).
 */
import axios from "axios";
import Parser from "rss-parser";

const TRENDS_RSS_URL = "https://trends.google.com/trending/rss?geo=IN";

export async function fetchIndiaTrends(limit = 20) {
  const parser = new Parser({ timeout: 20000 });
  try {
    const feed = await parser.parseURL(TRENDS_RSS_URL);
    return (feed.items ?? [])
      .slice(0, limit)
      .filter((item) => item.title)
      .map((item) => ({
        title: item.title.trim(),
        traffic: item["ht:approx_traffic"] ?? "",
        source: "Google Trends India",
      }));
  } catch (err) {
    console.warn("Google Trends IN RSS failed:", err.message);
    return [];
  }
}
