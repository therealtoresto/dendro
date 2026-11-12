import * as path from 'node:path';
import * as vscode from 'vscode';
import type { BlameService } from '../blame/BlameService';
import { BlameText } from '../blame/BlameText';
import { CommitDiffs } from '../CommitDiffs';
import type { API, Repository } from '../git/git';
import type { BranchSummary, Contributor, HistoryEntry, RemoteEntry, TagSummary } from '../git/GitOutputParser';
import type { GitService } from '../git/GitService';
import type { ChangedFile, RefInfo, StashInfo, WorktreeInfo } from '../protocol';
import { RepoActions } from '../RepoActions';

// The branch others are measured against: the remote one when there is one, since the local copy can be old.
interface BaseBranch {
  ref: string;
  name: string;
}

type RepoNode =
  | { kind: 'branch'; root: string; branch: BranchSummary; base: BaseBranch | null; merged: boolean }
  | { kind: 'commitGroup'; root: string; label: string; icon: string; commits: HistoryEntry[]; total: number }
  | { kind: 'commit'; root: string; commit: HistoryEntry }
  | { kind: 'remote'; root: string; remote: RemoteEntry }
  | { kind: 'remoteBranch'; root: string; remote: string; branch: BranchSummary }
  | { kind: 'tag'; root: string; tag: TagSummary }
  | { kind: 'stash'; root: string; stash: StashInfo }
  | { kind: 'stashFile'; root: string; stash: StashInfo; file: ChangedFile }
  | { kind: 'worktree'; root: string; worktree: WorktreeInfo }
  | { kind: 'contributor'; root: string; contributor: Contributor }
  | { kind: 'note'; text: string };

type ViewId = 'branches' | 'remotes' | 'tags' | 'stashes' | 'worktrees' | 'contributors';

const REFRESH_DELAY_MS = 500;
const MAX_TAGS = 300;
const GROUP_COMMITS = 50;

// One tree per part of the repository; each reads the repository of the active editor (or the first one).
class RepoTree implements vscode.TreeDataProvider<RepoNode> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  view: vscode.TreeView<RepoNode> | undefined;

  constructor(
    private readonly views: RepositoryViews,
    private readonly id: ViewId,
  ) {}

  refresh(): void {
    this.changeEmitter.fire();
  }

  getChildren(node?: RepoNode): Promise<RepoNode[]> {
    return this.views.loadChildren(this.id, node);
  }

  getTreeItem(node: RepoNode): Promise<vscode.TreeItem> {
    return this.views.buildItem(node);
  }
}

export class RepositoryViews implements vscode.Disposable {
  private readonly trees = new Map<ViewId, RepoTree>();
  private readonly disposables: vscode.Disposable[] = [];
  private refreshTimer: NodeJS.Timeout | undefined;
  private repoListeners: vscode.Disposable[] = [];
  // The repository the views show: the one of the last file opened, or the one picked by hand. A webview or an
  // output panel in front keeps it, so the views do not jump to some other repository (a submodule) meanwhile.
  private chosenRoot: string | undefined;

  constructor(
    private readonly api: API,
    private readonly blame: BlameService,
  ) {
    for (const id of ['branches', 'remotes', 'tags', 'stashes', 'worktrees', 'contributors'] as ViewId[]) {
      const tree = new RepoTree(this, id);
      tree.view = vscode.window.createTreeView(`dendro.${id}`, { treeDataProvider: tree, showCollapseAll: id === 'remotes' });
      this.trees.set(id, tree);
      this.disposables.push(tree.view);
    }

    this.watchRepositories();
    this.disposables.push(
      api.onDidOpenRepository(() => this.watchRepositories()),
      api.onDidCloseRepository(() => this.watchRepositories()),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.followEditor(editor);
        this.scheduleRefresh();
      }),
      blame.avatars.onDidResolve(() => this.trees.get('contributors')?.refresh()),
      ...this.registerCommands(),
    );
  }

  dispose(): void {
    clearTimeout(this.refreshTimer);
    for (const disposable of [...this.disposables, ...this.repoListeners]) {
      disposable.dispose();
    }
  }

  private watchRepositories(): void {
    for (const listener of this.repoListeners) {
      listener.dispose();
    }
    this.repoListeners = this.api.repositories.map((repo) => repo.state.onDidChange(() => this.scheduleRefresh()));
    void vscode.commands.executeCommand('setContext', 'dendro.multipleRepositories', this.api.repositories.length > 1);
    this.scheduleRefresh();
  }

  private scheduleRefresh(): void {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      const repo = this.findRepository();
      for (const tree of this.trees.values()) {
        if (tree.view) {
          tree.view.description = repo ? path.basename(repo.rootUri.fsPath) : undefined;
        }
        tree.refresh();
      }
    }, REFRESH_DELAY_MS);
  }

  private followEditor(editor: vscode.TextEditor | undefined): void {
    const root = editor ? this.blame.findRoot(editor.document.uri) : undefined;
    if (root && this.api.repositories.some((repo) => repo.rootUri.fsPath === root)) {
      this.chosenRoot = root;
    }
  }

  private findRepository(): Repository | undefined {
    if (!this.chosenRoot) {
      this.followEditor(vscode.window.activeTextEditor);
    }
    const repos = this.api.repositories;
    const folders = vscode.workspace.workspaceFolders ?? [];
    return (
      repos.find((repo) => repo.rootUri.fsPath === this.chosenRoot) ??
      repos.find((repo) => folders.some((folder) => folder.uri.fsPath === repo.rootUri.fsPath)) ??
      repos[0]
    );
  }

  private async switchRepository(): Promise<void> {
    const current = this.findRepository();
    const items = this.api.repositories.map((repo) => ({
      label: path.basename(repo.rootUri.fsPath),
      description: repo.state.HEAD?.name ?? 'detached HEAD',
      detail: repo.rootUri.fsPath,
      root: repo.rootUri.fsPath,
      picked: repo === current,
    }));
    const picked = await vscode.window.showQuickPick(items, { title: 'Show which repository?' });
    if (picked) {
      this.chosenRoot = picked.root;
      this.scheduleRefresh();
    }
  }

  private static async findBase(git: GitService): Promise<BaseBranch | null> {
    const name = await git.getDefaultBranch();
    if (!name) {
      return null;
    }
    const remote = `origin/${name}`;
    return { ref: (await git.resolveCommit(remote)) ? remote : name, name };
  }

  // What a branch holds apart from the rest: commits to push and to pull, the ones the base branch lacks and the
  // ones it gained since. Each group lists the newest commits, so a long-lived branch still opens fast.
  private async loadBranchGroups(git: GitService, node: Extract<RepoNode, { kind: 'branch' }>): Promise<RepoNode[]> {
    const { root, branch, base } = node;
    const groups: RepoNode[] = [];

    if (branch.upstream && !branch.upstreamGone && (branch.ahead || branch.behind)) {
      const sides = await git.getSideCommits(branch.name, branch.upstream, GROUP_COMMITS).catch(() => null);
      if (sides && branch.ahead) {
        groups.push({ kind: 'commitGroup', root, label: `${branch.ahead} to push`, icon: 'arrow-up', commits: sides.onlyLeft, total: branch.ahead });
      }
      if (sides && branch.behind) {
        groups.push({ kind: 'commitGroup', root, label: `${branch.behind} to pull`, icon: 'arrow-down', commits: sides.onlyRight, total: branch.behind });
      }
    }

    const isBase = base?.name === branch.name;
    if (base && !isBase) {
      const [counts, sides] = await Promise.all([
        git.countSideCommits(base.ref, branch.name).catch(() => null),
        git.getSideCommits(base.ref, branch.name, GROUP_COMMITS).catch(() => null),
      ]);
      if (counts && sides && counts.onlyRight) {
        groups.push({
          kind: 'commitGroup',
          root,
          label: `${counts.onlyRight} not in ${base.name}`,
          icon: 'git-commit',
          commits: sides.onlyRight,
          total: counts.onlyRight,
        });
      }
      if (counts && sides && counts.onlyLeft) {
        groups.push({
          kind: 'commitGroup',
          root,
          label: `${counts.onlyLeft} new in ${base.ref}`,
          icon: 'git-pull-request',
          commits: sides.onlyLeft,
          total: counts.onlyLeft,
        });
      }
    }

    if (groups.length > 0) {
      return groups;
    }
    if (isBase || !base) {
      return [{ kind: 'note', text: branch.upstream ? `In step with ${branch.upstream}.` : 'No upstream to compare with.' }];
    }
    return [{ kind: 'note', text: `The same commits as ${base.ref}.` }];
  }

  private createActions(root: string): { git: GitService; actions: RepoActions; repo: Repository } | undefined {
    const repo = this.api.repositories.find((candidate) => candidate.rootUri.fsPath === root);
    if (!repo) {
      return undefined;
    }
    const git = this.blame.createGit(root);
    const actions = new RepoActions(repo, git, () => undefined, () => this.scheduleRefresh(), () => undefined);
    return { git, actions, repo };
  }

  async loadChildren(id: ViewId, node?: RepoNode): Promise<RepoNode[]> {
    const repo = this.findRepository();
    if (!repo) {
      return [{ kind: 'note', text: 'No git repository is open.' }];
    }
    const root = repo.rootUri.fsPath;
    const git = this.blame.createGit(root);

    if (node?.kind === 'remote') {
      const branches = await git.getRemoteBranches(node.remote.name).catch(() => []);
      return branches.map((branch) => ({ kind: 'remoteBranch', root, remote: node.remote.name, branch }));
    }
    if (node?.kind === 'branch') {
      return this.loadBranchGroups(git, node);
    }
    if (node?.kind === 'commitGroup') {
      const commits: RepoNode[] = node.commits.map((commit) => ({ kind: 'commit', root: node.root, commit }));
      if (node.total > node.commits.length) {
        commits.push({ kind: 'note', text: `…and ${(node.total - node.commits.length).toLocaleString()} older` });
      }
      return commits;
    }
    if (node?.kind === 'stash') {
      const details = await git.getCommitDetails(node.stash.hash).catch(() => null);
      return (details?.files ?? []).map((file) => ({ kind: 'stashFile', root, stash: node.stash, file }));
    }
    if (node) {
      return [];
    }

    let nodes: RepoNode[] = [];
    switch (id) {
      case 'branches': {
        const [branches, base] = await Promise.all([git.getBranches().catch(() => []), RepositoryViews.findBase(git)]);
        const merged = base ? await git.getMergedBranches(base.ref) : new Set<string>();
        const current = branches.filter((branch) => branch.isCurrent);
        nodes = [...current, ...branches.filter((branch) => !branch.isCurrent)].map((branch) => ({
          kind: 'branch',
          root,
          branch,
          base,
          merged: !branch.isCurrent && branch.name !== base?.name && merged.has(branch.name),
        }));
        break;
      }
      case 'remotes':
        nodes = (await git.getRemotes().catch(() => [])).map((remote) => ({ kind: 'remote', root, remote }));
        break;
      case 'tags': {
        // CI can leave thousands of tags; the newest ones are the ones anybody looks for.
        const tags = await git.getTags().catch(() => []);
        nodes = tags.slice(0, MAX_TAGS).map((tag) => ({ kind: 'tag', root, tag }));
        if (tags.length > MAX_TAGS) {
          nodes.push({ kind: 'note', text: `…and ${(tags.length - MAX_TAGS).toLocaleString()} older tags` });
        }
        break;
      }
      case 'stashes':
        nodes = (await git.getStashes()).map((stash) => ({ kind: 'stash', root, stash }));
        break;
      case 'worktrees':
        nodes = (await git.getWorktrees()).map((worktree) => ({ kind: 'worktree', root, worktree }));
        break;
      case 'contributors':
        nodes = (await git.getContributors()).map((contributor) => ({ kind: 'contributor', root, contributor }));
        break;
    }
    return nodes.length > 0 ? nodes : [{ kind: 'note', text: RepositoryViews.describeEmpty(id) }];
  }

  async buildItem(node: RepoNode): Promise<vscode.TreeItem> {
    const dates = BlameText.createDateFormatter();
    const None = vscode.TreeItemCollapsibleState.None;

    switch (node.kind) {
      case 'note':
        return new vscode.TreeItem(node.text, None);

      case 'branch': {
        const { branch } = node;
        const item = new vscode.TreeItem(branch.name, vscode.TreeItemCollapsibleState.Collapsed);
        const sync = [branch.ahead ? `↑${branch.ahead}` : '', branch.behind ? `↓${branch.behind}` : ''].filter(Boolean).join(' ');
        const upstream = branch.upstreamGone ? 'upstream gone' : branch.upstream ? sync || '✓' : 'local only';
        const merged = node.merged && node.base ? `merged into ${node.base.name} · ` : '';
        item.description = `${merged}${upstream} · ${dates.formatAgoOrDate(branch.date)}`;
        item.iconPath = new vscode.ThemeIcon(branch.isCurrent ? 'check' : node.merged ? 'git-merge' : 'git-branch');
        item.contextValue = branch.isCurrent ? 'dendro.branch.current' : 'dendro.branch';
        item.tooltip = RepositoryViews.buildTooltip(branch.name, branch.subject, dates.formatFull(branch.date), branch.upstream);
        item.command = { title: 'Show in graph', command: 'dendro.repo.showInGraph', arguments: [node] };
        return item;
      }

      case 'commitGroup': {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
        item.iconPath = new vscode.ThemeIcon(node.icon);
        return item;
      }

      case 'commit': {
        const { commit } = node;
        const item = new vscode.TreeItem(commit.subject, None);
        item.description = `${commit.author} · ${dates.formatAgoOrDate(commit.date)}`;
        item.iconPath = new vscode.ThemeIcon('git-commit');
        item.contextValue = 'dendro.commit';
        item.tooltip = RepositoryViews.buildTooltip(commit.hash.slice(0, 7), commit.subject, `${commit.author}, ${dates.formatFull(commit.date)}`);
        item.command = { title: 'Show in graph', command: 'dendro.showCommit', arguments: [commit.hash, node.root] };
        return item;
      }

      case 'remote': {
        const item = new vscode.TreeItem(node.remote.name, vscode.TreeItemCollapsibleState.Collapsed);
        item.description = node.remote.url;
        item.iconPath = new vscode.ThemeIcon('cloud');
        item.contextValue = 'dendro.remote';
        return item;
      }

      case 'remoteBranch': {
        const { branch } = node;
        const item = new vscode.TreeItem(branch.name.slice(node.remote.length + 1), None);
        item.description = dates.formatAgoOrDate(branch.date);
        item.iconPath = new vscode.ThemeIcon('git-branch');
        item.contextValue = 'dendro.remoteBranch';
        item.tooltip = RepositoryViews.buildTooltip(branch.name, branch.subject, dates.formatFull(branch.date));
        item.command = { title: 'Show in graph', command: 'dendro.repo.showInGraph', arguments: [node] };
        return item;
      }

      case 'tag': {
        const { tag } = node;
        const item = new vscode.TreeItem(tag.name, None);
        item.description = dates.formatAgoOrDate(tag.date);
        item.iconPath = new vscode.ThemeIcon('tag');
        item.contextValue = 'dendro.tag';
        item.tooltip = RepositoryViews.buildTooltip(tag.name, tag.subject, dates.formatFull(tag.date));
        item.command = { title: 'Show in graph', command: 'dendro.repo.showInGraph', arguments: [node] };
        return item;
      }

      case 'stash': {
        const { stash } = node;
        const item = new vscode.TreeItem(stash.message, vscode.TreeItemCollapsibleState.Collapsed);
        item.description = `${stash.ref} · ${dates.formatAgoOrDate(stash.date)}`;
        item.iconPath = new vscode.ThemeIcon('archive');
        item.contextValue = 'dendro.stash';
        return item;
      }

      case 'stashFile': {
        const { file } = node;
        const item = new vscode.TreeItem(path.basename(file.path), None);
        item.description = path.dirname(file.path) === '.' ? '' : path.dirname(file.path);
        item.resourceUri = vscode.Uri.file(path.join(node.root, file.path));
        item.contextValue = 'dendro.stashFile';
        item.command = { title: 'Open changes', command: 'dendro.repo.openStashFile', arguments: [node] };
        return item;
      }

      case 'worktree': {
        const { worktree } = node;
        const item = new vscode.TreeItem(path.basename(worktree.path), None);
        item.description = `${worktree.branch ?? `detached at ${worktree.hash.slice(0, 7)}`}${worktree.isCurrent ? ' · this window' : ''}`;
        item.iconPath = new vscode.ThemeIcon(worktree.isCurrent ? 'folder-active' : 'folder');
        item.tooltip = worktree.path;
        item.contextValue = worktree.isCurrent ? 'dendro.worktree.current' : 'dendro.worktree';
        return item;
      }

      case 'contributor': {
        const { contributor } = node;
        const userEmail = await this.blame.getUserEmail(node.root);
        const item = new vscode.TreeItem(contributor.email === userEmail ? `${contributor.name} (you)` : contributor.name, None);
        item.description = `${contributor.commits.toLocaleString()} ${contributor.commits === 1 ? 'commit' : 'commits'}`;
        item.tooltip = contributor.email;
        item.contextValue = 'dendro.contributor';
        item.command = { title: 'Find their commits', command: 'dendro.repo.searchAuthor', arguments: [node] };
        const picture = this.blame.avatars.enabled ? this.blame.avatars.peek(contributor.email) : null;
        if (picture === undefined) {
          void this.blame.avatars.request(contributor.email, node.root);
        }
        item.iconPath = picture?.file ?? new vscode.ThemeIcon('person');
        return item;
      }
    }
  }

  private registerCommands(): vscode.Disposable[] {
    const register = (command: string, run: (node: RepoNode) => Promise<unknown> | unknown) =>
      vscode.commands.registerCommand(command, (node: RepoNode) => run(node));

    return [
      vscode.commands.registerCommand('dendro.repo.refresh', () => this.scheduleRefresh()),
      register('dendro.repo.showInGraph', (node) => {
        const target = RepositoryViews.readTarget(node);
        return target && vscode.commands.executeCommand('dendro.showCommit', target.hash, 'root' in node ? node.root : undefined);
      }),
      register('dendro.repo.checkout', (node) => this.withActions(node, (tools, ref) => tools.actions.checkoutRef(ref))),
      register('dendro.repo.merge', (node) =>
        this.withActions(node, (tools, ref) => tools.actions.mergeIntoCurrent(ref.name, tools.repo.state.HEAD?.name ?? null)),
      ),
      register('dendro.repo.rebase', (node) =>
        this.withActions(node, (tools, ref) => tools.actions.rebaseCurrentOnto(ref.name, ref.name, tools.repo.state.HEAD?.name ?? null)),
      ),
      register('dendro.repo.rename', (node) => this.withActions(node, (tools, ref) => tools.actions.renameBranch(ref))),
      register('dendro.repo.compare', (node) =>
        this.withActions(node, async (tools, ref) => {
          await vscode.commands.executeCommand('dendro.compareRefs', tools.repo.rootUri.fsPath, tools.repo.state.HEAD?.name ?? 'HEAD', ref.name);
        }),
      ),
      register('dendro.repo.delete', (node) => this.withActions(node, (tools, ref) => tools.actions.deleteRef(ref))),
      register('dendro.repo.push', (node) => this.withActions(node, (tools, ref) => tools.actions.pushBranch(ref))),
      register('dendro.repo.fetchRemote', async (node) => {
        if (node.kind === 'remote') {
          const repo = this.api.repositories.find((candidate) => candidate.rootUri.fsPath === node.root);
          await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Dendro: fetching ${node.remote.name}…` },
            () => repo?.fetch({ remote: node.remote.name, prune: true }) ?? Promise.resolve(),
          );
        }
      }),
      register('dendro.repo.stashApply', (node) => this.runStash(node, 'apply')),
      register('dendro.repo.stashPop', (node) => this.runStash(node, 'pop')),
      register('dendro.repo.stashDrop', (node) => this.runStash(node, 'drop')),
      register('dendro.repo.openStashFile', (node) => {
        if (node.kind === 'stashFile') {
          return CommitDiffs.openFileChange(this.blame.createGit(node.root), node.stash.hash, node.file.path, node.file.oldPath);
        }
        return undefined;
      }),
      register('dendro.repo.openWorktree', (node) => {
        if (node.kind === 'worktree') {
          return vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(node.worktree.path), { forceNewWindow: true });
        }
        return undefined;
      }),
      register('dendro.repo.removeWorktree', async (node) => {
        if (node.kind !== 'worktree') {
          return;
        }
        const choice = await vscode.window.showWarningMessage(
          `Remove the worktree at ${node.worktree.path}?`,
          { modal: true, detail: 'Its folder is deleted; the branch and its commits stay.' },
          'Remove',
        );
        if (choice === 'Remove') {
          await this.runGit(node.root, ['worktree', 'remove', node.worktree.path], 'Removed the worktree');
        }
      }),
      register('dendro.repo.searchAuthor', (node) =>
        node.kind === 'contributor' ? vscode.commands.executeCommand('dendro.searchGraph', node.contributor.name) : undefined,
      ),
      vscode.commands.registerCommand('dendro.repo.createBranch', () => this.createBranch()),
      vscode.commands.registerCommand('dendro.repo.switchRepository', () => this.switchRepository()),
      vscode.commands.registerCommand('dendro.repo.addWorktree', () => this.addWorktree()),
      vscode.commands.registerCommand('dendro.repo.stashSave', () => this.saveStash()),
    ];
  }

  // The ref a node stands for, in the shape the graph's actions take.
  private static readRef(node: RepoNode): RefInfo | undefined {
    switch (node.kind) {
      case 'branch':
        return { name: node.branch.name, kind: 'head', hash: node.branch.hash, upstream: node.branch.upstream };
      case 'remoteBranch':
        return { name: node.branch.name, kind: 'remote', hash: node.branch.hash, remote: node.remote };
      case 'tag':
        return { name: node.tag.name, kind: 'tag', hash: node.tag.hash };
      default:
        return undefined;
    }
  }

  private static readTarget(node: RepoNode): { hash: string } | undefined {
    if (node.kind === 'stash') {
      return { hash: node.stash.hash };
    }
    return RepositoryViews.readRef(node);
  }

  private async withActions(
    node: RepoNode,
    run: (tools: { actions: RepoActions; repo: Repository }, ref: RefInfo) => Promise<void>,
  ): Promise<void> {
    const ref = RepositoryViews.readRef(node);
    const tools = 'root' in node ? this.createActions(node.root) : undefined;
    if (ref && tools) {
      await run(tools, ref);
      this.scheduleRefresh();
    }
  }

  private async runStash(node: RepoNode, action: 'apply' | 'pop' | 'drop'): Promise<void> {
    const tools = node.kind === 'stash' ? this.createActions(node.root) : undefined;
    if (node.kind === 'stash' && tools) {
      await tools.actions.runStash(action, node.stash.ref, node.stash.message);
      this.scheduleRefresh();
    }
  }

  private async runGit(root: string, args: string[], done: string): Promise<boolean> {
    try {
      await this.blame.createGit(root).run(args);
      vscode.window.setStatusBarMessage(`$(check) Dendro: ${done}`, 3000);
      return true;
    } catch (error) {
      void vscode.window.showErrorMessage(`Dendro: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    } finally {
      this.scheduleRefresh();
    }
  }

  private async createBranch(): Promise<void> {
    const repo = this.findRepository();
    if (!repo) {
      return;
    }
    const git = this.blame.createGit(repo.rootUri.fsPath);
    const name = await vscode.window.showInputBox({
      title: 'New branch from HEAD',
      placeHolder: 'Branch name',
      validateInput: async (value) => (value.trim() && (await git.isValidBranchName(value.trim())) ? null : 'Not a valid branch name'),
    });
    if (name) {
      await this.runGit(repo.rootUri.fsPath, ['checkout', '-b', name.trim()], `Created and switched to ${name.trim()}`);
    }
  }

  private async addWorktree(): Promise<void> {
    const repo = this.findRepository();
    if (!repo) {
      return;
    }
    const root = repo.rootUri.fsPath;
    const branches = await this.blame.createGit(root).getBranches();
    const picked = await vscode.window.showQuickPick(
      branches.filter((branch) => !branch.isCurrent).map((branch) => ({ label: branch.name, description: branch.subject })),
      { title: 'Check out which branch in a new worktree?' },
    );
    if (!picked) {
      return;
    }
    const parent = await vscode.window.showOpenDialog({
      title: 'Folder to create the worktree in',
      canSelectFolders: true,
      canSelectFiles: false,
      defaultUri: vscode.Uri.file(path.dirname(root)),
      openLabel: 'Create the worktree here',
    });
    if (!parent?.[0]) {
      return;
    }
    const target = path.join(parent[0].fsPath, `${path.basename(root)}-${picked.label.replace(/[\\/]/g, '-')}`);
    if (await this.runGit(root, ['worktree', 'add', target, picked.label], `Created a worktree for ${picked.label}`)) {
      const open = await vscode.window.showInformationMessage(`Worktree created at ${target}.`, 'Open in New Window');
      if (open) {
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(target), { forceNewWindow: true });
      }
    }
  }

  private async saveStash(): Promise<void> {
    const repo = this.findRepository();
    if (!repo) {
      return;
    }
    const message = await vscode.window.showInputBox({ title: 'Stash all changes', prompt: 'A message to find it by later (optional)' });
    if (message === undefined) {
      return;
    }
    const args = ['stash', 'push', '--include-untracked', ...(message.trim() ? ['-m', message.trim()] : [])];
    await this.runGit(repo.rootUri.fsPath, args, 'Stashed the changes');
  }

  private static buildTooltip(name: string, subject: string, date: string, upstream?: string): vscode.MarkdownString {
    const tooltip = new vscode.MarkdownString('', true);
    tooltip.appendMarkdown(`**${name}**${upstream ? ` → \`${upstream}\`` : ''}\n\n`);
    tooltip.appendText(subject);
    tooltip.appendMarkdown(`\n\n_${date}_`);
    return tooltip;
  }

  private static describeEmpty(id: ViewId): string {
    const texts: Record<ViewId, string> = {
      branches: 'No branches yet.',
      remotes: 'No remotes.',
      tags: 'No tags.',
      stashes: 'Nothing stashed.',
      worktrees: 'No other worktrees.',
      contributors: 'No commits yet.',
    };
    return texts[id];
  }
}
