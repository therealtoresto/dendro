import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import * as path from 'node:path';
import type {
  ChangedFile,
  CommitDetails,
  CommitInfo,
  CommitStats,
  HeadInfo,
  RefInfo,
  WorkingDetails,
} from '../protocol';
import { FIELD_SEPARATOR, GitOutputParser, HistoryEntry } from './GitOutputParser';

const LOG_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%ct', '%s', '%b'].join('%x1f') + '%x1e';
const HISTORY_FORMAT = '%x1e' + ['%H', '%P', '%an', '%ae', '%at', '%s'].join('%x1f');
const DETAILS_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%cn', '%ce', '%ct', '%B'].join('%x1f');
const MAX_OUTPUT_BYTES = 512 * 1024 * 1024;

export class GitCommandError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
    readonly exitCode: number | null,
  ) {
    super(message);
  }
}

export type CommitOrder = 'date' | 'author-date' | 'topo';

export interface CommitPageRequest {
  skip: number;
  count: number;
  revisions: string[];
  order: CommitOrder;
}

const ORDER_FLAGS: Record<CommitOrder, string> = {
  date: '--date-order',
  'author-date': '--author-date-order',
  topo: '--topo-order',
};

export class GitService {
  private gitDir: string | null = null;

  constructor(
    private readonly gitPath: string,
    readonly root: string,
  ) {}

  run(args: string[], input?: string): Promise<string> {
    return this.runForBuffer(args, input).then((buffer) => buffer.toString('utf8'));
  }

  runForBuffer(args: string[], input?: string): Promise<Buffer> {
    // No prompts from the CLI path: credentials are the built-in Git extension's job (pull / push / fetch go there).
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };

    return new Promise((resolve, reject) => {
      const child = execFile(
        this.gitPath,
        args,
        { cwd: this.root, env, encoding: 'buffer', maxBuffer: MAX_OUTPUT_BYTES },
        (error, stdout, stderr) => {
          if (error) {
            const stderrText = stderr.toString('utf8').trim();
            const exitCode = typeof error.code === 'number' ? error.code : null;
            reject(new GitCommandError(stderrText || error.message, stderrText, exitCode));
            return;
          }
          resolve(stdout);
        },
      );
      child.stdin?.end(input ?? '');
    });
  }

  async getCommits(request: CommitPageRequest): Promise<{ commits: CommitInfo[]; hasMore: boolean }> {
    if (request.revisions.length === 0) {
      return { commits: [], hasMore: false };
    }

    const args = [
      'log',
      ...request.revisions,
      ORDER_FLAGS[request.order],
      `--skip=${request.skip}`,
      `--max-count=${request.count + 1}`,
      `--format=${LOG_FORMAT}`,
      '--',
    ];
    const commits = GitOutputParser.parseLog(await this.run(args));
    const hasMore = commits.length > request.count;

    return { commits: hasMore ? commits.slice(0, request.count) : commits, hasMore };
  }

  // A merge counts against its first parent, as in the commit details.
  async getCommitStats(hashes: string[]): Promise<Map<string, CommitStats>> {
    if (hashes.length === 0) {
      return new Map();
    }
    const args = ['log', '--no-walk=unsorted', '--stdin', '--shortstat', '--diff-merges=first-parent', '--format=%x1e%H'];
    return GitOutputParser.parseShortStats(await this.run(args, hashes.join('\n') + '\n'));
  }

  async getRefs(): Promise<RefInfo[]> {
    const format = ['%(objectname)', '%(*objectname)', '%(refname)', '%(upstream:short)', '%(upstream:track)'].join('%1f');
    const output = await this.run(['for-each-ref', `--format=${format}`, 'refs/heads', 'refs/remotes', 'refs/tags']);
    return GitOutputParser.parseRefs(output);
  }

  async getHead(): Promise<HeadInfo> {
    const [branch, hash] = await Promise.all([
      this.readOptional(['symbolic-ref', '--short', '-q', 'HEAD']),
      this.readOptional(['rev-parse', '--verify', '-q', 'HEAD']),
    ]);
    const head: HeadInfo = { branch, hash, upstream: null, ahead: 0, behind: 0 };

    if (!branch || !hash) {
      return head;
    }

    head.upstream = await this.readOptional(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
    if (!head.upstream) {
      return head;
    }

    const counts = await this.readOptional(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
    if (counts) {
      Object.assign(head, GitOutputParser.parseAheadBehind(counts));
    }

    return head;
  }

  async getCommitDetails(hash: string): Promise<CommitDetails> {
    const header = await this.run(['show', '-s', `--format=${DETAILS_FORMAT}`, hash, '--']);
    const [fullHash, parents, author, email, authorDate, committer, committerEmail, commitDate, message] =
      header.split(FIELD_SEPARATOR);
    const parentHashes = parents ? parents.split(' ') : [];

    // A merge is shown against its first parent: what the merge brought into the branch.
    const range = parentHashes.length > 0 ? [parentHashes[0], fullHash] : ['--root', fullHash];
    const diffArgs = ['diff-tree', '-r', '-M', '-z', '--no-commit-id', ...range];
    const [nameStatus, numstat] = await Promise.all([
      this.run([...diffArgs, '--name-status']),
      this.run([...diffArgs, '--numstat']),
    ]);
    const files = GitOutputParser.attachStats(
      GitOutputParser.parseNameStatus(nameStatus),
      GitOutputParser.parseNumstat(numstat),
    );

    return {
      hash: fullHash,
      parents: parentHashes,
      author,
      email,
      authorDate: Number(authorDate),
      committer,
      committerEmail,
      commitDate: Number(commitDate),
      message: message.trimEnd(),
      files,
    };
  }

  // Commits that changed the file, following it across renames.
  async getFileHistory(filePath: string, limit: number): Promise<HistoryEntry[]> {
    const args = ['log', '--follow', `--max-count=${limit}`, `--format=${HISTORY_FORMAT}`, '--name-status', '--', filePath];
    return GitOutputParser.parseHistory(await this.run(args));
  }

  // The same history with the lines each commit added and deleted in the file.
  async getFileHistoryStats(filePath: string, limit: number): Promise<HistoryEntry[]> {
    const args = ['log', '--follow', `--max-count=${limit}`, `--format=${HISTORY_FORMAT}`, '--numstat', '-z', '--', filePath];
    return GitOutputParser.parseHistoryStats(await this.run(args));
  }

  // Commits that changed these lines (1-based, inclusive), as git traces the lines back.
  async getLineHistory(filePath: string, startLine: number, endLine: number, limit: number): Promise<HistoryEntry[]> {
    const args = ['log', `-L${startLine},${endLine}:${filePath}`, '-s', `--max-count=${limit}`, `--format=${HISTORY_FORMAT}`];
    return GitOutputParser.parseHistory(await this.run(args));
  }

  // Commits the upstream has and HEAD does not: fetched, not pulled yet.
  async getIncomingHashes(limit: number): Promise<string[]> {
    const output = await this.run(['rev-list', `--max-count=${limit}`, 'HEAD..@{upstream}']);
    return output.split('\n').filter(Boolean);
  }

  async getWorkingLineStats(): Promise<CommitStats> {
    return GitOutputParser.parseShortStatLine(await this.run(['diff', 'HEAD', '--shortstat']));
  }

  async getComparisonFiles(base: string, target: string): Promise<ChangedFile[]> {
    const diffArgs = ['diff', '-M', '-z', base, target];
    const [nameStatus, numstat] = await Promise.all([
      this.run([...diffArgs, '--name-status']),
      this.run([...diffArgs, '--numstat']),
    ]);
    return GitOutputParser.attachStats(
      GitOutputParser.parseNameStatus(nameStatus),
      GitOutputParser.parseNumstat(numstat),
    );
  }

  async getDefaultBranch(): Promise<string | null> {
    const remoteHead = await this.readOptional(['symbolic-ref', '--short', '-q', 'refs/remotes/origin/HEAD']);
    if (remoteHead) {
      return remoteHead.slice(remoteHead.indexOf('/') + 1);
    }
    for (const candidate of ['main', 'master']) {
      if (await this.hasLocalBranch(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  async getWorkingDetails(): Promise<WorkingDetails> {
    const [status, unstagedStats, stagedStats] = await Promise.all([
      this.run(['status', '--porcelain=v1', '-z']),
      this.run(['diff', '--numstat', '-z']).catch(() => ''),
      this.run(['diff', '--cached', '-M', '--numstat', '-z']).catch(() => ''),
    ]);
    const details = GitOutputParser.parseStatus(status);

    GitOutputParser.attachStats(details.staged, GitOutputParser.parseNumstat(stagedStats));
    GitOutputParser.attachStats(details.unstaged, GitOutputParser.parseNumstat(unstagedStats));

    return details;
  }

  // ref "" reads the index (stage 0); a path missing at that ref reads as an empty file.
  async getFileContent(ref: string, filePath: string): Promise<Buffer> {
    try {
      return await this.runForBuffer(['show', `${ref}:${filePath}`]);
    } catch {
      return Buffer.alloc(0);
    }
  }

  // `--grep` and `--author` in one `git log` must both match, so message and author are two queries.
  async searchCommits(query: string, revisions: string[], limit: number): Promise<string[]> {
    if (revisions.length === 0) {
      return [];
    }

    const base = ['log', ...revisions, '--format=%H', '-i', '--fixed-strings', `--max-count=${limit}`];
    const searches = [
      this.run([...base, `--grep=${query}`, '--']),
      this.run([...base, `--author=${query}`, '--']),
    ];
    if (/^[0-9a-f]{4,40}$/i.test(query)) {
      searches.push(this.readOptional(['rev-parse', '--verify', '-q', `${query}^{commit}`]).then((hash) => hash ?? ''));
    }

    const outputs = await Promise.all(searches.map((search) => search.catch(() => '')));
    const hashes = new Set<string>();
    for (const output of outputs) {
      for (const line of output.split('\n')) {
        if (line) {
          hashes.add(line.trim());
        }
      }
    }

    return Array.from(hashes);
  }

  async getLastFetchTime(): Promise<number | null> {
    try {
      this.gitDir ??= (await this.run(['rev-parse', '--absolute-git-dir'])).trim();
      const info = await stat(path.join(this.gitDir, 'FETCH_HEAD'));
      return info.mtimeMs;
    } catch {
      return null;
    }
  }

  async isValidBranchName(name: string): Promise<boolean> {
    return (await this.readOptional(['check-ref-format', '--branch', name])) !== null;
  }

  async hasLocalBranch(name: string): Promise<boolean> {
    return (await this.readOptional(['rev-parse', '--verify', '-q', `refs/heads/${name}`])) !== null;
  }

  private async readOptional(args: string[]): Promise<string | null> {
    try {
      const output = (await this.run(args)).trim();
      return output || null;
    } catch {
      return null;
    }
  }
}
