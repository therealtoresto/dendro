import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';

export class WebviewHtml {
  // `bundle` names dist/<bundle>.js and dist/<bundle>.css. Images come only from the extension or as data URIs:
  // author pictures are downloaded by the extension, so the page itself never calls a remote host.
  static build(webview: vscode.Webview, extensionUri: vscode.Uri, bundle: string, title: string): string {
    const distUri = vscode.Uri.joinPath(extensionUri, 'dist');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, `${bundle}.js`));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, `${bundle}.css`));
    const nonce = randomBytes(16).toString('hex');
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `img-src ${webview.cspSource} data:`,
      `font-src ${webview.cspSource}`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>${title}</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
