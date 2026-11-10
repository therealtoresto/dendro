import * as path from 'node:path';
import * as vscode from 'vscode';
import type { AutoFetcher } from './AutoFetcher';
import type { AvatarService } from './AvatarService';
import type { API, Repository } from './git/git';
import { CommitOrder, GitService } from './git/GitService';
import { RemoteUrl } from './git/RemoteUrl';
import { FileChange, WorkingChangeCounter } from './git/WorkingChangeCounter';
import type {
  ChangedFile,
  CommitHoverInfo,
  CommitInfo,
  CommitStats,
  GraphState,
  HeadInfo,
  HostMessage,
  WorkingSummary,
  RefInfo,
  RemoteSummary,
  WebviewMessage,
} from './protocol';
import { RepoActions } from './RepoActions';
import { RevisionContentProvider } from './RevisionContentProvider';
import { Settings } from './Settings';
import { WebviewHtml } from './WebviewHtml';

const EMPTY_HEAD: HeadInfo = { branch: null, hash: null, upstream: null, ahead: 0, behind: 0 };
const MAX_PAGES_PER_SEARCH_JUMP = 100;
const STATE_DEBOUNCE_MS = 400;
const STATS_CHUNK_SIZE = 250;

// The settings that change which commits the list holds; any other setting only changes how they are drawn.
const COMMIT_SETTINGS = [
  'graph.showBranches',
  'graph.showRemoteBranches',
  'graph.showTags',
  'graph.order',
  'graph.avatars',
];

// Settings that change which avatar pictures exist; when they change, every author is looked up again.
const AVATAR_SETTINGS = ['graph.avatars', 'avatars.pictures', 'avatars.sources', 'avatars.fallback'];
const HOVER_CACHE_SIZE = 200;
const AVATAR_FLUSH_MS = 120;
const MAX_INCOMING = 2000;

export interface MenuContext {
  webview?: string;
  hash?: string;
  refName?: string;
  refKind?: RefInfo['kind'];
}

export type CommitAction = 'copySha' | 'copyMessage' | 'checkout' | 'createBranch' | 'cherryPick' | 'revert' | 'reset';

export interface GraphServices {
  avatars: AvatarService;
  autoFetcher: AutoFetcher;
}

export interface GraphHost {
  readonly viewId: string;
  readonly webview: vscode.Webview;
  setTitle(title: string): void;
  reveal(): void;
}

export class GraphController {
  private static readonly controllers = new Set<GraphController>();
  private static lastUsed: GraphController | undefined;

  private repo: Repository | undefined;
  private git: GitService | undefined;
  private actions: RepoActions | undefined;
  private head: HeadInfo = EMPTY_HEAD;
  private refs: RefInfo[] = [];
  private commitsByHash = new Map<string, CommitInfo>();
  private statsByHash = new Map<string, CommitStats>();
  private loadedCount = 0;
  private hasMore = false;
  private graphSignature = '';
  private refsSignature = '';
  private ready = false;
  private sentAvatars = new Set<string>();
  private unsentAvatars: Record<string, string> = {};
  private avatarTimer: NodeJS.Timeout | undefined;
  private avatarSignature = '';
  private readonly hoverInfos = new Map<string, CommitHoverInfo>();
  private readonly remoteSummaries = new Map<string, Promise<RemoteSummary | null>>();
  private autoFetching = false;
  private pendingReveal: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private stateTimer: NodeJS.Timeout | undefined;
  private repoListeners: vscode.Disposable[] = [];
  private readonly disposables: vscode.Disposable[] = [];

  static findByViewId(viewId: string | undefined): GraphController | undefined {
    for (const controller of GraphController.controllers) {
      if (controller.host.viewId === viewId) {
        return controller;
      }
    }
    return GraphController.lastUsed;
  }

  static get latest(): GraphController | undefined {
    return GraphController.lastUsed;
  }

  constructor(
    private readonly host: GraphHost,
    private readonly context: vscode.ExtensionContext,
    private readonly api: API,
    private readonly services: GraphServices,
  ) {
    GraphController.controllers.add(this);
    GraphController.lastUsed = this;

    host.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
    };
    host.webview.html = WebviewHtml.build(host.webview, context.extensionUri, 'webview', 'Commit Graph');

    this.disposables.push(
      host.webview.onDidReceiveMessage((message: WebviewMessage) => this.handleMessage(message)),
      api.onDidOpenRepository(() => this.onRepositoriesChanged()),
      api.onDidCloseRepository(() => this.onRepositoriesChanged()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('dendro')) {
          this.scheduleRefresh(false);
        }
      }),
      services.autoFetcher.onDidChangeActivity((activity) => {
        if (activity.root !== this.git?.root || this.actions?.busyAction) {
          return;
        }
        this.autoFetching = activity.running;
        this.post({ type: 'busy', action: activity.running ? 'fetch' : null, automatic: true });
      }),
    );

    this.selectRepository(this.findInitialRepository());
  }

  dispose(): void {
    GraphController.controllers.delete(this);
    if (GraphController.lastUsed === this) {
      GraphController.lastUsed = Array.from(GraphController.controllers).pop();
    }
    clearTimeout(this.stateTimer);
    clearTimeout(this.avatarTimer);
    this.disposeRepoListeners();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  refresh(): void {
    this.scheduleRefresh(true);
  }

  // A commit from another repository first switches the graph to it; the commit is shown once its list is loaded.
  revealCommit(hash: string, root?: string): void {
    this.host.reveal();
    const repo = root ? this.api.repositories.find((candidate) => candidate.rootUri.fsPath === root) : undefined;
    if (repo && repo !== this.repo) {
      this.pendingReveal = hash;
      this.selectRepository(repo);
      return;
    }
    if (!this.ready || this.loadedCount === 0) {
      this.pendingReveal = hash;
      return;
    }
    this.post({ type: 'reveal', hash });
  }

  async runCommitAction(action: CommitAction, context: MenuContext): Promise<void> {
    const commit = context.hash ? this.commitsByHash.get(context.hash) : undefined;
    if (!commit || !this.actions || !this.git) {
      return;
    }

    const target = { hash: commit.hash, subject: commit.subject, parentCount: commit.parents.length };
    switch (action) {
      case 'copySha':
        await vscode.env.clipboard.writeText(commit.hash);
        break;
      case 'copyMessage': {
        const details = await this.git.getCommitDetails(commit.hash);
        await vscode.env.clipboard.writeText(details.message);
        break;
      }
      case 'checkout':
        await this.actions.checkoutCommit(target);
        break;
      case 'createBranch':
        await this.actions.createBranch(target);
        break;
      case 'cherryPick':
        await this.actions.cherryPick(target);
        break;
      case 'revert':
        await this.actions.revert(target);
        break;
      case 'reset':
        await this.actions.reset(target, this.head.branch);
        break;
    }
  }

  async runRefAction(action: 'checkout' | 'copyName', context: MenuContext): Promise<void> {
    const ref = this.refs.find((candidate) => candidate.name === context.refName && candidate.kind === context.refKind);
    if (!ref) {
      return;
    }

    if (action === 'copyName') {
      await vscode.env.clipboard.writeText(ref.name);
      return;
    }
    await this.actions?.checkoutRef(ref);
  }

  private disposeRepoListeners(): void {
    for (const listener of this.repoListeners) {
      listener.dispose();
    }
    this.repoListeners = [];
  }

  private findInitialRepository(): Repository | undefined {
    const repositories = this.api.repositories;
    const savedRoot = this.context.workspaceState.get<string>('dendro.repoRoot');
    const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;

    if (activeFile) {
      const owner = repositories
        .filter((repo) => activeFile.startsWith(repo.rootUri.fsPath + path.sep))
        .sort((left, right) => right.rootUri.fsPath.length - left.rootUri.fsPath.length)[0];
      if (owner) {
        return owner;
      }
    }

    return repositories.find((repo) => repo.rootUri.fsPath === savedRoot) ?? repositories[0];
  }

  private onRepositoriesChanged(): void {
    const stillOpen = this.repo && this.api.repositories.includes(this.repo);
    if (!stillOpen) {
      this.selectRepository(this.findInitialRepository());
      return;
    }
    this.scheduleRefresh(false);
  }

  private selectRepository(repo: Repository | undefined): void {
    this.disposeRepoListeners();
    this.repo = repo;
    this.head = EMPTY_HEAD;
    this.refs = [];
    this.commitsByHash.clear();
    this.statsByHash.clear();
    this.loadedCount = 0;
    this.hasMore = false;
    this.graphSignature = '';
    this.refsSignature = '';

    if (!repo) {
      this.git = undefined;
      this.actions = undefined;
      this.host.setTitle('Commit Graph');
      this.postState(null);
      this.post({ type: 'refs', refs: [] });
      this.post({ type: 'commits', commits: [], append: false, hasMore: false });
      return;
    }

    const root = repo.rootUri.fsPath;
    void this.context.workspaceState.update('dendro.repoRoot', root);
    this.host.setTitle(`Graph · ${path.basename(root)}`);
    this.git = new GitService(this.api.git.path, root);
    this.actions = new RepoActions(
      repo,
      this.git,
      (action) => this.post({ type: 'busy', action }),
      () => this.scheduleRefresh(false),
      (action, ok, message) => this.post({ type: 'remoteResult', action, ok, message }),
    );
    this.repoListeners.push(repo.state.onDidChange(() => this.scheduleRefresh(false)));
    this.scheduleRefresh(true);
  }

  private scheduleRefresh(reloadCommits: boolean): void {
    clearTimeout(this.stateTimer);
    if (reloadCommits) {
      this.graphSignature = '';
      this.refsSignature = '';
    }
    this.stateTimer = setTimeout(
      () => {
        this.enqueue(() => this.refreshState()).catch((error) => this.reportError(error));
      },
      reloadCommits ? 0 : STATE_DEBOUNCE_MS,
    );
  }

  // Git reads run one at a time, so a page load never interleaves with a reload of the same list.
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  // The commit list is reloaded only when HEAD, a ref or a commit setting changed; file edits and other settings
  // refresh only the toolbar, the Working Changes row and the drawing.
  private async refreshState(): Promise<void> {
    const git = this.git;
    if (!git) {
      return;
    }

    const [head, refs] = await Promise.all([git.getHead(), git.getRefs()]);
    if (git !== this.git) {
      return;
    }
    this.head = head;
    this.refs = refs;
    const [lastFetch, working, incoming, remote] = await Promise.all([
      git.getLastFetchTime(),
      this.summarizeWorkingChanges(git),
      head.behind > 0 ? git.getIncomingHashes(MAX_INCOMING).catch(() => []) : Promise.resolve([]),
      this.getRemoteSummary(git, head.upstream),
    ]);
    this.postState(lastFetch, working, incoming, remote);

    // A repository can carry thousands of tags; they cross to the webview only when one of them moved.
    const refsSignature = refs.map((ref) => `${ref.kind}${ref.name}${ref.hash}${ref.ahead ?? ''}${ref.behind ?? ''}`).join('\n');
    if (refsSignature !== this.refsSignature) {
      this.refsSignature = refsSignature;
      this.post({ type: 'refs', refs });
    }

    const commitSettings = [...COMMIT_SETTINGS, ...AVATAR_SETTINGS].map((key) => Settings.get(key));
    const signature = JSON.stringify([commitSettings, head.hash, head.branch, refsSignature]);
    if (signature !== this.graphSignature) {
      this.graphSignature = signature;
      await this.loadCommits(false);
    }
  }

  private postState(
    lastFetch: number | null,
    working: WorkingSummary = this.summarizeWorkingFiles(),
    incoming: string[] = [],
    remote: RemoteSummary | null = null,
  ): void {
    const state: GraphState = {
      repos: this.api.repositories.map((repo) => ({
        root: repo.rootUri.fsPath,
        name: path.basename(repo.rootUri.fsPath),
      })),
      root: this.repo?.rootUri.fsPath ?? null,
      head: this.head,
      working,
      incoming,
      remote,
      lastFetch,
      settings: Settings.readAll(),
      locale: Settings.getEditorLocale(),
    };
    this.post({ type: 'state', state });
    const manual = this.actions?.busyAction ?? null;
    this.post({ type: 'busy', action: manual ?? (this.autoFetching ? 'fetch' : null), automatic: !manual && this.autoFetching });
  }

  // The remote the current branch tracks (or "origin"), named for the toolbar: "origin on GitLab".
  private getRemoteSummary(git: GitService, upstream: string | null): Promise<RemoteSummary | null> {
    const name = upstream ? upstream.split('/')[0] : 'origin';
    const key = `${git.root}\n${name}`;
    let summary = this.remoteSummaries.get(key);
    if (!summary) {
      summary = git
        .run(['remote', 'get-url', name])
        .then((url) => {
          const remote = RemoteUrl.parse(url.trim());
          return remote ? { name, host: remote.host, kind: remote.kind } : null;
        })
        .catch(() => null);
      this.remoteSummaries.set(key, summary);
    }
    return summary;
  }

  private summarizeWorkingFiles(): WorkingSummary {
    const state = this.repo?.state;
    const toFileChanges = (changes: { uri: vscode.Uri; status: number }[] | undefined): FileChange[] =>
      (changes ?? []).map((change) => ({ path: change.uri.fsPath, status: change.status }));

    return WorkingChangeCounter.count({
      merge: toFileChanges(state?.mergeChanges),
      index: toFileChanges(state?.indexChanges),
      workingTree: toFileChanges(state?.workingTreeChanges),
      untracked: toFileChanges(state?.untrackedChanges),
    });
  }

  // Line counts need a diff, so they are read only while there is something uncommitted.
  private async summarizeWorkingChanges(git: GitService): Promise<WorkingSummary> {
    const summary = this.summarizeWorkingFiles();
    if (summary.total > 0 && this.head.hash) {
      summary.lines = await git.getWorkingLineStats().catch(() => undefined);
    }
    return summary;
  }

  private async getRevisions(git: GitService): Promise<string[]> {
    const head = this.head.hash ? ['HEAD'] : [];
    const mode = Settings.get<string>('graph.showBranches');

    // The upstream belongs to the current branch too: its commits not pulled yet show up beside HEAD.
    if (mode === 'current') {
      return this.head.upstream && head.length > 0 ? [...head, `refs/remotes/${this.head.upstream}`] : head;
    }

    if (mode === 'smart') {
      const revisions = new Set(head);
      if (this.head.upstream) {
        revisions.add(`refs/remotes/${this.head.upstream}`);
      }
      const defaultBranch = await git.getDefaultBranch();
      for (const ref of this.refs) {
        const isDefaultLocal = ref.kind === 'head' && ref.name === defaultBranch;
        const isDefaultRemote = ref.kind === 'remote' && ref.name === `${ref.remote}/${defaultBranch}`;
        if (isDefaultLocal) {
          revisions.add(`refs/heads/${ref.name}`);
        } else if (isDefaultRemote) {
          revisions.add(`refs/remotes/${ref.name}`);
        }
      }
      return Array.from(revisions);
    }

    const revisions = ['--branches'];
    if (Settings.get<boolean>('graph.showRemoteBranches')) {
      revisions.push('--remotes');
    }
    if (Settings.get<boolean>('graph.showTags')) {
      revisions.push('--tags');
    }
    return [...revisions, ...head];
  }

  private async loadCommits(append: boolean): Promise<CommitInfo[]> {
    const git = this.git;
    if (!git) {
      return [];
    }

    const firstPage = Settings.get<number>('graph.initialRows');
    const nextPage = Settings.get<number>('graph.pageRows');
    const skip = append ? this.loadedCount : 0;
    const count = append ? nextPage : Math.max(firstPage, this.loadedCount);

    this.post({ type: 'loading', value: true });
    try {
      const revisions = await this.getRevisions(git);
      const order = Settings.get<CommitOrder>('graph.order');
      const page = await git.getCommits({ skip, count, revisions, order });
      if (git !== this.git) {
        return [];
      }

      if (!append) {
        this.commitsByHash.clear();
      }
      for (const commit of page.commits) {
        this.commitsByHash.set(commit.hash, commit);
      }
      this.loadedCount = skip + page.commits.length;
      this.hasMore = page.hasMore;
      this.post({ type: 'commits', commits: page.commits, append, hasMore: page.hasMore });
      if (!append && this.pendingReveal && this.ready) {
        this.post({ type: 'reveal', hash: this.pendingReveal });
        this.pendingReveal = null;
      }
      this.requestAvatars(git.root, page.commits);
      this.postCachedStats(page.commits);
      void this.enqueue(() => this.loadStats(git, page.commits)).catch((error) => this.reportError(error));

      return page.commits;
    } finally {
      this.post({ type: 'loading', value: false });
    }
  }

  // Each author's picture crosses to the webview once, as a data URI, in batches as the downloads finish.
  private requestAvatars(root: string, commits: CommitInfo[]): void {
    const signature = JSON.stringify(AVATAR_SETTINGS.map((key) => Settings.get(key)));
    if (signature !== this.avatarSignature) {
      const isFirst = this.avatarSignature === '';
      this.avatarSignature = signature;
      this.sentAvatars.clear();
      if (!isFirst) {
        this.post({ type: 'avatars', avatars: {}, reset: true });
      }
    }
    if (!Settings.get<boolean>('graph.avatars') || !this.services.avatars.enabled) {
      return;
    }

    for (const commit of commits) {
      const email = commit.email.trim().toLowerCase();
      if (this.sentAvatars.has(email)) {
        continue;
      }
      this.sentAvatars.add(email);
      void this.services.avatars.request(email, root, commit.hash).then((image) => {
        if (image) {
          this.unsentAvatars[email] = image.dataUri;
          this.scheduleAvatarFlush();
        }
      });
    }
  }

  private scheduleAvatarFlush(): void {
    if (this.avatarTimer) {
      return;
    }
    this.avatarTimer = setTimeout(() => {
      this.avatarTimer = undefined;
      this.post({ type: 'avatars', avatars: this.unsentAvatars });
      this.unsentAvatars = {};
    }, AVATAR_FLUSH_MS);
  }

  private async showHoverInfo(hash: string): Promise<void> {
    if (!this.git) {
      return;
    }
    let info = this.hoverInfos.get(hash);
    if (!info) {
      const details = await this.git.getCommitDetails(hash);
      info = { hash, message: details.message, files: details.files.length, added: 0, modified: 0, deleted: 0 };
      for (const file of details.files) {
        if (file.status === 'A' || file.status === 'C') {
          info.added++;
        } else if (file.status === 'D') {
          info.deleted++;
        } else {
          info.modified++;
        }
      }
      if (this.hoverInfos.size >= HOVER_CACHE_SIZE) {
        this.hoverInfos.delete(this.hoverInfos.keys().next().value!);
      }
      this.hoverInfos.set(hash, info);
    }
    this.post({ type: 'hoverInfo', info });
  }

  private postCachedStats(commits: CommitInfo[]): void {
    const stats: Record<string, CommitStats> = {};
    for (const commit of commits) {
      const cached = this.statsByHash.get(commit.hash);
      if (cached) {
        stats[commit.hash] = cached;
      }
    }
    if (Object.keys(stats).length > 0) {
      this.post({ type: 'commitStats', stats });
    }
  }

  // Line counts take a diff per commit, so they follow the page instead of holding it back; a commit never changes,
  // so each one is counted once.
  private async loadStats(git: GitService, commits: CommitInfo[]): Promise<void> {
    const missing = commits.map((commit) => commit.hash).filter((hash) => !this.statsByHash.has(hash));

    for (let start = 0; start < missing.length; start += STATS_CHUNK_SIZE) {
      if (git !== this.git) {
        return;
      }
      const chunk = await git.getCommitStats(missing.slice(start, start + STATS_CHUNK_SIZE));
      const stats: Record<string, CommitStats> = {};
      for (const [hash, value] of chunk) {
        this.statsByHash.set(hash, value);
        stats[hash] = value;
      }
      this.post({ type: 'commitStats', stats });
    }
  }

  private async loadUntil(hashes: string[]): Promise<void> {
    const wanted = new Set(hashes);
    let found = hashes.some((hash) => this.commitsByHash.has(hash));
    let pages = 0;

    while (!found && this.hasMore && pages < MAX_PAGES_PER_SEARCH_JUMP) {
      const commits = await this.loadCommits(true);
      found = commits.some((commit) => wanted.has(commit.hash));
      pages++;
    }

    this.post({ type: 'loadUntilDone', found });
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    GraphController.lastUsed = this;
    try {
      await this.dispatchMessage(message);
    } catch (error) {
      this.reportError(error);
    }
  }

  private async dispatchMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.ready = true;
        this.sentAvatars.clear();
        this.scheduleRefresh(true);
        return;
      case 'hoverCommit':
        await this.showHoverInfo(message.hash);
        return;
      case 'refresh':
        await this.repo?.status().catch(() => undefined);
        this.scheduleRefresh(true);
        return;
      case 'loadMore':
        if (this.hasMore) {
          await this.enqueue(() => this.loadCommits(true));
        }
        return;
      case 'loadUntil':
        await this.enqueue(() => this.loadUntil(message.hashes));
        return;
      case 'updateSetting':
        await Settings.update(message.key, message.value);
        return;
      case 'openSettings':
        await vscode.commands.executeCommand('dendro.showSettings', message.section ?? 'graph');
        return;
      case 'pickRepo':
        await this.pickRepository();
        return;
      case 'pickBranch':
        await this.pickBranch();
        return;
      case 'showCommit':
        await this.showCommit(message.hash);
        return;
      case 'showWorkingChanges':
        await this.showWorkingChanges();
        return;
      case 'showComparison':
        await this.showComparison(message.base, message.target);
        return;
      case 'openCommitDiff':
        await this.openCommitDiff(message.hash, message.parent, message.file);
        return;
      case 'openWorkingDiff':
        await this.openWorkingDiff(message.file, message.staged);
        return;
      case 'openFile':
        await this.openFile(message.path, message.ref);
        return;
      case 'remote':
        await this.actions?.runRemote(message.action);
        return;
      case 'checkoutRef':
        await this.actions?.checkoutRef(message.ref);
        return;
      case 'search':
        await this.search(message.query);
        return;
      case 'copy':
        await vscode.env.clipboard.writeText(message.text);
        vscode.window.setStatusBarMessage('$(check) Dendro: copied', 2000);
        return;
    }
  }

  private async pickRepository(): Promise<void> {
    const items = this.api.repositories.map((repo) => ({
      label: path.basename(repo.rootUri.fsPath),
      description: repo.rootUri.fsPath,
      repo,
    }));
    const picked = await vscode.window.showQuickPick(items, { title: 'Show the graph of' });
    if (picked && picked.repo !== this.repo) {
      this.selectRepository(picked.repo);
    }
  }

  private async pickBranch(): Promise<void> {
    const locals = this.refs.filter((ref) => ref.kind === 'head');
    const remotes = this.refs.filter((ref) => ref.kind === 'remote');
    const toItem = (ref: RefInfo) => ({
      label: `${ref.kind === 'head' ? '$(git-branch)' : '$(cloud)'} ${ref.name}`,
      description: ref.name === this.head.branch ? 'current' : RepoActions.shortHash(ref.hash),
      detail: this.commitsByHash.get(ref.hash)?.subject,
      ref,
    });
    const items: (vscode.QuickPickItem & { ref?: RefInfo })[] = [
      { label: 'Local branches', kind: vscode.QuickPickItemKind.Separator },
      ...locals.map(toItem),
      { label: 'Remote branches', kind: vscode.QuickPickItemKind.Separator },
      ...remotes.map(toItem),
    ];

    const picked = await vscode.window.showQuickPick(items, {
      title: 'Checkout branch',
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (picked?.ref && picked.ref.name !== this.head.branch) {
      await this.actions?.checkoutRef(picked.ref);
    }
  }

  private async showCommit(hash: string): Promise<void> {
    if (!this.git) {
      return;
    }
    const details = await this.git.getCommitDetails(hash);
    this.post({ type: 'commitDetails', details });
  }

  private async showWorkingChanges(): Promise<void> {
    if (!this.git) {
      return;
    }
    const details = await this.git.getWorkingDetails();
    this.post({ type: 'workingDetails', details });
  }

  private async showComparison(base: string, target: string): Promise<void> {
    if (!this.git) {
      return;
    }
    const files = await this.git.getComparisonFiles(base, target);
    this.post({ type: 'comparisonDetails', details: { base, target, files } });
  }

  private async search(query: string): Promise<void> {
    const git = this.git;
    if (!git) {
      return;
    }
    const trimmed = query.trim();
    const hashes = trimmed
      ? await git.searchCommits(trimmed, await this.getRevisions(git), Settings.get<number>('graph.searchLimit'))
      : [];
    this.post({ type: 'searchResult', query, hashes });
  }

  private async openCommitDiff(hash: string, parent: string | null, file: ChangedFile): Promise<void> {
    if (!this.git) {
      return;
    }
    if (file.binary) {
      void vscode.window.showInformationMessage(`Dendro: ${path.basename(file.path)} is a binary file; no text diff.`);
      return;
    }

    const root = this.git.root;
    const left = RevisionContentProvider.buildUri(root, file.oldPath ?? file.path, file.status === 'A' ? null : parent);
    const right = RevisionContentProvider.buildUri(root, file.path, file.status === 'D' ? null : hash);
    const leftLabel = parent ? RepoActions.shortHash(parent) : 'root';
    await this.openDiff(left, right, `${path.basename(file.path)} (${leftLabel} ↔ ${RepoActions.shortHash(hash)})`);
  }

  private async openWorkingDiff(file: ChangedFile, staged: boolean): Promise<void> {
    if (!this.git) {
      return;
    }

    const root = this.git.root;
    const workingUri = vscode.Uri.file(path.join(root, file.path));
    if (file.status === '?' || file.status === 'U') {
      await vscode.commands.executeCommand('vscode.open', workingUri, { viewColumn: GraphController.getDiffColumn() });
      return;
    }
    if (file.binary) {
      void vscode.window.showInformationMessage(`Dendro: ${path.basename(file.path)} is a binary file; no text diff.`);
      return;
    }

    const name = path.basename(file.path);
    if (staged) {
      const left = RevisionContentProvider.buildUri(root, file.oldPath ?? file.path, file.status === 'A' ? null : 'HEAD');
      const right = RevisionContentProvider.buildUri(root, file.path, file.status === 'D' ? null : '');
      await this.openDiff(left, right, `${name} (HEAD ↔ Index)`);
      return;
    }

    const left = RevisionContentProvider.buildUri(root, file.path, '');
    const right = file.status === 'D' ? RevisionContentProvider.buildUri(root, file.path, null) : workingUri;
    await this.openDiff(left, right, `${name} (Index ↔ Working Tree)`);
  }

  private async openFile(filePath: string, ref: string | null): Promise<void> {
    if (!this.git) {
      return;
    }

    if (ref) {
      const uri = RevisionContentProvider.buildUri(this.git.root, filePath, ref);
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document, { viewColumn: GraphController.getDiffColumn(), preview: true });
      return;
    }

    const uri = vscode.Uri.file(path.join(this.git.root, filePath));
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      void vscode.window.showWarningMessage(`Dendro: ${filePath} does not exist in the working tree.`);
      return;
    }
    await vscode.commands.executeCommand('vscode.open', uri, { viewColumn: GraphController.getDiffColumn() });
  }

  private async openDiff(left: vscode.Uri, right: vscode.Uri, title: string): Promise<void> {
    await vscode.commands.executeCommand('vscode.diff', left, right, title, {
      viewColumn: GraphController.getDiffColumn(),
      preview: true,
      preserveFocus: true,
    });
  }

  private static getDiffColumn(): vscode.ViewColumn {
    return Settings.get<string>('graph.diffLocation') === 'active' ? vscode.ViewColumn.Active : vscode.ViewColumn.Beside;
  }

  private reportError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.post({ type: 'error', message });
  }

  private post(message: HostMessage): void {
    void this.host.webview.postMessage(message);
  }
}
