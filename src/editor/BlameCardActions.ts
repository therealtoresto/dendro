import * as path from 'node:path';
import * as vscode from 'vscode';
import type { BlameCardAction, BlameCardTarget } from '../blame/BlameText';
import type { BlameService } from '../blame/BlameService';
import { CommitDiffs } from '../CommitDiffs';
import { SettingsCatalog } from '../shared/SettingsCatalog';

// The links of the blame card. Each one lands on a line of the same code, so reading history is a walk: from a
// commit's diff, the card of any line there leads to the commit before it.
export class BlameCardActions {
  static async run(blame: BlameService, action: BlameCardAction | 'toggleSetting', target: BlameCardTarget & { key?: string }): Promise<void> {
    switch (action) {
      case 'changes':
        await CommitDiffs.openFileChange(blame.createGit(target.root), target.sha, target.path, target.previousPath, target.originalLine - 1);
        return;
      case 'workingChanges':
        await vscode.commands.executeCommand('git.openChange', vscode.Uri.file(path.join(target.root, target.path)));
        return;
      case 'previous':
        // The blamed line sat near the same place before the commit; git does not say exactly where.
        await CommitDiffs.openRevision(target.root, target.previousSha ?? `${target.sha}^`, target.previousPath ?? target.path, target.originalLine - 1);
        return;
      case 'graph':
        await vscode.commands.executeCommand('dendro.showCommit', target.sha, target.root);
        return;
      case 'lineHistory':
        await vscode.commands.executeCommand('dendro.showLineHistory', vscode.Uri.file(path.join(target.root, target.path)), target.line + 1, target.line + 1);
        return;
      case 'copySha':
        await vscode.commands.executeCommand('dendro.copyText', target.sha);
        return;
      case 'toggleSetting':
        await BlameCardActions.toggleSetting(target.key);
        return;
    }
  }

  // Only switches of the catalog: a command link must not become a way to write any setting.
  private static async toggleSetting(key: string | undefined): Promise<void> {
    const item = key ? SettingsCatalog.findItem(key) : undefined;
    if (!key || !item || item.type !== 'boolean') {
      return;
    }
    const config = vscode.workspace.getConfiguration('dendro');
    await config.update(key, !config.get<boolean>(key, item.default as boolean), vscode.ConfigurationTarget.Global);
  }
}
