import * as path from 'node:path';
import * as vscode from 'vscode';
import { AutoFetcher } from './AutoFetcher';
import { AvatarService } from './AvatarService';
import { BlameService } from './blame/BlameService';
import { CommitDiffs } from './CommitDiffs';
import { ComparePanel } from './compare/ComparePanel';
import { BlameCodeLens } from './editor/BlameCodeLens';
import { BlameHovers } from './editor/BlameHovers';
import { AnnotationKind, FileAnnotations } from './editor/FileAnnotations';
import { LineBlame } from './editor/LineBlame';
import type { GitExtension } from './git/git';
import { GraphController, MenuContext, RefAction, StashAction } from './GraphController';
import type { CommitAction } from './protocol';
import { GraphPanel, GraphViewProvider } from './GraphPanel';
import { FileHistoryChart } from './history/FileHistoryChart';
import { HistoryViews } from './history/HistoryViews';
import { InteractiveRebase } from './rebase/InteractiveRebase';
import { RebaseEditorProvider } from './rebase/RebaseEditorProvider';
import { RepositoryViews } from './repository/RepositoryViews';
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
  'dendro.createTag': 'createTag',
  'dendro.mergeIntoCurrent': 'mergeIntoCurrent',
  'dendro.rebaseCurrentOnto': 'rebaseCurrentOnto',
};

const REF_COMMANDS: Record<string, RefAction> = {
  'dendro.checkoutRef': 'checkout',
  'dendro.copyRefName': 'copyName',
  'dendro.deleteRef': 'delete',
  'dendro.renameBranch': 'rename',
  'dendro.pushBranch': 'push',
  'dendro.mergeRefIntoCurrent': 'merge',
  'dendro.rebaseCurrentOntoRef': 'rebase',
  'dendro.openWorktree': 'openWorktree',
};

const STASH_COMMANDS: Record<string, StashAction> = {
  'dendro.stashApply': 'apply',
  'dendro.stashPop': 'pop',
  'dendro.stashDrop': 'drop',
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
  const autoFetcher = new AutoFetcher(api);
  GraphPanel.services = { avatars, autoFetcher };
  const blame = new BlameService(api, avatars);
  const annotations = new FileAnnotations(blame, avatars);
  const lineBlame = new LineBlame(blame);
  const codeLens = new BlameCodeLens(blame);
  const subscriptions = context.subscriptions;

  const rootOfActiveEditor = () => {
    const uri = vscode.window.activeTextEditor?.document.uri;
    return (uri && blame.findRoot(uri)) ?? GraphController.latest?.root ?? api.repositories[0]?.rootUri.fsPath;
  };

  subscriptions.push(
    vscode.window.registerCustomEditorProvider(RebaseEditorProvider.viewType, new RebaseEditorProvider(context, blame), {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('dendro.rebaseInteractive', (menu: MenuContext) => {
      const controller = GraphController.findByViewId(menu?.webview);
      if (controller?.root && menu.hash) {
        return InteractiveRebase.start(blame.createGit(controller.root), menu.hash, menu.hash.slice(0, 7));
      }
      return undefined;
    }),
    vscode.commands.registerCommand('dendro.rebaseContinue', () => {
      const root = rootOfActiveEditor();
      return root ? InteractiveRebase.continue(blame.createGit(root)) : undefined;
    }),
    vscode.commands.registerCommand('dendro.rebaseAbort', () => {
      const root = rootOfActiveEditor();
      return root ? InteractiveRebase.abort(blame.createGit(root)) : undefined;
    }),
    new RepositoryViews(api, blame),
    new HistoryViews(blame),
    autoFetcher,
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
    codeLens,
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLens),
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
    vscode.commands.registerCommand('dendro.compare', async () => {
      const editorUri = vscode.window.activeTextEditor?.document.uri;
      const root = (editorUri && blame.findRoot(editorUri)) ?? api.repositories[0]?.rootUri.fsPath;
      if (root) {
        const head = await blame.createGit(root).getHead();
        await ComparePanel.show(context, blame, root, head.branch ?? 'HEAD');
      }
    }),
    vscode.commands.registerCommand('dendro.compareRefs', (root: string, left: string, right?: string) =>
      ComparePanel.show(context, blame, root, left, right),
    ),
    vscode.commands.registerCommand('dendro.compareRefWithCurrent', (menu: MenuContext) => {
      const controller = GraphController.findByViewId(menu?.webview);
      if (controller?.root && menu.refName) {
        return ComparePanel.show(context, blame, controller.root, controller.currentBranch, menu.refName);
      }
      return undefined;
    }),
    vscode.commands.registerCommand('dendro.searchGraph', async (query: string) => {
      await GraphPanel.open(context, api);
      GraphController.latest?.searchFor(query);
    }),
    vscode.commands.registerCommand('dendro.copyText', async (text: string) => {
      await vscode.env.clipboard.writeText(text);
      vscode.window.setStatusBarMessage('$(check) Dendro: copied', 2000);
    }),
    vscode.commands.registerCommand('dendro.openLineChanges', (root: string, sha: string, filePath: string) =>
      CommitDiffs.openFileChange(blame.createGit(root), sha, filePath),
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
            await CommitDiffs.openFileChange(blame.createGit(root), sha, filePath);
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
    vscode.commands.registerCommand('dendro.showFileHistoryChart', (uri?: vscode.Uri) =>
      FileHistoryChart.show(context, blame, uri),
    ),
  );

  for (const [command, action] of Object.entries(COMMIT_COMMANDS)) {
    subscriptions.push(
      vscode.commands.registerCommand(command, (menu: MenuContext) =>
        GraphController.findByViewId(menu?.webview)?.runCommitAction(action, menu),
      ),
    );
  }
  for (const [command, action] of Object.entries(REF_COMMANDS)) {
    subscriptions.push(
      vscode.commands.registerCommand(command, (menu: MenuContext) =>
        GraphController.findByViewId(menu?.webview)?.runRefAction(action, menu),
      ),
    );
  }
  for (const [command, action] of Object.entries(STASH_COMMANDS)) {
    subscriptions.push(
      vscode.commands.registerCommand(command, (menu: MenuContext) =>
        GraphController.findByViewId(menu?.webview)?.runStashAction(action, menu),
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

export function deactivate(): void {}
