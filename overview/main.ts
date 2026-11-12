import type {
  BranchAction,
  OverviewBranch,
  OverviewHostMessage,
  OverviewState,
  OverviewWebviewMessage,
} from '../src/overviewProtocol';
import type { RemoteAction } from '../src/protocol';
import { AvatarStyle } from '../src/shared/AvatarStyle';
import { DateFormatter } from '../src/shared/DateFormatter';
import { Format } from '../webview/Format';
import { Icons } from '../webview/Icons';
import type { IconName } from '../webview/Icons';
import { WorkingCounters } from '../webview/WorkingCounters';

interface VsCodeApi {
  postMessage(message: OverviewWebviewMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

interface SavedState {
  filter?: string;
  showAll?: boolean;
}

declare function acquireVsCodeApi(): VsCodeApi;

// A long branch list folds to this many rows until it is asked for in full or filtered.
const FOLDED_BRANCHES = 8;
// Below this many branches a filter box is only in the way.
const FILTER_FROM = 7;

const BRANCH_ACTIONS: { action: BranchAction; icon: IconName; title: string }[] = [
  { action: 'checkout', icon: 'check', title: 'Check out' },
  { action: 'compare', icon: 'compare', title: 'Compare with the current branch' },
  { action: 'merge', icon: 'merge', title: 'Merge into the current branch' },
  { action: 'delete', icon: 'trash', title: 'Delete the branch' },
];

class OverviewApp {
  private readonly api = acquireVsCodeApi();
  private state: OverviewState | null = null;
  private emptyText: string | null = null;
  private busy: RemoteAction | null = null;
  private filter: string;
  private showAll: boolean;
  private dates = new DateFormatter({ relative: true, locale: '', format: '', shortFormat: '', timeFormat: '' }, navigator.language);

  constructor(private readonly root: HTMLElement) {
    const saved = (this.api.getState() as SavedState | undefined) ?? {};
    this.filter = saved.filter ?? '';
    this.showAll = saved.showAll ?? false;

    root.addEventListener('click', (event) => this.onClick(event));
    root.addEventListener('input', (event) => this.onInput(event));
    window.addEventListener('message', (event: MessageEvent<OverviewHostMessage>) => this.onMessage(event.data));
    this.api.postMessage({ type: 'ready' });
  }

  private onMessage(message: OverviewHostMessage): void {
    switch (message.type) {
      case 'state':
        this.state = message.state;
        this.emptyText = null;
        this.dates = new DateFormatter(message.state.dates, message.state.locale);
        break;
      case 'empty':
        this.state = null;
        this.emptyText = message.text;
        break;
      case 'busy':
        this.busy = message.action;
        break;
      case 'avatars':
        if (this.state) {
          Object.assign(this.state.avatars, message.avatars);
        }
        break;
    }
    this.render();
  }

  private save(): void {
    this.api.setState({ filter: this.filter, showAll: this.showAll } satisfies SavedState);
  }

  private render(): void {
    if (!this.state) {
      this.root.innerHTML = this.emptyText ? `<div class="ov-empty">${Format.escapeHtml(this.emptyText)}</div>` : '';
      return;
    }

    const filterFocused = document.activeElement?.classList.contains('ov-filter') ?? false;
    const caret = filterFocused ? (document.activeElement as HTMLInputElement).selectionStart : null;
    this.root.innerHTML = [
      this.renderHeader(this.state),
      this.renderHero(this.state),
      this.renderWorking(this.state),
      this.renderBase(this.state),
      this.renderBranches(this.state),
      this.renderCommits(this.state),
    ].join('');

    if (filterFocused) {
      const input = this.root.querySelector<HTMLInputElement>('.ov-filter');
      input?.focus();
      input?.setSelectionRange(caret, caret);
    }
  }

  private renderHeader(state: OverviewState): string {
    const canSwitch = state.repoCount > 1;
    const name = `${Icons.render('repo', 14)}<span>${Format.escapeHtml(state.repoName)}</span>${canSwitch ? Icons.render('down', 12) : ''}`;
    const title = canSwitch ? `Switch between the ${state.repoCount} open repositories` : 'The repository of the open files';
    return `
      <header class="ov-header">
        <button class="ov-repo${canSwitch ? '' : ' fixed'}" data-action="switch" title="${title}"${canSwitch ? '' : ' disabled'}>${name}</button>
        <span class="ov-tools">
          ${OverviewApp.renderIconButton('insights', 'pulse', 'Repository insights')}
          ${OverviewApp.renderIconButton('compare-branches', 'compare', 'Compare branches')}
          ${OverviewApp.renderIconButton('settings', 'gear', 'Dendro settings')}
        </span>
      </header>`;
  }

  private renderHero(state: OverviewState): string {
    const branchName = state.branch
      ? Format.escapeHtml(state.branch)
      : `detached at <span class="mono">${(state.headHash ?? '').slice(0, 7)}</span>`;

    const facts: string[] = [];
    if (!state.branch) {
      facts.push('no branch checked out');
    } else if (!state.upstream) {
      facts.push('not published yet');
    } else if (!state.ahead && !state.behind) {
      facts.push(`up to date with ${Format.escapeHtml(state.upstream)}`);
    } else {
      facts.push(Format.escapeHtml(state.upstream));
    }
    if (state.lastFetch) {
      facts.push(`fetched ${Format.escapeHtml(this.dates.formatAgo(state.lastFetch))}`);
    }

    const pushLabel = state.branch && !state.upstream ? 'Publish' : 'Push';
    return `
      <section class="ov-hero glass">
        <div class="ov-branch">${Icons.render('branch', 16)}<span class="ov-branch-name" title="${Format.escapeHtml(state.branch ?? '')}">${branchName}</span></div>
        <div class="ov-facts">${facts.join(' · ')}</div>
        <button class="ov-primary" data-action="graph">${Icons.render('graph', 16)}Open Commit Graph</button>
        <div class="ov-remote">
          ${this.renderRemoteButton('pull', 'pull', 'Pull', state.behind, `Pull ${state.behind || ''} incoming ${state.behind === 1 ? 'commit' : 'commits'}`)}
          ${this.renderRemoteButton('push', 'push', pushLabel, state.ahead, state.upstream ? `Push ${state.ahead || ''} outgoing ${state.ahead === 1 ? 'commit' : 'commits'}` : 'Publish the branch')}
          ${this.renderRemoteButton('fetch', 'fetch', 'Fetch', 0, 'Fetch from all remotes')}
        </div>
      </section>`;
  }

  private renderRemoteButton(action: RemoteAction, icon: IconName, label: string, count: number, title: string): string {
    const busy = this.busy === action;
    const classes = ['ov-button', busy ? 'busy' : '', count > 0 ? 'has-count' : ''].filter(Boolean).join(' ');
    const disabled = this.busy !== null ? ' disabled' : '';
    const badge = count > 0 ? `<span class="ov-count">${count}</span>` : '';
    return `<button class="${classes}" data-action="remote" data-remote="${action}" title="${title.replace(/\s+/g, ' ')}"${disabled}>${Icons.render(busy ? 'refresh' : icon, 13)}${label}${badge}</button>`;
  }

  private renderWorking(state: OverviewState): string {
    const { working } = state;
    const stashes = state.stashes
      ? `<span class="ov-muted">${state.stashes} ${state.stashes === 1 ? 'stash' : 'stashes'}</span>`
      : '';

    if (working.total === 0) {
      return `
        <section class="ov-card ov-clean">
          ${Icons.render('check', 13)}<span>Nothing uncommitted</span>${stashes}
        </section>`;
    }

    const lines = working.lines
      ? `<span class="ov-lines"><span class="ov-add">+${working.lines.additions}</span> <span class="ov-del">−${working.lines.deletions}</span></span>`
      : '';
    return `
      <section class="ov-card">
        <div class="ov-card-head">
          <span class="ov-card-title">Uncommitted changes</span>${lines}
        </div>
        <div class="ov-working">${WorkingCounters.render(working, true)}${stashes}</div>
        <div class="ov-actions">
          <button class="ov-button" data-action="source-control" title="Stage and commit in Source Control">${Icons.render('check', 13)}Commit</button>
          <button class="ov-button" data-action="stash" title="Stash all changes, untracked files too">${Icons.render('archive', 13)}Stash</button>
          <button class="ov-button" data-action="graph" title="See them in the commit graph">${Icons.render('graph', 13)}Review</button>
        </div>
      </section>`;
  }

  private renderBase(state: OverviewState): string {
    const { base } = state;
    if (!base || !state.branch || state.branch === base.name) {
      return '';
    }

    const total = Math.max(1, base.onlyHere + base.onlyThere);
    const bar = (count: number, kind: string) => `<span class="ov-bar ov-bar-${kind}" style="flex:${count / total}"></span>`;
    const behind = base.onlyThere > 0;
    return `
      <section class="ov-card">
        <div class="ov-card-head">
          <span class="ov-card-title">Against ${Format.escapeHtml(base.ref)}</span>
        </div>
        <div class="ov-versus">
          <span class="ov-versus-side" title="Commits of ${Format.escapeHtml(state.branch)} that ${Format.escapeHtml(base.ref)} does not have">
            <strong>${base.onlyHere}</strong> ahead</span>
          <span class="ov-bars">${bar(base.onlyHere, 'here')}${bar(base.onlyThere, 'there')}</span>
          <span class="ov-versus-side" title="Commits ${Format.escapeHtml(base.ref)} gained since ${Format.escapeHtml(state.branch)} branched off">
            <strong>${base.onlyThere}</strong> behind</span>
        </div>
        <div class="ov-actions">
          <button class="ov-button" data-action="update-base" data-how="rebase" title="Replay the branch on top of ${Format.escapeHtml(base.ref)}"${behind ? '' : ' disabled'}>${Icons.render('branch', 13)}Rebase</button>
          <button class="ov-button" data-action="update-base" data-how="merge" title="Merge ${Format.escapeHtml(base.ref)} into the branch"${behind ? '' : ' disabled'}>${Icons.render('merge', 13)}Merge in</button>
          <button class="ov-button" data-action="compare-branches" title="Compare the files with ${Format.escapeHtml(base.ref)}">${Icons.render('compare', 13)}Compare</button>
        </div>
      </section>`;
  }

  private renderBranches(state: OverviewState): string {
    const query = this.filter.trim().toLowerCase();
    const matching = query ? state.branches.filter((branch) => branch.name.toLowerCase().includes(query)) : state.branches;
    const folded = !query && !this.showAll && matching.length > FOLDED_BRANCHES;
    const shown = folded ? matching.slice(0, FOLDED_BRANCHES) : matching;
    const merged = state.branches.filter((branch) => branch.merged).length;

    const rows = shown.map((branch) => this.renderBranch(branch, query)).join('');
    const filter =
      state.branches.length >= FILTER_FROM
        ? `<input class="ov-filter" type="text" placeholder="Filter branches…" value="${Format.escapeHtml(this.filter)}" spellcheck="false">`
        : '';
    const more = folded
      ? `<button class="ov-link" data-action="show-all">Show all ${matching.length} branches</button>`
      : !query && this.showAll && matching.length > FOLDED_BRANCHES
        ? '<button class="ov-link" data-action="show-fewer">Show fewer</button>'
        : '';
    const cleanup =
      merged > 0 && state.base
        ? `<button class="ov-link ov-cleanup" data-action="delete-merged" title="Delete the local branches already merged into ${Format.escapeHtml(state.base.ref)}">${Icons.render('trash', 12)}Delete ${merged} merged</button>`
        : '';

    return `
      <section class="ov-section">
        <div class="ov-section-head">
          <span class="ov-section-title">Branches</span><span class="ov-badge">${state.branches.length}</span>
          ${OverviewApp.renderIconButton('create-branch', 'plus', 'New branch from here')}
        </div>
        ${filter}
        <div class="ov-list">${rows || '<div class="ov-muted ov-none">No branch matches.</div>'}</div>
        ${more || cleanup ? `<div class="ov-list-foot">${more}${cleanup}</div>` : ''}
      </section>`;
  }

  private renderBranch(branch: OverviewBranch, query: string): string {
    const icon: IconName = branch.isCurrent ? 'check' : branch.merged ? 'merge' : 'branch';
    const chips: string[] = [];
    if (branch.ahead) {
      chips.push(`<span class="ov-chip ov-chip-ahead" title="${branch.ahead} to push">↑${branch.ahead}</span>`);
    }
    if (branch.behind) {
      chips.push(`<span class="ov-chip ov-chip-behind" title="${branch.behind} to pull">↓${branch.behind}</span>`);
    }
    if (branch.upstreamGone) {
      chips.push('<span class="ov-chip ov-chip-gone" title="Its upstream branch was deleted">gone</span>');
    } else if (!branch.upstream) {
      chips.push('<span class="ov-chip" title="Not on any remote">local</span>');
    }
    if (branch.merged) {
      chips.push('<span class="ov-chip ov-chip-merged" title="All its commits are in the default branch">merged</span>');
    }

    const actions = branch.isCurrent
      ? ''
      : BRANCH_ACTIONS.map(
          (item) =>
            `<button class="ov-row-action${item.action === 'delete' ? ' danger' : ''}" data-action="branch" data-branch-action="${item.action}" title="${item.title}">${Icons.render(item.icon, 13)}</button>`,
        ).join('');
    const name = Format.highlight(branch.name, query);
    const title = `${branch.name}\n${branch.subject}\n${this.dates.formatFull(branch.date)}`;
    return `
      <div class="ov-row${branch.isCurrent ? ' current' : ''}${branch.merged ? ' merged' : ''}" data-action="branch" data-branch-action="show" data-branch="${Format.escapeHtml(branch.name)}" title="${Format.escapeHtml(title)}">
        <span class="ov-row-icon">${Icons.render(icon, 13)}</span>
        <span class="ov-row-name">${name}</span>
        ${chips.join('')}
        <span class="ov-row-age">${Format.escapeHtml(this.dates.formatCompact(branch.date))}</span>
        <span class="ov-row-actions">${actions}</span>
      </div>`;
  }

  private renderCommits(state: OverviewState): string {
    if (state.commits.length === 0) {
      return '';
    }
    const rows = state.commits
      .map((commit) => {
        const picture = state.avatars[commit.email];
        const avatar = `<span class="ov-avatar" style="background:${AvatarStyle.getColor(commit.email)}">${AvatarStyle.renderArt(commit.email)}${picture ? `<img src="${picture}" alt="">` : ''}</span>`;
        const title = `${commit.subject}\n${commit.author}, ${this.dates.formatFull(commit.date)}`;
        return `
          <div class="ov-row ov-commit" data-action="commit" data-hash="${commit.hash}" title="${Format.escapeHtml(title)}">
            ${avatar}
            <span class="ov-row-name">${Format.escapeHtml(commit.subject)}</span>
            <span class="ov-row-age">${Format.escapeHtml(this.dates.formatCompact(commit.date))}</span>
          </div>`;
      })
      .join('');
    return `
      <section class="ov-section">
        <div class="ov-section-head">
          <span class="ov-section-title">Latest commits</span>
          <button class="ov-link" data-action="graph">All in the graph ${Icons.render('chevron', 11)}</button>
        </div>
        <div class="ov-list">${rows}</div>
      </section>`;
  }

  private static renderIconButton(action: string, icon: IconName, title: string): string {
    return `<button class="ov-icon-button" data-action="${action}" title="${title}">${Icons.render(icon, 14)}</button>`;
  }

  private onClick(event: MouseEvent): void {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target || (target as HTMLButtonElement).disabled) {
      return;
    }

    const post = (message: OverviewWebviewMessage) => this.api.postMessage(message);
    switch (target.dataset.action) {
      case 'switch':
        post({ type: 'switchRepository' });
        return;
      case 'insights':
        post({ type: 'openInsights' });
        return;
      case 'compare-branches':
        post({ type: 'compareBranches' });
        return;
      case 'settings':
        post({ type: 'openSettings' });
        return;
      case 'graph':
        post({ type: 'openGraph' });
        return;
      case 'remote':
        post({ type: 'remote', action: target.dataset.remote as RemoteAction });
        return;
      case 'source-control':
        post({ type: 'openSourceControl' });
        return;
      case 'stash':
        post({ type: 'stash' });
        return;
      case 'update-base':
        post({ type: 'updateFromBase', how: target.dataset.how as 'rebase' | 'merge' });
        return;
      case 'create-branch':
        post({ type: 'createBranch' });
        return;
      case 'delete-merged':
        post({ type: 'deleteMerged' });
        return;
      case 'commit':
        post({ type: 'openGraph', hash: target.dataset.hash });
        return;
      case 'branch': {
        const row = target.closest<HTMLElement>('[data-branch]');
        if (row) {
          post({ type: 'branchAction', action: target.dataset.branchAction as BranchAction, name: row.dataset.branch! });
        }
        return;
      }
      case 'show-all':
        this.showAll = true;
        break;
      case 'show-fewer':
        this.showAll = false;
        break;
    }
    this.save();
    this.render();
  }

  private onInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.classList.contains('ov-filter')) {
      this.filter = input.value;
      this.save();
      this.render();
    }
  }
}

new OverviewApp(document.getElementById('app')!);
