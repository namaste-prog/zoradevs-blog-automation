# Zoradevs B2B Blog Automation

Zero-touch B2B lead-generation pipeline for **Delhi NCR first** (Noida, Gurgaon, Delhi), then Pan-India. Runs Mon–Fri via GitHub Actions.

Aligned with the **ZoraDevs SEO Roadmap** (2026 title formulas, local keywords, fixed closing CTA).

## 5-Layer Pipeline

1. **Competitor discovery** — Google Custom Search + fallback domains
2. **Website intelligence** — Scrapes zoradevs.com + competitors (sitemap, H1/H2, meta)
3. **Service-based topics** — Groq maps `ctx.services` into Pattern 1 / Pattern 2 titles with a **2026** anchor (no Google Trends)
4. **6-month memory** — MongoDB + local log anti-duplication (no repeated blogs)
5. **Publish** — Groq writes B2B blog + FAQ schema + landscape Unsplash/Pexels cover → `POST /api/blogs`

## Title formulas (required)

- **Pattern 1:** `[Service/Industry] + AI + in [India/Noida/Delhi NCR] + 2026`
- **Pattern 2:** `AI + [Service/Industry] + in [India/Noida/Delhi NCR] + 2026`

Titles missing `"AI"` are regenerated (up to 3 metadata retries).

## Content rules

- **Region:** Delhi NCR (Noida / Gurgaon / Delhi) first; Pan-India only as fallback
- **AI keywords:** every blog keyword set must include AI + business intent (founders, ROI, scale)
- **Static local keywords appended on publish:**
  - `AI development company Noida`
  - `software development company Noida`
  - `IT company Noida`
  - `app development Delhi NCR`
- **Closing paragraph:** every blog ends with the exact ZoraDevs Noida CTA block
- **Authors:** randomly assigned from Mansi, Parul, Nikhil
- **Length:** minimum 2000 words via 3-part Groq write
- **Images:** Groq `imageQuery` (literal scene only) → Unsplash then Pexels; `orientation=landscape` only; alt = first keyword
- **No repeats:** topic key + keyword combo + similar titles are blocked

## GitHub Secrets

| Secret | Required |
|--------|----------|
| `GROQ_API_KEY` | Yes |
| `BLOG_API_SECRET` | Yes |
| `BLOG_API_URL` | Yes (`https://zoradevs.com/api/blogs`) |
| `UNSPLASH_ACCESS_KEY` | Recommended (cover images) |
| `PEXELS_API_KEY` | Recommended (landscape fallback / co-provider) |
| `GOOGLE_CSE_API_KEY` | Optional (better competitor discovery) |
| `GOOGLE_CSE_CX` | Optional |

## Local test

```bash
npm install
GROQ_API_KEY=... BLOG_API_SECRET=... BLOG_API_URL=https://zoradevs.com/api/blogs UNSPLASH_ACCESS_KEY=... PEXELS_API_KEY=... node scripts/generate-and-publish.js
```

## Admin

Toggle pipeline at **Admin → Blog Automation** on zoradevs.com.

See `BLOG_AUTOMATION_GUIDE.md` for the full system map.
