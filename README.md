# Zoradevs B2B Blog Automation

Zero-touch B2B lead-generation pipeline for **Delhi NCR first** (Noida, Gurgaon, Delhi), then Pan-India. Runs Mon–Fri via GitHub Actions.

## 5-Layer Pipeline

1. **Competitor discovery** — Google Custom Search + Clutch India (dynamic, no hardcoded URLs)
2. **Website intelligence** — Scrapes zoradevs.com + competitors (sitemap, H1/H2, meta)
3. **India trend filter** — Google Trends RSS (`geo=IN`) + Groq topic selection (Delhi NCR priority)
4. **6-month memory** — MongoDB + local log anti-duplication (no repeated blogs)
5. **Publish** — Groq writes B2B blog + FAQ schema + keyword-based Unsplash cover → `POST /api/blogs`

## Content rules

- **Region:** Delhi NCR (Noida / Gurgaon / Delhi) first; Pan-India only as fallback
- **AI keywords:** every blog keyword set must include AI
- **Authors:** randomly assigned from Mansi, Parul, Nikhil
- **Length:** minimum 2000 words via 3-part Groq write (fits free-tier TPM limits)
- **Images:** Unsplash search uses blog keywords; previously used photo IDs are never reused (`used_unsplash_ids.json`)
- **No repeats:** topic key + keyword combo + similar titles are blocked

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
GROQ_API_KEY=... BLOG_API_SECRET=... BLOG_API_URL=https://zoradevs.com/api/blogs UNSPLASH_ACCESS_KEY=... node scripts/generate-and-publish.js
```

## Admin

Toggle pipeline at **Admin → Blog Automation** on zoradevs.com.
