import { MARKER_COLORS, RowMarker } from './Markers';

const TRACK_WIDTH = 8;

// Ticks drawn over the list's scrollbar at the height of the rows they mark; clicks pass through to the scrollbar.
export class ScrollMarkers {
  private readonly canvas: HTMLCanvasElement;
  private markers: RowMarker[] = [];
  private rowCount = 0;

  constructor(private readonly track: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'scroll-markers';
    track.appendChild(this.canvas);
    new ResizeObserver(() => this.draw()).observe(track);
  }

  update(markers: RowMarker[] | null, rowCount: number): void {
    this.canvas.hidden = markers === null;
    this.markers = markers ?? [];
    this.rowCount = rowCount;
    this.draw();
  }

  private draw(): void {
    const height = this.track.clientHeight;
    if (this.canvas.hidden || height === 0) {
      return;
    }

    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = TRACK_WIDTH * ratio;
    this.canvas.height = height * ratio;
    this.canvas.style.height = `${height}px`;
    const context = this.canvas.getContext('2d')!;
    context.scale(ratio, ratio);
    context.clearRect(0, 0, TRACK_WIDTH, height);

    if (this.rowCount === 0) {
      return;
    }
    for (const marker of this.markers) {
      const y = ((marker.index + 0.5) / this.rowCount) * height;
      context.fillStyle = MARKER_COLORS[marker.kind];
      const thick = marker.kind === 'selection' || marker.kind === 'head';
      context.fillRect(thick ? 0 : 2, Math.round(y - 1), thick ? TRACK_WIDTH : TRACK_WIDTH - 4, thick ? 3 : 2);
    }
  }
}
