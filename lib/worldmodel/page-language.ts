// Only a validated code ever reaches the signals prompt, so a page can't inject through its lang attribute.
const LANGUAGE_TAG = /^([a-z]{2,3})(?:[-_][a-z0-9]{1,8})*$/i;

export function languageFromTag(raw: unknown): string | null {
  const match = typeof raw === "string" ? LANGUAGE_TAG.exec(raw.trim()) : null;
  return match ? match[1].toLowerCase() : null;
}

// Words that tell these languages apart: shared ones like "de", "que" or "para" would only blur Spanish and Portuguese.
const MARKERS: Record<string, string[]> = {
  es: ["el", "los", "las", "del", "una", "con", "y", "más", "tu", "nuestro", "nuestra", "sin", "cómo", "sobre", "ahora", "gratis"],
  pt: ["os", "do", "da", "um", "uma", "com", "e", "mais", "você", "seu", "sua", "não", "ao", "em", "agora", "grátis"],
  en: ["the", "and", "of", "to", "your", "with", "for", "our", "you", "how", "now", "free", "get"],
  fr: ["le", "les", "des", "et", "une", "pour", "avec", "vos", "votre", "nous", "sur", "gratuit"],
  de: ["der", "die", "das", "und", "mit", "für", "ihre", "wir", "sie", "jetzt", "kostenlos"],
  it: ["il", "gli", "di", "che", "della", "delle", "alla", "dei", "nel", "per", "sono", "tuo", "tua", "ora", "più"],
};
const MIN_MARKERS = 3;
const MIN_LEAD = 1.5;

// A clear winner or nothing: a wrong guess is worse than "unknown", and this one overrules the page's lang.
export function guessLanguage(text: string): string | null {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const scores = Object.entries(MARKERS)
    .map(([language, markers]) => ({ language, hits: words.filter((word) => markers.includes(word)).length }))
    .sort((a, b) => b.hits - a.hits);
  const [best, second] = scores;
  return best.hits >= MIN_MARKERS && best.hits >= second.hits * MIN_LEAD ? best.language : null;
}

// Templates ship lang="en" on Spanish sites, so the content decides and the attribute only fills in when it
// can't. Languages without markers keep their attribute: Polish "to" and "do" would read as English.
export function pageLanguage(tag: unknown, text: string): string | null {
  const declared = languageFromTag(tag);
  if (declared && !(declared in MARKERS)) return declared;
  return guessLanguage(text) ?? declared;
}
