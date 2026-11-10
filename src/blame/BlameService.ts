import * as path from 'node:path';
import * as vscode from 'vscode';
import type { AvatarService } from '../AvatarService';
import type { API } from '../git/git';
import { GitService } from '../git/GitService';
import { Settings } from '../Settings';
import { BlameCommit, BlameParser, BlameResult } from './BlameParser';

export interface LineBlameInfo {
  root: string;
  path: string;
  line: number;
  originalLine: number;
  commit: BlameCommit;
}

interface CachedBlame {
  version: number;
  result: Promise<BlameResult | null>;
}

// Blame per open document, cached by the document version. An unsaved document is blamed with its current text
// (`--contents -`), so lines keep lining up while you type; its own edits come back as not committed yet.
export class BlameService implements vscode.Disposable {
  private readonly cache = new Map<string, CachedBlame>();
  private readonly userEmails = new Map<string, Promise<string | null>>();
  private readonly messages = new Map<string, Promise<string>>();
  private readonly unpushed = new Map<string, Promise<Set<string>>>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly changeEmitter = new vscode.EventEmitter<void>();

  // Fires when blame may have changed for every file: a commit, a checkout, a pull.
  readonly onDidChange = this.changeEmitter.event;

  constructor(
    private readonly api: API,
    readonly avatars: AvatarService,
  ) {
    const watchRepository = (repo: API['repositories'][number]) =>
      this.disposables.push(repo.state.onDidChange(() => this.onRepositoryChanged()));
    api.repositories.forEach(watchRepository);

    this.disposables.push(
      api.onDidOpenRepository(watchRepository),
      vscode.workspace.onDidCloseTextDocument((document) => this.cache.delete(document.uri.toString())),
    );
  }

  dispose(): void {
    this.changeEmitter.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  findRoot(uri: vscode.Uri): string | undefined {
    if (uri.scheme !== 'file') {
      return undefined;
    }
    return this.api.repositories
      .map((repo) => repo.rootUri.fsPath)
      .filter((root) => uri.fsPath.startsWith(root + path.sep))
      .sort((left, right) => right.length - left.length)[0];
  }

  createGit(root: string): GitService {
    return new GitService(this.api.git.path, root);
  }

  getBlame(document: vscode.TextDocument): Promise<BlameResult | null> {
    const root = this.findRoot(document.uri);
    if (!root) {
      return Promise.resolve(null);
    }

    const key = document.uri.toString();
    const cached = this.cache.get(key);
    if (cached && cached.version === document.version) {
      return cached.result;
    }

    if (document.isDirty && document.lineCount > Settings.get<number>('blame.dirtyMaxLines')) {
      return Promise.resolve(null);
    }

    const relativePath = BlameService.toGitPath(root, document.uri.fsPath);
    const args = ['blame', '--porcelain'];
    let input: string | undefined;
    if (document.isDirty) {
      args.push('--contents', '-');
      input = document.getText();
    }
    args.push('--', relativePath);

    const result = this.createGit(root)
      .run(args, input)
      .then((output) => BlameParser.parse(output))
      .catch(() => null);
    this.cache.set(key, { version: document.version, result });
    return result;
  }

  async getLineInfo(document: vscode.TextDocument, line: number): Promise<LineBlameInfo | null> {
    const root = this.findRoot(document.uri);
    const blame = await this.getBlame(document);
    const entry = blame?.lines[line];
    if (!root || !blame || !entry) {
      return null;
    }
    return {
      root,
      path: BlameService.toGitPath(root, document.uri.fsPath),
      line,
      originalLine: entry.originalLine,
      commit: blame.commits.get(entry.sha)!,
    };
  }

  getUserEmail(root: string): Promise<string | null> {
    let email = this.userEmails.get(root);
    if (!email) {
      email = this.createGit(root)
        .run(['config', 'user.email'])
        .then((output) => output.trim() || null)
        .catch(() => null);
      this.userEmails.set(root, email);
    }
    return email;
  }

  getFullMessage(root: string, sha: string): Promise<string> {
    let message = this.messages.get(sha);
    if (!message) {
      message = this.createGit(root)
        .run(['show', '-s', '--format=%B', sha, '--'])
        .then((output) => output.trim())
        .catch(() => '');
      this.messages.set(sha, message);
    }
    return message;
  }

  // Commits on the current branch that its upstream does not have yet.
  getUnpushedShas(root: string): Promise<Set<string>> {
    let shas = this.unpushed.get(root);
    if (!shas) {
      shas = this.createGit(root)
        .run(['rev-list', '@{upstream}..HEAD'])
        .then((output) => new Set(output.split('\n').filter(Boolean)))
        .catch(() => new Set<string>());
      this.unpushed.set(root, shas);
    }
    return shas;
  }

  // The lines of the commit's diff for this file around the blamed line, as "-old" / "+new" lines.
  async getLineChange(info: LineBlameInfo, maxLines = 12): Promise<string[] | null> {
    const { commit } = info;
    const git = this.createGit(info.root);
    let args: string[];

    if (commit.uncommitted) {
      args = ['diff', '-U0', 'HEAD', '--', info.path];
    } else if (commit.previousSha) {
      args = ['diff', '-U0', '-M', commit.previousSha, commit.sha, '--', commit.previousPath ?? info.path, commit.path];
    } else {
      args = ['show', '-U0', '--format=', commit.sha, '--', commit.path];
    }

    try {
      const diff = await git.run(args);
      return BlameService.findHunk(diff, commit.uncommitted ? info.line + 1 : info.originalLine, maxLines);
    } catch {
      return null;
    }
  }

  static findHunk(diff: string, newLine: number, maxLines: number): string[] | null {
    const lines = diff.split('\n');

    for (let index = 0; index < lines.length; index++) {
      const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(lines[index]);
      if (!header) {
        continue;
      }
      const start = Number(header[1]);
      const count = header[2] === undefined ? 1 : Number(header[2]);
      if (newLine < start || newLine >= start + Math.max(1, count)) {
        continue;
      }

      const body: string[] = [];
      for (let next = index + 1; next < lines.length && !lines[next].startsWith('@@'); next++) {
        if (lines[next].startsWith('-') || lines[next].startsWith('+')) {
          body.push(lines[next]);
        }
      }
      return body.length > maxLines ? [...body.slice(0, maxLines), '…'] : body;
    }

    return null;
  }

  static toGitPath(root: string, fsPath: string): string {
    return path.relative(root, fsPath).split(path.sep).join('/');
  }

  private onRepositoryChanged(): void {
    this.cache.clear();
    this.unpushed.clear();
    this.changeEmitter.fire();
  }
}
