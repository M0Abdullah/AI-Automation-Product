import type { Page } from 'playwright';
import type { DesignSpec } from './design-spec';

/**
 * CHECKING A LIVE PAGE AGAINST THE DESIGN SPEC.
 *
 * The whole value of this file is what it REFUSES to report.
 *
 * A page contains hundreds of measurable elements and a design system permits
 * only a handful of values, so a naive "flag everything that differs" produces
 * a wall of noise, and a reviewer who scrolls past a wall of noise will also
 * scroll past the two findings that mattered. The platform's one real asset is
 * that its findings are trustworthy; a chatty design checker would spend it.
 *
 * So the rule is NEAR-MISSES ONLY:
 *
 *   button is 38px, design says 40px   -> 2px out  -> report (a mistake)
 *   button is 26px, design says 32px   -> 6px out  -> silent (different thing)
 *
 * Something a couple of pixels off a permitted value is almost certainly meant
 * to be that value. Something far away is almost certainly a component the
 * design does not cover, and guessing otherwise is how a tool loses its
 * reputation.
 */

export interface MeasuredElement {
  tag: string;
  text: string;
  selector: string;
  width: number;
  height: number;
  radius: number;
  fontSize: number;
  fontWeight: number;
  fontFamily: string;
  color: string;
  background: string;
}

export interface DesignDeviation {
  /** What was measured: 'button height', 'corner radius', 'font size'... */
  property: string;
  /** The element, described so a human can find it. */
  element: string;
  selector: string;
  actual: string;
  expected: string;
  /** How far off, in px. Drives ordering - the closest misses are the surest. */
  offBy: number;
  note: string;
}

export interface DesignComparison {
  checked: number;
  deviations: DesignDeviation[];
  /** Values on the page that matched the design exactly. Evidence it worked. */
  conforming: number;
  skippedFarFromSpec: number;
}

/** How many px off a spec value still counts as "meant to be that value". */
const NEAR_MISS_PX = 4;
/** Font sizes are a tighter scale, so the window is tighter too. */
const NEAR_MISS_FONT_PX = 2;

/**
 * Read every candidate element's computed geometry and typography.
 *
 * Computed styles are used rather than the stylesheet, because what the user
 * actually sees is the product of cascade, media queries and runtime changes -
 * the declared CSS is frequently not what rendered.
 */
export async function measurePage(page: Page): Promise<MeasuredElement[]> {
  return page.evaluate(() => {
    const out: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();

    const describe = (el: Element): string => {
      const id = (el as HTMLElement).id;
      if (id) return `#${id}`;
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/) : [];
      // Utility-class frameworks produce 20-class strings; the first two are
      // enough to locate the element without filling the report with noise.
      return el.tagName.toLowerCase() + (cls.length ? `.${cls.slice(0, 2).join('.')}` : '');
    };

    const nodes = document.querySelectorAll(
      'button, a, input, select, textarea, [role="button"]',
    );

    for (const el of Array.from(nodes).slice(0, 400)) {
      const r = el.getBoundingClientRect();
      // Invisible or degenerate boxes tell us nothing about the design.
      if (r.width < 8 || r.height < 8) continue;

      const s = window.getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) continue;

      const text = (el as HTMLElement).innerText?.trim().replace(/\s+/g, ' ').slice(0, 40) ?? '';
      const key = `${el.tagName}|${text}|${Math.round(r.width)}x${Math.round(r.height)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const radius = parseFloat(s.borderTopLeftRadius) || 0;

      out.push({
        tag: el.tagName.toLowerCase(),
        text,
        selector: describe(el),
        width: Math.round(r.width),
        height: Math.round(r.height),
        radius: Math.round(radius),
        fontSize: Math.round(parseFloat(s.fontSize) || 0),
        fontWeight: Number(s.fontWeight) || 400,
        fontFamily: (s.fontFamily.split(',')[0] ?? '').replace(/["']/g, '').trim(),
        color: s.color,
        background: s.backgroundColor,
      });
    }
    return out;
  }) as unknown as Promise<MeasuredElement[]>;
}

/** Closest permitted value, and the distance to it. */
function nearest(value: number, allowed: number[]): { value: number; distance: number } | null {
  if (!allowed.length) return null;
  let best = allowed[0];
  let dist = Math.abs(value - allowed[0]);
  for (const a of allowed) {
    const d = Math.abs(value - a);
    if (d < dist) {
      dist = d;
      best = a;
    }
  }
  return { value: best, distance: dist };
}

/** Elements a design system's button rules should apply to. */
function isButtonLike(m: MeasuredElement): boolean {
  if (m.tag === 'button' || m.tag === 'input') return true;
  // A link styled as a button: it has a real background and sensible height.
  const hasBg = m.background !== 'rgba(0, 0, 0, 0)' && m.background !== 'transparent';
  return m.tag === 'a' && hasBg && m.height >= 24 && m.height <= 72 && m.text.length > 0;
}

export function compareToSpec(
  measured: MeasuredElement[],
  spec: DesignSpec,
): DesignComparison {
  const deviations: DesignDeviation[] = [];
  let conforming = 0;
  let skipped = 0;
  let checked = 0;

  const label = (m: MeasuredElement) =>
    m.text ? `"${m.text}"` : `<${m.tag}> ${m.width}x${m.height}`;

  for (const m of measured) {
    let elementChecked = false;

    // ---------------------------------------------------------- button height
    if (isButtonLike(m) && spec.buttonHeights.length) {
      elementChecked = true;
      const n = nearest(m.height, spec.buttonHeights);
      if (n) {
        if (n.distance === 0) {
          conforming++;
        } else if (n.distance <= NEAR_MISS_PX) {
          deviations.push({
            property: 'button height',
            element: label(m),
            selector: m.selector,
            actual: `${m.height}px`,
            expected: `${n.value}px`,
            offBy: n.distance,
            note:
              `The design defines button heights of ${spec.buttonHeights.join(', ')}px. ` +
              `This one is ${n.distance}px off the nearest.`,
          });
        } else {
          skipped++;
        }
      }
    }

    // ---------------------------------------------------------- corner radius
    if (m.radius > 0 && spec.cornerRadii.length) {
      elementChecked = true;
      const n = nearest(m.radius, spec.cornerRadii);
      if (n) {
        if (n.distance === 0) conforming++;
        else if (n.distance <= NEAR_MISS_PX) {
          deviations.push({
            property: 'corner radius',
            element: label(m),
            selector: m.selector,
            actual: `${m.radius}px`,
            expected: `${n.value}px`,
            offBy: n.distance,
            note: `The design uses radii of ${spec.cornerRadii.join(', ')}px.`,
          });
        } else skipped++;
      }
    }

    // -------------------------------------------------------------- font size
    if (m.fontSize > 0 && spec.fontSizes.length && m.text) {
      elementChecked = true;
      const n = nearest(m.fontSize, spec.fontSizes);
      if (n) {
        if (n.distance === 0) conforming++;
        else if (n.distance <= NEAR_MISS_FONT_PX) {
          deviations.push({
            property: 'font size',
            element: label(m),
            selector: m.selector,
            actual: `${m.fontSize}px`,
            expected: `${n.value}px`,
            offBy: n.distance,
            note: `The design's type scale is ${spec.fontSizes.join(', ')}px.`,
          });
        } else skipped++;
      }
    }

    // ------------------------------------------------------------ font family
    // Only checked when the design is unambiguous about it. A design using four
    // families says nothing useful about what the page should use.
    if (m.text && spec.fontFamilies.length === 1 && m.fontFamily) {
      elementChecked = true;
      const want = spec.fontFamilies[0];
      if (sameTypeface(m.fontFamily, want)) {
        conforming++;
      } else {
        deviations.push({
          property: 'font family',
          element: label(m),
          selector: m.selector,
          actual: m.fontFamily,
          expected: want,
          // Not a pixel measure; ranked below every pixel finding.
          offBy: 99,
          note: `The design uses ${want} throughout.`,
        });
      }
    }

    if (elementChecked) checked++;
  }

  // Closest misses first: a 1px difference is near-certainly a real mistake,
  // a 4px one is likelier to be a component the design does not describe.
  deviations.sort((a, b) => a.offBy - b.offBy);

  return { checked, deviations, conforming, skippedFarFromSpec: skipped };
}

/**
 * Is this the same typeface, ignoring how the file happens to be packaged?
 *
 * A browser reports the loaded face ("Geist Variable", "Inter var"), while
 * Figma names the family ("Geist", "Inter"). They are the same typeface, and
 * reporting "you used Geist Variable, the design says Geist" would be a
 * confident, wrong finding of exactly the kind this file exists to avoid.
 */
function sameTypeface(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/(variable|vf|var)/g, '')
      .replace(/[^a-z0-9]+/g, '')
      .trim();
  return norm(a) === norm(b);
}
