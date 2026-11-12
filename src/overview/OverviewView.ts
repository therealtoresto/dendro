import * as path from 'node:path';
import * as vscode from 'vscode';
import type { BlameService } from '../blame/BlameService';
import type { API, Repository } from '../git/git';
import type { GitService } from '../git/GitService';
import { WorkingChangeCounter } from '../git/WorkingChangeCounter';
import type {
  BranchAction,
  OverviewBase,
  OverviewHostMessage,
  OverviewState,
  OverviewWebviewMessage,
} from '../overviewProtocol';
import type { RemoteAction, WorkingSummary } from '../protocol';
import { RepoActions } from '../RepoActions';
import type { RepositoryViews } from '../repository/RepositoryViews';
import { Settings } from '../Settings';
import { WebviewHtml } from '../WebviewHtml';

const RECENT_COMMITS = 6;

// The first view of the Dendro side bar: where the current branch stands and the buttons that act on it, the
// uncommitted changes, the local branches with their actions, the latest commits, and the way into the graph.
export class OverviewView implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'dendro.overview';

  private view: vscode.WebviewView | undefined;
  private ready = false;
  private busy: RemoteAction | null = null;
  private loading: Promise<void> | null = null;
  private loadAgain = false;
  private shown: { root: string; state: OverviewState } | null = null;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly api: API,
    private readonly blame: BlameService,
    private readonly repositories: RepositoryViews,
  ) {
    this.disposables.push(
      repositories.onDidRefresh(() => this.refresh()),
      blame.avatars.onDidResolve((email) => {
        const picture = blame.avatars.peek(email);
        if (picture) {
          this.post({ type: 'avatars', avatars: { [email]: picture.dataUri } });
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('dendro.dates')) {
          this.refresh();
        }
      }),
    );
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.ready = false;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')],
    };
    view.webview.html = WebviewHtml.build(view.webview, this.context.extensionUri, 'overview', 'Overview');
    view.webview.onDidReceiveMessage((message: OverviewWebviewMessage) => void this.handleMessage(message));
    view.onDidChangeVisibility(() => {
      if (view.visible) {
        this.refresh();
      }
    });
    view.onDidDispose(() => {
      this.view = undefined;
      this.ready = false;
    });
  }

  // Loads run one at a time; a change during a load asks for one more afterwards, never for a pile of them.
  refresh(): void {
    if (!this.ready || !this.view?.visible) {
      return;
    }
    if (this.loading) {
      this.loadAgain = true;
      return;
    }
    this.loading = this.load()
      .catch(() => undefined)
      .finally(() => {
        this.loading = null;
        if (this.loadAgain) {
          this.loadAgain = false;
          this.refresh();
        }
      });
  }

  private async load(): Promise<void> {
    const repo = this.repositories.findRepository();
    if (!repo) {
      this.shown = null;
      this.post({ type: 'empty', text: 'Open a folder with a git repository to see its branches here.' });
      return;
    }

    const root = repo.rootUri.fsPath;
    const git = this.blame.createGit(root);
    const [head, branches, base, stashes, lastFetch, commits, working] = await Promise.all([
      git.getHead(),
      git.getBranches().catch(() => []),
      OverviewView.findBase(git),
      git.getStashes().catch(() => []),
      git.getLastFetchTime().catch(() => null),
      git.getRecentCommits(RECENT_COMMITS).catch(() => []),
      this.summarizeWorking(repo, git),
    ]);

    const [merged, sides] = await Promise.all([
      base ? git.getMergedBranches(base.ref) : Promise.resolve(new Set<string>()),
      base && head.hash && head.branch !== base.name ? git.countSideCommits('HEAD', base.ref).catch(() => null) : Promise.resolve(null),
    ]);
    const baseState: OverviewBase | null = base && { ...base, onlyHere: sides?.onlyLeft ?? 0, onlyThere: sides?.onlyRight ?? 0 };

    const current = branches.filter((branch) => branch.isCurrent);
    const others = branches.filter((branch) => !branch.isCurrent);
    const state: OverviewState = {
      repoName: path.basename(root),
      repoCount: this.api.repositories.length,
      branch: head.branch,
      headHash: head.hash,
      upstream: head.upstream,
      ahead: head.ahead,
      behind: head.behind,
      lastFetch,
      base: baseState,
      working,
      stashes: stashes.length,
      branches: [...current, ...others].map((branch) => ({
        name: branch.name,
        hash: branch.hash,
        upstream: branch.upstream,
        upstreamGone: branch.upstreamGone,
        ahead: branch.ahead,
        behind: branch.behind,
        date: branch.date,
        subject: branch.subject,
        isCurrent: branch.isCurrent,
        merged: !branch.isCurrent && branch.name !== base?.name && merged.has(branch.name),
      })),
      commits: commits.map((commit) => ({
        hash: commit.hash,
        subject: commit.subject,
        author: commit.author,
        email: commit.email.toLowerCase(),
        date: commit.date,
      })),
      avatars: {},
      dates: Settings.readDateSettings(),
      locale: Settings.getEditorLocale(),
    };
    state.avatars = this.collectAvatars(root, state);
    this.shown = { root, state };
    this.post({ type: 'state', state });
  }

  private async summarizeWorking(repo: Repository, git: GitService): Promise<WorkingSummary> {
    const summary: WorkingSummary = WorkingChangeCounter.countState(repo.state);
    if (summary.total > 0) {
      summary.lines = await git.getWorkingLineStats().catch(() => undefined);
    }
    return summary;
  }

  // The branch the others are measured against: the remote one when there is one, since the local copy can be old.
  private static async findBase(git: GitService): Promise<{ name: string; ref: string } | null> {
    const name = await git.getDefaultBranch().catch(() => null);
    if (!name) {
      return null;
    }
    const remote = `origin/${name}`;
    return { name, ref: (await git.resolveCommit(remote)) ? remote : name };
  }

  private collectAvatars(root: string, state: OverviewState): Record<string, string> {
    const avatars: Record<string, string> = {};
    if (!this.blame.avatars.enabled) {
      return avatars;
    }
    for (const commit of state.commits) {
      const picture = this.blame.avatars.peek(commit.email);
      if (picture) {
        avatars[commit.email] = picture.dataUri;
      } else if (picture === undefined) {
        void this.blame.avatars.request(commit.email, root, commit.hash);
      }
    }
    return avatars;
  }

  private createActions(root: string): RepoActions | undefined {
    const repo = this.api.repositories.find((candidate) => candidate.rootUri.fsPath === root);
    if (!repo) {
      return undefined;
    }
    return new RepoActions(
      repo,
      this.blame.createGit(root),
      (action) => {
        this.busy = action;
        this.post({ type: 'busy', action });
      },
      () => this.refresh(),
      () => undefined,
    );
  }

  private async handleMessage(message: OverviewWebviewMessage): Promise<void> {
    if (message.type === 'ready') {
      this.ready = true;
      this.post({ type: 'busy', action: this.busy });
      this.refresh();
      return;
    }

    const shown = this.shown;
    switch (message.type) {
      case 'openGraph':
        await vscode.commands.executeCommand('dendro.showCommit', message.hash, shown?.root);
        return;
      case 'switchRepository':
        await this.repositories.switchRepository();
        return;
      case 'openSettings':
        await vscode.commands.executeCommand('dendro.showSettings');
        return;
      case 'openSourceControl':
        await vscode.commands.executeCommand('workbench.view.scm');
        return;
      case 'stash':
        await vscode.commands.executeCommand('dendro.repo.stashSave');
        return;
    }

    if (!shown) {
      return;
    }
    const { root, state } = shown;
    const actions = this.createActions(root);
    if (!actions) {
      return;
    }

    switch (message.type) {
      case 'remote':
        await actions.runRemote(message.action);
        break;
      case 'openInsights':
        await vscode.commands.executeCommand('dendro.showInsights', root);
        break;
      case 'compareBranches':
        await vscode.commands.executeCommand('dendro.compareRefs', root, state.branch ?? 'HEAD', state.base?.ref);
        break;
      case 'createBranch':
        if (state.headHash) {
          const subject = state.commits[0]?.subject ?? '';
          await actions.createBranch({ hash: state.headHash, subject, parentCount: 1 });
        }
        break;
      case 'branchAction':
        await this.runBranchAction(actions, root, state, message.action, message.name);
        break;
      case 'updateFromBase':
        if (state.base) {
          if (message.how === 'rebase') {
            await actions.rebaseCurrentOnto(state.base.ref, state.base.ref, state.branch);
          } else {
            await actions.mergeIntoCurrent(state.base.ref, state.branch);
          }
        }
        break;
      case 'deleteMerged':
        await this.deleteMerged(root, state);
        break;
    }
    this.refresh();
  }

  private async runBranchAction(actions: RepoActions, root: string, state: OverviewState, action: BranchAction, name: string): Promise<void> {
    const branch = state.branches.find((candidate) => candidate.name === name);
    if (!branch) {
      return;
    }
    const ref = { name: branch.name, kind: 'head' as const, hash: branch.hash, upstream: branch.upstream };

    switch (action) {
      case 'show':
        await vscode.commands.executeCommand('dendro.showCommit', branch.hash, root);
        return;
      case 'checkout':
        await actions.checkoutRef(ref);
        return;
      case 'compare':
        await vscode.commands.executeCommand('dendro.compareRefs', root, state.branch ?? 'HEAD', branch.name);
        return;
      case 'merge':
        await actions.mergeIntoCurrent(branch.name, state.branch);
        return;
      case 'rebase':
        await actions.rebaseCurrentOnto(branch.name, branch.name, state.branch);
        return;
      case 'delete':
        await actions.deleteRef(ref);
        return;
    }
  }

  // Each branch is checked again right before it goes, so a branch that got new commits since the list was read
  // stays. `branch -d` would judge by HEAD or the branch's upstream, not by the default branch, hence -D.
  private async deleteMerged(root: string, state: OverviewState): Promise<void> {
    const names = state.branches.filter((branch) => branch.merged).map((branch) => branch.name);
    if (names.length === 0 || !state.base) {
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      `Delete ${names.length} ${names.length === 1 ? 'branch' : 'branches'} already merged into ${state.base.ref}?`,
      { modal: true, detail: `${names.join('\n')}\n\nOnly the local branches are deleted; their commits stay in ${state.base.ref}.` },
      'Delete',
    );
    if (choice !== 'Delete') {
      return;
    }

    const git = this.blame.createGit(root);
    const failed: string[] = [];
    for (const name of names) {
      const isMerged = await git.run(['merge-base', '--is-ancestor', `refs/heads/${name}`, state.base.ref]).then(() => true, () => false);
      if (!isMerged) {
        failed.push(name);
        continue;
      }
      await git.run(['branch', '-D', name]).catch(() => failed.push(name));
    }
    if (failed.length > 0) {
      void vscode.window.showWarningMessage(`Dendro: kept ${failed.join(', ')}: not merged into ${state.base.ref} any more.`);
    }
    vscode.window.setStatusBarMessage(`$(check) Dendro: deleted ${names.length - failed.length} merged branches`, 3000);
  }

  private post(message: OverviewHostMessage): void {
    if (this.ready) {
      void this.view?.webview.postMessage(message);
    }
  }
}
