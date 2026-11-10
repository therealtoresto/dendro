import * as vscode from 'vscode';
import { GitService } from './git/GitService';

export const REVISION_SCHEME = 'dendro';

interface RevisionQuery {
  root: string;
  ref: string | null;
}

// Serves a file as it was at a commit (or in the index) for the diff editor; ref null is an empty side.
export class RevisionContentProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly gitPath: string) {}

  static buildUri(root: string, filePath: string, ref: string | null): vscode.Uri {
    const query: RevisionQuery = { root, ref };
    return vscode.Uri.from({
      scheme: REVISION_SCHEME,
      path: '/' + filePath,
      query: JSON.stringify(query),
    });
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const query = JSON.parse(uri.query) as RevisionQuery;
    if (query.ref === null) {
      return '';
    }

    const git = new GitService(this.gitPath, query.root);
    const content = await git.getFileContent(query.ref, uri.path.slice(1));
    return content.toString('utf8');
  }
}
