import * as path from 'node:path';
import * as vscode from 'vscode';
import type { BlameService } from '../blame/BlameService';
import { CommitDiffs } from '../CommitDiffs';
import type { ChartCommit, FileHistoryData, HistoryHostMessage, HistoryWebviewMessage } from '../historyProtocol';
import { Settings } from '../Settings';
import { WebviewHtml } from '../WebviewHtml';

const MAX_COMMITS = 1000;

interface ChartTarget {
  root: string;
  filePath: string;
}

// A picture of a file's life: who changed it when and how much, in a panel of its own. One panel follows the
// file it was last opened for.
export class FileHistoryChart {
  static readonly viewType = 'dendro.fileHistoryChart';
  private static current: FileHistoryChart | undefined;

  private target: ChartTarget | null = null;
  private ready = false;
  private readonly disposables: vscode.Disposable[] = [];

  static async show(context: vscode.ExtensionContext, blame: BlameService, uri?: vscode.Uri): Promise<void> {
    const fileUri = uri instanceof vscode.Uri ? uri : vscode.window.activeTextEditor?.document.uri;
    const root = fileUri ? blame.findRoot(fileUri) : undefined;
    if (!fileUri || !root) {
      void vscode.window.showInformationMessage('Dendro: open a file of a git repository to see its history.');
      return;
    }
    const target = { root, filePath: path.relative(root, fileUri.fsPath).split(path.sep).join('/') };

    if (!FileHistoryChart.current) {
      const panel = vscode.window.createWebviewPanel(FileHistoryChart.viewType, 'File History', vscode.ViewColumn.Beside, {
        enableScripts: true,
        retainContextWhenHidden: true,
      });
      FileHistoryChart.current = new FileHistoryChart(panel, context, blame);
    }
    FileHistoryChart.current.panel.reveal(undefined, false);
    await FileHistoryChart.current.load(target);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    private readonly blame: BlameService,
  ) {
    panel.iconPath = {
      light: vscode.Uri.joinPath(context.extensionUri, 'media', 'dendro-light.svg'),
      dark: vscode.Uri.joinPath(context.extensionUri, 'media', 'dendro-dark.svg'),
    };
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
    };
    panel.webview.html = WebviewHtml.build(panel.webview, context.extensionUri, 'history', 'File History');

    this.disposables.push(
      panel.onDidDispose(() => this.dispose()),
      panel.webview.onDidReceiveMessage((message: HistoryWebviewMessage) => void this.handleMessage(message)),
      blame.avatars.onDidResolve((email) => {
        const picture = blame.avatars.peek(email);
        if (picture) {
          this.post({ type: 'avatars', avatars: { [email]: picture.dataUri } });
        }
      }),
    );
  }

  private dispose(): void {
    FileHistoryChart.current = undefined;
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async load(target: ChartTarget): Promise<void> {
    this.target = target;
    const fileName = path.basename(target.filePath);
    this.panel.title = `History · ${fileName}`;
    if (this.ready) {
      await this.postData();
    }
  }

  private async postData(): Promise<void> {
    const target = this.target;
    if (!target) {
      return;
    }
    const fileName = path.basename(target.filePath);
    this.post({ type: 'loading', fileName });

    const git = this.blame.createGit(target.root);
    const [entries, userEmail] = await Promise.all([
      git.getFileHistoryStats(target.filePath, MAX_COMMITS).catch(() => []),
      this.blame.getUserEmail(target.root),
    ]);
    if (target !== this.target) {
      return;
    }

    const commits: ChartCommit[] = entries.map((entry) => ({
      hash: entry.hash,
      author: entry.author,
      email: entry.email.toLowerCase(),
      date: entry.date,
      subject: entry.subject,
      additions: entry.additions ?? 0,
      deletions: entry.deletions ?? 0,
      path: entry.path ?? target.filePath,
      oldPath: entry.oldPath,
    }));

    const data: FileHistoryData = {
      fileName,
      filePath: target.filePath,
      commits,
      truncated: entries.length >= MAX_COMMITS,
      userEmail: userEmail?.toLowerCase() ?? null,
      avatars: this.collectAvatars(target.root, commits),
      dates: Settings.readDateSettings(),
      locale: Settings.getEditorLocale(),
    };
    this.post({ type: 'data', data });
  }

  // Pictures already known go out with the data; the rest arrive as they download.
  private collectAvatars(root: string, commits: ChartCommit[]): Record<string, string> {
    const avatars: Record<string, string> = {};
    if (!this.blame.avatars.enabled) {
      return avatars;
    }
    for (const commit of commits) {
      if (commit.email in avatars) {
        continue;
      }
      const picture = this.blame.avatars.peek(commit.email);
      if (picture) {
        avatars[commit.email] = picture.dataUri;
      } else if (picture === undefined) {
        void this.blame.avatars.request(commit.email, root, commit.hash);
      }
    }
    return avatars;
  }

  private async handleMessage(message: HistoryWebviewMessage): Promise<void> {
    const target = this.target;
    switch (message.type) {
      case 'ready':
        this.ready = true;
        await this.postData();
        return;
      case 'openChange':
        if (target) {
          await CommitDiffs.openFileChange(this.blame.createGit(target.root), message.hash, message.path, message.oldPath);
        }
        return;
      case 'showInGraph':
        if (target) {
          await vscode.commands.executeCommand('dendro.showCommit', message.hash, target.root);
        }
        return;
    }
  }

  private post(message: HistoryHostMessage): void {
    void this.panel.webview.postMessage(message);
  }
}
