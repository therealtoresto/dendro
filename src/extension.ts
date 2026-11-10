import * as path from 'node:path';
import * as vscode from 'vscode';
import { AutoFetcher } from './AutoFetcher';
import { AvatarService } from './AvatarService';
import { BlameService } from './blame/BlameService';
import { BlameHovers } from './editor/BlameHovers';
import { AnnotationKind, FileAnnotations } from './editor/FileAnnotations';
import { LineBlame } from './editor/LineBlame';
import type { GitExtension } from './git/git';
import { CommitAction, GraphController, MenuContext } from './GraphController';
import { GraphPanel, GraphViewProvider } from './GraphPanel';
import { RevisionContentProvider, REVISION_SCHEME } from './RevisionContentProvider';
import { Settings } from './Settings';
import { SettingsPanel } from './SettingsPanel';

const COMMIT_COMMANDS: Record<string, CommitAction> = {
  'dendro.copySha': 'copySha',
  'dendro.copyMessage': 'copyMessage',
  'dendro.checkoutCommit': 'checkout',
  'dendro.createBranch': 'createBranch',
  'dendro.cherryPick': 'cherryPick',
  'dendro.revert': 'revert',
  'dendro.reset': 'reset',
};

const ANNOTATION_COMMANDS: Record<string, AnnotationKind> = {
  'dendro.toggleFileBlame': 'blame',
  'dendro.toggleFileHeatmap': 'heatmap',
  'dendro.toggleFileChanges': 'changes',
};

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!gitExtension) {
    void vscode.window.showErrorMessage('Dendro needs the built-in Git extension, and it is not available.');
    return;
  }

  const api = (await gitExtension.activate()).getAPI(1);
  const avatars = new AvatarService(context, api.git.path);
  GraphPanel.avatars = avatars;
  const blame = new BlameService(api, avatars);
  const annotations = new FileAnnotations(blame, avatars);
  const lineBlame = new LineBlame(blame);
  const subscriptions = context.subscriptions;

  subscriptions.push(
    new AutoFetcher(api),
    avatars,
    blame,
    annotations,
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('dendro.avatars')) {
        void avatars.forgetAll();
      }
    }),
    vscode.commands.registerCommand('dendro.connectGitLabAvatars', () =>
      avatars.connectGitLab(
        vscode.window.activeTextEditor ? blame.findRoot(vscode.window.activeTextEditor.document.uri) : api.repositories[0]?.rootUri.fsPath,
      ),
    ),
    lineBlame,
    vscode.workspace.registerTextDocumentContentProvider(REVISION_SCHEME, new RevisionContentProvider(api.git.path)),
    vscode.languages.registerHoverProvider({ scheme: 'file' }, new BlameHovers(blame, annotations)),
    vscode.window.registerWebviewViewProvider(GraphViewProvider.viewId, new GraphViewProvider(context, api), {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewPanelSerializer(GraphPanel.viewType, {
      async deserializeWebviewPanel(panel) {
        GraphPanel.attach(panel, context, api);
      },
    }),
    vscode.window.registerWebviewPanelSerializer(SettingsPanel.viewType, {
      async deserializeWebviewPanel(panel) {
        SettingsPanel.revive(panel, context);
      },
    }),
    vscode.commands.registerCommand('dendro.show', () => GraphPanel.open(context, api)),
    vscode.commands.registerCommand('dendro.showSettings', (section?: string) =>
      SettingsPanel.show(context, typeof section === 'string' ? section : undefined),
    ),
    vscode.commands.registerCommand('dendro.refresh', () => GraphController.latest?.refresh()),
    vscode.commands.registerCommand('dendro.showCommit', (sha: string, root?: string) =>
      GraphPanel.open(context, api, sha, root),
    ),
    vscode.commands.registerCommand('dendro.copyText', async (text: string) => {
      await vscode.env.clipboard.writeText(text);
      vscode.window.setStatusBarMessage('$(check) Dendro: copied', 2000);
    }),
    vscode.commands.registerCommand('dendro.openLineChanges', (root: string, sha: string, filePath: string) =>
      openCommitFileDiff(blame, root, sha, filePath),
    ),
    vscode.commands.registerCommand(
      'dendro.statusBarAction',
      async (root: string, sha: string, filePath: string, uncommitted: boolean) => {
        if (uncommitted) {
          await vscode.commands.executeCommand('git.openChange', vscode.Uri.file(path.join(root, filePath)));
          return;
        }
        switch (Settings.get<string>('statusBar.command')) {
          case 'openChanges':
            await openCommitFileDiff(blame, root, sha, filePath);
            return;
          case 'copySha':
            await vscode.commands.executeCommand('dendro.copyText', sha);
            return;
          default:
            await GraphPanel.open(context, api, sha, root);
        }
      },
    ),
    vscode.commands.registerCommand('dendro.clearFileAnnotations', () => annotations.clearAll()),
    vscode.commands.registerCommand('dendro.checkoutRef', (menu: MenuContext) =>
      GraphController.findByViewId(menu?.webview)?.runRefAction('checkout', menu),
    ),
    vscode.commands.registerCommand('dendro.copyRefName', (menu: MenuContext) =>
      GraphController.findByViewId(menu?.webview)?.runRefAction('copyName', menu),
    ),
  );

  for (const [command, action] of Object.entries(COMMIT_COMMANDS)) {
    subscriptions.push(
      vscode.commands.registerCommand(command, (menu: MenuContext) =>
        GraphController.findByViewId(menu?.webview)?.runCommitAction(action, menu),
      ),
    );
  }
  for (const [command, kind] of Object.entries(ANNOTATION_COMMANDS)) {
    subscriptions.push(
      vscode.commands.registerCommand(command, (uri?: vscode.Uri) => {
        const editor =
          uri instanceof vscode.Uri
            ? vscode.window.visibleTextEditors.find((candidate) => candidate.document.uri.toString() === uri.toString())
            : vscode.window.activeTextEditor;
        return annotations.toggle(kind, editor);
      }),
    );
  }
}

// What the commit changed in this file: its parent's version against its own, following a rename.
async function openCommitFileDiff(blame: BlameService, root: string, sha: string, filePath: string): Promise<void> {
  const git = blame.createGit(root);
  const details = await git.getCommitDetails(sha);
  const file = details.files.find((candidate) => candidate.path === filePath);
  const parent = details.parents[0] ?? null;
  const oldPath = file?.oldPath ?? filePath;
  const left = RevisionContentProvider.buildUri(root, oldPath, file?.status === 'A' ? null : parent);
  const right = RevisionContentProvider.buildUri(root, filePath, file?.status === 'D' ? null : sha);
  const title = `${path.basename(filePath)} (${parent ? parent.slice(0, 7) : 'root'} ↔ ${sha.slice(0, 7)})`;
  await vscode.commands.executeCommand('vscode.diff', left, right, title, { preview: true });
}

export function deactivate(): void {}
