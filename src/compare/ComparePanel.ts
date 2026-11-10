import * as vscode from 'vscode';
import type { BlameService } from '../blame/BlameService';
import { CommitDiffs } from '../CommitDiffs';
import type { CompareCommit, CompareData, CompareHostMessage, CompareMode, CompareWebviewMessage } from '../compareProtocol';
import type { HistoryEntry } from '../git/GitOutputParser';
import type { GitService } from '../git/GitService';
import { Settings } from '../Settings';
import { WebviewHtml } from '../WebviewHtml';

const SIDE_LIMIT = 300;
const RECENT_KEY = 'dendro.compare.recent';
const MAX_RECENT = 8;
const MAX_PICKED_TAGS = 200;

// Two branches, tags or commits side by side: the commits only one of them has, and the files that differ.
export class ComparePanel {
  static readonly viewType = 'dendro.compare';
  private static current: ComparePanel | undefined;

  private root = '';
  private left = 'HEAD';
  private right = 'HEAD';
  private mode: CompareMode = 'diverged';
  private mergeBase: string | null = null;
  private ready = false;
  private readonly disposables: vscode.Disposable[] = [];

  static async show(context: vscode.ExtensionContext, blame: BlameService, root: string, left: string, right?: string): Promise<void> {
    if (!ComparePanel.current) {
      const panel = vscode.window.createWebviewPanel(ComparePanel.viewType, 'Compare', vscode.ViewColumn.Active, {
        enableScripts: true,
        retainContextWhenHidden: true,
      });
      ComparePanel.current = new ComparePanel(panel, context, blame);
    }
    const compare = ComparePanel.current;
    compare.root = root;
    compare.left = left;
    compare.panel.reveal();

    const picked = right ?? (await compare.pickRef(`Compare ${left} with…`));
    if (!picked) {
      if (!right && compare.right === compare.left) {
        compare.panel.dispose();
      }
      return;
    }
    compare.right = picked;
    if (compare.ready) {
      await compare.load();
    }
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly blame: BlameService,
  ) {
    panel.iconPath = {
      light: vscode.Uri.joinPath(context.extensionUri, 'media', 'dendro-light.svg'),
      dark: vscode.Uri.joinPath(context.extensionUri, 'media', 'dendro-dark.svg'),
    };
    panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')] };
    panel.webview.html = WebviewHtml.build(panel.webview, context.extensionUri, 'compare', 'Compare');
    this.disposables.push(
      panel.onDidDispose(() => this.dispose()),
      panel.webview.onDidReceiveMessage((message: CompareWebviewMessage) => void this.handleMessage(message)),
    );
  }

  private dispose(): void {
    ComparePanel.current = undefined;
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private get git(): GitService {
    return this.blame.createGit(this.root);
  }

  private async load(): Promise<void> {
    this.panel.title = `${this.left} ↔ ${this.right}`;
    this.post({ type: 'loading' });
    const git = this.git;

    const [leftHash, rightHash] = await Promise.all([git.resolveCommit(this.left), git.resolveCommit(this.right)]);
    if (!leftHash || !rightHash) {
      this.post({ type: 'error', message: `Cannot find ${!leftHash ? this.left : this.right} in this repository.` });
      return;
    }

    this.mergeBase = await git.getMergeBase(leftHash, rightHash);
    const base = this.mode === 'diverged' && this.mergeBase ? this.mergeBase : leftHash;
    const [sides, counts, files] = await Promise.all([
      git.getSideCommits(leftHash, rightHash, SIDE_LIMIT),
      git.countSideCommits(leftHash, rightHash),
      git.getComparisonFiles(base, rightHash),
    ]);
    await this.rememberPair();

    const data: CompareData = {
      left: { ref: this.left, hash: leftHash },
      right: { ref: this.right, hash: rightHash },
      mode: this.mode,
      mergeBase: this.mergeBase,
      onlyLeft: sides.onlyLeft.map(ComparePanel.toCommit),
      onlyRight: sides.onlyRight.map(ComparePanel.toCommit),
      leftCount: counts.onlyLeft,
      rightCount: counts.onlyRight,
      sideLimit: SIDE_LIMIT,
      files,
      recent: this.context.workspaceState.get(RECENT_KEY, []),
      dates: Settings.readDateSettings(),
      locale: Settings.getEditorLocale(),
    };
    this.post({ type: 'data', data });
  }

  private static toCommit(entry: HistoryEntry): CompareCommit {
    return { hash: entry.hash, author: entry.author, email: entry.email.toLowerCase(), date: entry.date, subject: entry.subject };
  }

  private async rememberPair(): Promise<void> {
    const recent = this.context.workspaceState.get<{ left: string; right: string }[]>(RECENT_KEY, []);
    const pair = { left: this.left, right: this.right };
    const others = recent.filter((item) => item.left !== pair.left || item.right !== pair.right);
    await this.context.workspaceState.update(RECENT_KEY, [pair, ...others].slice(0, MAX_RECENT));
  }

  private async pickRef(title: string): Promise<string | undefined> {
    const git = this.git;
    const [branches, remotes, tags] = await Promise.all([git.getBranches(), git.getRemotes(), git.getTags()]);
    const remoteBranches = (await Promise.all(remotes.map((remote) => git.getRemoteBranches(remote.name)))).flat();
    type Item = vscode.QuickPickItem & { ref?: string; custom?: boolean };
    const items: Item[] = [
      { label: 'Branches', kind: vscode.QuickPickItemKind.Separator },
      ...branches.map((branch) => ({ label: `$(git-branch) ${branch.name}`, description: branch.subject, ref: branch.name })),
      { label: 'Remote branches', kind: vscode.QuickPickItemKind.Separator },
      ...remoteBranches.map((branch) => ({ label: `$(cloud) ${branch.name}`, description: branch.subject, ref: branch.name })),
      { label: 'Tags', kind: vscode.QuickPickItemKind.Separator },
      ...tags.slice(0, MAX_PICKED_TAGS).map((tag) => ({ label: `$(tag) ${tag.name}`, description: tag.subject, ref: tag.name })),
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      { label: '$(git-commit) A commit SHA…', custom: true },
    ];

    const picked = await vscode.window.showQuickPick(items, { title, matchOnDescription: true });
    if (picked?.custom) {
      const sha = await vscode.window.showInputBox({
        title: 'Commit SHA',
        validateInput: async (value) => ((await git.resolveCommit(value.trim())) ? null : 'No such commit'),
      });
      return sha?.trim() || undefined;
    }
    return picked?.ref;
  }

  private async handleMessage(message: CompareWebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.ready = true;
        if (this.left !== this.right) {
          await this.load();
        }
        return;
      case 'pick': {
        const picked = await this.pickRef(message.side === 'left' ? 'Compare from…' : 'Compare with…');
        if (picked) {
          this[message.side] = picked;
          await this.load();
        }
        return;
      }
      case 'swap':
        [this.left, this.right] = [this.right, this.left];
        await this.load();
        return;
      case 'setMode':
        this.mode = message.mode;
        await this.load();
        return;
      case 'openRecent':
        this.left = message.left;
        this.right = message.right;
        await this.load();
        return;
      case 'showCommit':
        await vscode.commands.executeCommand('dendro.showCommit', message.hash, this.root);
        return;
      case 'openFile': {
        const leftHash = await this.git.resolveCommit(this.left);
        const rightHash = await this.git.resolveCommit(this.right);
        if (!leftHash || !rightHash) {
          return;
        }
        const base = this.mode === 'diverged' && this.mergeBase ? this.mergeBase : leftHash;
        const title = this.mode === 'diverged' ? `${this.right} since it left ${this.left}` : `${this.left} ↔ ${this.right}`;
        await CommitDiffs.openBetween(this.root, base, rightHash, message.file, title);
        return;
      }
    }
  }

  private post(message: CompareHostMessage): void {
    void this.panel.webview.postMessage(message);
  }
}
