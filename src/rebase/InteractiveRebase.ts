import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { GitService } from '../git/GitService';

// Runs `git rebase -i` with this editor as git's editor: the todo list opens in the rebase editor, commit messages
// (reword, squash) open as normal files, and git goes on when they are closed.
export class InteractiveRebase {
  static findEditorCommand(): string | null {
    const binFolder = path.join(vscode.env.appRoot, 'bin');
    for (const name of ['cursor', 'code', 'code-insiders']) {
      const candidate = path.join(binFolder, name);
      if (existsSync(candidate)) {
        return `"${candidate}" --wait`;
      }
    }
    return null;
  }

  static async start(git: GitService, base: string, label: string): Promise<void> {
    const confirmed = await vscode.window.showInformationMessage(
      `Rebase the commits after ${label} interactively?`,
      { modal: true, detail: 'The list of commits opens in the rebase editor. Uncommitted changes are stashed for the time of the rebase.' },
      'Start',
    );
    if (confirmed === 'Start') {
      await InteractiveRebase.runGit(git, ['rebase', '-i', '--autostash', base], 'Rebase finished');
    }
  }

  static continue(git: GitService): Promise<void> {
    return InteractiveRebase.runGit(git, ['rebase', '--continue'], 'Rebase finished');
  }

  static abort(git: GitService): Promise<void> {
    return InteractiveRebase.runGit(git, ['rebase', '--abort'], 'Rebase aborted');
  }

  private static async runGit(git: GitService, args: string[], done: string): Promise<void> {
    const editor = InteractiveRebase.findEditorCommand();
    if (!editor) {
      void vscode.window.showErrorMessage('Dendro: cannot find the editor command line tool to hand to git.');
      return;
    }

    try {
      await git.run(args, undefined, { GIT_SEQUENCE_EDITOR: editor, GIT_EDITOR: editor });
      vscode.window.setStatusBarMessage(`$(check) Dendro: ${done}`, 4000);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/conflict|could not apply|stopped at/i.test(message)) {
        const choice = await vscode.window.showWarningMessage(
          'Dendro: the rebase stopped. Resolve the conflicts (or amend the commit), then continue.',
          { detail: message },
          'Continue Rebase',
          'Abort Rebase',
          'Open Source Control',
        );
        if (choice === 'Continue Rebase') {
          await InteractiveRebase.continue(git);
        } else if (choice === 'Abort Rebase') {
          await InteractiveRebase.abort(git);
        } else if (choice === 'Open Source Control') {
          await vscode.commands.executeCommand('workbench.view.scm');
        }
        return;
      }
      void vscode.window.showErrorMessage(`Dendro: git ${args[0]} failed. ${message.split('\n')[0]}`, { detail: message });
    }
  }
}
