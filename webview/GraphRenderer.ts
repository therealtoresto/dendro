import type { RowLayout } from './GraphLayout';

const GRAPH_PADDING = 6;
const MIN_GRAPH_WIDTH = 52;

const PALETTE = [
  '#15a0bf',
  '#3b82f6',
  '#a855f7',
  '#e11d8f',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#6366f1',
];

export type NodeStyle = 'commit' | 'merge' | 'head' | 'working' | 'incoming';

export interface GraphMetrics {
  rowHeight: number;
  laneWidth: number;
  nodeRadius: number;
  avatarNodes: boolean;
}

export interface NodePicture {
  initials: string;
  color: string;
  image: string | undefined;
}

export class GraphRenderer {
  static getColor(colorIndex: number): string {
    return PALETTE[colorIndex % PALETTE.length];
  }

  // Picture nodes need wider lanes than dots; both scale with the row height.
  static createMetrics(rowHeight: number, avatarNodes: boolean): GraphMetrics {
    const nodeRadius = avatarNodes ? Math.round(rowHeight * 0.34) : 4.5;
    const laneWidth = avatarNodes ? nodeRadius * 2 + 6 : 14;
    return { rowHeight, laneWidth, nodeRadius, avatarNodes };
  }

  static getGraphWidth(maxLanes: number, maxWidth: number, metrics: GraphMetrics): number {
    const natural = GRAPH_PADDING * 2 + Math.max(1, maxLanes) * metrics.laneWidth;
    return Math.max(MIN_GRAPH_WIDTH, Math.min(natural, maxWidth));
  }

  // Lines are SVG; a picture node is an HTML circle laid over them, so it can hold an image or initials.
  static renderRow(
    layout: RowLayout,
    width: number,
    nodeStyle: NodeStyle,
    metrics: GraphMetrics,
    picture?: NodePicture,
    linkFromLeft = false,
  ): string {
    const height = metrics.rowHeight;
    const middle = height / 2;
    let lines = '';

    // The branch badges sit in the column on the left; a line ties them to their commit's node.
    if (linkFromLeft) {
      const nodeLeft = GraphRenderer.getLaneX(layout.lane, metrics) - (metrics.avatarNodes ? metrics.nodeRadius : 5);
      lines += `<path d="M0 ${middle}H${nodeLeft}" stroke="${GraphRenderer.getColor(layout.color)}" stroke-width="2"/>`;
    }

    for (const segment of layout.segments) {
      const x1 = GraphRenderer.getLaneX(segment.fromLane, metrics);
      const x2 = GraphRenderer.getLaneX(segment.toLane, metrics);
      const [y1, y2] = segment.half === 'top' ? [0, middle] : [middle, height];
      const shape = x1 === x2 ? `M${x1} ${y1}V${y2}` : `M${x1} ${y1}C${x1} ${y2} ${x2} ${y1} ${x2} ${y2}`;
      const dash = segment.dashed ? ' stroke-dasharray="3 3"' : '';
      lines += `<path d="${shape}" stroke="${GraphRenderer.getColor(segment.color)}"${dash}/>`;
    }

    const x = GraphRenderer.getLaneX(layout.lane, metrics);
    const usePicture = metrics.avatarNodes && picture && nodeStyle !== 'merge' && nodeStyle !== 'working';
    const svgNode = usePicture ? '' : GraphRenderer.renderNode(x, middle, layout.color, nodeStyle, metrics);
    const strokeWidth = metrics.avatarNodes ? 2.4 : 2;
    const svg =
      `<svg class="graph-svg" width="${width}" height="${height}" fill="none" stroke-width="${strokeWidth}" ` +
      `stroke-linecap="round">${lines}${svgNode}</svg>`;

    if (!usePicture || !picture) {
      return svg;
    }
    return svg + GraphRenderer.renderPictureNode(x, middle, layout.color, nodeStyle, metrics, picture);
  }

  private static renderPictureNode(
    x: number,
    y: number,
    colorIndex: number,
    nodeStyle: NodeStyle,
    metrics: GraphMetrics,
    picture: NodePicture,
  ): string {
    const radius = metrics.nodeRadius;
    const size = radius * 2;
    const image = picture.image ? `<img src="${picture.image}" alt="">` : '';
    const style =
      `left:${x - radius}px;top:${y - radius}px;width:${size}px;height:${size}px;` +
      `font-size:${Math.max(7, Math.round(radius * 0.8))}px;--lane:${GraphRenderer.getColor(colorIndex)};` +
      `background:${picture.color}`;
    return `<span class="graph-node node-${nodeStyle}" style="${style}">${picture.initials}${image}</span>`;
  }

  private static renderNode(x: number, y: number, colorIndex: number, nodeStyle: NodeStyle, metrics: GraphMetrics): string {
    const color = GraphRenderer.getColor(colorIndex);
    const big = metrics.avatarNodes ? metrics.nodeRadius - 1 : 6;
    switch (nodeStyle) {
      // Uncommitted work: a dash-dot ring around a dot.
      case 'working':
        return (
          `<circle cx="${x}" cy="${y}" r="${big}" stroke="${color}" stroke-width="1.6" stroke-dasharray="3 1.6 0.8 1.6" class="node-hollow"/>` +
          `<circle cx="${x}" cy="${y}" r="${(big * 0.37).toFixed(1)}" fill="${color}" stroke="none"/>`
        );
      // The checked-out commit: a dot inside a ring.
      case 'head':
        return (
          `<circle cx="${x}" cy="${y}" r="6" stroke="${color}" stroke-width="1.8" class="node-hollow"/>` +
          `<circle cx="${x}" cy="${y}" r="3.2" fill="${color}" stroke="none"/>`
        );
      // Fetched, not pulled yet: an empty ring.
      case 'incoming':
        return `<circle cx="${x}" cy="${y}" r="4.5" stroke="${color}" stroke-width="2" class="node-hollow"/>`;
      case 'merge':
        return `<circle cx="${x}" cy="${y}" r="${metrics.avatarNodes ? 4 : 3.5}" fill="${color}" stroke="none"/>`;
      default:
        return `<circle cx="${x}" cy="${y}" r="4.5" fill="${color}" class="node"/>`;
    }
  }

  private static getLaneX(lane: number, metrics: GraphMetrics): number {
    return GRAPH_PADDING + lane * metrics.laneWidth + metrics.laneWidth / 2;
  }
}
