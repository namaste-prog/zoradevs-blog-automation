/**
 * Layer 3 — Anti-duplication checks (6-month memory via API + local log).
 */
export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80)
    .replace(/-$/, "");
}

export function hashKeywordCombo(keywords) {
  return keywords
    .map((k) => k.toLowerCase().trim())
    .filter(Boolean)
    .sort()
    .join("|");
}

function normalizeTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleTooSimilar(a, b) {
  const left = normalizeTitle(a);
  const right = normalizeTitle(b);
  if (!left || !right) return false;
  if (left === right) return true;

  const leftWords = new Set(left.split(" ").filter((w) => w.length > 3));
  const rightWords = right.split(" ").filter((w) => w.length > 3);
  if (!leftWords.size || !rightWords.length) return false;

  const overlap = rightWords.filter((w) => leftWords.has(w)).length;
  const ratio = overlap / Math.max(leftWords.size, rightWords.length);
  return ratio >= 0.7;
}

export function isDuplicate(candidate, recentTopics) {
  const topicKey = slugify(candidate.topic_key || candidate.keywords?.[0] || "");
  const keywordHash = hashKeywordCombo(candidate.keywords ?? []);
  const primary = String(candidate.keywords?.[0] || "").toLowerCase().trim();
  const title = candidate.topic || candidate.title || "";

  return recentTopics.some((t) => {
    const existingKey = slugify(t.topicKey || t.topic_key || "");
    const existingHash =
      t.keywordHash ||
      hashKeywordCombo(t.keywords ?? [t.keyword].filter(Boolean));
    const existingPrimary = String(
      t.keywords?.[0] || t.keyword || ""
    )
      .toLowerCase()
      .trim();
    const existingTitle = t.title || t.topic || "";

    return (
      (topicKey && existingKey === topicKey) ||
      (keywordHash && existingHash === keywordHash) ||
      (primary && existingPrimary && primary === existingPrimary) ||
      titleTooSimilar(title, existingTitle)
    );
  });
}

export function pickUniqueCandidate(candidates, recentTopics) {
  for (const candidate of candidates) {
    if (!isDuplicate(candidate, recentTopics)) {
      return candidate;
    }
    console.warn("Rejected duplicate topic:", candidate.topic_key || candidate.topic);
  }
  return null;
}

/** Ensure topic-pick keywords include AI in a phrase; do not pad with generic SEO lists. */
export function ensureAiInKeywords(keywords = []) {
  const cleaned = keywords
    .map((k) => String(k || "").trim().replace(/\s+/g, " "))
    .filter((k) => k && k.split(/\s+/).length >= 2);

  const hasAi = cleaned.some((k) =>
    /\bai\b|artificial intelligence|machine learning|\bml\b/i.test(k)
  );

  if (!hasAi && cleaned.length) {
    cleaned[0] = /\bai\b/i.test(cleaned[0])
      ? cleaned[0]
      : `AI ${cleaned[0]}`.replace(/\s+/g, " ").trim();
  }

  return cleaned.slice(0, 5);
}
