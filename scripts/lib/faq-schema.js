/**
 * Build FAQPage JSON-LD for blog accordion UI + Google rich results.
 */
export function buildFaqSchema(faqs) {
  const clean = (Array.isArray(faqs) ? faqs : [])
    .map((faq) => ({
      question: String(faq?.question || "").trim(),
      answer: String(faq?.answer || "").trim(),
    }))
    .filter((faq) => faq.question.length >= 5 && faq.answer.length >= 10);

  if (!clean.length) return null;

  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: clean.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}
