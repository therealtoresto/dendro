import {
  CommitHoverInfo,
  CommitInfo,
  CommitStats,
  GraphState,
  HostMessage,
  RefInfo,
  WORKING_CHANGES_KEY,
} from '../src/protocol';
import { DateFormatter } from '../src/shared/DateFormatter';
import type { SettingValues } from '../src/shared/SettingsCatalog';
import { ColumnId, Columns, ColumnWidths, COLUMN_SPECS } from './Columns';
import { CommitList, ListModel, ListRow, RowDisplay } from './CommitList';
import { Markers } from './Markers';
import { DetailsPanel } from './DetailsPanel';
import { GraphLayout, GraphLayoutResult, LayoutInput } from './GraphLayout';
import { GraphRenderer } from './GraphRenderer';
import { HostBridge } from './HostBridge';
import { HoverCard } from './HoverCard';
import { Toolbar } from './Toolbar';

const SEARCH_DEBOUNCE_MS = 250;
const MIN_SEARCH_LENGTH = 2;
const MIN_DETAILS_WIDTH = 260;
const DEFAULT_DETAILS_WIDTH = 400;
// One huge import would flatten every other bar, so bars are scaled against at most this many changed lines.
const LARGEST_CHANGE_CAP = 5000;

interface SearchState {
  query: string;
  matches: Set<string>;
}

class GraphApp {
  private state: GraphState | null = null;
  private commits: CommitInfo[] = [];
  private hasMore = false;
  private loading = false;
  private rows: ListRow[] = [];
  private layout: GraphLayoutResult = { rows: [], maxLanes: 0 };
  private refs: RefInfo[] = [];
  private refsByHash = new Map<string, RefInfo[]>();
  private statsByHash = new Map<string, CommitStats>();
  private avatars = new Map<string, string>();
  private incoming = new Set<string>();
  private hoverInfos = new Map<string, CommitHoverInfo>();
  private hoverTimer: number | undefined;
  private readonly hoverCard = new HoverCard();
  private largestChange = 1;
  private columnWidths: ColumnWidths;
  private selectedKey: string | null;
  private compareKey: string | null = null;
  private dates = new DateFormatter({ relative: true, locale: '', format: '', shortFormat: '', timeFormat: '' }, 'en-US');
  private search: SearchState | null = null;
  private searchTimer: number | undefined;
  private pendingSearchStep: 1 | null = null;
  private pendingSelection: string | null = null;
  private moreRequested = false;
  private firstLoadDone = false;

  private readonly toolbar: Toolbar;
  private readonly list: CommitList;
  private readonly details: DetailsPanel;
  private readonly errorBar: HTMLElement;

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <header class="toolbar"></header>
      <div class="error-bar" hidden></div>
      <main class="layout">
        <section class="list"></section>
        <div class="splitter" title="Drag to resize"></div>
        <aside class="details"></aside>
      </main>`;

    const viewState = HostBridge.readViewState();
    this.selectedKey = viewState.selectedKey ?? null;
    this.columnWidths = viewState.columnWidths ?? {};
    GraphApp.applyDetailsWidth(viewState.detailsWidth ?? DEFAULT_DETAILS_WIDTH);

    this.errorBar = root.querySelector('.error-bar')!;
    this.toolbar = new Toolbar(root.querySelector('.toolbar')!, {
      onSearchInput: (query) => this.onSearchInput(query),
      onSearchStep: (direction) => this.stepSearch(direction),
      onSearchClear: () => this.clearSearch(),
    });
    this.list = new CommitList(root.querySelector('.list')!, {
      onSelect: (key, compare) => this.onRowSelect(key, compare),
      onCheckoutRef: (name, kind) => this.checkoutRef(name, kind),
      onNeedMore: () => this.requestMore(),
      onResizeColumn: (id, width) => this.resizeColumn(id, width),
      onResetColumn: (id) => this.resizeColumn(id, null),
      onRowHover: (key, row, pointerX) => this.onRowHover(key, row, pointerX),
      onRowLeave: () => this.onRowLeave(),
      onScroll: () => this.hideHover(),
    });
    this.details = new DetailsPanel(root.querySelector('.details')!, {
      onSelectCommit: (hash) => this.selectCommitAnywhere(hash),
    });

    this.errorBar.addEventListener('click', () => (this.errorBar.hidden = true));
    this.attachSplitter(root.querySelector('.splitter')!);
    window.addEventListener('message', (event: MessageEvent<HostMessage>) => this.onHostMessage(event.data));
    document.addEventListener('keydown', (event) => this.onKeyDown(event));

    HostBridge.post({ type: 'ready' });
  }

  private onHostMessage(message: HostMessage): void {
    switch (message.type) {
      case 'state':
        this.onState(message.state);
        return;
      case 'refs':
        this.onRefs(message.refs);
        return;
      case 'commits':
        this.onCommits(message.commits, message.append, message.hasMore);
        return;
      case 'commitStats':
        this.onCommitStats(message.stats);
        return;
      case 'loading':
        this.loading = message.value;
        this.renderList();
        return;
      case 'busy':
        this.toolbar.setBusy(message.action, message.automatic === true);
        return;
      case 'remoteResult':
        this.toolbar.showRemoteResult(message.action, message.ok, message.message);
        return;
      case 'commitDetails':
        if (message.details.hash === this.selectedKey) {
          const laneColor = this.getLaneColor(message.details.hash);
          const refs = this.refsByHash.get(message.details.hash) ?? [];
          const avatar = this.avatars.get(message.details.email.toLowerCase());
          const incomingFrom = this.incoming.has(message.details.hash) ? this.state?.head.upstream ?? null : null;
          this.details.showCommit(message.details, refs, this.state?.head.branch ?? null, laneColor, this.dates, avatar, incomingFrom);
        }
        return;
      case 'comparisonDetails': {
        const { base, target } = message.details;
        const pair = this.getComparisonPair();
        if (pair && pair.base === base && pair.target === target) {
          this.details.showComparison(message.details, this.findCommit(base), this.findCommit(target));
        }
        return;
      }
      case 'reveal':
        this.selectCommitAnywhere(message.hash);
        return;
      case 'avatars':
        this.onAvatars(message.avatars, message.reset === true);
        return;
      case 'hoverInfo':
        this.hoverInfos.set(message.info.hash, message.info);
        this.hoverCard.updateInfo(message.info);
        return;
      case 'workingDetails':
        if (this.selectedKey === WORKING_CHANGES_KEY && this.state) {
          this.details.showWorking(message.details, this.state.working);
        }
        return;
      case 'searchResult':
        this.onSearchResult(message.query, message.hashes);
        return;
      case 'loadUntilDone':
        this.onLoadUntilDone(message.found);
        return;
      case 'error':
        this.showError(message.message);
        return;
    }
  }

  private onState(state: GraphState): void {
    const previous = this.state;
    this.state = state;
    this.dates = new DateFormatter(
      {
        relative: Boolean(state.settings['dates.relative']),
        locale: String(state.settings['dates.locale']),
        format: String(state.settings['dates.format']),
        shortFormat: String(state.settings['dates.shortFormat']),
        timeFormat: String(state.settings['dates.timeFormat']),
      },
      state.locale,
    );
    this.toolbar.render(state, this.dates);
    this.indexRefs();

    if (!state.root) {
      this.details.showMessage('No git repository is open in this window.');
    }

    this.rebuildRows();

    const workingChanged = JSON.stringify(previous?.working) !== JSON.stringify(state.working);
    if (this.selectedKey === WORKING_CHANGES_KEY) {
      if (state.working.total === 0) {
        this.selectHead();
      } else if (workingChanged || previous?.head.hash !== state.head.hash) {
        HostBridge.post({ type: 'showWorkingChanges' });
      }
    }
  }

  private onRefs(refs: RefInfo[]): void {
    this.refs = refs;
    this.indexRefs();
    this.renderList();
  }

  private get settings(): SettingValues {
    return this.state?.settings ?? {};
  }

  // Hidden remote branches or tags lose their badges and markers too, not only their commits.
  private indexRefs(): void {
    const showRemotes = this.settings['graph.showRemoteBranches'] !== false;
    const showTags = this.settings['graph.showTags'] !== false;
    this.refsByHash = new Map();

    for (const ref of this.refs) {
      if ((ref.kind === 'remote' && !showRemotes) || (ref.kind === 'tag' && !showTags)) {
        continue;
      }
      const list = this.refsByHash.get(ref.hash) ?? [];
      list.push(ref);
      this.refsByHash.set(ref.hash, list);
    }
  }

  private onAvatars(avatars: Record<string, string>, reset: boolean): void {
    if (reset) {
      this.avatars.clear();
    }
    for (const [email, dataUri] of Object.entries(avatars)) {
      this.avatars.set(email, dataUri);
      this.hoverCard.updateAvatar(email, dataUri);
    }
    this.renderList();
  }

  // A card already open follows the pointer to the next row at once; the first one waits for the hover delay.
  private onRowHover(key: string, row: DOMRect, pointerX: number): void {
    window.clearTimeout(this.hoverTimer);
    if (this.settings['graph.rowHover.enabled'] === false || key === WORKING_CHANGES_KEY) {
      this.hoverCard.scheduleHide();
      return;
    }
    const delay = this.hoverCard.shownHash ? 0 : Number(this.settings['graph.rowHover.delayMs'] ?? 400);
    this.hoverTimer = window.setTimeout(() => this.showHover(key, row, pointerX), delay);
  }

  private onRowLeave(): void {
    window.clearTimeout(this.hoverTimer);
    this.hoverCard.scheduleHide();
  }

  private hideHover(): void {
    window.clearTimeout(this.hoverTimer);
    this.hoverCard.hide();
  }

  private showHover(hash: string, row: DOMRect, pointerX: number): void {
    const commit = this.findCommit(hash);
    if (!commit) {
      return;
    }
    const info = this.hoverInfos.get(hash) ?? null;
    this.hoverCard.show(
      {
        commit,
        refs: this.refsByHash.get(hash) ?? [],
        headBranch: this.state?.head.branch ?? null,
        laneColor: this.getLaneColor(hash),
        stats: this.statsByHash.get(hash),
        avatar: this.avatars.get(commit.email.toLowerCase()),
        dates: this.dates,
        useCommitDate: this.settings['dates.source'] === 'committed',
        incomingFrom: this.incoming.has(hash) ? this.state?.head.upstream ?? null : null,
      },
      info,
      row,
      pointerX,
    );
    if (!info) {
      HostBridge.post({ type: 'hoverCommit', hash });
    }
  }

  private onCommitStats(stats: Record<string, CommitStats>): void {
    for (const [hash, value] of Object.entries(stats)) {
      this.statsByHash.set(hash, value);
      this.largestChange = Math.min(
        LARGEST_CHANGE_CAP,
        Math.max(this.largestChange, value.additions + value.deletions),
      );
    }
    this.renderList();
  }

  private resizeColumn(id: ColumnId, width: number | null): void {
    if (width === null) {
      delete this.columnWidths[id];
    } else {
      this.columnWidths[id] = width;
    }
    HostBridge.saveViewState({ columnWidths: this.columnWidths });
    this.renderList();
  }

  private onCommits(commits: CommitInfo[], append: boolean, hasMore: boolean): void {
    this.commits = append ? this.commits.concat(commits) : commits;
    this.hasMore = hasMore;
    this.moreRequested = false;
    this.rebuildRows();

    if (append) {
      return;
    }

    const selectionStillThere = this.selectedKey && this.rows.some((row) => row.key === this.selectedKey);
    if (!this.firstLoadDone || !selectionStillThere) {
      this.firstLoadDone = true;
      if (selectionStillThere) {
        this.select(this.selectedKey!, 'center');
      } else {
        this.selectHead();
      }
      return;
    }

    if (this.selectedKey !== WORKING_CHANGES_KEY) {
      HostBridge.post({ type: 'showCommit', hash: this.selectedKey! });
    }
  }

  private rebuildRows(): void {
    const state = this.state;
    const rows: ListRow[] = [];
    const inputs: LayoutInput[] = [];

    if (state && state.working.total > 0) {
      rows.push({ key: WORKING_CHANGES_KEY, commit: null });
      inputs.push({ hash: WORKING_CHANGES_KEY, parents: state.head.hash ? [state.head.hash] : [], dashed: true });
    }
    for (const commit of this.commits) {
      rows.push({ key: commit.hash, commit });
      inputs.push({ hash: commit.hash, parents: commit.parents });
    }

    // Without a Working Changes row on top, HEAD still keeps the first lane, so commits above it branch off it.
    const headHash = state?.head.hash ?? null;
    const headIsBelowTop = headHash !== null && rows.length > 0 && rows[0].key !== headHash;
    const keepFirstLaneFor =
      headIsBelowTop && rows[0].key !== WORKING_CHANGES_KEY && this.commits.some((commit) => commit.hash === headHash)
        ? headHash
        : undefined;

    this.rows = rows;
    this.incoming = new Set(state?.incoming ?? []);
    this.layout = GraphLayout.compute(inputs, keepFirstLaneFor);
    this.renderList();
    this.updateSearchStatus();
  }

  private renderList(): void {
    const state = this.state;
    const settings = this.settings;
    const metrics = GraphRenderer.createMetrics(GraphApp.readRowHeight(settings), settings['graph.avatarNodes'] !== false);
    const autoGraphWidth = GraphRenderer.getGraphWidth(this.layout.maxLanes, Number(settings['graph.maxGraphWidth'] ?? 220), metrics);
    const graphWidth = this.columnWidths.graph ?? autoGraphWidth;
    Columns.applyWidths(this.columnWidths, graphWidth);

    const markerSource = {
      rows: this.rows,
      refsByHash: this.refsByHash,
      headHash: state?.head.hash ?? null,
      selectedKey: this.selectedKey,
      compareKey: this.compareKey,
      matches: this.search?.matches ?? null,
    };
    const scrollKinds = new Set([...GraphApp.readList(settings['graph.scrollMarkers.kinds']), 'selection', 'searchResults']);
    const minimapKinds = new Set(GraphApp.readList(settings['graph.minimap.kinds']));

    const model: ListModel = {
      rows: this.rows,
      layout: this.layout,
      display: this.buildRowDisplay(),
      refsByHash: this.refsByHash,
      statsByHash: this.statsByHash,
      avatars: this.avatars,
      incoming: this.incoming,
      largestChange: this.largestChange,
      headHash: state?.head.hash ?? null,
      headBranch: state?.head.branch ?? null,
      selectedKey: this.selectedKey,
      selectedLaneColor: this.getSelectedLaneColor(),
      compareKey: this.compareKey,
      searchQuery: this.search?.query ?? '',
      matches: this.search?.matches ?? null,
      working: state?.working ?? { total: 0, added: 0, modified: 0, deleted: 0, conflicted: 0, staged: 0 },
      graphWidth,
      metrics,
      loading: this.loading,
      hasMore: this.hasMore,
      scrollAheadRows: Number(settings['graph.scrollAheadRows'] ?? 60),
      minimapMarkers: settings['graph.minimap.enabled'] === true ? Markers.collect(markerSource, minimapKinds) : null,
      scrollMarkers: settings['graph.scrollMarkers.enabled'] === false ? null : Markers.collect(markerSource, scrollKinds),
    };
    this.list.setModel(model);
  }

  private buildRowDisplay(): RowDisplay {
    const settings = this.settings;
    const pillsInline = settings['graph.pillLayout'] === 'inline';
    const shown = new Set(GraphApp.readList(settings['graph.columns'] ?? COLUMN_SPECS.map((spec) => spec.id)));
    const columns = COLUMN_SPECS.map((spec) => spec.id).filter(
      (id) => id === 'message' || (shown.has(id) && !(id === 'refs' && pillsInline)),
    );
    const useCommitDate = settings['dates.source'] === 'committed';
    const dates = this.dates;

    return {
      columns,
      pillsInline,
      badges: {
        maxPills: Number(settings['graph.pillsPerRow'] ?? 2),
        showRemoteNames: settings['graph.showRemoteNames'] !== false,
        showUpstreamStatus: settings['graph.showUpstreamStatus'] !== false,
      },
      dimMerges: settings['graph.dimMergeCommits'] === true,
      avatars: settings['graph.avatars'] !== false,
      getRowDate: (commit) => (useCommitDate ? commit.commitDate : commit.date),
      formatDate: (commit) => {
        const date = useCommitDate ? commit.commitDate : commit.date;
        return { text: dates.formatCompact(date), title: dates.formatFull(date) };
      },
      formatDay: (unixSeconds) => dates.formatShortDate(unixSeconds),
    };
  }

  private static readRowHeight(settings: SettingValues): number {
    const heights: Record<string, number> = { compact: 24, comfortable: 28, spacious: 34 };
    return heights[String(settings['graph.density'])] ?? heights.comfortable;
  }

  private static readList(value: unknown): string[] {
    return Array.isArray(value) ? value.map(String) : [];
  }

  private findCommit(hash: string): CommitInfo | undefined {
    return this.commits.find((commit) => commit.hash === hash);
  }

  // The older of the two commits (lower in the list) is the base, so the diff reads forward in time.
  private getComparisonPair(): { base: string; target: string } | null {
    if (!this.compareKey || !this.selectedKey || this.selectedKey === WORKING_CHANGES_KEY) {
      return null;
    }
    const selectedIndex = this.rows.findIndex((row) => row.key === this.selectedKey);
    const compareIndex = this.rows.findIndex((row) => row.key === this.compareKey);
    if (selectedIndex < 0 || compareIndex < 0) {
      return null;
    }
    return selectedIndex > compareIndex
      ? { base: this.selectedKey, target: this.compareKey }
      : { base: this.compareKey, target: this.selectedKey };
  }

  private onRowSelect(key: string, compare: boolean): void {
    const canCompare =
      compare &&
      this.settings['graph.multiSelect'] !== false &&
      key !== WORKING_CHANGES_KEY &&
      this.selectedKey !== null &&
      this.selectedKey !== WORKING_CHANGES_KEY &&
      key !== this.selectedKey;

    if (!canCompare) {
      this.compareKey = null;
      this.select(key);
      return;
    }

    this.compareKey = key;
    this.renderList();
    const pair = this.getComparisonPair();
    if (pair) {
      this.details.showLoading();
      HostBridge.post({ type: 'showComparison', base: pair.base, target: pair.target });
    }
  }

  private select(key: string, align: 'nearest' | 'center' = 'nearest'): void {
    const index = this.rows.findIndex((row) => row.key === key);
    if (index < 0) {
      return;
    }

    const changed = key !== this.selectedKey || this.details.shownKey !== key;
    this.selectedKey = key;
    HostBridge.saveViewState({ selectedKey: key });
    this.list.scrollToIndex(index, align);
    this.renderList();
    this.updateSearchStatus();

    if (!changed) {
      return;
    }
    this.details.showLoading();
    if (key === WORKING_CHANGES_KEY) {
      HostBridge.post({ type: 'showWorkingChanges' });
    } else {
      HostBridge.post({ type: 'showCommit', hash: key });
    }
  }

  private selectHead(): void {
    const headHash = this.state?.head.hash;
    const headRow = this.rows.find((row) => row.key === headHash) ?? this.rows.find((row) => row.commit);
    if (headRow) {
      this.select(headRow.key, 'center');
      return;
    }
    this.selectedKey = null;
    if (this.state?.root) {
      this.details.showMessage(this.rows.length === 0 ? 'This repository has no commits yet.' : 'Select a commit.');
    }
  }

  private selectCommitAnywhere(hash: string): void {
    if (this.rows.some((row) => row.key === hash)) {
      this.select(hash, 'center');
      return;
    }
    this.pendingSelection = hash;
    HostBridge.post({ type: 'loadUntil', hashes: [hash] });
  }

  private checkoutRef(name: string, kind: RefInfo['kind']): void {
    const ref = this.refs.find((candidate) => candidate.name === name && candidate.kind === kind);
    if (ref) {
      HostBridge.post({ type: 'checkoutRef', ref });
    }
  }

  private requestMore(): void {
    if (this.moreRequested || !this.hasMore) {
      return;
    }
    this.moreRequested = true;
    HostBridge.post({ type: 'loadMore' });
  }

  private onSearchInput(query: string): void {
    window.clearTimeout(this.searchTimer);
    this.searchTimer = window.setTimeout(() => {
      const trimmed = query.trim();
      if (trimmed.length < MIN_SEARCH_LENGTH) {
        this.clearSearch();
        return;
      }
      this.toolbar.setSearchStatus('…');
      HostBridge.post({ type: 'search', query: trimmed });
    }, SEARCH_DEBOUNCE_MS);
  }

  private onSearchResult(query: string, hashes: string[]): void {
    if (!query) {
      return;
    }
    this.search = { query, matches: new Set(hashes) };
    this.renderList();

    const first = this.rows.find((row) => this.search!.matches.has(row.key));
    if (first) {
      this.select(first.key, 'center');
    } else if (hashes.length > 0) {
      this.loadUnloadedMatches();
    }
    this.updateSearchStatus();
  }

  private stepSearch(direction: 1 | -1): void {
    const search = this.search;
    if (!search || search.matches.size === 0) {
      return;
    }

    const current = this.rows.findIndex((row) => row.key === this.selectedKey);
    for (let index = current + direction; index >= 0 && index < this.rows.length; index += direction) {
      if (search.matches.has(this.rows[index].key)) {
        this.select(this.rows[index].key, 'center');
        return;
      }
    }

    if (direction === 1 && this.hasMore) {
      this.loadUnloadedMatches();
    }
  }

  private loadUnloadedMatches(): void {
    const loaded = new Set(this.rows.map((row) => row.key));
    const unloaded = Array.from(this.search?.matches ?? []).filter((hash) => !loaded.has(hash));
    if (unloaded.length === 0 || !this.hasMore) {
      return;
    }
    this.pendingSearchStep = 1;
    this.toolbar.setSearchStatus('loading…');
    HostBridge.post({ type: 'loadUntil', hashes: unloaded });
  }

  private onLoadUntilDone(found: boolean): void {
    if (this.pendingSelection) {
      const hash = this.pendingSelection;
      this.pendingSelection = null;
      if (found) {
        this.select(hash, 'center');
      }
      return;
    }

    if (this.pendingSearchStep) {
      this.pendingSearchStep = null;
      if (found) {
        this.stepSearch(1);
      }
      this.updateSearchStatus();
    }
  }

  private clearSearch(): void {
    window.clearTimeout(this.searchTimer);
    this.search = null;
    this.toolbar.setSearchStatus('');
    this.renderList();
  }

  private updateSearchStatus(): void {
    const search = this.search;
    if (!search) {
      return;
    }
    if (search.matches.size === 0) {
      this.toolbar.setSearchStatus('no matches');
      return;
    }

    const loadedMatches = this.rows.filter((row) => search.matches.has(row.key));
    const position = loadedMatches.findIndex((row) => row.key === this.selectedKey);
    const current = position >= 0 ? `${position + 1} / ` : '';
    this.toolbar.setSearchStatus(`${current}${search.matches.size}`);
  }

  private onKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    this.hideHover();
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      this.toolbar.focusSearch();
      return;
    }
    if (target.tagName === 'INPUT' || this.rows.length === 0) {
      return;
    }

    const current = Math.max(0, this.rows.findIndex((row) => row.key === this.selectedKey));
    let next: number | null = null;
    if (event.key === 'ArrowDown') {
      next = current + 1;
    } else if (event.key === 'ArrowUp') {
      next = current - 1;
    } else if (event.key === 'PageDown') {
      next = current + this.list.getPageRowCount();
    } else if (event.key === 'PageUp') {
      next = current - this.list.getPageRowCount();
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = this.rows.length - 1;
    }

    if (next === null) {
      return;
    }
    event.preventDefault();
    const index = Math.min(this.rows.length - 1, Math.max(0, next));
    this.select(this.rows[index].key);
  }

  private getSelectedLaneColor(): number | null {
    const index = this.rows.findIndex((row) => row.key === this.selectedKey);
    return index >= 0 ? this.layout.rows[index]?.color ?? null : null;
  }

  private getLaneColor(hash: string): string {
    const index = this.rows.findIndex((row) => row.key === hash);
    return GraphRenderer.getColor(index >= 0 ? this.layout.rows[index].color : 0);
  }

  private showError(message: string): void {
    this.errorBar.textContent = message;
    this.errorBar.hidden = false;
  }

  private attachSplitter(splitter: HTMLElement): void {
    splitter.addEventListener('pointerdown', (event) => {
      splitter.setPointerCapture(event.pointerId);
      const onMove = (move: PointerEvent) => {
        const width = Math.max(MIN_DETAILS_WIDTH, Math.min(window.innerWidth - 300, window.innerWidth - move.clientX));
        GraphApp.applyDetailsWidth(width);
      };
      const onUp = () => {
        splitter.removeEventListener('pointermove', onMove);
        splitter.removeEventListener('pointerup', onUp);
        const width = parseInt(document.documentElement.style.getPropertyValue('--details-width'), 10);
        HostBridge.saveViewState({ detailsWidth: width });
      };
      splitter.addEventListener('pointermove', onMove);
      splitter.addEventListener('pointerup', onUp);
    });
  }

  private static applyDetailsWidth(width: number): void {
    document.documentElement.style.setProperty('--details-width', `${width}px`);
  }
}

new GraphApp(document.getElementById('app')!);
