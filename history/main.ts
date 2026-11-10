import type { ChartCommit, FileHistoryData, HistoryHostMessage, HistoryWebviewMessage } from '../src/historyProtocol';
import { AvatarStyle } from '../src/shared/AvatarStyle';
import { DateFormatter } from '../src/shared/DateFormatter';
import { TimeAxis } from './TimeAxis';

interface VsCodeApi {
  postMessage(message: HistoryWebviewMessage): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

type RangeId = 'all' | 'year' | 'quarter' | 'month';
type ViewId = 'chart' | 'table';

interface Lane {
  key: string;
  name: string;
  email: string | null;
  commits: number;
}

interface PlotLayout {
  width: number;
  left: number;
  right: number;
  lanesTop: number;
  laneHeight: number;
  changesTop: number;
  changesHeight: number;
  axisTop: number;
  height: number;
  start: number;
  end: number;
}

const DAY = 86400;
const RANGES: { id: RangeId; label: string; days: number | null }[] = [
  { id: 'all', label: 'All', days: null },
  { id: 'year', label: '1 year', days: 365 },
  { id: 'quarter', label: '90 days', days: 90 },
  { id: 'month', label: '30 days', days: 30 },
];
const MAX_LANES = 8;
const LABEL_WIDTH = 190;
const HIT_DISTANCE = 24;
const OTHERS_KEY = '__others__';
const LABELED_OUTLIERS = 3;
const OUTLIER_LABEL_GAP = 44;
const MIN_COMMITS_FOR_CAP = 12;

const svgEscape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A file's history as a picture: one lane per author with a dot per commit (its size is the lines changed), and
// below it the lines each commit added (up) and deleted (down) on the same time axis. Every value is also in the
// table view; the tooltip only adds a closer look.
class HistoryApp {
  private readonly api = acquireVsCodeApi();
  private data: FileHistoryData | null = null;
  private readonly avatars = new Map<string, string>();
  private dates = new DateFormatter({ relative: true, locale: '', format: '', shortFormat: '', timeFormat: '' }, 'en-US');
  private range: RangeId = 'all';
  private view: ViewId = 'chart';
  private commits: ChartCommit[] = [];
  private layout: PlotLayout | null = null;
  private hovered: number | null = null;

  private readonly header: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly chart: HTMLElement;
  private readonly table: HTMLElement;
  private readonly tooltip: HTMLElement;

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <header class="fh-header"></header>
      <div class="fh-controls"></div>
      <section class="fh-chart glass" tabindex="0" aria-label="File history chart"></section>
      <section class="fh-table glass" hidden></section>
      <div class="fh-tooltip glass-strong" hidden></div>`;
    this.header = root.querySelector('.fh-header')!;
    this.controls = root.querySelector('.fh-controls')!;
    this.chart = root.querySelector('.fh-chart')!;
    this.table = root.querySelector('.fh-table')!;
    this.tooltip = root.querySelector('.fh-tooltip')!;

    this.controls.addEventListener('click', (event) => this.onControlClick(event.target as HTMLElement));
    this.chart.addEventListener('pointermove', (event) => this.onPointerMove(event));
    this.chart.addEventListener('pointerleave', () => this.setHovered(null));
    this.chart.addEventListener('click', () => this.openHovered());
    this.chart.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.table.addEventListener('click', (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>('tr[data-index]');
      if (row) {
        this.openCommit(this.commits[Number(row.dataset.index)]);
      }
    });
    new ResizeObserver(() => this.renderView()).observe(this.chart);
    window.addEventListener('message', (event: MessageEvent<HistoryHostMessage>) => this.onHostMessage(event.data));

    this.api.postMessage({ type: 'ready' });
  }

  private onHostMessage(message: HistoryHostMessage): void {
    if (message.type === 'loading') {
      this.header.innerHTML = `<div class="fh-title"><span class="fh-name"></span></div><div class="fh-summary">Reading the history…</div>`;
      this.header.querySelector('.fh-name')!.textContent = message.fileName;
      this.chart.classList.add('fh-loading');
      return;
    }
    if (message.type === 'avatars') {
      for (const [email, dataUri] of Object.entries(message.avatars)) {
        this.avatars.set(email, dataUri);
      }
      this.renderView();
      return;
    }

    this.data = message.data;
    this.dates = new DateFormatter(message.data.dates, message.data.locale);
    for (const [email, dataUri] of Object.entries(message.data.avatars)) {
      this.avatars.set(email, dataUri);
    }
    this.chart.classList.remove('fh-loading');
    this.render();
  }

  private render(): void {
    const data = this.data;
    if (!data) {
      return;
    }

    const days = RANGES.find((range) => range.id === this.range)!.days;
    const since = days === null ? -Infinity : Date.now() / 1000 - days * DAY;
    this.commits = data.commits.filter((commit) => commit.date >= since).sort((left, right) => left.date - right.date);
    this.hovered = null;

    this.renderHeader(data);
    this.renderControls();
    this.renderView();
  }

  private renderHeader(data: FileHistoryData): void {
    const authors = new Set(this.commits.map((commit) => commit.email)).size;
    const first = this.commits[0];
    let summary = `${this.commits.length} ${this.commits.length === 1 ? 'commit' : 'commits'} by ${authors} ${authors === 1 ? 'author' : 'authors'}`;
    if (first) {
      summary += ` · since ${this.dates.formatShortDate(first.date)}`;
    }
    if (data.truncated && this.range === 'all') {
      summary += ` · the latest ${data.commits.length} shown`;
    }

    this.header.innerHTML = '<div class="fh-title"><span class="fh-name"></span><span class="fh-path"></span></div><div class="fh-summary"></div>';
    this.header.querySelector('.fh-name')!.textContent = data.fileName;
    this.header.querySelector('.fh-path')!.textContent = data.filePath;
    this.header.querySelector('.fh-summary')!.textContent = summary;
  }

  private renderControls(): void {
    const ranges = RANGES.map(
      (range) => `<button data-range="${range.id}" class="${range.id === this.range ? 'active' : ''}">${range.label}</button>`,
    ).join('');
    const views = (['chart', 'table'] as ViewId[])
      .map((view) => `<button data-view="${view}" class="${view === this.view ? 'active' : ''}">${view === 'chart' ? 'Chart' : 'Table'}</button>`)
      .join('');
    this.controls.innerHTML = `<div class="fh-segmented">${ranges}</div><div class="fh-segmented">${views}</div>`;
  }

  private onControlClick(target: HTMLElement): void {
    const button = target.closest<HTMLButtonElement>('button');
    if (button?.dataset.range) {
      this.range = button.dataset.range as RangeId;
      this.render();
    } else if (button?.dataset.view) {
      this.view = button.dataset.view as ViewId;
      this.renderControls();
      this.renderView();
    }
  }

  private renderView(): void {
    if (!this.data) {
      return;
    }
    this.chart.hidden = this.view !== 'chart';
    this.table.hidden = this.view !== 'table';
    this.tooltip.hidden = true;
    if (this.view === 'chart') {
      this.renderChart();
    } else {
      this.renderTable();
    }
  }

  private buildLanes(): Lane[] {
    const byEmail = new Map<string, Lane>();
    for (const commit of this.commits) {
      const lane = byEmail.get(commit.email) ?? { key: commit.email, name: commit.author, email: commit.email, commits: 0 };
      lane.commits++;
      byEmail.set(commit.email, lane);
    }
    const lanes = Array.from(byEmail.values()).sort((left, right) => right.commits - left.commits);
    if (lanes.length <= MAX_LANES) {
      return lanes;
    }
    const others = lanes.slice(MAX_LANES - 1);
    const commits = others.reduce((sum, lane) => sum + lane.commits, 0);
    return [...lanes.slice(0, MAX_LANES - 1), { key: OTHERS_KEY, name: `${others.length} others`, email: null, commits }];
  }

  private renderChart(): void {
    if (this.commits.length === 0) {
      this.chart.innerHTML = '<div class="fh-empty">No commits changed this file in this period.</div>';
      return;
    }

    const lanes = this.buildLanes();
    const laneOf = new Map(lanes.map((lane, index) => [lane.key, index]));
    const width = Math.max(420, this.chart.clientWidth);
    const laneHeight = 32;
    const lanesTop = 8;
    const changesTop = lanesTop + lanes.length * laneHeight + 52;
    const changesHeight = 150;
    const axisTop = changesTop + changesHeight + 6;
    const first = this.commits[0].date;
    const last = this.commits[this.commits.length - 1].date;
    const padding = Math.max(DAY / 2, (last - first) * 0.03);

    const layout: PlotLayout = {
      width,
      left: LABEL_WIDTH,
      right: width - 20,
      lanesTop,
      laneHeight,
      changesTop,
      changesHeight,
      axisTop,
      height: axisTop + 26,
      start: first - padding,
      end: last + padding,
    };
    this.layout = layout;

    const x = (time: number) => layout.left + ((time - layout.start) / (layout.end - layout.start)) * (layout.right - layout.left);
    // One huge commit would flatten every other bar, so the scale stops near the 95th percentile and taller bars
    // are cut, with their size written on the biggest of them (the tooltip and the table always have it).
    const capAdded = HistoryApp.findScaleCap(this.commits.map((commit) => commit.additions), 1);
    const capDeleted = HistoryApp.findScaleCap(this.commits.map((commit) => commit.deletions), 0);
    const maxAdded = capAdded;
    const maxDeleted = capDeleted;
    const scale = changesHeight / (maxAdded + maxDeleted);
    // The biggest cut bars get their size written on them, unless a bigger labeled one stands too close.
    const outliers = new Set<ChartCommit>();
    const labeledX: number[] = [];
    const cutCommits = this.commits
      .filter((commit) => commit.additions > capAdded || commit.deletions > capDeleted)
      .sort((left, right) => right.additions + right.deletions - (left.additions + left.deletions));
    for (const commit of cutCommits) {
      const commitX = x(commit.date);
      if (outliers.size < LABELED_OUTLIERS && labeledX.every((other) => Math.abs(other - commitX) >= OUTLIER_LABEL_GAP)) {
        outliers.add(commit);
        labeledX.push(commitX);
      }
    }
    const baseline = changesTop + maxAdded * scale;
    const barWidth = Math.max(2, Math.min(8, ((layout.right - layout.left) / this.commits.length) * 0.6));

    let svg = '';

    // Ticks and recessive hairlines first, so marks paint over them.
    const ticks = TimeAxis.buildTicks(layout.start, layout.end, Math.max(2, Math.floor((layout.right - layout.left) / 90)), this.dates.locale);
    for (const tick of ticks) {
      const tickX = x(tick.time);
      svg += `<line class="fh-grid" x1="${tickX}" x2="${tickX}" y1="${lanesTop}" y2="${axisTop}"/>`;
      svg += `<text class="fh-axis-label" x="${tickX}" y="${axisTop + 16}" text-anchor="middle">${svgEscape(tick.label)}</text>`;
    }
    lanes.forEach((_, index) => {
      const y = lanesTop + (index + 1) * laneHeight;
      svg += `<line class="fh-lane-rule" x1="${layout.left}" x2="${layout.right}" y1="${y}" y2="${y}"/>`;
    });

    svg += `<text class="fh-section-label" x="${layout.left}" y="${changesTop - 26}">Lines changed</text>`;
    svg += `<line class="fh-baseline" x1="${layout.left}" x2="${layout.right}" y1="${baseline}" y2="${baseline}"/>`;
    svg += `<text class="fh-axis-label" x="${layout.left - 8}" y="${changesTop + 4}" text-anchor="end">+${maxAdded.toLocaleString()}</text>`;
    svg += `<text class="fh-axis-label" x="${layout.left - 8}" y="${baseline + 4}" text-anchor="end">0</text>`;
    if (maxDeleted > 0) {
      svg += `<text class="fh-axis-label" x="${layout.left - 8}" y="${changesTop + changesHeight}" text-anchor="end">−${maxDeleted.toLocaleString()}</text>`;
    }

    this.commits.forEach((commit, index) => {
      const commitX = x(commit.date);
      const added = Math.min(commit.additions, capAdded) * scale;
      const deleted = Math.min(commit.deletions, capDeleted) * scale;
      if (added > 0) {
        const end = baseline - Math.max(1, added);
        svg += `<path class="fh-bar fh-added" data-i="${index}" d="${HistoryApp.buildBarPath(commitX, barWidth, baseline, end)}"/>`;
        if (commit.additions > capAdded) {
          svg += HistoryApp.renderCut(commitX, barWidth, end + 6, outliers.has(commit) ? `+${commit.additions.toLocaleString()}` : null, end - 4);
        }
      }
      if (deleted > 0) {
        const end = baseline + Math.max(1, deleted);
        svg += `<path class="fh-bar fh-deleted" data-i="${index}" d="${HistoryApp.buildBarPath(commitX, barWidth, baseline, end)}"/>`;
        if (commit.deletions > capDeleted) {
          svg += HistoryApp.renderCut(commitX, barWidth, end - 6, outliers.has(commit) ? `−${commit.deletions.toLocaleString()}` : null, end + 13);
        }
      }
    });

    this.commits.forEach((commit, index) => {
      const lane = laneOf.get(commit.email) ?? laneOf.get(OTHERS_KEY)!;
      const cy = lanesTop + lane * laneHeight + laneHeight / 2;
      const radius = 4 + Math.min(9, Math.sqrt(commit.additions + commit.deletions) * 0.6);
      svg += `<circle class="fh-dot" data-i="${index}" cx="${x(commit.date)}" cy="${cy}" r="${radius.toFixed(1)}"/>`;
    });

    svg += `<line class="fh-crosshair" x1="0" x2="0" y1="${lanesTop}" y2="${axisTop}" visibility="hidden"/>`;

    const labels = lanes
      .map((lane, index) => {
        const top = lanesTop + index * laneHeight;
        const picture = lane.email ? this.avatars.get(lane.email) : undefined;
        const art = lane.email ? AvatarStyle.renderArt(lane.email) : '…';
        const background = lane.email ? AvatarStyle.getColor(lane.email) : 'var(--fh-muted)';
        return (
          `<div class="fh-lane-label" style="top:${top}px;height:${laneHeight}px">` +
          `<span class="fh-avatar" style="background:${background}">${art}${picture ? `<img src="${picture}" alt="">` : ''}</span>` +
          `<span class="fh-lane-name" data-lane="${index}"></span><span class="fh-lane-count">${lane.commits}</span></div>`
        );
      })
      .join('');

    const hasCuts = this.commits.some((commit) => commit.additions > capAdded || commit.deletions > capDeleted);
    const legend =
      '<div class="fh-legend"><span><i class="fh-key fh-key-dot"></i>A commit; the bigger the dot, the more lines it changed</span>' +
      '<span><i class="fh-key fh-key-added"></i>Lines added</span><span><i class="fh-key fh-key-deleted"></i>Lines deleted</span>' +
      (hasCuts ? '<span><i class="fh-key fh-key-cut"></i>Cut bar: taller than the scale, its size is on it or in the tooltip</span>' : '') +
      '</div>';

    this.chart.innerHTML =
      `<div class="fh-plot" style="height:${layout.height}px">${labels}` +
      `<svg width="${width}" height="${layout.height}" role="img" aria-label="Commits by author over time">${svg}</svg></div>${legend}`;

    // Names come from git: text, never markup.
    this.chart.querySelectorAll<HTMLElement>('.fh-lane-name').forEach((element) => {
      const lane = lanes[Number(element.dataset.lane)];
      const isYou = lane.email !== null && lane.email === this.data?.userEmail;
      element.textContent = isYou ? `${lane.name} (you)` : lane.name;
      element.title = lane.email ?? '';
    });
  }

  private static findScaleCap(values: number[], floor: number): number {
    const max = Math.max(floor, ...values);
    if (values.length < MIN_COMMITS_FOR_CAP) {
      return max;
    }
    const sorted = [...values].sort((left, right) => left - right);
    const p95 = sorted[Math.floor(0.95 * (sorted.length - 1))];
    return Math.min(max, Math.max(floor, Math.ceil(p95 * 1.25), 10));
  }

  // A cut bar: a gap in the surface color across it, and its real size next to its end when it is labeled.
  private static renderCut(centerX: number, width: number, gapY: number, label: string | null, labelY: number): string {
    const half = width / 2 + 1;
    let html = `<path class="fh-cut" d="M${centerX - half} ${gapY + 2}L${centerX + half} ${gapY - 2}"/>`;
    if (label) {
      html += `<text class="fh-outlier-label" x="${centerX}" y="${labelY}" text-anchor="middle">${label}</text>`;
    }
    return html;
  }

  // A bar from the baseline to its value, rounded only at the value end.
  private static buildBarPath(centerX: number, width: number, baseline: number, end: number): string {
    const left = centerX - width / 2;
    const right = centerX + width / 2;
    const radius = Math.min(4, width / 2, Math.abs(end - baseline));
    const direction = end < baseline ? 1 : -1;
    return (
      `M${left} ${baseline}V${end + direction * radius}` +
      `Q${left} ${end} ${left + radius} ${end}H${right - radius}` +
      `Q${right} ${end} ${right} ${end + direction * radius}V${baseline}Z`
    );
  }

  private onPointerMove(event: PointerEvent): void {
    const layout = this.layout;
    const svg = this.chart.querySelector('svg');
    if (!layout || !svg || this.commits.length === 0) {
      return;
    }
    const box = svg.getBoundingClientRect();
    const pointerX = event.clientX - box.left;
    const timeAt = (x: number) => layout.start + ((x - layout.left) / (layout.right - layout.left)) * (layout.end - layout.start);
    const xOf = (time: number) => layout.left + ((time - layout.start) / (layout.end - layout.start)) * (layout.right - layout.left);

    if (pointerX < layout.left - HIT_DISTANCE || pointerX > layout.right + HIT_DISTANCE) {
      this.setHovered(null);
      return;
    }

    const time = timeAt(pointerX);
    let nearest = 0;
    for (let index = 1; index < this.commits.length; index++) {
      if (Math.abs(this.commits[index].date - time) < Math.abs(this.commits[nearest].date - time)) {
        nearest = index;
      }
    }
    if (Math.abs(xOf(this.commits[nearest].date) - pointerX) > HIT_DISTANCE) {
      this.setHovered(null);
      return;
    }
    this.setHovered(nearest, event.clientX, event.clientY);
  }

  private setHovered(index: number | null, pointerX = 0, pointerY = 0): void {
    const svg = this.chart.querySelector('svg');
    const layout = this.layout;
    if (!svg || !layout) {
      return;
    }
    this.hovered = index;
    svg.classList.toggle('fh-has-hover', index !== null);
    svg.querySelectorAll('.fh-active').forEach((element) => element.classList.remove('fh-active'));

    const crosshair = svg.querySelector<SVGLineElement>('.fh-crosshair')!;
    if (index === null) {
      crosshair.setAttribute('visibility', 'hidden');
      this.tooltip.hidden = true;
      return;
    }

    svg.querySelectorAll(`[data-i="${index}"]`).forEach((element) => element.classList.add('fh-active'));
    const commit = this.commits[index];
    const commitX = layout.left + ((commit.date - layout.start) / (layout.end - layout.start)) * (layout.right - layout.left);
    crosshair.setAttribute('x1', String(commitX));
    crosshair.setAttribute('x2', String(commitX));
    crosshair.setAttribute('visibility', 'visible');
    this.showTooltip(commit, pointerX, pointerY);
  }

  private showTooltip(commit: ChartCommit, pointerX: number, pointerY: number): void {
    const tooltip = this.tooltip;
    tooltip.innerHTML =
      '<div class="fh-tip-values"><span><i class="fh-key fh-key-added"></i><b class="fh-tip-added"></b></span>' +
      '<span><i class="fh-key fh-key-deleted"></i><b class="fh-tip-deleted"></b></span></div>' +
      '<div class="fh-tip-subject"></div><div class="fh-tip-meta"></div><div class="fh-tip-hint">Click to open the change</div>';
    tooltip.querySelector('.fh-tip-added')!.textContent = `+${commit.additions.toLocaleString()}`;
    tooltip.querySelector('.fh-tip-deleted')!.textContent = `−${commit.deletions.toLocaleString()}`;
    tooltip.querySelector('.fh-tip-subject')!.textContent = commit.subject;
    tooltip.querySelector('.fh-tip-meta')!.textContent =
      `${commit.author} · ${this.dates.formatAgoOrDate(commit.date)} · ${commit.hash.slice(0, 7)}`;
    tooltip.hidden = false;

    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    const left = pointerX + 16 + width > window.innerWidth ? pointerX - width - 16 : pointerX + 16;
    const top = Math.min(window.innerHeight - height - 8, Math.max(8, pointerY - height / 2));
    tooltip.style.left = `${Math.max(8, left)}px`;
    tooltip.style.top = `${top}px`;
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.commits.length === 0) {
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const step = event.key === 'ArrowRight' ? 1 : -1;
      const next = this.hovered === null ? (step === 1 ? 0 : this.commits.length - 1) : this.hovered + step;
      const index = Math.min(this.commits.length - 1, Math.max(0, next));
      const box = this.chart.querySelector(`.fh-dot[data-i="${index}"]`)?.getBoundingClientRect();
      this.setHovered(index, box ? box.right : 0, box ? box.top : 0);
    } else if (event.key === 'Enter') {
      this.openHovered();
    } else if (event.key === 'Escape') {
      this.setHovered(null);
    }
  }

  private openHovered(): void {
    if (this.hovered !== null) {
      this.openCommit(this.commits[this.hovered]);
    }
  }

  private openCommit(commit: ChartCommit | undefined): void {
    if (commit) {
      this.api.postMessage({ type: 'openChange', hash: commit.hash, path: commit.path, oldPath: commit.oldPath });
    }
  }

  private renderTable(): void {
    const rows = [...this.commits].reverse();
    this.table.innerHTML =
      '<table><thead><tr><th>Date</th><th>Author</th><th class="num">Added</th><th class="num">Deleted</th><th>Message</th></tr></thead><tbody></tbody></table>';
    const body = this.table.querySelector('tbody')!;
    for (const commit of rows) {
      const row = document.createElement('tr');
      row.dataset.index = String(this.commits.indexOf(commit));
      const cells = [
        this.dates.formatShortDate(commit.date),
        commit.author,
        `+${commit.additions.toLocaleString()}`,
        `−${commit.deletions.toLocaleString()}`,
        commit.subject,
      ];
      cells.forEach((text, index) => {
        const cell = document.createElement('td');
        cell.textContent = text;
        if (index === 2 || index === 3) {
          cell.className = 'num';
        }
        row.appendChild(cell);
      });
      body.appendChild(row);
    }
  }
}

new HistoryApp(document.getElementById('app')!);
