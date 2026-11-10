import * as path from 'node:path';
import * as vscode from 'vscode';
import type { GitService } from './git/GitService';
import { RevisionContentProvider } from './RevisionContentProvider';

export class CommitDiffs {
  // What a commit changed in one file: its first parent's version against its own, following a rename.
  static async openFileChange(git: GitService, sha: string, filePath: string, oldPath?: string): Promise<void> {
    const details = await git.getCommitDetails(sha);
    const file = details.files.find((candidate) => candidate.path === filePath);
    const parent = details.parents[0] ?? null;
    const before = file?.oldPath ?? oldPath ?? filePath;

    const left = RevisionContentProvider.buildUri(git.root, before, file?.status === 'A' ? null : parent);
    const right = RevisionContentProvider.buildUri(git.root, filePath, file?.status === 'D' ? null : sha);
    const title = `${path.basename(filePath)} (${parent ? parent.slice(0, 7) : 'root'} ↔ ${sha.slice(0, 7)})`;
    await vscode.commands.executeCommand('vscode.diff', left, right, title, { preview: true });
  }

  static async openRevision(root: string, sha: string, filePath: string): Promise<void> {
    const document = await vscode.workspace.openTextDocument(RevisionContentProvider.buildUri(root, filePath, sha));
    await vscode.window.showTextDocument(document, { preview: true });
  }
}
