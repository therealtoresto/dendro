import { MARKER_COLORS, RowMarker } from './Markers';

export interface MinimapModel {
  rowDates: (number | null)[];
  markers: RowMarker[];
  firstVisible: number;
  lastVisible: number;
  formatDay(unixSeconds: number): string;
}

interface Bucket {
  start: number;
  count: number;
  firstIndex: number;
  markerKinds: Set<RowMarker['kind']>;
}

const HEIGHT = 40;
const MARKER_HEIGHT = 3;
const MIN_BUCKET_WIDTH = 3;
const DAY = 86400;
const MIN_DAYS = 30;

// Commit activity per day across the loaded history, newest on the right, with the rows on screen shaded.
// Clicking a day scrolls to its newest commit.
export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private model: MinimapModel | null = null;
  private buckets: Bucket[] = [];
  private bucketWidth = 0;

  constructor(
    private readonly element: HTMLElement,
    private readonly onPick: (rowIndex: number) => void,
  ) {
    element.innerHTML = '<canvas></canvas>';
    this.canvas = element.querySelector('canvas')!;
    this.canvas.addEventListener('click', (event) => this.pick(event));
    this.canvas.addEventListener('mousemove', (event) => this.describe(event));
    new ResizeObserver(() => this.draw()).observe(element);
  }

  update(model: MinimapModel | null): void {
    this.model = model;
    this.element.hidden = model === null;
    this.draw();
  }

  private draw(): void {
    const model = this.model;
    const width = this.element.clientWidth;
    if (!model || width === 0) {
      return;
    }

    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = width * ratio;
    this.canvas.height = HEIGHT * ratio;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${HEIGHT}px`;
    const context = this.canvas.getContext('2d')!;
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, HEIGHT);

    this.buckets = Minimap.buildBuckets(model, Math.max(1, Math.floor(width / MIN_BUCKET_WIDTH)));
    if (this.buckets.length === 0) {
      return;
    }
    this.bucketWidth = width / this.buckets.length;

    const styles = getComputedStyle(document.documentElement);
    const barColor = styles.getPropertyValue('--vscode-charts-blue').trim() || '#3b82f6';
    const shadeColor = styles.getPropertyValue('--vscode-editor-selectionBackground').trim() || 'rgba(128,128,128,0.25)';
    const maxCount = Math.max(...this.buckets.map((bucket) => bucket.count));
    const barSpace = HEIGHT - MARKER_HEIGHT - 4;

    this.shadeVisibleRange(context, model, shadeColor);

    context.globalAlpha = 0.75;
    context.fillStyle = barColor;
    this.buckets.forEach((bucket, index) => {
      if (bucket.count === 0) {
        return;
      }
      const height = Math.max(2, Math.sqrt(bucket.count / maxCount) * barSpace);
      context.fillRect(index * this.bucketWidth, barSpace - height + 1, Math.max(1, this.bucketWidth - 1), height);
    });
    context.globalAlpha = 1;

    this.buckets.forEach((bucket, index) => {
      let offset = 0;
      for (const kind of bucket.markerKinds) {
        context.fillStyle = MARKER_COLORS[kind];
        context.fillRect(index * this.bucketWidth, HEIGHT - MARKER_HEIGHT - offset, Math.max(2, this.bucketWidth - 1), MARKER_HEIGHT);
        offset += MARKER_HEIGHT;
        if (offset > 2 * MARKER_HEIGHT) {
          break;
        }
      }
    });
  }

  private shadeVisibleRange(context: CanvasRenderingContext2D, model: MinimapModel, color: string): void {
    const visibleBuckets = new Set<number>();
    for (let index = model.firstVisible; index <= model.lastVisible; index++) {
      const bucket = this.findBucketOfRow(index);
      if (bucket >= 0) {
        visibleBuckets.add(bucket);
      }
    }
    if (visibleBuckets.size === 0) {
      return;
    }
    const first = Math.min(...visibleBuckets);
    const last = Math.max(...visibleBuckets);
    context.fillStyle = color;
    context.fillRect(first * this.bucketWidth, 0, (last - first + 1) * this.bucketWidth, HEIGHT);
  }

  private findBucketOfRow(rowIndex: number): number {
    const date = this.model?.rowDates[rowIndex];
    if (date === null || date === undefined) {
      return -1;
    }
    return this.buckets.findIndex(
      (bucket, index) => date >= bucket.start && (index === this.buckets.length - 1 || date < this.buckets[index + 1].start),
    );
  }

  private static buildBuckets(model: MinimapModel, maxBuckets: number): Bucket[] {
    const dates = model.rowDates.filter((date): date is number => date !== null);
    if (dates.length === 0) {
      return [];
    }

    // A short history still gets a month-wide axis, so a day of work is one bar on the right, not the whole strip.
    const lastDay = Math.floor(Math.max(...dates) / DAY) * DAY;
    const firstDay = Math.min(Math.floor(Math.min(...dates) / DAY) * DAY, lastDay - (MIN_DAYS - 1) * DAY);
    const dayCount = (lastDay - firstDay) / DAY + 1;
    const bucketCount = Math.min(dayCount, maxBuckets);
    const daysPerBucket = dayCount / bucketCount;

    const buckets: Bucket[] = [];
    for (let index = 0; index < bucketCount; index++) {
      buckets.push({
        start: firstDay + Math.floor(index * daysPerBucket) * DAY,
        count: 0,
        firstIndex: -1,
        markerKinds: new Set(),
      });
    }

    const bucketOf = (date: number) =>
      Math.min(bucketCount - 1, Math.floor((Math.floor(date / DAY) * DAY - firstDay) / DAY / daysPerBucket));

    model.rowDates.forEach((date, rowIndex) => {
      if (date === null) {
        return;
      }
      const bucket = buckets[bucketOf(date)];
      bucket.count++;
      if (bucket.firstIndex < 0) {
        bucket.firstIndex = rowIndex;
      }
    });

    for (const marker of model.markers) {
      const date = model.rowDates[marker.index] ?? Math.max(...dates);
      buckets[bucketOf(date)].markerKinds.add(marker.kind);
    }

    return buckets;
  }

  private getBucketAt(event: MouseEvent): Bucket | undefined {
    const x = event.clientX - this.canvas.getBoundingClientRect().left;
    return this.buckets[Math.floor(x / this.bucketWidth)];
  }

  private pick(event: MouseEvent): void {
    const bucket = this.getBucketAt(event);
    if (bucket && bucket.firstIndex >= 0) {
      this.onPick(bucket.firstIndex);
    }
  }

  private describe(event: MouseEvent): void {
    const bucket = this.getBucketAt(event);
    if (!bucket || !this.model) {
      this.canvas.title = '';
      return;
    }
    const commits = `${bucket.count} ${bucket.count === 1 ? 'commit' : 'commits'}`;
    this.canvas.title = `${this.model.formatDay(bucket.start)} · ${commits}`;
  }
}
