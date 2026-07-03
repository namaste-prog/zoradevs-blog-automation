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

export function isDuplicate(candidate, recentTopics) {
  const topicKey = slugify(candidate.topic_key || candidate.keywords?.[0] || "");
  const keywordHash = hashKeywordCombo(candidate.keywords ?? []);

  return recentTopics.some((t) => {
    const existingKey = slugify(t.topicKey || "");
    const existingHash = t.keywordHash || hashKeywordCombo(t.keywords ?? [t.keyword].filter(Boolean));
    return existingKey === topicKey || (keywordHash && existingHash === keywordHash);
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
