import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';

/**
 * READING A DESIGN FROM FIGMA.
 *
 * Only ever reads. The token this uses is granted `file_content:read` and
 * nothing else, and no method here issues a write - the platform must never be
 * able to modify somebody's design file.
 *
 * A public share link is NOT enough on its own: Figma's REST API rejects every
 * request without an X-Figma-Token header, even for a file anyone can view in a
 * browser. That is why a token is required rather than just a URL.
 */

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  cornerRadius?: number;
  rectangleCornerRadii?: number[];
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  itemSpacing?: number;
  layoutMode?: string;
  characters?: string;
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  style?: {
    fontFamily?: string;
    fontWeight?: number;
    fontSize?: number;
    lineHeightPx?: number;
    letterSpacing?: number;
  };
  children?: FigmaNode[];
  visible?: boolean;
}

export interface FigmaPaint {
  type?: string;
  visible?: boolean;
  opacity?: number;
  color?: { r: number; g: number; b: number; a?: number };
}

export class FigmaError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly hint: string,
  ) {
    super(message);
    this.name = 'FigmaError';
  }
}

@Injectable()
export class FigmaService {
  private readonly logger = new Logger(FigmaService.name);
  private static readonly BASE = 'https://api.figma.com/v1';

  constructor(private readonly config: AppConfigService) {}

  get enabled(): boolean {
    return this.config.figma.enabled;
  }

  /**
   * Pull one node (usually a page or a frame) with its subtree.
   *
   * `depth` is capped because a design-system page can contain tens of
   * thousands of nodes and the response is measured in megabytes. Four levels
   * is enough to reach a component's text child, which is where font data lives.
   */
  async getNode(fileKey: string, nodeId: string, depth = 4): Promise<FigmaNode> {
    const id = nodeId.replace('-', ':');
    const url = `${FigmaService.BASE}/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(id)}&depth=${depth}`;
    const body = await this.request<{
      nodes: Record<string, { document: FigmaNode } | null>;
    }>(url);

    const entry = body.nodes[id];
    if (!entry?.document) {
      throw new FigmaError(
        `Figma returned no node "${nodeId}" in file ${fileKey}.`,
        404,
        'Check the node-id in the Figma URL. Open the frame in Figma and copy the ' +
          'address bar - the node-id parameter is the part after "node-id=".',
      );
    }
    return entry.document;
  }

  /** The document's top-level pages. Used to let a user pick one. */
  async listPages(fileKey: string): Promise<Array<{ id: string; name: string }>> {
    const url = `${FigmaService.BASE}/files/${encodeURIComponent(fileKey)}?depth=1`;
    const body = await this.request<{
      name: string;
      document: { children: Array<{ id: string; name: string }> };
    }>(url);
    return (body.document.children ?? []).map((p) => ({ id: p.id, name: p.name }));
  }

  async fileName(fileKey: string): Promise<string> {
    const url = `${FigmaService.BASE}/files/${encodeURIComponent(fileKey)}?depth=1`;
    const body = await this.request<{ name: string }>(url);
    return body.name;
  }

  /**
   * Figma's errors are terse ("Invalid scope(s)"), and the fix is never obvious
   * from the status code alone, so each one is translated into something a user
   * can act on.
   */
  private async request<T>(url: string): Promise<T> {
    const { token, enabled, timeoutMs } = this.config.figma;
    if (!enabled) {
      throw new FigmaError(
        'Figma is not configured on this server.',
        400,
        'Set FIGMA_TOKEN in backend/.env with a personal access token that has the ' +
          'file_content:read scope.',
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'X-Figma-Token': token },
        signal: controller.signal,
      });
    } catch (err) {
      throw new FigmaError(
        `Could not reach the Figma API: ${err instanceof Error ? err.message : String(err)}`,
        503,
        'Check network access to api.figma.com, or raise FIGMA_TIMEOUT_MS.',
      );
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) return (await res.json()) as T;

    const text = await res.text().catch(() => '');
    throw new FigmaError(
      `Figma API returned ${res.status}: ${text.slice(0, 300)}`,
      res.status,
      this.hintFor(res.status, text),
    );
  }

  private hintFor(status: number, body: string): string {
    if (status === 403 && /scope/i.test(body)) {
      return (
        'The token is missing the file_content:read scope. In Figma: Settings > ' +
        'Security > Generate new token, and tick ONLY "file_content:read".'
      );
    }
    if (status === 403) {
      return (
        'The token cannot read this file. Confirm the file is in this Figma ' +
        'account, and that the token has file_content:read.'
      );
    }
    if (status === 404) {
      return (
        'Check the file key. In a URL like figma.com/design/ABC123/My-File, the ' + 'key is ABC123.'
      );
    }
    if (status === 429) {
      return 'Figma is rate-limiting this token. Wait a minute and try again.';
    }
    return 'See the Figma REST API docs for this status code.';
  }
}

/** Figma stores colour as 0..1 floats. Everything else in the world uses 0..255. */
export function paintToHex(paint?: FigmaPaint): string | null {
  const c = paint?.color;
  if (!c) return null;
  const to = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${to(c.r)}${to(c.g)}${to(c.b)}`.toUpperCase();
}

/** First visible solid fill, which is what a viewer actually perceives. */
export function firstSolidFill(node: FigmaNode): FigmaPaint | undefined {
  return (node.fills ?? []).find(
    (f) => f.visible !== false && f.type === 'SOLID' && (f.opacity ?? 1) > 0.05,
  );
}

/** Depth-first walk, skipping hidden layers - they are not part of the design. */
export function walkNodes(root: FigmaNode, visit: (n: FigmaNode, depth: number) => void): void {
  const stack: Array<{ n: FigmaNode; d: number }> = [{ n: root, d: 0 }];
  let guard = 0;
  while (stack.length && guard++ < 50_000) {
    const { n, d } = stack.pop()!;
    if (n.visible === false) continue;
    visit(n, d);
    for (const c of n.children ?? []) stack.push({ n: c, d: d + 1 });
  }
}
