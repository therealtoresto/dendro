import * as path from 'node:path';
import * as vscode from 'vscode';
import type { BlameService } from '../blame/BlameService';
import type { RebaseHostMessage, RebaseRow, RebaseWebviewMessage } from '../rebaseProtocol';
import { WebviewHtml } from '../WebviewHtml';
import { RebaseTodo } from './RebaseTodo';

// The visual editor of git's rebase todo list. Edits go straight into the document; "Start" saves and closes it,
// which is what git waits for, and "Abort" empties it first, which makes git stop the rebase.
export class RebaseEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'dendro.rebase';
  // Set while our own edit is applied, so the change event it raises does not redraw the page under the user.
  private applying = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly blame: BlameService,
  ) {}

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')] };
    panel.webview.html = WebviewHtml.build(panel.webview, this.context.extensionUri, 'rebase', 'Interactive Rebase');

    const post = async () => {
      const message: RebaseHostMessage = { type: 'view', view: await this.buildView(document) };
      void panel.webview.postMessage(message);
    };

    const subscriptions = [
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document === document && event.contentChanges.length > 0 && !this.applying) {
          void post();
        }
      }),
      panel.webview.onDidReceiveMessage(async (message: RebaseWebviewMessage) => {
        if (message.type === 'ready') {
          await post();
        } else if (message.type === 'update') {
          const todo = RebaseTodo.parse(document.getText());
          await this.replaceText(document, RebaseTodo.serialize({ steps: message.rows, otherLines: todo.otherLines }));
        } else if (message.type === 'start') {
          await this.finish(document, panel, null);
        } else if (message.type === 'abort') {
          await this.finish(document, panel, '');
        }
      }),
    ];
    panel.onDidDispose(() => subscriptions.forEach((subscription) => subscription.dispose()));
  }

  private async replaceText(document: vscode.TextDocument, text: string): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), text);
    this.applying = true;
    try {
      await vscode.workspace.applyEdit(edit);
    } finally {
      this.applying = false;
    }
  }

  private async finish(document: vscode.TextDocument, panel: vscode.WebviewPanel, replacement: string | null): Promise<void> {
    if (replacement !== null) {
      await this.replaceText(document, replacement);
    }
    await document.save();
    panel.dispose();
  }

  // The todo of a rebase lives in <repository>/.git/rebase-merge/git-rebase-todo; the rest of the row comes from git.
  private async buildView(document: vscode.TextDocument): Promise<{ rows: RebaseRow[]; onto: string | null; branch: string | null }> {
    const todo = RebaseTodo.parse(document.getText());
    const rebaseFolder = path.dirname(document.uri.fsPath);
    const root = path.dirname(path.dirname(rebaseFolder));
    const git = this.blame.createGit(root);

    const readState = (name: string) =>
      vscode.workspace.fs.readFile(vscode.Uri.file(path.join(rebaseFolder, name))).then(
        (bytes) => Buffer.from(bytes).toString('utf8').trim(),
        () => null,
      );
    const [onto, headName] = await Promise.all([readState('onto'), readState('head-name')]);

    const details = await Promise.all(
      todo.steps.map((step) =>
        git
          .run(['show', '-s', '--format=%an%x1f%ae%x1f%at', step.hash, '--'])
          .then((output) => output.trim().split('\x1f'))
          .catch(() => null),
      ),
    );

    return {
      rows: todo.steps.map((step, index) => {
        const [author, email, date] = details[index] ?? [];
        return { ...step, author, email: email?.toLowerCase(), date: date ? Number(date) : undefined };
      }),
      onto: onto ? onto.slice(0, 7) : null,
      branch: headName ? headName.replace('refs/heads/', '') : null,
    };
  }
}
