import { CommitAction, CommitInfo, CommitStats, RefInfo, StashInfo, WORKING_CHANGES_KEY, WorkingSummary } from '../src/protocol';
import { ColumnId, Columns } from './Columns';
import { AvatarStyle } from '../src/shared/AvatarStyle';
import { Format } from './Format';
import type { GraphLayoutResult } from './GraphLayout';
import { GraphMetrics, GraphRenderer, NodeStyle } from './GraphRenderer';
import { IconName, Icons } from './Icons';
import type { RowMarker } from './Markers';
import { Minimap } from './Minimap';
import { BadgeOptions, RefBadges } from './RefBadges';
import { ScrollMarkers } from './ScrollMarkers';
import { WorkingCounters } from './WorkingCounters';

export interface ListRow {
  key: string;
  commit: CommitInfo | null;
  stash?: StashInfo;
}

const ROW_ACTIONS: { action: CommitAction; icon: IconName; title: string }[] = [
  { action: 'createBranch', icon: 'branch', title: 'Create a branch here' },
  { action: 'createTag', icon: 'tag', title: 'Tag this commit' },
  { action: 'cherryPick', icon: 'cherry', title: 'Cherry-pick onto the current branch' },
  { action: 'revert', icon: 'undo', title: 'Revert this commit' },
  { action: 'copySha', icon: 'copy', title: 'Copy the SHA' },
];

export interface RowDisplay {
  columns: ColumnId[];
  badges: BadgeOptions;
  pillsInline: boolean;
  dimMerges: boolean;
  avatars: boolean;
  formatDate(commit: CommitInfo): { text: string; title: string };
  formatTime(unixSeconds: number): { text: string; title: string };
  formatDay(unixSeconds: number): string;
  getRowDate(commit: CommitInfo): number;
}

export interface ListModel {
  rows: ListRow[];
  layout: GraphLayoutResult;
  display: RowDisplay;
  refsByHash: Map<string, RefInfo[]>;
  statsByHash: Map<string, CommitStats>;
  avatars: Map<string, string>;
  incoming: Set<string>;
  largestChange: number;
  headHash: string | null;
  headBranch: string | null;
  selectedKey: string | null;
  selectedLaneColor: number | null;
  compareKey: string | null;
  branchHighlight: Set<string> | null;
  searchQuery: string;
  matches: Set<string> | null;
  working: WorkingSummary;
  graphWidth: number;
  metrics: GraphMetrics;
  loading: boolean;
  hasMore: boolean;
  scrollAheadRows: number;
  minimapMarkers: RowMarker[] | null;
  scrollMarkers: RowMarker[] | null;
}

interface ListHandlers {
  onSelect(key: string, compare: boolean): void;
  onCheckoutRef(name: string, kind: RefInfo['kind']): void;
  onNeedMore(): void;
  onResizeColumn(id: ColumnId, width: number): void;
  onResetColumn(id: ColumnId): void;
  onRowHover(key: string, row: DOMRect, pointerX: number): void;
  onBadgeHover(commitHash: string | null): void;
  onRowAction(action: CommitAction, hash: string): void;
  onDropRef(name: string, kind: RefInfo['kind'], targetKey: string): void;
  onRowLeave(): void;
  onScroll(): void;
}

const OVERSCAN_ROWS = 12;
const OVERLAY_GAP = 4;

export class CommitList {
  private readonly header: HTMLElement;
  private readonly overlay: HTMLElement;
  private inset = 0;
  private readonly scroller: HTMLElement;
  private readonly sizer: HTMLElement;
  private readonly rowsElement: HTMLElement;
  private readonly footer: HTMLElement;
  private readonly minimap: Minimap;
  private readonly scrollMarkers: ScrollMarkers;
  private model: ListModel | null = null;
  private headerColumns = '';
  private renderQueued = false;
  private hoveredKey: string | null = null;
  private hoveredBadgeRow: string | null = null;

  constructor(
    container: HTMLElement,
    private readonly handlers: ListHandlers,
  ) {
    // The column header (and the activity strip) float over the rows, which scroll on beneath them.
    container.innerHTML = `
      <div class="list-body">
        <div class="list-scroller" tabindex="0">
          <div class="list-sizer"><div class="list-rows"></div></div>
          <div class="list-footer"></div>
        </div>
      </div>
      <div class="list-overlay glass">
        <div class="minimap"></div>
        <div class="list-header"></div>
      </div>`;
    this.overlay = container.querySelector('.list-overlay')!;
    new ResizeObserver(() => this.updateInset()).observe(this.overlay);

    this.header = container.querySelector('.list-header')!;
    this.scroller = container.querySelector('.list-scroller')!;
    this.sizer = container.querySelector('.list-sizer')!;
    this.rowsElement = container.querySelector('.list-rows')!;
    this.footer = container.querySelector('.list-footer')!;
    this.minimap = new Minimap(container.querySelector('.minimap')!, (index) => {
      const row = this.model?.rows[index];
      if (row) {
        this.handlers.onSelect(row.key, false);
        this.scrollToIndex(index, 'center');
      }
    });
    this.scrollMarkers = new ScrollMarkers(container.querySelector('.list-body')!);

    this.scroller.addEventListener('scroll', () => {
      this.hoveredKey = null;
      handlers.onScroll();
      this.queueRender();
    });
    this.rowsElement.addEventListener('mouseover', (event) => this.onRowOver(event));
    this.rowsElement.addEventListener('mouseleave', () => {
      this.hoveredKey = null;
      this.setBadgeHover(null);
      handlers.onRowLeave();
    });
    window.addEventListener('resize', () => this.queueRender());
    this.rowsElement.addEventListener('click', (event) => this.onRowClick(event));
    this.attachDragAndDrop();
    this.rowsElement.addEventListener('dblclick', (event) => this.onRowDoubleClick(event));
    Columns.attachResize(this.header, (id) => this.readColumnWidth(id), {
      onResize: (id, width) => handlers.onResizeColumn(id, width),
      onReset: (id) => handlers.onResetColumn(id),
    });
  }

  private get rowHeight(): number {
    return this.model?.metrics.rowHeight ?? 28;
  }

  setModel(model: ListModel): void {
    this.model = model;
    document.documentElement.style.setProperty('--row-height', `${model.metrics.rowHeight}px`);
    this.sizer.style.height = `${model.rows.length * this.rowHeight}px`;
    this.footer.textContent = model.loading ? 'Loading commits…' : model.hasMore ? '' : CommitList.describeEnd(model);

    const columnsKey = model.display.columns.join(',');
    if (columnsKey !== this.headerColumns) {
      this.headerColumns = columnsKey;
      this.header.innerHTML = Columns.renderHeader(model.display.columns);
    }
    this.scrollMarkers.update(model.scrollMarkers, model.rows.length);
    this.queueRender();
  }

  focus(): void {
    this.scroller.focus({ preventScroll: true });
  }

  // Row positions count from the top of the rows; the part of the view under the overlay does not count as seen.
  scrollToIndex(index: number, align: 'nearest' | 'center' = 'nearest'): void {
    const top = this.inset + index * this.rowHeight;
    const viewTop = this.scroller.scrollTop + this.inset;
    const viewHeight = this.scroller.clientHeight - this.inset;

    if (align === 'center') {
      this.scroller.scrollTop = Math.max(0, top - this.inset - viewHeight / 2 + this.rowHeight / 2);
    } else if (top < viewTop) {
      this.scroller.scrollTop = top - this.inset;
    } else if (top + this.rowHeight > viewTop + viewHeight) {
      this.scroller.scrollTop = top + this.rowHeight - this.scroller.clientHeight;
    }
    this.queueRender();
  }

  getPageRowCount(): number {
    return Math.max(1, Math.floor((this.scroller.clientHeight - this.inset) / this.rowHeight) - 1);
  }

  // The overlay floats a few pixels below the top edge, so the rows start under its bottom edge plus a small gap.
  private updateInset(): void {
    this.inset = this.overlay.offsetTop + this.overlay.offsetHeight + OVERLAY_GAP;
    this.sizer.style.marginTop = `${this.inset}px`;
    this.queueRender();
  }

  private readColumnWidth(id: ColumnId): number {
    return this.header.querySelector<HTMLElement>(`.cell.${id}`)?.getBoundingClientRect().width ?? 0;
  }

  private queueRender(): void {
    if (this.renderQueued) {
      return;
    }
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  private render(): void {
    const model = this.model;
    if (!model) {
      return;
    }

    const firstOnScreen = Math.floor(this.scroller.scrollTop / this.rowHeight);
    const visibleCount = Math.ceil((this.scroller.clientHeight - this.inset) / this.rowHeight);
    const first = Math.max(0, firstOnScreen - OVERSCAN_ROWS);
    const last = Math.min(model.rows.length, firstOnScreen + visibleCount + OVERSCAN_ROWS);

    let html = '';
    for (let index = first; index < last; index++) {
      html += this.renderRow(model, index);
    }
    this.rowsElement.innerHTML = html;

    this.updateMinimap(model, firstOnScreen, Math.min(model.rows.length - 1, firstOnScreen + visibleCount - 1));

    if (model.hasMore && !model.loading && last + model.scrollAheadRows >= model.rows.length) {
      this.handlers.onNeedMore();
    }
  }

  private updateMinimap(model: ListModel, firstVisible: number, lastVisible: number): void {
    if (!model.minimapMarkers) {
      this.minimap.update(null);
      return;
    }
    this.minimap.update({
      rowDates: model.rows.map((row) => (row.commit ? model.display.getRowDate(row.commit) : null)),
      markers: model.minimapMarkers,
      firstVisible,
      lastVisible,
      formatDay: model.display.formatDay,
    });
  }

  private renderRow(model: ListModel, index: number): string {
    const row = model.rows[index];
    const commit = row.commit;
    const classes = ['row'];

    if (row.key === model.selectedKey) {
      classes.push('selected');
    }
    if (row.key === model.compareKey) {
      classes.push('compared');
    }
    if (model.matches) {
      classes.push(model.matches.has(row.key) ? 'match' : 'dim');
    }
    if (model.branchHighlight && !model.branchHighlight.has(row.key)) {
      classes.push('branch-dim');
    }

    if (row.stash) {
      return this.renderStashRow(model, index, row.stash, classes);
    }

    const cells = commit ? this.renderCommitCells(model, index, commit) : this.renderWorkingCells(model, index);
    const cellsHtml = model.display.columns.map((id) => `<div class="cell ${id}">${cells[id]}</div>`).join('');
    const laneColor = model.layout.rows[index].color;
    let top = `style="top:${index * this.rowHeight}px"`;

    // The rows of the selected commit's branch line get a light wash of the branch color.
    if (model.selectedLaneColor !== null && laneColor === model.selectedLaneColor && row.key !== model.selectedKey) {
      classes.push('lane-tint');
      top = `style="top:${index * this.rowHeight}px;--tint:${GraphRenderer.getColor(laneColor)}"`;
    }

    if (!commit) {
      return `<div class="${classes.join(' ')} working" ${top} data-key="${WORKING_CHANGES_KEY}">${cellsHtml}</div>`;
    }

    if (commit.hash === model.headHash) {
      classes.push('head');
    }
    if (model.incoming.has(commit.hash)) {
      classes.push('incoming');
    }
    if (model.display.dimMerges && commit.parents.length > 1) {
      classes.push('merge-dimmed');
    }
    const context = Format.escapeHtml(
      JSON.stringify({ webviewSection: 'commit', hash: commit.hash, preventDefaultContextMenuItems: true }),
    );
    const actions = ROW_ACTIONS.map(
      (item) => `<button class="row-action" data-row-action="${item.action}" title="${item.title}">${Icons.render(item.icon, 13)}</button>`,
    ).join('');
    return (
      `<div class="${classes.join(' ')}" ${top} data-key="${commit.hash}" data-vscode-context="${context}">` +
      `${cellsHtml}<div class="row-actions glass-strong">${actions}</div></div>`
    );
  }

  private renderStashRow(model: ListModel, index: number, stash: StashInfo, classes: string[]): string {
    const layout = model.layout.rows[index];
    const color = GraphRenderer.getColor(layout.color);
    const date = model.display.formatTime(stash.date);
    const cells: Record<ColumnId, string> = {
      refs: `<span class="badge badge-stash" style="--lane:${color}">${Icons.render('box', 12)}<span class="badge-name">${Format.escapeHtml(stash.ref)}</span></span>`,
      graph: GraphRenderer.renderRow(layout, model.graphWidth, 'stash', model.metrics),
      message: `<span class="subject stash-subject">${Format.highlight(stash.message, model.searchQuery)}</span>`,
      author: '',
      changes: '',
      date: `<span title="${Format.escapeHtml(date.title)}">${Format.escapeHtml(date.text)}</span>`,
      sha: stash.hash.slice(0, 7),
    };
    const context = Format.escapeHtml(
      JSON.stringify({ webviewSection: 'stash', stashRef: stash.ref, preventDefaultContextMenuItems: true }),
    );
    const cellsHtml = model.display.columns.map((id) => `<div class="cell ${id}">${cells[id]}</div>`).join('');
    return (
      `<div class="${[...classes, 'stash'].join(' ')}" style="top:${index * this.rowHeight}px" data-key="stash:${stash.hash}" ` +
      `data-vscode-context="${context}">${cellsHtml}</div>`
    );
  }

  private renderWorkingCells(model: ListModel, index: number): Record<ColumnId, string> {
    const { working } = model;
    const lines = working.lines;
    const changes = lines
      ? CommitList.renderChanges({ ...lines, files: working.total }, model.largestChange)
      : `<span class="changes-cell"><span class="changes-files">${Icons.render('file', 11)}${working.total}</span></span>`;

    return {
      refs: '',
      graph: GraphRenderer.renderRow(model.layout.rows[index], model.graphWidth, 'working', model.metrics),
      message: `<span class="subject">Working Changes</span>${WorkingCounters.render(working, true)}`,
      author: '',
      changes,
      date: '',
      sha: '',
    };
  }

  private renderCommitCells(model: ListModel, index: number, commit: CommitInfo): Record<ColumnId, string> {
    const layout = model.layout.rows[index];
    const display = model.display;
    const isHead = commit.hash === model.headHash;

    let nodeStyle: NodeStyle = 'commit';
    if (isHead) {
      nodeStyle = 'head';
    } else if (model.incoming.has(commit.hash)) {
      nodeStyle = 'incoming';
    } else if (commit.parents.length > 1) {
      nodeStyle = 'merge';
    }

    const refs = model.refsByHash.get(commit.hash) ?? [];
    const badges = RefBadges.render(refs, model.headBranch, GraphRenderer.getColor(layout.color), display.badges);
    const linkBadges = badges !== '' && !display.pillsInline && display.columns.includes('refs') && display.columns.includes('graph');
    const body = commit.bodyPreview
      ? `<span class="body">${Format.highlight(commit.bodyPreview, model.searchQuery)}</span>`
      : '';
    const inlineBadges = display.pillsInline && badges ? `<span class="inline-badges">${badges}</span>` : '';
    const date = display.formatDate(commit);

    return {
      refs: linkBadges
        ? `<span class="ref-badges">${badges}</span><span class="ref-link" style="background:${GraphRenderer.getColor(layout.color)}"></span>`
        : badges,
      graph: GraphRenderer.renderRow(layout, model.graphWidth, nodeStyle, model.metrics, {
        initials: Format.escapeHtml(AvatarStyle.getInitials(commit.author)),
        color: AvatarStyle.getColor(commit.email),
        image: model.avatars.get(commit.email.toLowerCase()),
      }, linkBadges),
      message: `${inlineBadges}<span class="subject">${Format.highlight(commit.subject, model.searchQuery)}</span>${body}`,
      author: CommitList.renderAuthor(commit, display.avatars, model.avatars.get(commit.email.toLowerCase())),
      changes: CommitList.renderChanges(model.statsByHash.get(commit.hash), model.largestChange),
      date: `<span title="${Format.escapeHtml(date.title)}">${Format.escapeHtml(date.text)}</span>`,
      sha: commit.hash.slice(0, 7),
    };
  }

  private static renderAuthor(commit: CommitInfo, avatars: boolean, picture: string | undefined): string {
    const title = Format.escapeHtml(`${commit.author} <${commit.email}>`);
    if (!avatars) {
      return `<span class="author-name" title="${title}">${Format.escapeHtml(commit.author)}</span>`;
    }

    // The picture lies over the initials, which show until it arrives and stay for authors without one.
    const image = picture ? `<img class="avatar-image" src="${picture}" alt="">` : '';
    return (
      `<span class="avatar" style="background:${AvatarStyle.getColor(commit.email)}" title="${title}">` +
      `${Format.escapeHtml(AvatarStyle.getInitials(commit.author))}${image}</span>`
    );
  }

  // The bar's length grows with the log of the changed lines, so a 5-line fix and a 5 000-line import both stay
  // readable next to each other; the green / red split is the share of added / deleted lines.
  private static renderChanges(stats: CommitStats | undefined, largestChange: number): string {
    if (!stats) {
      return '<span class="changes-pending"></span>';
    }

    const total = stats.additions + stats.deletions;
    const length = total === 0 ? 0 : Math.max(6, (Math.log(total + 1) / Math.log(largestChange + 1)) * 100);
    const addedShare = total === 0 ? 0 : (stats.additions / total) * 100;
    const tooltip =
      `${stats.files} ${stats.files === 1 ? 'file' : 'files'} changed` +
      ` · ${stats.additions} ${stats.additions === 1 ? 'addition' : 'additions'}` +
      ` · ${stats.deletions} ${stats.deletions === 1 ? 'deletion' : 'deletions'}`;

    return (
      `<span class="changes-cell" title="${tooltip}">` +
      `<span class="changes-files">${Icons.render('file', 11)}${stats.files}</span>` +
      `<span class="changes-track"><span class="changes-bar" style="width:${Math.min(100, length)}%">` +
      `<span class="changes-added" style="width:${addedShare}%"></span><span class="changes-deleted"></span>` +
      `</span></span></span>`
    );
  }

  private setBadgeHover(rowKey: string | null): void {
    if (rowKey !== this.hoveredBadgeRow) {
      this.hoveredBadgeRow = rowKey;
      this.handlers.onBadgeHover(rowKey);
    }
  }

  private onRowOver(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>('.row');
    const overBadge = target.closest('.badge[data-ref-name]') !== null;
    this.setBadgeHover(overBadge ? row?.dataset.key ?? null : null);

    // A badge already explains itself and lights its branch; the commit card would only cover it.
    if (overBadge) {
      this.hoveredKey = null;
      this.handlers.onRowLeave();
      return;
    }

    const key = row?.dataset.key ?? null;
    if (!row || !key || key === this.hoveredKey) {
      return;
    }
    this.hoveredKey = key;
    this.handlers.onRowHover(key, row.getBoundingClientRect(), event.clientX);
  }

  // A branch badge dragged onto a commit row: the row lights up as a target, and the drop asks what to do.
  private attachDragAndDrop(): void {
    const dragType = 'text/x-dendro-ref';
    let target: HTMLElement | null = null;
    const clearTarget = () => {
      target?.classList.remove('drop-target');
      target = null;
    };

    this.rowsElement.addEventListener('dragstart', (event) => {
      const badge = (event.target as HTMLElement).closest<HTMLElement>('.badge[draggable="true"]');
      if (!badge || !event.dataTransfer) {
        return;
      }
      event.dataTransfer.setData(dragType, JSON.stringify({ name: badge.dataset.refName, kind: badge.dataset.refKind }));
      event.dataTransfer.effectAllowed = 'move';
      document.body.classList.add('dragging-ref');
      this.handlers.onRowLeave();
    });
    this.rowsElement.addEventListener('dragover', (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>('.row[data-key]');
      if (!row || row.classList.contains('working') || !event.dataTransfer?.types.includes(dragType)) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (row !== target) {
        clearTarget();
        target = row;
        row.classList.add('drop-target');
      }
    });
    this.rowsElement.addEventListener('drop', (event) => {
      const data = event.dataTransfer?.getData(dragType);
      const key = target?.dataset.key;
      clearTarget();
      document.body.classList.remove('dragging-ref');
      if (data && key) {
        event.preventDefault();
        const ref = JSON.parse(data) as { name: string; kind: RefInfo['kind'] };
        this.handlers.onDropRef(ref.name, ref.kind, key);
      }
    });
    this.rowsElement.addEventListener('dragend', () => {
      clearTarget();
      document.body.classList.remove('dragging-ref');
    });
  }

  private onRowClick(event: MouseEvent): void {
    const actionButton = (event.target as HTMLElement).closest<HTMLElement>('[data-row-action]');
    if (actionButton) {
      event.stopPropagation();
      const rowKey = actionButton.closest<HTMLElement>('.row')?.dataset.key;
      if (rowKey) {
        this.handlers.onRowAction(actionButton.dataset.rowAction as CommitAction, rowKey);
      }
      return;
    }
    const row = (event.target as HTMLElement).closest<HTMLElement>('.row');
    if (row?.dataset.key) {
      this.handlers.onSelect(row.dataset.key, event.metaKey || event.ctrlKey);
    }
  }

  private onRowDoubleClick(event: MouseEvent): void {
    const badge = (event.target as HTMLElement).closest<HTMLElement>('.badge[data-ref-name]');
    if (badge) {
      this.handlers.onCheckoutRef(badge.dataset.refName!, badge.dataset.refKind as RefInfo['kind']);
    }
  }

  private static describeEnd(model: ListModel): string {
    const commitCount = model.rows.filter((row) => row.commit).length;
    return commitCount === 0 ? '' : `${commitCount} commits`;
  }
}
