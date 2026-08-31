import { FigmaNode, firstSolidFill, paintToHex, walkNodes } from './figma.service';

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

  /** How much design we actually read, so a thin spec can be reported honestly. */
  sampled: {
    nodes: number;
    buttonLike: number;
    textNodes: number;
  };
}

/**
 * A component counts as button-like when its name says so, or when its shape
 * says so. Name alone misses unnamed instances; shape alone would sweep in
 * every small rectangle on the canvas.
 */
const BUTTON_NAME = /(^|[^a-z])(button|btn|cta)([^a-z]|$)/i;

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
  const radii = new Map<number, number>();
  const sizes = new Map<number, number>();
  const weights = new Map<number, number>();
  const families = new Map<string, number>();
  const colors = new Map<string, number>();

  let nodes = 0;
  let buttonLike = 0;
  let textNodes = 0;

  const bump = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);

  walkNodes(root, (n) => {
    nodes++;

    if (looksLikeButton(n)) {
      buttonLike++;
      bump(heights, Math.round(n.absoluteBoundingBox!.height));
    }

    if (typeof n.cornerRadius === 'number' && n.cornerRadius > 0) {
      bump(radii, Math.round(n.cornerRadius));
    }

    const fill = firstSolidFill(n);
    const hex = paintToHex(fill);
    // Pure white and pure black are backgrounds and body text everywhere; they
    // carry no information about whether a page follows the design system.
    if (hex && hex !== '#FFFFFF' && hex !== '#000000') bump(colors, hex);

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
    // A radius or size used exactly once is more likely a one-off than a rule,
    // and treating it as a rule would make the live page look wrong for
    // following the design properly.
    cornerRadii: (byFrequency(radii, 2) as number[]).sort((a, b) => a - b),
    fontSizes: (byFrequency(sizes, 2) as number[]).sort((a, b) => a - b),
    fontWeights: (byFrequency(weights, 2) as number[]).sort((a, b) => a - b),
    fontFamilies: byFrequency(families, 2) as string[],
    colors: (byFrequency(colors, 3) as string[]).slice(0, 24),

    sampled: { nodes, buttonLike, textNodes },
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
