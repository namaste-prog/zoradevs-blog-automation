# Zoradevs B2B Blog Automation

Zero-touch B2B lead-generation pipeline for Indian startups. Runs Mon–Fri via GitHub Actions.

## 5-Layer Pipeline

1. **Competitor discovery** — Google Custom Search + Clutch India (dynamic, no hardcoded URLs)
2. **Website intelligence** — Scrapes zoradevs.com + competitors (sitemap, H1/H2, meta)
3. **India trend filter** — Google Trends RSS (`geo=IN`) + Groq topic selection
4. **6-month memory** — MongoDB `published_topics_log` anti-duplication
5. **Publish** — Groq writes B2B blog + FAQ schema → `POST /api/blogs`

## GitHub Secrets

| Secret | Required |
|--------|----------|
| `GROQ_API_KEY` | Yes |
| `BLOG_API_SECRET` | Yes |
| `BLOG_API_URL` | Yes (`https://zoradevs.com/api/blogs`) |
| `UNSPLASH_ACCESS_KEY` | Yes (cover images) |
| `GOOGLE_CSE_API_KEY` | Optional (better competitor discovery) |
| `GOOGLE_CSE_CX` | Optional |

## Local test

```bash
npm install
GROQ_API_KEY=... BLOG_API_SECRET=... BLOG_API_URL=https://zoradevs.com/api/blogs node scripts/generate-and-publish.js
```

## Admin

Toggle pipeline at **Admin → Blog Automation** on zoradevs.com.
