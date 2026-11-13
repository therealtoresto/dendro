import * as vscode from 'vscode';
import type { BlameService, LineBlameInfo } from '../blame/BlameService';
import { BlameText } from '../blame/BlameText';
import { Settings } from '../Settings';

const SELECTION_DELAY_MS = 120;

// The blame of the line under the cursor: an annotation at the end of the line and a status bar item.
export class LineBlame implements vscode.Disposable {
  private readonly decoration = vscode.window.createTextEditorDecorationType({
    after: {
      margin: '0 0 0 3em',
      color: new vscode.ThemeColor('editorCodeLens.foreground'),
      fontStyle: 'italic',
    },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
  });
  private statusItem: vscode.StatusBarItem | undefined;
  private statusAlignment: string | undefined;
  private timer: NodeJS.Timeout | undefined;
  private current: LineBlameInfo | null = null;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly blame: BlameService) {
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor === vscode.window.activeTextEditor) {
          this.schedule(SELECTION_DELAY_MS);
        }
      }),
      vscode.window.onDidChangeActiveTextEditor(() => this.schedule(0)),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document === vscode.window.activeTextEditor?.document) {
          this.clear();
          this.schedule(Settings.get<number>('blame.dirtyDelayMs'));
        }
      }),
      vscode.workspace.onDidSaveTextDocument(() => this.schedule(0)),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('dendro')) {
          this.schedule(0);
        }
      }),
      blame.onDidChange(() => this.schedule(0)),
    );
    this.schedule(0);
  }

  get currentLine(): LineBlameInfo | null {
    return this.current;
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.decoration.dispose();
    this.statusItem?.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private schedule(delay: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.update(), delay);
  }

  private clear(): void {
    vscode.window.activeTextEditor?.setDecorations(this.decoration, []);
  }

  private async update(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const inlineEnabled = Settings.get<boolean>('inlineBlame.enabled');
    const statusEnabled = Settings.get<boolean>('statusBar.enabled');

    if (!editor || (!inlineEnabled && !statusEnabled) || !this.blame.findBlameRoot(editor.document.uri)) {
      this.current = null;
      this.clear();
      this.updateStatus(null, '');
      return;
    }

    const line = editor.selection.active.line;
    const info = await this.blame.getLineInfo(editor.document, line);
    if (editor !== vscode.window.activeTextEditor || editor.selection.active.line !== line) {
      return;
    }
    this.current = info;

    if (!info) {
      this.clear();
      this.updateStatus(null, '');
      return;
    }

    const dates = BlameText.createDateFormatter();
    const userEmail = await this.blame.getUserEmail(info.root);

    if (inlineEnabled) {
      const text = BlameText.format(Settings.get<string>('inlineBlame.format'), info.commit, userEmail, dates);
      const end = editor.document.lineAt(line).range.end;
      const hoverOnAnnotation =
        Settings.get<boolean>('hovers.enabled') &&
        Settings.get<boolean>('hovers.currentLine.enabled') &&
        Settings.get<string>('hovers.currentLine.over') === 'annotation';
      const option: vscode.DecorationOptions = {
        range: new vscode.Range(end, end),
        renderOptions: { after: { contentText: text } },
      };
      if (hoverOnAnnotation) {
        option.hoverMessage = await BlameText.buildHover(this.blame, info, { changes: true, languageId: editor.document.languageId });
      }
      editor.setDecorations(this.decoration, [option]);
    } else {
      this.clear();
    }

    const statusText = statusEnabled
      ? BlameText.format(Settings.get<string>('statusBar.format'), info.commit, userEmail, dates)
      : '';
    this.updateStatus(statusEnabled ? info : null, statusText, editor.document.languageId);
  }

  private updateStatus(info: LineBlameInfo | null, text: string, languageId?: string): void {
    const alignment = Settings.get<string>('statusBar.alignment');
    if (!this.statusItem || this.statusAlignment !== alignment) {
      this.statusItem?.dispose();
      this.statusItem = vscode.window.createStatusBarItem(
        'dendro.blame',
        alignment === 'left' ? vscode.StatusBarAlignment.Left : vscode.StatusBarAlignment.Right,
        alignment === 'left' ? 0 : 1000,
      );
      this.statusItem.name = 'Dendro Blame';
      this.statusAlignment = alignment;
    }

    if (!info) {
      this.statusItem.hide();
      return;
    }

    this.statusItem.text = `$(git-commit) ${text}`;
    this.statusItem.tooltip = new vscode.MarkdownString(
      `${info.commit.uncommitted ? 'Uncommitted changes' : info.commit.summary}\n\n_Click: ${LineBlame.describeCommand()}_`,
    );
    if (Settings.get<boolean>('statusBar.hover')) {
      void this.showStatusCard(info, languageId);
    }
    this.statusItem.command = {
      title: 'Dendro blame',
      command: 'dendro.statusBarAction',
      arguments: [info.root, info.commit.sha, info.path, info.commit.uncommitted],
    };
    this.statusItem.show();
  }

  // The full card takes a few git calls, so the short tooltip stands until it is ready, and a card for a line the
  // cursor has already left is dropped.
  private async showStatusCard(info: LineBlameInfo, languageId: string | undefined): Promise<void> {
    const card = await BlameText.buildHover(this.blame, info, {
      changes: true,
      languageId,
      controls: Settings.get<boolean>('statusBar.hoverControls'),
    }).catch(() => null);
    if (!card || this.current !== info || !this.statusItem) {
      return;
    }
    card.appendMarkdown(`\n\n_Click: ${LineBlame.describeCommand()}_`);
    this.statusItem.tooltip = card;
  }

  private static describeCommand(): string {
    switch (Settings.get<string>('statusBar.command')) {
      case 'openChanges':
        return "open the line's changes";
      case 'copySha':
        return 'copy the commit SHA';
      default:
        return 'show the commit in the Commit Graph';
    }
  }
}
