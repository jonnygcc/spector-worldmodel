// Passed as strings so the compiler can't inject helpers that don't exist in the page. Only text the
// user sees is extracted (innerText, visible headings, no meta description), each one capped.

export const MAX_TITLE = 200;
export const MAX_HEADING = 150;
export const MAX_HEADINGS = 15;
export const MAX_LABEL = 70;
export const MAX_ELEMENTS = 100;
// Caps the DOM work: a page with hundreds of thousands of nodes doesn't multiply each script's cost.
export const MAX_TAGGED = 2000;
export const MAX_HEADINGS_SCANNED = 200;

const IS_VISIBLE = `
  const isVisible = (el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    return true;
  };
`;

// Capture and matcher must see the same label: the visible text, or the accessible name without one.
const LABEL_OF = `
  const labelOf = (el, elType) => {
    if (elType === 'input') {
      return el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.getAttribute('name') || '';
    }
    return (el.innerText || '').trim() || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('value') || '';
  };
  const typeOf = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'input' && el.type === 'submit') return 'button';
    if (tag === 'input' || tag === 'textarea') return 'input';
    return 'button';
  };
`;

/** Tags every visible interactive element with a unique data-spector-id. */
export const TAG_ELEMENTS_SCRIPT = `
(() => {
  // The counter lives in the page: restarting at 0 gave late elements (a dropdown) ids already in use,
  // so on Google the dropdown's search button became sp-0 and the Apps button got clicked instead.
  let counter = window.__spectorCounter || 0;
  ${IS_VISIBLE}
  const selectors = [
    'button',
    "[role='button']",
    "input[type='submit']",
    'a[href]',
    "input[type='text']",
    "input[type='search']",
    "input[type='email']",
    'textarea'
  ];

  let tagged = document.querySelectorAll('[data-spector-id]').length;
  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel)) {
      if (tagged >= ${MAX_TAGGED}) break;
      if (el.hasAttribute('data-spector-id')) continue;
      if (!isVisible(el)) continue;
      el.setAttribute('data-spector-id', 'sp-' + (counter++));
      tagged += 1;
    }
  }
  window.__spectorCounter = counter;
})()
`;

export const EXTRACT_STATE_SCRIPT = `
(() => {
  ${IS_VISIBLE}
  ${LABEL_OF}
  const clip = (s, max) => (s || '').replace(/\\s+/g, ' ').trim().substring(0, max);

  // Visible headings only, with the text the user actually sees.
  const headings = Array.prototype.slice
    .call(document.querySelectorAll('h1, h2, h3'), 0, ${MAX_HEADINGS_SCANNED})
    .filter(isVisible)
    .map((el) => el.tagName + ': ' + clip(el.innerText, ${MAX_HEADING}))
    .filter((h) => !/: $/.test(h))
    .slice(0, ${MAX_HEADINGS});

  const interactiveElements = [];

  document.querySelectorAll('[data-spector-id]').forEach((el) => {
    // An element tagged earlier may have been hidden since.
    if (!isVisible(el)) return;
    const id = el.getAttribute('data-spector-id');
    const rect = el.getBoundingClientRect();
    const type = typeOf(el);
    const label = clip(labelOf(el, type) || (type === 'input' ? 'unnamed input' : 'unnamed'), ${MAX_LABEL});
    if (label.length < 1) return;

    interactiveElements.push({
      type: type,
      label: label,
      selector: '[data-spector-id="' + id + '"]',
      coordinates: { x: Math.round(rect.x), y: Math.round(rect.y) },
      region: el.closest('header, nav, footer, [role="navigation"], [role="banner"], [role="contentinfo"]') ? 'chrome' : 'content'
    });
  });

  // Up to ${MAX_ELEMENTS} in document order: with 40, a category page returned only header and filter
  // elements, no products.
  return {
    headings: headings,
    interactiveElements: interactiveElements.slice(0, ${MAX_ELEMENTS})
  };
})()
`;

export const buildFindElementScript = (label: string, type: string): string => `
(() => {
  ${LABEL_OF}
  const target = ${JSON.stringify(label)}.toLowerCase().trim();
  const type = ${JSON.stringify(type)};
  const candidates = [];

  // bag and basket count as cart, so "Add to Cart" finds "Add to bag".
  const normalize = (s) => s.replace(/\\s+/g, ' ').trim().toLowerCase().replace(/\\b(bag|basket)\\b/g, 'cart');
  const stripNumbers = (s) => s.replace(/\\d+/g, '#').trim();

  const targetNorm = normalize(target);
  const targetStripped = stripNumbers(targetNorm);

  document.querySelectorAll('[data-spector-id]').forEach((el) => {
    const id = el.getAttribute('data-spector-id');
    const elType = typeOf(el);
    if (elType !== type) return;

    const elLabel = labelOf(el, elType);
    const a = normalize(elLabel);
    if (!a) return;

    const aStripped = stripNumbers(a);

    let score = -1;

    if (a === targetNorm) {
      score = 1000;
    } else if (aStripped === targetStripped) {
      score = 900;
    } else if (a.indexOf(targetNorm) === 0 || targetNorm.indexOf(a) === 0) {
      score = 700 - Math.abs(a.length - targetNorm.length);
    } else if (a.indexOf(targetNorm) !== -1) {
      score = 500 - Math.abs(a.length - targetNorm.length);
    } else if (targetNorm.indexOf(a) !== -1) {
      score = 400 - Math.abs(a.length - targetNorm.length);
    } else if (aStripped.indexOf(targetStripped) !== -1 || targetStripped.indexOf(aStripped) !== -1) {
      score = 300 - Math.abs(a.length - targetNorm.length);
    }

    if (score < 0) return;

    // Share of the longer label they have in common: "Search" starts like "search button" but covers half.
    const coverage = Math.min(a.length, targetNorm.length) / Math.max(a.length, targetNorm.length);

    // Is it what a click at its center actually hits? Google has two search buttons and the suggestions
    // dropdown covers one, so on equal score the one on top wins.
    const rect = el.getBoundingClientRect();
    const hitEl = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    const onTop = !!hitEl && (hitEl === el || el.contains(hitEl));

    candidates.push({ id: id, label: elLabel, norm: a, score: score, coverage: coverage, onTop: onTop });
  });

  if (candidates.length === 0) return null;
  candidates.sort((x, y) => y.score - x.score || (y.onTop ? 1 : 0) - (x.onTop ? 1 : 0));

  // One per label: two "Google Search" buttons are the same target, not an ambiguity.
  const seen = {};
  const top = [];
  candidates.forEach((c) => {
    if (top.length >= 5 || seen[c.norm]) return;
    seen[c.norm] = true;
    top.push({
      selector: '[data-spector-id="' + c.id + '"]',
      label: c.label.replace(/\\s+/g, ' ').trim().slice(0, 80),
      score: c.score,
      coverage: c.coverage
    });
  });
  return top;
})()
`;
