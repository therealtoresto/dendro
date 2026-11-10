import * as vscode from 'vscode';
import type { Repository } from './git/git';
import { GitCommandError, GitService } from './git/GitService';
import type { RefInfo, RemoteAction } from './protocol';
import { Settings } from './Settings';

interface CommitTarget {
  hash: string;
  subject: string;
  parentCount: number;
}

type ResetMode = 'soft' | 'mixed' | 'hard';

export class RepoActions {
  private runningAction: RemoteAction | null = null;

  constructor(
    private readonly repo: Repository,
    private readonly git: GitService,
    private readonly onBusyChange: (action: RemoteAction | null) => void,
    private readonly onChanged: () => void,
  ) {}

  get busyAction(): RemoteAction | null {
    return this.runningAction;
  }

  async runRemote(action: RemoteAction): Promise<void> {
    if (action === 'pull') {
      await this.runRemoteTask('pull', 'Pulling', () => this.repo.pull());
    } else if (action === 'push') {
      await this.push();
    } else {
      const prune = Settings.get<boolean>('graph.fetchPrune');
      await this.runRemoteTask('fetch', 'Fetching', () => this.repo.fetch({ all: true, prune }));
    }
  }

  async checkoutCommit(target: CommitTarget): Promise<void> {
    await this.runLocal(['checkout', '--detach', target.hash], `Checked out ${RepoActions.shortHash(target.hash)}`);
  }

  async checkoutRef(ref: RefInfo): Promise<void> {
    if (ref.kind === 'head') {
      await this.runLocal(['checkout', ref.name], `Switched to ${ref.name}`);
      return;
    }

    if (ref.kind === 'tag') {
      await this.runLocal(['checkout', '--detach', ref.name], `Checked out tag ${ref.name}`);
      return;
    }

    const localName = ref.name.slice((ref.remote ?? '').length + 1);
    if (await this.git.hasLocalBranch(localName)) {
      await this.runLocal(['checkout', localName], `Switched to ${localName}`);
      return;
    }
    await this.runLocal(['checkout', '--track', ref.name], `Created ${localName} tracking ${ref.name}`);
  }

  async createBranch(target: CommitTarget): Promise<void> {
    const name = await vscode.window.showInputBox({
      title: `Create branch at ${RepoActions.shortHash(target.hash)}`,
      prompt: target.subject,
      placeHolder: 'Branch name',
      validateInput: async (value) => {
        if (!value.trim()) {
          return 'Enter a branch name';
        }
        return (await this.git.isValidBranchName(value.trim())) ? null : 'Not a valid branch name';
      },
    });
    if (!name) {
      return;
    }

    await this.runLocal(['checkout', '-b', name.trim(), target.hash], `Created and switched to ${name.trim()}`);
  }

  async cherryPick(target: CommitTarget): Promise<void> {
    const confirmed = await RepoActions.confirm(
      `Cherry-pick ${RepoActions.shortHash(target.hash)} onto the current branch?`,
      RepoActions.describeMerge(target, target.subject),
      'Cherry-pick',
    );
    if (!confirmed) {
      return;
    }

    await this.runLocal(
      ['cherry-pick', ...RepoActions.getMainlineArgs(target), target.hash],
      `Cherry-picked ${RepoActions.shortHash(target.hash)}`,
    );
  }

  async revert(target: CommitTarget): Promise<void> {
    const confirmed = await RepoActions.confirm(
      `Revert ${RepoActions.shortHash(target.hash)}?`,
      RepoActions.describeMerge(target, `A new commit will undo "${target.subject}".`),
      'Revert',
    );
    if (!confirmed) {
      return;
    }

    await this.runLocal(
      ['revert', '--no-edit', ...RepoActions.getMainlineArgs(target), target.hash],
      `Reverted ${RepoActions.shortHash(target.hash)}`,
    );
  }

  async reset(target: CommitTarget, branch: string | null): Promise<void> {
    const options: (vscode.QuickPickItem & { mode: ResetMode })[] = [
      { mode: 'soft', label: 'Soft', detail: 'Move the branch; keep all changes staged.' },
      { mode: 'mixed', label: 'Mixed', detail: 'Move the branch; keep all changes as unstaged.' },
      { mode: 'hard', label: 'Hard', detail: 'Move the branch and DISCARD all changes, committed and uncommitted.' },
    ];
    const picked = await vscode.window.showQuickPick(options, {
      title: `Reset ${branch ?? 'HEAD'} to ${RepoActions.shortHash(target.hash)}`,
      placeHolder: target.subject,
    });
    if (!picked) {
      return;
    }

    if (picked.mode === 'hard') {
      const confirmed = await RepoActions.confirm(
        `Hard reset ${branch ?? 'HEAD'} to ${RepoActions.shortHash(target.hash)}?`,
        'Uncommitted changes and the commits after this one on the branch will be lost.',
        'Reset --hard',
      );
      if (!confirmed) {
        return;
      }
    }

    await this.runLocal(['reset', `--${picked.mode}`, target.hash], `Reset to ${RepoActions.shortHash(target.hash)}`);
  }

  private async push(): Promise<void> {
    const head = this.repo.state.HEAD;
    if (!head?.name) {
      void vscode.window.showWarningMessage('Dendro: HEAD is detached. Check out a branch to push.');
      return;
    }

    if (head.upstream) {
      await this.runRemoteTask('push', 'Pushing', () => this.repo.push());
      return;
    }

    const remote = await this.pickRemote();
    if (!remote) {
      return;
    }
    const confirmed = await RepoActions.confirm(
      `Publish "${head.name}" to "${remote}"?`,
      'The branch has no upstream yet. It will be pushed and set to track the remote branch.',
      'Publish',
    );
    if (!confirmed) {
      return;
    }

    await this.runRemoteTask('push', `Publishing ${head.name}`, () => this.repo.push(remote, head.name, true));
  }

  private async pickRemote(): Promise<string | undefined> {
    const remotes = this.repo.state.remotes.map((remote) => remote.name);
    if (remotes.length === 0) {
      void vscode.window.showWarningMessage('Dendro: this repository has no remotes.');
      return undefined;
    }
    if (remotes.length === 1) {
      return remotes[0];
    }
    return vscode.window.showQuickPick(remotes, { title: 'Publish to remote' });
  }

  private async runRemoteTask(action: RemoteAction, title: string, task: () => Promise<void>): Promise<void> {
    if (this.runningAction) {
      return;
    }

    this.runningAction = action;
    this.onBusyChange(action);
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Dendro: ${title}…` },
        task,
      );
      vscode.window.setStatusBarMessage(`$(check) Dendro: ${action} done`, 3000);
    } catch (error) {
      await this.showRemoteError(action, error);
    } finally {
      this.runningAction = null;
      this.onBusyChange(null);
      this.onChanged();
    }
  }

  private async showRemoteError(action: RemoteAction, error: unknown): Promise<void> {
    const message = RepoActions.readErrorMessage(error);
    const rejected = action === 'push' && /rejected|fetch first|non-fast-forward/i.test(message);

    if (rejected) {
      const choice = await vscode.window.showErrorMessage(
        'Dendro: push rejected — the remote has commits you do not have. Pull first.',
        { detail: message },
        'Pull',
      );
      if (choice === 'Pull') {
        await this.runRemote('pull');
      }
      return;
    }

    void vscode.window.showErrorMessage(`Dendro: ${action} failed. ${RepoActions.firstLine(message)}`, {
      detail: message,
    });
  }

  private async runLocal(args: string[], successMessage: string): Promise<void> {
    try {
      await this.git.run(args);
      vscode.window.setStatusBarMessage(`$(check) Dendro: ${successMessage}`, 3000);
    } catch (error) {
      const message = RepoActions.readErrorMessage(error);
      if (/conflict/i.test(message)) {
        const choice = await vscode.window.showWarningMessage(
          `Dendro: git ${args[0]} stopped on conflicts. Resolve them, then continue from Source Control.`,
          { detail: message },
          'Open Source Control',
        );
        if (choice === 'Open Source Control') {
          await vscode.commands.executeCommand('workbench.view.scm');
        }
      } else {
        void vscode.window.showErrorMessage(`Dendro: git ${args[0]} failed. ${RepoActions.firstLine(message)}`, {
          detail: message,
        });
      }
    } finally {
      await this.repo.status().catch(() => undefined);
      this.onChanged();
    }
  }

  private static getMainlineArgs(target: CommitTarget): string[] {
    return target.parentCount > 1 ? ['-m', '1'] : [];
  }

  private static describeMerge(target: CommitTarget, text: string): string {
    if (target.parentCount > 1) {
      return `${text}\n\nThis is a merge commit: its changes are taken against its first parent.`;
    }
    return text;
  }

  private static async confirm(message: string, detail: string, action: string): Promise<boolean> {
    const choice = await vscode.window.showWarningMessage(message, { modal: true, detail }, action);
    return choice === action;
  }

  private static readErrorMessage(error: unknown): string {
    if (error instanceof GitCommandError) {
      return error.message;
    }
    const gitError = error as { stderr?: string; message?: string };
    return (gitError.stderr || gitError.message || String(error)).trim();
  }

  private static firstLine(text: string): string {
    return text.split('\n').find((line) => line.trim()) ?? '';
  }

  static shortHash(hash: string): string {
    return hash.slice(0, 7);
  }
}
