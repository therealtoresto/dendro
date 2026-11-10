import type { RowLayout } from './GraphLayout';

export const ROW_HEIGHT = 26;
const LANE_WIDTH = 14;
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

export type NodeStyle = 'commit' | 'merge' | 'head' | 'working';

export class GraphRenderer {
  static getColor(colorIndex: number): string {
    return PALETTE[colorIndex % PALETTE.length];
  }

  static getGraphWidth(maxLanes: number, maxWidth: number): number {
    const natural = GRAPH_PADDING * 2 + Math.max(1, maxLanes) * LANE_WIDTH;
    return Math.max(MIN_GRAPH_WIDTH, Math.min(natural, maxWidth));
  }

  static renderRow(layout: RowLayout, width: number, nodeStyle: NodeStyle): string {
    const middle = ROW_HEIGHT / 2;
    let lines = '';

    for (const segment of layout.segments) {
      const x1 = GraphRenderer.getLaneX(segment.fromLane);
      const x2 = GraphRenderer.getLaneX(segment.toLane);
      const [y1, y2] = segment.half === 'top' ? [0, middle] : [middle, ROW_HEIGHT];
      const shape = x1 === x2 ? `M${x1} ${y1}V${y2}` : `M${x1} ${y1}C${x1} ${y2} ${x2} ${y1} ${x2} ${y2}`;
      const dash = segment.dashed ? ' stroke-dasharray="3 3"' : '';
      lines += `<path d="${shape}" stroke="${GraphRenderer.getColor(segment.color)}"${dash}/>`;
    }

    const node = GraphRenderer.renderNode(GraphRenderer.getLaneX(layout.lane), middle, layout.color, nodeStyle);
    return (
      `<svg class="graph-svg" width="${width}" height="${ROW_HEIGHT}" fill="none" stroke-width="2">` +
      `${lines}${node}</svg>`
    );
  }

  private static renderNode(x: number, y: number, colorIndex: number, nodeStyle: NodeStyle): string {
    const color = GraphRenderer.getColor(colorIndex);
    switch (nodeStyle) {
      case 'working':
        return `<circle cx="${x}" cy="${y}" r="4.5" stroke="${color}" stroke-dasharray="2 2" class="node-hollow"/>`;
      case 'head':
        return `<circle cx="${x}" cy="${y}" r="5" stroke="${color}" stroke-width="2.5" class="node-hollow"/>`;
      case 'merge':
        return `<circle cx="${x}" cy="${y}" r="3.5" fill="${color}" stroke="none"/>`;
      default:
        return `<circle cx="${x}" cy="${y}" r="4.5" fill="${color}" class="node"/>`;
    }
  }

  private static getLaneX(lane: number): number {
    return GRAPH_PADDING + lane * LANE_WIDTH + LANE_WIDTH / 2;
  }
}
