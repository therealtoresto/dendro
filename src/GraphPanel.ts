import * as vscode from 'vscode';
import type { AvatarService } from './AvatarService';
import type { API } from './git/git';
import { GraphController } from './GraphController';
import { Settings } from './Settings';

// The graph lives either in an editor tab (GraphPanel) or in the bottom panel (GraphViewProvider); both hand the
// webview to a GraphController, which does the work.
export class GraphPanel {
  static readonly viewType = 'dendro.graph';
  private static panel: vscode.WebviewPanel | undefined;
  private static controller: GraphController | undefined;

  static avatars: AvatarService;

  static async open(context: vscode.ExtensionContext, api: API, revealHash?: string, root?: string): Promise<void> {
    if (Settings.get<string>('graph.location') === 'panel') {
      await vscode.commands.executeCommand(`${GraphViewProvider.viewId}.focus`);
      if (revealHash) {
        GraphViewProvider.revealWhenReady(revealHash, root);
      }
      return;
    }

    if (!GraphPanel.panel) {
      const panel = vscode.window.createWebviewPanel(GraphPanel.viewType, 'Commit Graph', vscode.ViewColumn.Active, {
        enableScripts: true,
        retainContextWhenHidden: true,
      });
      GraphPanel.attach(panel, context, api);
    }
    GraphPanel.panel!.reveal();
    if (revealHash) {
      GraphPanel.controller!.revealCommit(revealHash, root);
    }
  }

  static attach(panel: vscode.WebviewPanel, context: vscode.ExtensionContext, api: API): void {
    panel.iconPath = {
      light: vscode.Uri.joinPath(context.extensionUri, 'media', 'dendro-light.svg'),
      dark: vscode.Uri.joinPath(context.extensionUri, 'media', 'dendro-dark.svg'),
    };

    const controller = new GraphController(
      {
        viewId: GraphPanel.viewType,
        webview: panel.webview,
        setTitle: (title) => (panel.title = title),
        reveal: () => panel.reveal(undefined, true),
      },
      context,
      api,
      GraphPanel.avatars,
    );
    GraphPanel.panel = panel;
    GraphPanel.controller = controller;

    panel.onDidDispose(() => {
      controller.dispose();
      GraphPanel.panel = undefined;
      GraphPanel.controller = undefined;
    });
  }
}

export class GraphViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'dendro.graphView';
  private static controller: GraphController | undefined;
  private static pendingReveal: { hash: string; root?: string } | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly api: API,
  ) {}

  static revealWhenReady(hash: string, root?: string): void {
    if (GraphViewProvider.controller) {
      GraphViewProvider.controller.revealCommit(hash, root);
      return;
    }
    GraphViewProvider.pendingReveal = { hash, root };
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    const controller = new GraphController(
      {
        viewId: GraphViewProvider.viewId,
        webview: view.webview,
        setTitle: (title) => (view.description = title.replace(/^Graph · /, '')),
        reveal: () => view.show(true),
      },
      this.context,
      this.api,
      GraphPanel.avatars,
    );
    GraphViewProvider.controller = controller;

    if (GraphViewProvider.pendingReveal) {
      controller.revealCommit(GraphViewProvider.pendingReveal.hash, GraphViewProvider.pendingReveal.root);
      GraphViewProvider.pendingReveal = null;
    }

    view.onDidDispose(() => {
      controller.dispose();
      GraphViewProvider.controller = undefined;
    });
  }
}
