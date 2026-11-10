import * as vscode from 'vscode';
import { Settings } from './Settings';
import type { SettingsHostMessage, SettingsWebviewMessage } from './settingsProtocol';
import { WebviewHtml } from './WebviewHtml';

// The Dendro settings screen. It reads and writes the user's settings.json through the catalog, so the screen,
// the Settings UI and settings.json always show the same values.
export class SettingsPanel {
  static readonly viewType = 'dendro.settings';
  private static current: SettingsPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  static show(context: vscode.ExtensionContext, section?: string): void {
    if (SettingsPanel.current) {
      SettingsPanel.current.panel.reveal();
      if (section) {
        SettingsPanel.current.post({ type: 'focusSection', id: section });
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(SettingsPanel.viewType, 'Dendro Settings', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });
    SettingsPanel.current = new SettingsPanel(panel, context, section);
  }

  static revive(panel: vscode.WebviewPanel, context: vscode.ExtensionContext): void {
    SettingsPanel.current = new SettingsPanel(panel, context);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    private readonly initialSection?: string,
  ) {
    panel.iconPath = {
      light: vscode.Uri.joinPath(context.extensionUri, 'media', 'dendro-light.svg'),
      dark: vscode.Uri.joinPath(context.extensionUri, 'media', 'dendro-dark.svg'),
    };
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
    };
    panel.webview.html = WebviewHtml.build(panel.webview, context.extensionUri, 'settings', 'Dendro Settings');

    this.disposables.push(
      panel.onDidDispose(() => this.dispose()),
      panel.webview.onDidReceiveMessage((message: SettingsWebviewMessage) => void this.handleMessage(message)),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('dendro')) {
          this.postValues();
        }
      }),
    );
  }

  private dispose(): void {
    SettingsPanel.current = undefined;
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async handleMessage(message: SettingsWebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.postValues();
        if (this.initialSection) {
          this.post({ type: 'focusSection', id: this.initialSection });
        }
        return;
      case 'update':
        try {
          await Settings.update(message.key, message.value);
        } catch (error) {
          void vscode.window.showErrorMessage(`Dendro: could not save ${message.key}. ${String(error)}`);
          this.postValues();
        }
        return;
      case 'openNativeSettings':
        await vscode.commands.executeCommand('workbench.action.openSettings', message.query);
        return;
    }
  }

  private postValues(): void {
    this.post({ type: 'values', values: Settings.readAll(), locale: Settings.getEditorLocale() });
  }

  private post(message: SettingsHostMessage): void {
    void this.panel.webview.postMessage(message);
  }
}
