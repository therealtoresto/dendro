import * as path from 'node:path';
import * as vscode from 'vscode';
import type { BlameService } from '../blame/BlameService';
import { BlameText } from '../blame/BlameText';
import { CommitDiffs } from '../CommitDiffs';
import type { HistoryEntry } from '../git/GitOutputParser';

export interface HistoryCommitNode {
  kind: 'commit';
  entry: HistoryEntry;
  root: string;
  filePath: string;
}

type HistoryNode = HistoryCommitNode | { kind: 'more' } | { kind: 'note'; text: string };

interface FileTarget {
  root: string;
  filePath: string;
}

interface LineTarget extends FileTarget {
  startLine: number;
  endLine: number;
}

const PAGE_SIZE = 50;
const SELECTION_DELAY_MS = 500;
const PICTURE_REFRESH_MS = 400;

// One list of commits that touched a file (or some of its lines), in a view of its own.
abstract class HistoryList implements vscode.TreeDataProvider<HistoryNode> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private pictureTimer: NodeJS.Timeout | undefined;
  protected limit = PAGE_SIZE;
  view: vscode.TreeView<HistoryNode> | undefined;

  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(protected readonly blame: BlameService) {
    blame.avatars.onDidResolve(() => {
      clearTimeout(this.pictureTimer);
      this.pictureTimer = setTimeout(() => this.changeEmitter.fire(), PICTURE_REFRESH_MS);
    });
    blame.onDidChange(() => this.refresh());
  }

  protected abstract readHistory(): Promise<{ target: FileTarget; entries: HistoryEntry[] } | string>;

  refresh(): void {
    this.changeEmitter.fire();
  }

  loadMore(): void {
    this.limit += PAGE_SIZE;
    this.refresh();
  }

  async getChildren(node?: HistoryNode): Promise<HistoryNode[]> {
    if (node) {
      return [];
    }
    const history = await this.readHistory();
    if (typeof history === 'string') {
      return [{ kind: 'note', text: history }];
    }
    if (history.entries.length === 0) {
      return [{ kind: 'note', text: 'No commits changed this yet.' }];
    }

    const nodes: HistoryNode[] = history.entries.map((entry) => ({
      kind: 'commit',
      entry,
      root: history.target.root,
      filePath: entry.path ?? history.target.filePath,
    }));
    if (history.entries.length >= this.limit) {
      nodes.push({ kind: 'more' });
    }
    return nodes;
  }

  async getTreeItem(node: HistoryNode): Promise<vscode.TreeItem> {
    if (node.kind === 'note') {
      return new vscode.TreeItem(node.text);
    }
    if (node.kind === 'more') {
      const item = new vscode.TreeItem('Load more…');
      item.iconPath = new vscode.ThemeIcon('ellipsis');
      item.command = { title: 'Load more', command: 'dendro.history.loadMore', arguments: [this] };
      return item;
    }

    const { entry, root } = node;
    const dates = BlameText.createDateFormatter();
    const userEmail = await this.blame.getUserEmail(root);
    const author = userEmail !== null && entry.email === userEmail ? 'You' : entry.author;
    const time = entry.date;

    const item = new vscode.TreeItem(entry.subject);
    item.description = `${author}, ${dates.formatAgoOrDate(time)}`;
    item.contextValue = 'dendro.historyCommit';
    item.command = { title: 'Open changes', command: 'dendro.history.openChange', arguments: [node] };
    item.iconPath = this.getPicture(node) ?? new vscode.ThemeIcon('git-commit');

    const tooltip = new vscode.MarkdownString('', true);
    tooltip.appendMarkdown(`**${author}**, ${dates.formatAgo(time)} _(${dates.formatFull(time)})_\n\n`);
    tooltip.appendText(entry.subject);
    tooltip.appendMarkdown(`\n\n\`${entry.hash.slice(0, 7)}\``);
    if (entry.oldPath) {
      tooltip.appendMarkdown(`\n\nRenamed from \`${entry.oldPath}\``);
    }
    item.tooltip = tooltip;
    return item;
  }

  private getPicture(node: HistoryCommitNode): vscode.Uri | undefined {
    if (!this.blame.avatars.enabled) {
      return undefined;
    }
    const picture = this.blame.avatars.peek(node.entry.email);
    if (picture === undefined) {
      void this.blame.avatars.request(node.entry.email, node.root, node.entry.hash);
    }
    return picture?.file;
  }

  protected findTarget(document: vscode.TextDocument | undefined): FileTarget | null {
    if (!document) {
      return null;
    }
    const root = this.blame.findRoot(document.uri);
    if (!root) {
      return null;
    }
    return { root, filePath: path.relative(root, document.uri.fsPath).split(path.sep).join('/') };
  }
}

class FileHistoryList extends HistoryList {
  private target: FileTarget | null = null;

  follow(document: vscode.TextDocument | undefined): void {
    const target = this.findTarget(document);
    if (!target || (this.target && target.root === this.target.root && target.filePath === this.target.filePath)) {
      return;
    }
    this.target = target;
    this.limit = PAGE_SIZE;
    if (this.view) {
      this.view.description = path.basename(target.filePath);
    }
    this.refresh();
  }

  protected async readHistory(): Promise<{ target: FileTarget; entries: HistoryEntry[] } | string> {
    if (!this.target) {
      return 'Open a file of a git repository to see its history.';
    }
    const git = this.blame.createGit(this.target.root);
    return { target: this.target, entries: await git.getFileHistory(this.target.filePath, this.limit).catch(() => []) };
  }
}

class LineHistoryList extends HistoryList {
  private target: LineTarget | null = null;
  private timer: NodeJS.Timeout | undefined;

  follow(editor: vscode.TextEditor | undefined, delay = SELECTION_DELAY_MS): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const target = this.findTarget(editor?.document);
      if (!editor || !target) {
        return;
      }
      const selection = editor.selection;
      const endLine = selection.end.character === 0 && selection.end.line > selection.start.line ? selection.end.line : selection.end.line + 1;
      this.show({ ...target, startLine: selection.start.line + 1, endLine });
    }, delay);
  }

  show(target: LineTarget): void {
    const same =
      this.target &&
      this.target.root === target.root &&
      this.target.filePath === target.filePath &&
      this.target.startLine === target.startLine &&
      this.target.endLine === target.endLine;
    if (same) {
      return;
    }
    this.target = target;
    this.limit = PAGE_SIZE;
    if (this.view) {
      const lines = target.startLine === target.endLine ? `line ${target.startLine}` : `lines ${target.startLine}–${target.endLine}`;
      this.view.description = `${path.basename(target.filePath)}, ${lines}`;
    }
    this.refresh();
  }

  protected async readHistory(): Promise<{ target: FileTarget; entries: HistoryEntry[] } | string> {
    const target = this.target;
    if (!target) {
      return 'Put the cursor on a line of a file to see who changed it.';
    }
    const git = this.blame.createGit(target.root);
    const entries = await git.getLineHistory(target.filePath, target.startLine, target.endLine, this.limit).catch(() => []);
    return { target, entries };
  }
}

// The File History and Line History views: they follow the active editor and its selection.
export class HistoryViews implements vscode.Disposable {
  private readonly fileHistory: FileHistoryList;
  private readonly lineHistory: LineHistoryList;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(blame: BlameService) {
    this.fileHistory = new FileHistoryList(blame);
    this.lineHistory = new LineHistoryList(blame);
    this.fileHistory.view = vscode.window.createTreeView('dendro.fileHistory', { treeDataProvider: this.fileHistory });
    this.lineHistory.view = vscode.window.createTreeView('dendro.lineHistory', { treeDataProvider: this.lineHistory });

    this.disposables.push(
      this.fileHistory.view,
      this.lineHistory.view,
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.fileHistory.follow(editor?.document);
        this.lineHistory.follow(editor, 0);
      }),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor === vscode.window.activeTextEditor) {
          this.lineHistory.follow(event.textEditor);
        }
      }),
      vscode.workspace.onDidSaveTextDocument(() => this.refresh()),
      vscode.commands.registerCommand('dendro.history.loadMore', (list: HistoryList) => list.loadMore()),
      vscode.commands.registerCommand('dendro.history.refresh', () => this.refresh()),
      vscode.commands.registerCommand('dendro.history.openChange', (node: HistoryCommitNode) =>
        CommitDiffs.openFileChange(blame.createGit(node.root), node.entry.hash, node.filePath, node.entry.oldPath),
      ),
      vscode.commands.registerCommand('dendro.history.openRevision', (node: HistoryCommitNode) =>
        CommitDiffs.openRevision(node.root, node.entry.hash, node.filePath),
      ),
      vscode.commands.registerCommand('dendro.history.showInGraph', (node: HistoryCommitNode) =>
        vscode.commands.executeCommand('dendro.showCommit', node.entry.hash, node.root),
      ),
      vscode.commands.registerCommand('dendro.history.copySha', (node: HistoryCommitNode) =>
        vscode.commands.executeCommand('dendro.copyText', node.entry.hash),
      ),
      vscode.commands.registerCommand('dendro.showFileHistory', async () => {
        this.fileHistory.follow(vscode.window.activeTextEditor?.document);
        await vscode.commands.executeCommand('dendro.fileHistory.focus');
      }),
      vscode.commands.registerCommand('dendro.showLineHistory', async (uri?: vscode.Uri, startLine?: number, endLine?: number) => {
        const editor = vscode.window.activeTextEditor;
        const document = uri instanceof vscode.Uri ? await vscode.workspace.openTextDocument(uri) : editor?.document;
        const root = document ? blame.findRoot(document.uri) : undefined;
        if (document && root && typeof startLine === 'number' && typeof endLine === 'number') {
          const filePath = path.relative(root, document.uri.fsPath).split(path.sep).join('/');
          this.lineHistory.show({ root, filePath, startLine, endLine });
        } else {
          this.lineHistory.follow(editor, 0);
        }
        await vscode.commands.executeCommand('dendro.lineHistory.focus');
      }),
    );

    this.fileHistory.follow(vscode.window.activeTextEditor?.document);
    this.lineHistory.follow(vscode.window.activeTextEditor, 0);
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private refresh(): void {
    this.fileHistory.refresh();
    this.lineHistory.refresh();
  }
}
