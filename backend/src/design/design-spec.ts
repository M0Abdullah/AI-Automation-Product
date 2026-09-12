import { type FigmaNode, firstSolidFill, paintToHex, walkNodes } from './figma.service';

/**
 * TURNING A FIGMA FILE INTO RULES THAT CAN BE CHECKED.
 *
 * The obvious approach - match each Figma layer to one element on the page and
 * diff their positions - does not survive contact with reality. In the Flowbite
 * kit the button layer is called
 *
 *     "Color=Brand, Size=base, State=Initial, Icon only=False"
 *
 * and the live button says "Pricing & FAQ". There is nothing to match on, and
 * an app page almost never mirrors a design frame one-for-one anyway.
 *
 * So this reads the design as a SPECIFICATION instead: the set of button
 * heights, corner radii, font sizes and brand colours the design permits. The
 * live page is then checked for conformance. That works on any page, including
 * ones with no corresponding Figma frame at all - which is the normal case in a
 * real product.
 */

export interface DesignSpec {
  fileKey: string;
  fileName: string;
  nodeId: string;
  nodeName: string;

  /** Distinct heights of button-like components, ascending. */
  buttonHeights: number[];
  /**
   * Distinct heights of INPUT-like components, ascending.
   *
   * Separate from buttonHeights on purpose: most design systems give inputs and
   * buttons the same scale, but not all do, and checking a 56px text field
   * against a 40px button height would be a confident, wrong finding.
   */
  controlHeights: number[];
  /** Distinct corner radii used across the design. */
  cornerRadii: number[];
  /** Distinct text sizes. */
  fontSizes: number[];
  /** Distinct font weights. */
  fontWeights: number[];
  /** Font families, most common first. */
  fontFamilies: string[];
  /** Fill colours as uppercase hex, most used first. */
  colors: string[];
  /**
   * Colours the design uses for TEXT, most used first.
   *
   * Kept apart from `colors` because they are different palettes doing different
   * jobs: a brand fill that would be correct on a button is wrong as body-copy
   * colour, so one merged list cannot judge either.
   */
  textColors: string[];
  /** Stroke colours — what a border on the live page should be. */
  borderColors: string[];
  /**
   * Icon box sizes, ascending. Icons are square by convention, so one number
   * covers both width and height — and unlike an arbitrary element width, an
   * icon size genuinely IS a design-system rule (16/20/24 and nothing between).
   */
  iconSizes: number[];
  /** The padding / gap scale, ascending. Usually a 4px or 8px grid. */
  spacings: number[];

  /** How much design we actually read, so a thin spec can be reported honestly. */
  sampled: {
    nodes: number;
    buttonLike: number;
    controlLike: number;
    textNodes: number;
    iconNodes: number;
  };
}

/**
 * A component counts as button-like when its name says so, or when its shape
 * says so. Name alone misses unnamed instances; shape alone would sweep in
 * every small rectangle on the canvas.
 */
const BUTTON_NAME = /(^|[^a-z])(button|btn|cta)([^a-z]|$)/i;

/** Names design systems give text fields, selects and the like. */
const CONTROL_NAME =
  /(^|[^a-z])(input|field|textbox|text-?field|textarea|select|dropdown|combobox|search-?bar)([^a-z]|$)/i;

/** Names design systems give icons. */
const ICON_NAME = /(^|[^a-z])(icon|glyph|symbol)s?([^a-z]|$)/i;

function looksLikeButton(n: FigmaNode): boolean {
  const b = n.absoluteBoundingBox;
  if (!b) return false;
  if (BUTTON_NAME.test(n.name)) {
    // Even a named button must be a plausible size - a 1200px-wide "Buttons"
    // section frame is documentation, not a control.
    return b.height >= 20 && b.height <= 80 && b.width >= 24 && b.width <= 640;
  }
  // Unnamed: an auto-layout box with padding, a radius, a fill and one text
  // child is a button in every design system worth the name.
  return (
    n.layoutMode === 'HORIZONTAL' &&
    b.height >= 24 &&
    b.height <= 72 &&
    (n.cornerRadius ?? 0) > 0 &&
    Boolean(firstSolidFill(n)) &&
    (n.children ?? []).some((c) => c.type === 'TEXT')
  );
}

/**
 * An input, a select or a search field — the controls a button's height rule
 * does not describe.
 */
function looksLikeControl(n: FigmaNode): boolean {
  const b = n.absoluteBoundingBox;
  if (!b) return false;
  if (!CONTROL_NAME.test(n.name)) return false;
  // Same plausibility guard as buttons: a 900px-tall "Inputs" documentation
  // frame is not a control.
  return b.height >= 20 && b.height <= 96 && b.width >= 40;
}

/**
 * An icon: a small SQUARE glyph.
 *
 * Squareness is the load-bearing test, not the name. Design systems ship icons
 * as VECTOR and BOOLEAN_OPERATION layers with names like "chevron-down" that no
 * pattern would catch, while "Icon Button" is a button. A 24x24 vector is an
 * icon whatever it is called; a 24x180 one is a divider.
 */
function looksLikeIcon(n: FigmaNode): boolean {
  const b = n.absoluteBoundingBox;
  if (!b) return false;
  const w = Math.round(b.width);
  const h = Math.round(b.height);
  if (w < 8 || w > 64 || h < 8 || h > 64) return false;
  // Within 1px of square, to tolerate Figma's sub-pixel bounding boxes.
  if (Math.abs(w - h) > 1) return false;

  const vectorish =
    n.type === 'VECTOR' ||
    n.type === 'BOOLEAN_OPERATION' ||
    n.type === 'STAR' ||
    n.type === 'ELLIPSE' ||
    n.type === 'LINE';
  return vectorish || ICON_NAME.test(n.name);
}

/** Counted values, sorted by how often the design uses them. */
function byFrequency(counts: Map<string | number, number>, min = 1): Array<string | number> {
  return [...counts.entries()]
    .filter(([, c]) => c >= min)
    .sort((a, b) => b[1] - a[1])
    .map(([v]) => v);
}

export function extractDesignSpec(args: {
  root: FigmaNode;
  fileKey: string;
  fileName: string;
}): DesignSpec {
  const { root, fileKey, fileName } = args;

  const heights = new Map<number, number>();
  const controlHeights = new Map<number, number>();
  const radii = new Map<number, number>();
  const sizes = new Map<number, number>();
  const weights = new Map<number, number>();
  const families = new Map<string, number>();
  const colors = new Map<string, number>();
  const textColors = new Map<string, number>();
  const borderColors = new Map<string, number>();
  const iconSizes = new Map<number, number>();
  const spacings = new Map<number, number>();

  let nodes = 0;
  let buttonLike = 0;
  let controlLike = 0;
  let textNodes = 0;
  let iconNodes = 0;

  const bump = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);

  walkNodes(root, (n) => {
    nodes++;

    if (looksLikeButton(n)) {
      buttonLike++;
      bump(heights, Math.round(n.absoluteBoundingBox!.height));
    }

    if (looksLikeControl(n)) {
      controlLike++;
      bump(controlHeights, Math.round(n.absoluteBoundingBox!.height));
    }

    if (looksLikeIcon(n)) {
      iconNodes++;
      bump(iconSizes, Math.round(n.absoluteBoundingBox!.width));
    }

    if (typeof n.cornerRadius === 'number' && n.cornerRadius > 0) {
      bump(radii, Math.round(n.cornerRadius));
    }

    // Spacing
    // Auto-layout padding and gaps ARE the design's spacing scale. A design
    // that lays out on an 8px grid will show 8/16/24/32 here, which is exactly
    // the rule a hand-written 15px gap breaks.
    for (const gap of [
      n.itemSpacing,
      n.paddingTop,
      n.paddingRight,
      n.paddingBottom,
      n.paddingLeft,
    ]) {
      if (typeof gap === 'number' && gap > 0 && gap <= 96) bump(spacings, Math.round(gap));
    }

    // Colour
    const fill = firstSolidFill(n);
    const hex = paintToHex(fill);

    if (n.type === 'TEXT') {
      // A text node's fill is its TEXT colour, not a surface colour. Pure
      // black and white are kept here - unlike for surfaces, "the body copy
      // should be #111827, not #000000" is a real and common design finding.
      if (hex) bump(textColors, hex);
    } else if (hex && hex !== '#FFFFFF' && hex !== '#000000') {
      // Pure white and pure black surfaces are page backgrounds everywhere;
      // they carry no information about whether a page follows the system.
      bump(colors, hex);
    }

    const stroke = (n.strokes ?? []).find(
      (p) => p.visible !== false && p.type === 'SOLID' && (p.opacity ?? 1) > 0.05,
    );
    const strokeHex = paintToHex(stroke);
    if (strokeHex) bump(borderColors, strokeHex);

    if (n.type === 'TEXT' && n.style) {
      textNodes++;
      if (n.style.fontSize) bump(sizes, Math.round(n.style.fontSize));
      if (n.style.fontWeight) bump(weights, n.style.fontWeight);
      if (n.style.fontFamily) bump(families, n.style.fontFamily);
    }
  });

  return {
    fileKey,
    fileName,
    nodeId: root.id,
    nodeName: root.name,

    buttonHeights: [...heights.keys()].sort((a, b) => a - b),
    controlHeights: [...controlHeights.keys()].sort((a, b) => a - b),
    // A radius or size used exactly once is more likely a one-off than a rule,
    // and treating it as a rule would make the live page look wrong for
    // following the design properly.
    cornerRadii: (byFrequency(radii, 2) as number[]).sort((a, b) => a - b),
    fontSizes: (byFrequency(sizes, 2) as number[]).sort((a, b) => a - b),
    fontWeights: (byFrequency(weights, 2) as number[]).sort((a, b) => a - b),
    fontFamilies: byFrequency(families, 2) as string[],
    colors: (byFrequency(colors, 3) as string[]).slice(0, 24),
    // Text and border palettes are shorter than the surface palette, so the
    // frequency floor is lower - a design typically has three text colours and
    // requiring three uses of each would empty the list.
    textColors: (byFrequency(textColors, 2) as string[]).slice(0, 16),
    borderColors: (byFrequency(borderColors, 2) as string[]).slice(0, 12),
    // Icons are drawn at a handful of sizes; two uses is enough to call it a
    // rule, and a single 23px one-off must not become one.
    iconSizes: (byFrequency(iconSizes, 2) as number[]).sort((a, b) => a - b),
    // Spacing needs the strictest floor of all. Auto-layout produces a lot of
    // incidental values, and treating each as permitted would make every gap
    // "correct" - the check would then never find anything.
    spacings: (byFrequency(spacings, 4) as number[]).sort((a, b) => a - b),

    sampled: { nodes, buttonLike, controlLike, textNodes, iconNodes },
  };
}

/**
 * Is the spec substantial enough to judge a page against?
 *
 * Reporting "37 violations" from a spec built out of four nodes would be
 * worthless and actively misleading, so a thin spec is refused up front.
 */
export function specIsUsable(spec: DesignSpec): { ok: boolean; reason?: string } {
  // 12, not 20: a design-system page has thousands of layers, but a single
  // hand-drawn login screen has about twenty and is a perfectly valid spec.
  // The real guard is the value check below - a spec with no buttons and no
  // type scale is useless however many layers it contains.
  if (spec.sampled.nodes < 12) {
    return {
      ok: false,
      reason:
        `Only ${spec.sampled.nodes} layers were readable in "${spec.nodeName}". ` +
        'Point at a page or frame that contains the actual components.',
    };
  }
  if (!spec.buttonHeights.length && !spec.fontSizes.length) {
    return {
      ok: false,
      reason:
        `No buttons or text styles were found in "${spec.nodeName}", so there is ` +
        'nothing to check the page against.',
    };
  }
  return { ok: true };
}
