import type {
  ChangedFile,
  CommitAction,
  CommitDetails,
  CommitInfo,
  ComparisonDetails,
  RefInfo,
  WorkingDetails,
  WorkingSummary,
} from '../src/protocol';
import type { DateFormatter } from '../src/shared/DateFormatter';
import { AvatarStyle } from '../src/shared/AvatarStyle';
import { FileIcons } from './FileIcons';
import { FileTree, TreeNode } from './FileTree';
import { Format } from './Format';
import { IconName, Icons } from './Icons';
import { HostBridge } from './HostBridge';
import { RefBadges } from './RefBadges';
import { WorkingCounters } from './WorkingCounters';

interface FileEntry {
  file: ChangedFile;
  staged: boolean;
}

interface DetailsHandlers {
  onSelectCommit(hash: string): void;
  onCommitAction(action: CommitAction, hash: string): void;
}

type Shown =
  | { kind: 'none' }
  | { kind: 'commit'; details: CommitDetails }
  | { kind: 'working'; details: WorkingDetails }
  | { kind: 'comparison'; details: ComparisonDetails };

const COMMIT_ACTIONS: { action: CommitAction; icon: IconName; label: string; title: string }[] = [
  { action: 'checkout', icon: 'check', label: 'Checkout', title: 'Check out this commit' },
  { action: 'createBranch', icon: 'branch', label: 'Branch', title: 'Create a branch here' },
  { action: 'createTag', icon: 'tag', label: 'Tag', title: 'Tag this commit' },
  { action: 'cherryPick', icon: 'cherry', label: 'Cherry-pick', title: 'Cherry-pick onto the current branch' },
  { action: 'revert', icon: 'undo', label: 'Revert', title: 'Revert this commit' },
];

// A long message folds to this many lines, so the changed files stay in view.
const BODY_CLAMP_LINES = 9;

const STATUS_NAMES: Record<string, string> = {
  A: 'Added',
  M: 'Modified',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  T: 'Type changed',
  U: 'Conflict',
  '?': 'Untracked',
};

export class DetailsPanel {
  private shown: Shown = { kind: 'none' };
  private entries: FileEntry[] = [];
  private filterText = '';
  private fileView: 'list' | 'tree' = HostBridge.readViewState().fileView ?? 'list';
  private readonly collapsedFolders = new Set<string>();

  constructor(
    private readonly element: HTMLElement,
    private readonly handlers: DetailsHandlers,
  ) {
    element.addEventListener('click', (event) => this.onClick(event));
    element.addEventListener('input', (event) => {
      const input = event.target as HTMLInputElement;
      if (input.classList.contains('files-filter')) {
        this.filterText = input.value;
        this.renderFiles();
      }
    });
    this.showMessage('Select a commit to see its changes.');
  }

  get shownKey(): string | null {
    if (this.shown.kind === 'commit') {
      return this.shown.details.hash;
    }
    if (this.shown.kind === 'comparison') {
      return `${this.shown.details.base}..${this.shown.details.target}`;
    }
    return this.shown.kind === 'working' ? 'WORKING' : null;
  }

  showMessage(text: string): void {
    this.shown = { kind: 'none' };
    this.element.innerHTML = `<div class="details-empty">${Icons.render('rings', 40)}<p>${Format.escapeHtml(text)}</p></div>`;
  }

  showLoading(): void {
    this.element.classList.add('details-loading');
  }

  showCommit(
    details: CommitDetails,
    refs: RefInfo[],
    headBranch: string | null,
    laneColor: string,
    dates: DateFormatter,
    avatar: string | undefined,
    incomingFrom: string | null,
  ): void {
    this.element.classList.remove('details-loading');
    const keepFilter = this.shown.kind === 'commit';
    this.shown = { kind: 'commit', details };
    this.entries = details.files.map((file) => ({ file, staged: false }));
    if (!keepFilter) {
      this.filterText = '';
    }

    const [subject, ...bodyLines] = details.message.split('\n');
    const body = bodyLines.join('\n').trim();
    const counts = DetailsPanel.countStatuses(details.files);
    const committedBySomeoneElse = details.committer !== details.author;
    const parents = details.parents
      .map(
        (parent) =>
          `<a class="link mono" data-action="select" data-hash="${parent}" title="Show parent ${parent}">${parent.slice(0, 7)}</a>`,
      )
      .join(' ');
    const badges = RefBadges.renderAll(refs, headBranch, laneColor);

    if (!keepFilter || this.shown.details.hash !== details.hash) {
      this.collapsedFolders.clear();
    }

    this.element.innerHTML = `
      <div class="details-scroll">
        <div class="details-header">
        <div class="details-author">
          <span class="avatar avatar-large" style="background:${AvatarStyle.getColor(details.email)}">${AvatarStyle.renderArt(details.email)}${avatar ? `<img class="avatar-image" src="${avatar}" alt="">` : ''}</span>
          <div class="details-author-text">
            <div class="details-author-name" title="${Format.escapeHtml(details.email)}">${Format.escapeHtml(details.author)}</div>
            <div class="details-muted">
              ${Format.escapeHtml(dates.formatAgo(details.authorDate))} · ${Format.escapeHtml(dates.formatFull(details.authorDate))}
            </div>
            ${committedBySomeoneElse ? `<div class="details-muted">committed by ${Format.escapeHtml(details.committer)}, ${Format.escapeHtml(dates.formatAgoOrDate(details.commitDate))}</div>` : ''}
          </div>
        </div>
        <div class="details-meta">
          <button class="chip mono" data-action="copy" data-text="${details.hash}" title="Copy full SHA">
            ${Icons.render('copy', 12)}${details.hash.slice(0, 7)}
          </button>
          ${badges ? `<span class="details-badges">${badges}</span>` : ''}
          <span class="details-counts">
            <span class="count-added" title="Files added">+${counts.added}</span>
            <span class="count-modified" title="Files modified">~${counts.modified}</span>
            <span class="count-deleted" title="Files deleted">−${counts.deleted}</span>
          </span>
        </div>
        ${parents ? `<div class="details-parents details-muted">${details.parents.length > 1 ? 'Parents' : 'Parent'}: ${parents}</div>` : ''}
        <div class="details-actions">${DetailsPanel.renderCommitActions()}</div>
        </div>
        <div class="details-message">
          <div class="details-subject">${Format.escapeHtml(subject)}
            <button class="icon-button" data-action="copy" data-text="${Format.escapeHtml(details.message)}" title="Copy message">${Icons.render('copy', 12)}</button>
          </div>
          ${body ? `<pre class="details-body${body.split('\n').length > BODY_CLAMP_LINES ? ' clamped' : ''}">${Format.escapeHtml(body)}</pre>` : ''}
          ${body.split('\n').length > BODY_CLAMP_LINES ? '<button class="link details-more" data-action="toggle-body">Show more</button>' : ''}
        </div>
        ${details.parents.length > 1 ? '<div class="details-note">Merge commit: changes are shown against the first parent.</div>' : ''}
        ${incomingFrom ? `<div class="details-note details-incoming">↓ This commit is on ${Format.escapeHtml(incomingFrom)} and not pulled yet.</div>` : ''}
        <div class="files-section">
          <div class="files-header">
            <span>Files changed</span><span class="files-count">${details.files.length}</span>
            <span class="files-lines">${DetailsPanel.renderLineTotals(details.files)}</span>
            ${this.renderViewSwitch()}
          </div>
          <input class="files-filter" type="text" placeholder="Filter files…" value="${Format.escapeHtml(this.filterText)}" spellcheck="false">
          <div class="files-list"></div>
        </div>
      </div>`;
    this.renderFiles();
  }

  showComparison(details: ComparisonDetails, base: CommitInfo | undefined, target: CommitInfo | undefined): void {
    this.element.classList.remove('details-loading');
    const keepFilter = this.shown.kind === 'comparison';
    this.shown = { kind: 'comparison', details };
    this.entries = details.files.map((file) => ({ file, staged: false }));
    if (!keepFilter) {
      this.filterText = '';
    }

    const describe = (hash: string, commit: CommitInfo | undefined) =>
      `<div class="compare-side">
        <a class="link mono" data-action="select" data-hash="${hash}">${hash.slice(0, 7)}</a>
        <span class="compare-subject">${Format.escapeHtml(commit?.subject ?? '')}</span>
      </div>`;

    this.element.innerHTML = `
      <div class="details-scroll">
        <div class="details-working-title">${Icons.render('compare', 16)} Comparing two commits</div>
        <div class="details-muted">What changed from the older commit to the newer one. Cmd/Ctrl+click another commit to change the pair; click one commit to leave.</div>
        <div class="compare-pair">
          ${describe(details.base, base)}
          <div class="compare-arrow">↓</div>
          ${describe(details.target, target)}
        </div>
        <div class="files-section">
          <div class="files-header">
            <span>Files changed</span><span class="files-count">${details.files.length}</span>
            <span class="files-lines">${DetailsPanel.renderLineTotals(details.files)}</span>
            ${this.renderViewSwitch()}
          </div>
          <input class="files-filter" type="text" placeholder="Filter files…" value="${Format.escapeHtml(this.filterText)}" spellcheck="false">
          <div class="files-list"></div>
        </div>
      </div>`;
    this.renderFiles();
  }

  showWorking(details: WorkingDetails, summary: WorkingSummary): void {
    this.element.classList.remove('details-loading');
    const keepFilter = this.shown.kind === 'working';
    this.shown = { kind: 'working', details };
    this.entries = [
      ...details.staged.map((file) => ({ file, staged: true })),
      ...details.unstaged.map((file) => ({ file, staged: false })),
    ];
    if (!keepFilter) {
      this.filterText = '';
    }

    this.element.innerHTML = `
      <div class="details-scroll">
        <div class="details-working-title">${Icons.render('file', 16)} Working Changes</div>
        <div class="details-meta">
          ${WorkingCounters.render(summary, true)}
          ${summary.lines ? `<span class="details-counts">${DetailsPanel.renderLineCounts(summary.lines.additions, summary.lines.deletions)}</span>` : ''}
        </div>
        <div class="details-muted details-working-note">Uncommitted changes in the working tree. Stage and commit them from Source Control.</div>
        <div class="files-section">
          <div class="files-header"><span>Files</span><span class="files-count">${this.entries.length}</span>${this.renderViewSwitch()}</div>
          <input class="files-filter" type="text" placeholder="Filter files…" value="${Format.escapeHtml(this.filterText)}" spellcheck="false">
          <div class="files-list"></div>
        </div>
      </div>`;
    this.renderFiles();
  }

  private renderViewSwitch(): string {
    const button = (view: 'list' | 'tree', title: string) =>
      `<button class="icon-button view-switch${this.fileView === view ? ' active' : ''}" data-action="view-${view}" title="${title}">${Icons.render(view, 13)}</button>`;
    return `<span class="files-view">${button('list', 'Show as a list')}${button('tree', 'Show as folders')}</span>`;
  }

  private renderFiles(): void {
    const list = this.element.querySelector<HTMLElement>('.files-list');
    if (!list) {
      return;
    }

    const filter = this.filterText.trim().toLowerCase();
    const matches = (entry: FileEntry) => !filter || entry.file.path.toLowerCase().includes(filter);

    if (this.shown.kind !== 'working') {
      list.innerHTML = this.renderFileRows(matches) || '<div class="details-muted files-none">No files match.</div>';
      return;
    }

    const sections = [
      { title: 'Staged', staged: true },
      { title: 'Unstaged', staged: false },
    ];
    list.innerHTML = sections
      .map(({ title, staged }) => {
        const total = this.entries.filter((entry) => entry.staged === staged).length;
        const rows = this.renderFileRows((entry) => entry.staged === staged && matches(entry), title);
        return (
          `<div class="files-subheader"><span>${title}</span><span class="files-count">${total}</span></div>` +
          (rows || `<div class="details-muted files-none">${total === 0 ? 'Nothing here.' : 'No files match.'}</div>`)
        );
      })
      .join('');
  }

  private renderFileRows(include: (entry: FileEntry) => boolean, group = ''): string {
    const included = this.entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => include(entry));

    if (this.fileView === 'tree' && !this.filterText.trim()) {
      const tree = FileTree.build(included.map(({ entry, index }) => ({ path: entry.file.path, index })));
      return this.renderTree(tree, 0, group);
    }
    return included.map(({ index }) => this.renderFileRow(index, 0, true)).join('');
  }

  private renderTree(nodes: TreeNode[], depth: number, group: string): string {
    let html = '';
    for (const node of nodes) {
      if (node.kind === 'file') {
        html += this.renderFileRow(node.index, depth, false);
        continue;
      }
      const key = `${group}/${node.path}`;
      const open = !this.collapsedFolders.has(key);
      html +=
        `<div class="folder-row" data-action="toggle-folder" data-folder="${Format.escapeHtml(key)}" style="--depth:${depth}" title="${Format.escapeHtml(node.path)}">` +
        `<span class="folder-chevron${open ? ' open' : ''}">${Icons.render('chevron', 12)}</span>${FileIcons.renderFolder(open)}` +
        `<span class="folder-name">${Format.escapeHtml(node.name)}</span><span class="folder-count">${node.fileCount}</span></div>`;
      if (open) {
        html += this.renderTree(node.children, depth + 1, group);
      }
    }
    return html;
  }

  private renderFileRow(index: number, depth: number, withFolder: boolean): string {
    const { file } = this.entries[index];
    const { name, folder } = Format.splitPath(file.path);
    const renamedFrom = file.oldPath ? `${file.oldPath} → ` : '';
    const lines = file.binary
      ? '<span class="details-muted">binary</span>'
      : DetailsPanel.renderLineCounts(file.additions, file.deletions);
    const atRevision =
      (this.shown.kind === 'commit' || this.shown.kind === 'comparison') && file.status !== 'D'
        ? `<button class="icon-button" data-action="open-revision" data-index="${index}" title="Open the file as of this commit">${Icons.render('history', 13)}</button>`
        : '';

    return `
      <div class="file-row" data-action="diff" data-index="${index}" style="--depth:${depth}" title="${Format.escapeHtml(renamedFrom + file.path)}">
        ${FileIcons.render(file.path)}
        <span class="file-name">${Format.escapeHtml(name)}</span>
        <span class="file-folder">${withFolder ? Format.escapeHtml(folder) : ''}</span>
        <span class="file-lines">${lines}</span>
        <span class="file-actions">
          ${atRevision}
          <button class="icon-button" data-action="open-file" data-index="${index}" title="Open the working file">${Icons.render('file', 13)}</button>
        </span>
        <span class="file-status status-${file.status === '?' ? 'untracked' : file.status}" title="${STATUS_NAMES[file.status]}">${file.status === '?' ? 'U' : file.status}</span>
      </div>`;
  }

  private static renderCommitActions(): string {
    return COMMIT_ACTIONS.map(
      (item) =>
        `<button class="details-action" data-action="commit-action" data-commit-action="${item.action}" title="${item.title}">${Icons.render(item.icon, 13)}${item.label}</button>`,
    ).join('');
  }

  private onClick(event: MouseEvent): void {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target) {
      return;
    }

    const action = target.dataset.action;
    if (action === 'copy') {
      HostBridge.post({ type: 'copy', text: target.dataset.text ?? '' });
      return;
    }
    if (action === 'commit-action' && this.shown.kind === 'commit') {
      this.handlers.onCommitAction(target.dataset.commitAction as CommitAction, this.shown.details.hash);
      return;
    }
    if (action === 'select') {
      this.handlers.onSelectCommit(target.dataset.hash!);
      return;
    }
    if (action === 'toggle-body') {
      const body = this.element.querySelector('.details-body');
      const clamped = body?.classList.toggle('clamped') ?? false;
      target.textContent = clamped ? 'Show more' : 'Show less';
      return;
    }
    if (action === 'view-list' || action === 'view-tree') {
      this.fileView = action === 'view-list' ? 'list' : 'tree';
      HostBridge.saveViewState({ fileView: this.fileView });
      for (const button of this.element.querySelectorAll<HTMLElement>('.view-switch')) {
        button.classList.toggle('active', button.dataset.action === action);
      }
      this.renderFiles();
      return;
    }
    if (action === 'toggle-folder') {
      const folder = target.dataset.folder!;
      if (this.collapsedFolders.has(folder)) {
        this.collapsedFolders.delete(folder);
      } else {
        this.collapsedFolders.add(folder);
      }
      this.renderFiles();
      return;
    }

    const entry = this.entries[Number(target.dataset.index)];
    if (!entry) {
      return;
    }
    event.stopPropagation();

    if (action === 'open-file') {
      HostBridge.post({ type: 'openFile', path: entry.file.path, ref: null });
      return;
    }
    if (action === 'open-revision' && this.shown.kind === 'commit') {
      HostBridge.post({ type: 'openFile', path: entry.file.path, ref: this.shown.details.hash });
      return;
    }
    if (action === 'open-revision' && this.shown.kind === 'comparison') {
      HostBridge.post({ type: 'openFile', path: entry.file.path, ref: this.shown.details.target });
      return;
    }
    if (action === 'diff') {
      this.markActiveFile(target);
      this.openDiff(entry);
    }
  }

  private openDiff(entry: FileEntry): void {
    if (this.shown.kind === 'comparison') {
      const { details } = this.shown;
      HostBridge.post({ type: 'openCommitDiff', hash: details.target, parent: details.base, file: entry.file });
      return;
    }
    if (this.shown.kind === 'commit') {
      const { details } = this.shown;
      HostBridge.post({ type: 'openCommitDiff', hash: details.hash, parent: details.parents[0] ?? null, file: entry.file });
      return;
    }
    HostBridge.post({ type: 'openWorkingDiff', file: entry.file, staged: entry.staged });
  }

  private markActiveFile(row: HTMLElement): void {
    this.element.querySelector('.file-row.active')?.classList.remove('active');
    row.classList.add('active');
  }

  private static countStatuses(files: ChangedFile[]): { added: number; modified: number; deleted: number } {
    const counts = { added: 0, modified: 0, deleted: 0 };
    for (const file of files) {
      if (file.status === 'A' || file.status === 'C') {
        counts.added++;
      } else if (file.status === 'D') {
        counts.deleted++;
      } else {
        counts.modified++;
      }
    }
    return counts;
  }

  private static renderLineTotals(files: ChangedFile[]): string {
    let additions = 0;
    let deletions = 0;
    for (const file of files) {
      additions += file.additions ?? 0;
      deletions += file.deletions ?? 0;
    }
    return DetailsPanel.renderLineCounts(additions, deletions);
  }

  private static renderLineCounts(additions: number | undefined, deletions: number | undefined): string {
    if (additions === undefined && deletions === undefined) {
      return '';
    }
    return `<span class="lines-added">+${additions ?? 0}</span> <span class="lines-deleted">−${deletions ?? 0}</span>`;
  }
}
