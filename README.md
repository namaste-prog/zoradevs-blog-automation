# Zoradevs Blog Automation

Publishes one SEO blog per weekday to [zoradevs.com](https://zoradevs.com) via GitHub Actions + **Groq (Llama 3 70B)**.

## Weekly routine (Monday, ~15 min)

1. Edit `keywords.json` — replace 5 entries (Mon–Fri)
2. Commit: `Keywords for week of …`
3. Done — blogs publish automatically at **9 AM IST** Mon–Fri

## GitHub Secrets (required)

| Secret | Value |
|--------|--------|
| `GROQ_API_KEY` | From [console.groq.com](https://console.groq.com) |
| `BLOG_API_SECRET` | Same token as Vercel `BLOG_API_SECRET` |
| `BLOG_API_URL` | `https://zoradevs.com/api/blogs` |

Default model: `llama-3.3-70b-versatile` (set in workflow)

## Manual test

GitHub → **Actions** → **Publish Daily Blog** → **Run workflow**

## Files

| File | Purpose |
|------|---------|
| `keywords.json` | You update weekly |
| `published_log.json` | Auto — do not edit |
| `linkedin_queue.txt` | Copy posts to LinkedIn |
| `scripts/generate-and-publish.js` | Main bot script |

## Categories (exact spelling)

Software Development · AI & Automation · Mobile Development · Fintech · Healthcare Tech · E-Commerce · Staff Augmentation · Web Development · Case Studies · Tech Insights
