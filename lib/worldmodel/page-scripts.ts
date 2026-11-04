// Scripts que corren dentro de la página (page.evaluate). Se pasan como
// string para evitar que el compilador inyecte helpers que no existen
// dentro del navegador.
//
// Solo se extrae texto que el usuario ve: innerText (respeta el CSS, no
// incluye lo oculto) en vez de textContent, encabezados visibles, y nada
// de meta description. Cada texto tiene tope (inyección de prompt y
// volumen, paso 7).
//
// Módulo sin dependencias: los tests lo cargan con `node --test`.

export const MAX_TITLE = 200;
export const MAX_HEADING = 150;
export const MAX_HEADINGS = 15;
export const MAX_LABEL = 70;
export const MAX_ELEMENTS = 100;

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

// Texto visible de un elemento interactivo: el que lee el usuario o, si
// no tiene, su nombre accesible. Lo usan la captura y el emparejador, que
// deben ver la misma etiqueta.
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

/**
 * Inyecta un atributo data-spector-id unico a cada elemento interactivo visible.
 */
export const TAG_ELEMENTS_SCRIPT = `
(() => {
  // El contador vive en la página: si empezara en 0 en cada llamada, los
  // elementos que aparecen después (un desplegable) repetirían ids ya
  // usados, y el selector resolvería al primero del DOM. En Google, el
  // "Buscar con Google" del desplegable salía como sp-0, igual que el
  // botón de Aplicaciones, y se pulsaba ese.
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

  selectors.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => {
      if (el.hasAttribute('data-spector-id')) return;
      if (!isVisible(el)) return;
      el.setAttribute('data-spector-id', 'sp-' + (counter++));
    });
  });
  window.__spectorCounter = counter;
})()
`;

export const EXTRACT_STATE_SCRIPT = `
(() => {
  ${IS_VISIBLE}
  ${LABEL_OF}
  const clip = (s, max) => (s || '').replace(/\\s+/g, ' ').trim().substring(0, max);

  // Solo encabezados visibles, con el texto que se ve.
  const headings = Array.prototype.slice
    .call(document.querySelectorAll('h1, h2, h3'))
    .filter(isVisible)
    .map((el) => el.tagName + ': ' + clip(el.innerText, ${MAX_HEADING}))
    .filter((h) => !/: $/.test(h))
    .slice(0, ${MAX_HEADINGS});

  const interactiveElements = [];

  document.querySelectorAll('[data-spector-id]').forEach((el) => {
    // Un elemento etiquetado antes puede haberse ocultado después.
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

  // Hasta ${MAX_ELEMENTS} en orden del documento. Antes eran 40, y en una página de
  // categoría eran todos de la cabecera y los filtros: ningún producto.
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

  // bag y basket valen lo mismo que cart: "Add to Cart" encuentra "Add to bag".
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

    // Cobertura: qué parte de la etiqueta más larga comparten. "Search"
    // empieza igual que "search button", pero solo cubre la mitad.
    const coverage = Math.min(a.length, targetNorm.length) / Math.max(a.length, targetNorm.length);

    // ¿Es lo que de verdad se pulsa en su centro? Google tiene dos botones
    // "Buscar con Google" y uno queda tapado por el desplegable de
    // sugerencias: a igual puntaje gana el que está encima.
    const rect = el.getBoundingClientRect();
    const hitEl = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    const onTop = !!hitEl && (hitEl === el || el.contains(hitEl));

    candidates.push({ id: id, label: elLabel, norm: a, score: score, coverage: coverage, onTop: onTop });
  });

  if (candidates.length === 0) return null;
  candidates.sort((x, y) => y.score - x.score || (y.onTop ? 1 : 0) - (x.onTop ? 1 : 0));

  // Los mejores, uno por etiqueta: dos botones "Google Search" son el
  // mismo destino, no una ambigüedad.
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
