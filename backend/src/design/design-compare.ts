import type { Page } from 'playwright';
import { DesignIssueGroup } from '../common/enums';
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
 *
 * ELEVEN PROPERTIES are checked: button and control heights, corner radius,
 * icon size, spacing, font size / family / weight, and text / background /
 * border colour. Each one keeps its own near-miss window, because the windows
 * are not comparable - 2px is a big deal on a type scale and nothing at all on
 * a 48px gap.
 *
 * STILL NOT CHECKED, deliberately: absolute element positions, arbitrary
 * widths, and pixel diffing. A design system does not constrain how wide a
 * card is - that is the page's layout, not the design's rule - so flagging a
 * width would be inventing a requirement. Icon and control DIMENSIONS are
 * checked precisely because those are real rules.
 */

/** Which family a property belongs to, for grouping in the UI. */
export type DeviationGroup = (typeof DesignIssueGroup)[keyof typeof DesignIssueGroup];

/** How the measurer classified an element, which decides what rules apply. */
export type MeasuredKind = 'button' | 'control' | 'icon' | 'text' | 'container';

export interface MeasuredElement {
  kind: MeasuredKind;
  tag: string;
  text: string;
  selector: string;
  width: number;
  height: number;
  radius: number;
  fontSize: number;
  fontWeight: number;
  fontFamily: string;
  /** Computed text colour as #RRGGBB, or '' when fully transparent. */
  color: string;
  /** Computed background as #RRGGBB, or '' when transparent. */
  background: string;
  /** Computed border colour as #RRGGBB, or '' when there is no visible border. */
  borderColor: string;
  borderWidth: number;
  /** Uniform padding when all four sides agree, else 0. */
  padding: number;
  /** Flex/grid gap, 0 when not a flex or grid container. */
  gap: number;
}

export interface DesignDeviation {
  /** What was measured: 'button height', 'text colour', 'icon size'... */
  property: string;
  /** Which family it belongs to, so the UI can group and bulk-dismiss. */
  group: DeviationGroup;
  /** The element, described so a human can find it. */
  element: string;
  selector: string;
  actual: string;
  expected: string;
  /**
   * How far off. Pixels for geometry and type; perceptual distance for colour.
   * Drives ordering - the closest misses are the surest.
   */
  offBy: number;
  note: string;
}

export interface DesignComparison {
  checked: number;
  deviations: DesignDeviation[];
  /** Values on the page that matched the design exactly. Evidence it worked. */
  conforming: number;
  skippedFarFromSpec: number;
  /** Deviation count per group, for the summary line. */
  byGroup: Record<string, number>;
}

// ---------------------------------------------------------- near-miss windows
/** Geometry: how many px off a spec value still counts as "meant to be that". */
const NEAR_MISS_PX = 4;
/** Font sizes are a tighter scale, so the window is tighter too. */
const NEAR_MISS_FONT_PX = 2;
/** Icons come in 16/20/24; 4px would let 20 match 24 and report nothing useful. */
const NEAR_MISS_ICON_PX = 3;
/** Spacing scales step by 4 or 8, so 3px off is a broken grid, 6px is a choice. */
const NEAR_MISS_SPACING_PX = 3;
/** Font weight steps by 100. 100 off is one step - a plausible slip. */
const NEAR_MISS_WEIGHT = 100;
/**
 * Colour, as weighted RGB distance (0..765).
 *
 * 40 is calibrated to catch the two mistakes that actually happen - a hardcoded
 * hex instead of the token, and the wrong step of the same ramp - while staying
 * silent on a colour the design simply does not contain. Above it, we cannot
 * tell "wrong shade" from "not in the design", and guessing is what this file
 * exists to avoid.
 */
const NEAR_MISS_COLOUR = 40;

/**
 * Read every candidate element's computed geometry, typography and colour.
 *
 * Computed styles are used rather than the stylesheet, because what the user
 * actually sees is the product of cascade, media queries and runtime changes -
 * the declared CSS is frequently not what rendered.
 *
 * The element set is wider than the interactive controls it started as, because
 * colour and type rules apply to body copy and headings too - and "the heading
 * is #4B5563 where the design says #111827" is exactly the kind of finding a
 * design review is for.
 */
export async function measurePage(page: Page): Promise<MeasuredElement[]> {
  return page.evaluate(() => {
    const out: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();

    /** rgb()/rgba() -> #RRGGBB. Returns '' for anything invisible. */
    const hex = (css: string): string => {
      const m = css.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/i);
      if (!m) return '';
      const a = m[4] === undefined ? 1 : Number(m[4]);
      // A transparent colour is not a colour choice, it is the absence of one.
      if (a < 0.1) return '';
      const to = (v: string) =>
        Math.max(0, Math.min(255, Math.round(Number(v))))
          .toString(16)
          .padStart(2, '0');
      return `#${to(m[1])}${to(m[2])}${to(m[3])}`.toUpperCase();
    };

    const describe = (el: Element): string => {
      const id = (el as HTMLElement).id;
      if (id) return `#${id}`;
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/) : [];
      // Utility-class frameworks produce 20-class strings; the first two are
      // enough to locate the element without filling the report with noise.
      return el.tagName.toLowerCase() + (cls.length ? `.${cls.slice(0, 2).join('.')}` : '');
    };

    /**
     * WHAT KIND OF THING IS THIS?
     *
     * The classification decides which rules apply, so it matters more than the
     * measurement. An icon judged as a button would be reported as a 20px-tall
     * button against a 40px spec - a loud, wrong finding.
     */
    const classify = (el: Element, w: number, h: number, s: CSSStyleDeclaration): string => {
      const tag = el.tagName.toLowerCase();

      // Icons first: an <svg> inside a button is an icon, not the button.
      const iconish =
        tag === 'svg' ||
        tag === 'i' ||
        tag === 'img' ||
        /\bicon\b|\bglyph\b/i.test(el.getAttribute('class') ?? '');
      if (iconish && Math.abs(w - h) <= 2 && w >= 8 && w <= 64) return 'icon';

      if (tag === 'input') {
        const t = (el.getAttribute('type') ?? 'text').toLowerCase();
        return t === 'button' || t === 'submit' || t === 'reset' ? 'button' : 'control';
      }
      if (tag === 'select' || tag === 'textarea') return 'control';
      if (tag === 'button' || el.getAttribute('role') === 'button') return 'button';

      if (tag === 'a') {
        // A link with a real background and a control-like height is a button
        // in every design system; a link in a paragraph is text.
        const bg = hex(s.backgroundColor);
        return bg && h >= 24 && h <= 72 ? 'button' : 'text';
      }

      if (/^(h[1-6]|p|label|span|li|td|th|strong|em|small|dt|dd|figcaption|legend)$/.test(tag)) {
        return 'text';
      }
      return 'container';
    };

    const nodes = document.querySelectorAll(
      'button, a, input, select, textarea, [role="button"], ' +
        'h1, h2, h3, h4, h5, h6, p, label, li, td, th, ' +
        'svg, i, img, [class*="icon"], [class*="Icon"], ' +
        'div, section, nav, header, footer, ul, form',
    );

    for (const el of Array.from(nodes).slice(0, 1200)) {
      const r = el.getBoundingClientRect();
      // Invisible or degenerate boxes tell us nothing about the design.
      if (r.width < 8 || r.height < 8) continue;

      const s = window.getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) continue;

      const w = Math.round(r.width);
      const h = Math.round(r.height);
      const kind = classify(el, w, h, s);

      const text = (el as HTMLElement).innerText?.trim().replace(/\s+/g, ' ').slice(0, 40) ?? '';

      // A container is only worth measuring for its spacing, and only when it
      // actually declares some. Otherwise every <div> on the page arrives here
      // and the 1200-element budget is spent on wrappers.
      const gapRaw = parseFloat(s.columnGap) || parseFloat(s.rowGap) || 0;
      const padT = Math.round(parseFloat(s.paddingTop) || 0);
      const padR = Math.round(parseFloat(s.paddingRight) || 0);
      const padB = Math.round(parseFloat(s.paddingBottom) || 0);
      const padL = Math.round(parseFloat(s.paddingLeft) || 0);
      const uniformPadding = padT === padR && padR === padB && padB === padL ? padT : 0;
      if (kind === 'container' && !gapRaw && !uniformPadding) continue;

      // Text elements with no text are layout, not typography.
      if (kind === 'text' && !text) continue;

      const key = `${kind}|${el.tagName}|${text}|${w}x${h}|${Math.round(gapRaw)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const borderWidth = Math.round(parseFloat(s.borderTopWidth) || 0);

      out.push({
        kind,
        tag: el.tagName.toLowerCase(),
        text,
        selector: describe(el),
        width: w,
        height: h,
        radius: Math.round(parseFloat(s.borderTopLeftRadius) || 0),
        fontSize: Math.round(parseFloat(s.fontSize) || 0),
        fontWeight: Number(s.fontWeight) || 400,
        fontFamily: (s.fontFamily.split(',')[0] ?? '').replace(/["']/g, '').trim(),
        color: hex(s.color),
        background: hex(s.backgroundColor),
        // A 0-width border has a colour in computed styles but no border on
        // screen. Reporting it would be a finding about something invisible.
        borderColor: borderWidth > 0 ? hex(s.borderTopColor) : '',
        borderWidth,
        padding: uniformPadding,
        gap: Math.round(gapRaw),
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

/**
 * Perceptual distance between two hex colours, 0..765.
 *
 * Weighted rather than plain Euclidean: the eye is far more sensitive to green
 * than to blue, so an unweighted distance calls two obviously different blues
 * "close" and two barely distinguishable greens "far". Getting that backwards
 * would invert the ordering the whole report relies on.
 */
export function colourDistance(a: string, b: string): number {
  const parse = (h: string): [number, number, number] | null => {
    const m = /^#([0-9a-f]{6})$/i.exec(h.trim());
    if (!m) return null;
    const v = parseInt(m[1], 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return Number.POSITIVE_INFINITY;
  const dr = x[0] - y[0];
  const dg = x[1] - y[1];
  const db = x[2] - y[2];
  return Math.round(Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db));
}

/** Nearest colour in a palette, and how far off it is. */
function nearestColour(
  value: string,
  palette: string[],
): { value: string; distance: number } | null {
  if (!value || !palette.length) return null;
  let best = palette[0];
  let dist = colourDistance(value, palette[0]);
  for (const p of palette) {
    const d = colourDistance(value, p);
    if (d < dist) {
      dist = d;
      best = p;
    }
  }
  return Number.isFinite(dist) ? { value: best, distance: dist } : null;
}

export function compareToSpec(measured: MeasuredElement[], spec: DesignSpec): DesignComparison {
  const deviations: DesignDeviation[] = [];
  let conforming = 0;
  let skipped = 0;
  let checked = 0;

  const label = (m: MeasuredElement) =>
    m.text ? `"${m.text}"` : `<${m.tag}> ${m.width}x${m.height}`;

  /**
   * One numeric check, in one place.
   *
   * Every property does exactly the same three things - exact match counts as
   * conforming, a near miss is a deviation, anything further away is silence -
   * and eleven hand-written copies of that would drift apart.
   */
  const checkNumber = (args: {
    m: MeasuredElement;
    property: string;
    group: DeviationGroup;
    actual: number;
    allowed: number[];
    window: number;
    unit?: string;
    note: string;
  }): boolean => {
    const { m, actual, allowed, window: win, unit = 'px' } = args;
    if (!allowed.length || actual <= 0) return false;
    const n = nearest(actual, allowed);
    if (!n) return false;
    if (n.distance === 0) {
      conforming++;
    } else if (n.distance <= win) {
      deviations.push({
        property: args.property,
        group: args.group,
        element: label(m),
        selector: m.selector,
        actual: `${actual}${unit}`,
        expected: `${n.value}${unit}`,
        offBy: n.distance,
        note: args.note,
      });
    } else {
      skipped++;
    }
    return true;
  };

  /** The same three-way decision for colour. */
  const checkColour = (args: {
    m: MeasuredElement;
    property: string;
    actual: string;
    palette: string[];
    note: string;
  }): boolean => {
    const { m, actual, palette } = args;
    if (!actual || !palette.length) return false;
    const n = nearestColour(actual, palette);
    if (!n) return false;
    if (n.distance === 0) {
      conforming++;
    } else if (n.distance <= NEAR_MISS_COLOUR) {
      deviations.push({
        property: args.property,
        group: DesignIssueGroup.COLOUR,
        element: label(m),
        selector: m.selector,
        actual,
        expected: n.value,
        offBy: n.distance,
        note: args.note,
      });
    } else {
      skipped++;
    }
    return true;
  };

  for (const m of measured) {
    let elementChecked = false;
    const did = (b: boolean) => {
      elementChecked = elementChecked || b;
    };

    // ------------------------------------------------------------------ SIZE
    if (m.kind === 'button') {
      did(
        checkNumber({
          m,
          property: 'button height',
          group: DesignIssueGroup.SIZE,
          actual: m.height,
          allowed: spec.buttonHeights,
          window: NEAR_MISS_PX,
          note:
            `The design defines button heights of ${spec.buttonHeights.join(', ')}px. ` +
            'This one is off the nearest.',
        }),
      );
    }

    if (m.kind === 'control') {
      // Falls back to the button scale when the design named no inputs: most
      // systems share one control height, and having SOME rule is better than
      // leaving every text field unchecked.
      const allowed = spec.controlHeights.length ? spec.controlHeights : spec.buttonHeights;
      did(
        checkNumber({
          m,
          property: 'control height',
          group: DesignIssueGroup.SIZE,
          actual: m.height,
          allowed,
          window: NEAR_MISS_PX,
          note:
            `The design's input and control heights are ${allowed.join(', ')}px` +
            (spec.controlHeights.length ? '.' : ' (taken from its buttons - it names no inputs).'),
        }),
      );
    }

    if (m.kind !== 'text' && m.kind !== 'container') {
      did(
        checkNumber({
          m,
          property: 'corner radius',
          group: DesignIssueGroup.SIZE,
          actual: m.radius,
          allowed: spec.cornerRadii,
          window: NEAR_MISS_PX,
          note: `The design uses radii of ${spec.cornerRadii.join(', ')}px.`,
        }),
      );
    }

    // ------------------------------------------------------------------ ICON
    if (m.kind === 'icon') {
      did(
        checkNumber({
          m,
          property: 'icon size',
          group: DesignIssueGroup.ICON,
          actual: m.width,
          allowed: spec.iconSizes,
          window: NEAR_MISS_ICON_PX,
          note:
            `The design draws icons at ${spec.iconSizes.join(', ')}px. ` +
            'An off-scale icon is the most visible kind of drift, because it sits ' +
            'next to a correctly sized one.',
        }),
      );
    }

    // --------------------------------------------------------------- SPACING
    if (m.padding > 0) {
      did(
        checkNumber({
          m,
          property: 'padding',
          group: DesignIssueGroup.SPACING,
          actual: m.padding,
          allowed: spec.spacings,
          window: NEAR_MISS_SPACING_PX,
          note: `The design's spacing scale is ${spec.spacings.join(', ')}px.`,
        }),
      );
    }
    if (m.gap > 0) {
      did(
        checkNumber({
          m,
          property: 'gap',
          group: DesignIssueGroup.SPACING,
          actual: m.gap,
          allowed: spec.spacings,
          window: NEAR_MISS_SPACING_PX,
          note: `The design's spacing scale is ${spec.spacings.join(', ')}px.`,
        }),
      );
    }

    // ------------------------------------------------------------ TYPOGRAPHY
    if (m.text) {
      did(
        checkNumber({
          m,
          property: 'font size',
          group: DesignIssueGroup.TYPOGRAPHY,
          actual: m.fontSize,
          allowed: spec.fontSizes,
          window: NEAR_MISS_FONT_PX,
          note: `The design's type scale is ${spec.fontSizes.join(', ')}px.`,
        }),
      );

      did(
        checkNumber({
          m,
          property: 'font weight',
          group: DesignIssueGroup.TYPOGRAPHY,
          actual: m.fontWeight,
          allowed: spec.fontWeights,
          window: NEAR_MISS_WEIGHT,
          unit: '',
          note:
            `The design uses weights ${spec.fontWeights.join(', ')}. ` +
            'One step out usually means a hardcoded weight instead of the token.',
        }),
      );

      // Font family is only checked when the design is unambiguous about it. A
      // design using four families says nothing useful about what the page
      // should use.
      if (spec.fontFamilies.length === 1 && m.fontFamily) {
        elementChecked = true;
        const want = spec.fontFamilies[0];
        if (sameTypeface(m.fontFamily, want)) {
          conforming++;
        } else {
          deviations.push({
            property: 'font family',
            group: DesignIssueGroup.TYPOGRAPHY,
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
    }

    // ---------------------------------------------------------------- COLOUR
    if (m.text) {
      did(
        checkColour({
          m,
          property: 'text colour',
          actual: m.color,
          palette: spec.textColors,
          note:
            `The design's text colours are ${spec.textColors.slice(0, 6).join(', ')}` +
            `${spec.textColors.length > 6 ? ', …' : ''}.`,
        }),
      );
    }

    // Background is checked on the things the design actually paints. A page
    // wrapper's off-white is layout, not a component colour.
    if (m.kind === 'button' || m.kind === 'control' || m.kind === 'icon') {
      did(
        checkColour({
          m,
          property: 'background colour',
          actual: m.background,
          palette: spec.colors,
          note:
            `The design's surface colours are ${spec.colors.slice(0, 6).join(', ')}` +
            `${spec.colors.length > 6 ? ', …' : ''}.`,
        }),
      );
    }

    if (m.borderWidth > 0) {
      did(
        checkColour({
          m,
          property: 'border colour',
          actual: m.borderColor,
          // Falls back to the surface palette: many designs draw borders with a
          // colour from the same ramp rather than declaring a stroke style.
          palette: spec.borderColors.length ? spec.borderColors : spec.colors,
          note:
            spec.borderColors.length
              ? `The design's border colours are ${spec.borderColors.slice(0, 6).join(', ')}.`
              : 'Compared against the design\'s surface palette - it declares no stroke styles.',
        }),
      );
    }

    if (elementChecked) checked++;
  }

  // Closest misses first: a 1px difference is near-certainly a real mistake,
  // a 4px one is likelier to be a component the design does not describe.
  deviations.sort((a, b) => a.offBy - b.offBy);

  const byGroup: Record<string, number> = {};
  for (const d of deviations) byGroup[d.group] = (byGroup[d.group] ?? 0) + 1;

  return { checked, deviations, conforming, skippedFarFromSpec: skipped, byGroup };
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
      .replace(/(variable|vf|var)/g, '')
      .replace(/[^a-z0-9]+/g, '')
      .trim();
  return norm(a) === norm(b);
}
