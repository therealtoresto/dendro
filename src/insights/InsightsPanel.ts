import * as path from 'node:path';
import * as vscode from 'vscode';
import type { BlameService } from '../blame/BlameService';
import type { ActivityCommit } from '../git/GitOutputParser';
import type { FileCount, InsightsAuthor, InsightsData, InsightsHostMessage, InsightsWebviewMessage } from '../insightsProtocol';
import { Settings } from '../Settings';
import { WebviewHtml } from '../WebviewHtml';

const DAY = 86400;
// 53 weeks, so the calendar's first column is always full.
const PERIOD_DAYS = 53 * 7;
const TOP_FILES = 10;
const AVATAR_AUTHORS = 12;

// A summary of a repository's last year on the current branch: a calendar of commits per day, streaks, who
// commits, which files change most and at which hours. Line counts arrive second, as they take longer to read.
export class InsightsPanel {
  static readonly viewType = 'dendro.insights';
  private static current: InsightsPanel | undefined;

  private root = '';
  private ready = false;
  private loadId = 0;
  private readonly disposables: vscode.Disposable[] = [];

  static async show(context: vscode.ExtensionContext, blame: BlameService, root: string): Promise<void> {
    if (!InsightsPanel.current) {
      const panel = vscode.window.createWebviewPanel(InsightsPanel.viewType, 'Insights', vscode.ViewColumn.Active, {
        enableScripts: true,
        retainContextWhenHidden: true,
      });
      InsightsPanel.current = new InsightsPanel(panel, context, blame);
    }
    const insights = InsightsPanel.current;
    insights.root = root;
    insights.panel.title = `Insights · ${path.basename(root)}`;
    insights.panel.reveal();
    if (insights.ready) {
      await insights.load();
    }
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
    panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')] };
    panel.webview.html = WebviewHtml.build(panel.webview, context.extensionUri, 'insights', 'Insights');

    this.disposables.push(
      panel.onDidDispose(() => this.dispose()),
      panel.webview.onDidReceiveMessage((message: InsightsWebviewMessage) => void this.handleMessage(message)),
      blame.avatars.onDidResolve((email) => {
        const picture = blame.avatars.peek(email);
        if (picture) {
          this.post({ type: 'avatars', avatars: { [email]: picture.dataUri } });
        }
      }),
    );
  }

  private dispose(): void {
    InsightsPanel.current = undefined;
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async load(): Promise<void> {
    const loadId = ++this.loadId;
    const root = this.root;
    const git = this.blame.createGit(root);
    const since = Math.floor(Date.now() / 1000) - PERIOD_DAYS * DAY;
    this.post({ type: 'loading', repoName: path.basename(root) });

    const [commits, head, totalCommits, firstCommitDate, userEmail] = await Promise.all([
      git.getActivity(since).catch(() => [] as ActivityCommit[]),
      git.getHead(),
      git.countCommits(),
      git.getFirstCommitDate(),
      this.blame.getUserEmail(root),
    ]);
    if (loadId !== this.loadId) {
      return;
    }

    const authors: InsightsAuthor[] = [];
    const authorIndexByEmail = new Map<string, number>();
    const commitCountByEmail = new Map<string, number>();
    const firstHashByEmail = new Map<string, string>();
    const rows = commits.map((commit) => {
      let index = authorIndexByEmail.get(commit.email);
      if (index === undefined) {
        index = authors.push({ name: commit.author, email: commit.email }) - 1;
        authorIndexByEmail.set(commit.email, index);
        firstHashByEmail.set(commit.email, commit.hash);
      }
      commitCountByEmail.set(commit.email, (commitCountByEmail.get(commit.email) ?? 0) + 1);
      return { date: commit.date, author: index };
    });

    const topEmails = Array.from(commitCountByEmail.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, AVATAR_AUTHORS)
      .map(([email]) => email);

    const data: InsightsData = {
      repoName: path.basename(root),
      branch: head.branch,
      since,
      commits: rows,
      authors,
      userEmail: userEmail?.toLowerCase() ?? null,
      totalCommits,
      firstCommitDate,
      avatars: this.collectAvatars(root, topEmails, firstHashByEmail),
      locale: Settings.getEditorLocale(),
    };
    this.post({ type: 'data', data });

    await this.loadStats(loadId, commits, data.userEmail, since);
  }

  private async loadStats(loadId: number, commits: ActivityCommit[], userEmail: string | null, since: number): Promise<void> {
    const statsByHash = await this.blame
      .createGit(this.root)
      .getActivityStats(since)
      .catch(() => null);
    if (loadId !== this.loadId || !statsByHash) {
      return;
    }

    const fileCounts = new Map<string, number>();
    const myFileCounts = new Map<string, number>();
    const additions: number[] = [];
    const deletions: number[] = [];
    for (const commit of commits) {
      const stats = statsByHash.get(commit.hash);
      additions.push(stats?.additions ?? 0);
      deletions.push(stats?.deletions ?? 0);
      for (const file of stats?.files ?? []) {
        fileCounts.set(file, (fileCounts.get(file) ?? 0) + 1);
        if (commit.email === userEmail) {
          myFileCounts.set(file, (myFileCounts.get(file) ?? 0) + 1);
        }
      }
    }

    this.post({
      type: 'stats',
      stats: { additions, deletions, files: InsightsPanel.pickTopFiles(fileCounts), myFiles: InsightsPanel.pickTopFiles(myFileCounts) },
    });
  }

  private static pickTopFiles(counts: Map<string, number>): FileCount[] {
    return Array.from(counts.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, TOP_FILES)
      .map(([filePath, commits]) => ({ path: filePath, commits }));
  }

  // Pictures already known go out with the data; the rest arrive as they download.
  private collectAvatars(root: string, emails: string[], firstHashByEmail: Map<string, string>): Record<string, string> {
    const avatars: Record<string, string> = {};
    if (!this.blame.avatars.enabled) {
      return avatars;
    }
    for (const email of emails) {
      const picture = this.blame.avatars.peek(email);
      if (picture) {
        avatars[email] = picture.dataUri;
      } else if (picture === undefined) {
        void this.blame.avatars.request(email, root, firstHashByEmail.get(email)!);
      }
    }
    return avatars;
  }

  private async handleMessage(message: InsightsWebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.ready = true;
        await this.load();
        return;
      case 'refresh':
        await this.load();
        return;
      case 'openFile': {
        const uri = vscode.Uri.file(path.join(this.root, message.path));
        try {
          await vscode.window.showTextDocument(uri, { preview: true });
        } catch {
          void vscode.window.showInformationMessage(`Dendro: ${message.path} is not in the working tree any more.`);
        }
        return;
      }
    }
  }

  private post(message: InsightsHostMessage): void {
    void this.panel.webview.postMessage(message);
  }
}
