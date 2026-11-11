import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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
    private readonly onResult: (action: RemoteAction, ok: boolean, message?: string) => void,
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

  // The subject is edited and the body kept. The last commit is amended; an older one is reworded by a rebase that
  // git runs without asking: its todo gets "reword" on the first line and the editor copies in the new message.
  async reword(target: CommitTarget, headHash: string | null): Promise<void> {
    const isHead = target.hash === headHash;
    if (!isHead && !(await this.canRebaseFrom(target))) {
      return;
    }

    const { message } = await this.git.getCommitDetails(target.hash);
    const [subject, ...rest] = message.split('\n');
    const body = rest.join('\n').trim();
    const newSubject = await vscode.window.showInputBox({
      title: `Edit the message of ${RepoActions.shortHash(target.hash)}`,
      prompt: body ? 'The subject line; the rest of the message stays as it is.' : 'The commit message',
      value: subject,
      validateInput: (value) => (value.trim() ? null : 'Enter a message'),
    });
    if (!newSubject || newSubject.trim() === subject.trim()) {
      return;
    }
    const newMessage = body ? `${newSubject.trim()}\n\n${body}\n` : `${newSubject.trim()}\n`;

    const pushed = await this.isPushed(target.hash);
    if (!isHead || pushed) {
      const notes = [
        isHead ? '' : 'The commits after it are replayed, so they get new SHAs too. Uncommitted changes are stashed for the time of it.',
        pushed ? 'The commit is already pushed: the branch will need a force push.' : '',
      ];
      const confirmed = await RepoActions.confirm(
        `Change the message of ${RepoActions.shortHash(target.hash)}?`,
        notes.filter(Boolean).join(' '),
        'Change Message',
      );
      if (!confirmed) {
        return;
      }
    }

    if (isHead) {
      const args = ['commit', '--amend', '--only', '--allow-empty', '-m', newSubject.trim(), ...(body ? ['-m', body] : [])];
      await this.runLocal(args, `Changed the message of ${RepoActions.shortHash(target.hash)}`);
      return;
    }

    const messageFile = path.join(os.tmpdir(), `dendro-message-${randomUUID()}.txt`);
    await fs.writeFile(messageFile, newMessage, 'utf8');
    const quotedFile = `"${messageFile.split(path.sep).join('/')}"`;
    const base = target.parentCount ? `${target.hash}~1` : '--root';
    try {
      await this.runLocal(['rebase', '-i', '--autostash', base], `Changed the message of ${RepoActions.shortHash(target.hash)}`, {
        GIT_SEQUENCE_EDITOR: 'sed -i.bak -e "1s/^[a-z]* /reword /"',
        GIT_EDITOR: `cp ${quotedFile}`,
      });
    } finally {
      await fs.rm(messageFile, { force: true });
    }
  }

  // A rebase replays a straight line of commits: the commit has to be on the current branch, and neither it nor the
  // commits after it may be merges, which a plain rebase would flatten.
  private async canRebaseFrom(target: CommitTarget): Promise<boolean> {
    if ((await this.tryGit(['merge-base', '--is-ancestor', target.hash, 'HEAD'])) !== null) {
      void vscode.window.showWarningMessage('Dendro: only a commit of the current branch can get a new message.');
      return false;
    }
    const merges = await this.git.run(['rev-list', '--merges', `${target.hash}~1..HEAD`]).catch(() => '');
    if (target.parentCount > 1 || merges.trim()) {
      void vscode.window.showWarningMessage(
        'Dendro: there are merge commits from this commit on. Use "Interactive Rebase from Here…" to change its message.',
      );
      return false;
    }
    return true;
  }

  private async isPushed(hash: string): Promise<boolean> {
    const upstream = await this.git.run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).catch(() => '');
    return Boolean(upstream.trim()) && (await this.tryGit(['merge-base', '--is-ancestor', hash, upstream.trim()])) === null;
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

  async createTag(target: CommitTarget): Promise<void> {
    const name = await vscode.window.showInputBox({
      title: `Tag ${RepoActions.shortHash(target.hash)}`,
      prompt: target.subject,
      placeHolder: 'Tag name, e.g. v1.4.0',
      validateInput: async (value) =>
        value.trim() && (await this.git.isValidRefName(`refs/tags/${value.trim()}`)) ? null : 'Not a valid tag name',
    });
    if (!name) {
      return;
    }
    const message = await vscode.window.showInputBox({
      title: `Message for ${name.trim()}`,
      prompt: 'With a message the tag is annotated; leave it empty for a plain tag.',
    });
    if (message === undefined) {
      return;
    }
    const args = message.trim()
      ? ['tag', '-a', name.trim(), '-m', message.trim(), target.hash]
      : ['tag', name.trim(), target.hash];
    await this.runLocal(args, `Tagged ${RepoActions.shortHash(target.hash)} as ${name.trim()}`);
  }

  async mergeIntoCurrent(source: string, current: string | null): Promise<void> {
    if (!current) {
      void vscode.window.showWarningMessage('Dendro: HEAD is detached. Check out a branch to merge into it.');
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      `Merge ${source} into ${current}?`,
      { modal: true, detail: 'With "Merge" git fast-forwards when it can; the other button always makes a merge commit.' },
      'Merge',
      'Merge with a merge commit',
    );
    if (!choice) {
      return;
    }
    const args = choice === 'Merge' ? ['merge', source] : ['merge', '--no-ff', source];
    await this.runLocal(args, `Merged ${source} into ${current}`);
  }

  async rebaseCurrentOnto(target: string, label: string, current: string | null): Promise<void> {
    if (!current) {
      void vscode.window.showWarningMessage('Dendro: HEAD is detached. Check out a branch to rebase it.');
      return;
    }
    const confirmed = await RepoActions.confirm(
      `Rebase ${current} onto ${label}?`,
      `The commits of ${current} that ${label} does not have are replayed on top of it. Commits already pushed will need a force push.`,
      'Rebase',
    );
    if (confirmed) {
      await this.runLocal(['rebase', target], `Rebased ${current} onto ${label}`);
    }
  }

  async deleteRef(ref: RefInfo): Promise<void> {
    if (ref.kind === 'tag') {
      if (await RepoActions.confirm(`Delete tag ${ref.name}?`, 'The tag is removed here; a pushed tag stays on the remote.', 'Delete')) {
        await this.runLocal(['tag', '-d', ref.name], `Deleted tag ${ref.name}`);
      }
      return;
    }

    if (ref.kind === 'remote' && ref.remote) {
      const branch = ref.name.slice(ref.remote.length + 1);
      const confirmed = await RepoActions.confirm(
        `Delete ${branch} from ${ref.remote}?`,
        'The branch is removed from the remote for everyone who uses it.',
        'Delete from remote',
      );
      if (confirmed) {
        await this.runLocal(['push', ref.remote, '--delete', branch], `Deleted ${ref.name}`);
      }
      return;
    }

    if (!(await RepoActions.confirm(`Delete branch ${ref.name}?`, 'Only the local branch is deleted.', 'Delete'))) {
      return;
    }
    const failure = await this.tryGit(['branch', '-d', ref.name]);
    if (failure === null) {
      vscode.window.setStatusBarMessage(`$(check) Dendro: Deleted ${ref.name}`, 3000);
    } else if (/not fully merged/i.test(failure)) {
      const force = await RepoActions.confirm(
        `${ref.name} is not merged anywhere. Delete it anyway?`,
        'Its commits that no other branch has will be lost.',
        'Delete anyway',
      );
      if (force) {
        await this.runLocal(['branch', '-D', ref.name], `Deleted ${ref.name}`);
      }
    } else {
      void vscode.window.showErrorMessage(`Dendro: could not delete ${ref.name}. ${RepoActions.firstLine(failure)}`);
    }
    this.onChanged();
  }

  async renameBranch(ref: RefInfo): Promise<void> {
    const name = await vscode.window.showInputBox({
      title: `Rename ${ref.name}`,
      value: ref.name,
      validateInput: async (value) => (value.trim() && (await this.git.isValidBranchName(value.trim())) ? null : 'Not a valid branch name'),
    });
    if (name && name.trim() !== ref.name) {
      await this.runLocal(['branch', '-m', ref.name, name.trim()], `Renamed ${ref.name} to ${name.trim()}`);
    }
  }

  async pushBranch(ref: RefInfo): Promise<void> {
    if (ref.upstream) {
      const [remote] = ref.upstream.split('/');
      await this.runRemoteTask('push', `Pushing ${ref.name}`, () => this.repo.push(remote, ref.name));
      return;
    }
    const remote = await this.pickRemote();
    if (remote) {
      await this.runRemoteTask('push', `Publishing ${ref.name}`, () => this.repo.push(remote, ref.name, true));
    }
  }

  async runStash(action: 'apply' | 'pop' | 'drop', stashRef: string, message: string): Promise<void> {
    if (action === 'drop' && !(await RepoActions.confirm(`Drop ${stashRef}?`, `"${message}" will be lost.`, 'Drop'))) {
      return;
    }
    const done: Record<typeof action, string> = { apply: 'Applied', pop: 'Popped', drop: 'Dropped' };
    await this.runLocal(['stash', action, stashRef], `${done[action]} ${stashRef}`);
  }

  private async tryGit(args: string[]): Promise<string | null> {
    try {
      await this.git.run(args);
      return null;
    } catch (error) {
      return RepoActions.readErrorMessage(error);
    } finally {
      await this.repo.status().catch(() => undefined);
    }
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
      this.onResult(action, true);
    } catch (error) {
      this.onResult(action, false, RepoActions.firstLine(RepoActions.readErrorMessage(error)));
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

  private async runLocal(args: string[], successMessage: string, env: Record<string, string> = {}): Promise<void> {
    try {
      await this.git.run(args, undefined, env);
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
