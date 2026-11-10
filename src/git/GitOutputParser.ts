import type {
  ChangedFile,
  CommitInfo,
  CommitStats,
  FileStatus,
  RefInfo,
  StashInfo,
  WorkingDetails,
  WorktreeInfo,
} from '../protocol';

export const FIELD_SEPARATOR = '\x1f';
export const RECORD_SEPARATOR = '\x1e';

const BODY_PREVIEW_LENGTH = 240;

export interface BranchSummary {
  name: string;
  hash: string;
  upstream?: string;
  upstreamGone: boolean;
  ahead: number;
  behind: number;
  date: number;
  subject: string;
  isCurrent: boolean;
}

export interface TagSummary {
  name: string;
  hash: string;
  date: number;
  subject: string;
}

export interface RemoteEntry {
  name: string;
  url: string;
}

export interface Contributor {
  name: string;
  email: string;
  commits: number;
}

export interface HistoryEntry {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  date: number;
  subject: string;
  path?: string;
  oldPath?: string;
  additions?: number;
  deletions?: number;
}

export interface ActivityCommit {
  hash: string;
  author: string;
  email: string;
  date: number;
}

export interface ActivityStats {
  additions: number;
  deletions: number;
  files: string[];
}

interface LineStats {
  additions?: number;
  deletions?: number;
  binary: boolean;
}

export class GitOutputParser {
  static parseLog(output: string): CommitInfo[] {
    const commits: CommitInfo[] = [];

    for (const record of output.split(RECORD_SEPARATOR)) {
      const text = record.replace(/^\n/, '');
      if (!text) {
        continue;
      }

      const [hash, parents, author, email, date, commitDate, subject, body = ''] = text.split(FIELD_SEPARATOR);
      commits.push({
        hash,
        parents: parents ? parents.split(' ') : [],
        author,
        email,
        date: Number(date),
        commitDate: Number(commitDate),
        subject,
        bodyPreview: body.replace(/\s+/g, ' ').trim().slice(0, BODY_PREVIEW_LENGTH),
      });
    }

    return commits;
  }

  // `--format=%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s`, optionally with `--name-status` lines after each header,
  // which say the file's path in that commit ("R087<tab>old<tab>new" after a rename).
  static parseHistory(output: string): HistoryEntry[] {
    const entries: HistoryEntry[] = [];

    for (const record of output.split(RECORD_SEPARATOR)) {
      const [header, ...rest] = record.split('\n');
      if (!header.trim()) {
        continue;
      }

      const [hash, parents, author, email, date, subject] = header.split(FIELD_SEPARATOR);
      const entry: HistoryEntry = {
        hash,
        parents: parents ? parents.split(' ') : [],
        author,
        email,
        date: Number(date),
        subject,
      };

      const change = rest.find((line) => /^[A-Z]\d*\t/.test(line));
      if (change) {
        const parts = change.split('\t');
        entry.path = parts[parts.length - 1];
        entry.oldPath = parts.length > 2 ? parts[1] : undefined;
      }
      entries.push(entry);
    }

    return entries;
  }

  // The same history with `--numstat -z`: after each header a NUL, then "12<tab>3<tab>path" or, for a rename,
  // "12<tab>3<tab>" followed by the old and the new path, each ended by a NUL.
  static parseHistoryStats(output: string): HistoryEntry[] {
    const entries: HistoryEntry[] = [];

    for (const record of output.split(RECORD_SEPARATOR)) {
      const headerEnd = record.indexOf('\0');
      const header = headerEnd < 0 ? record : record.slice(0, headerEnd);
      if (!header.trim()) {
        continue;
      }

      const [hash, parents, author, email, date, subject] = header.split(FIELD_SEPARATOR);
      const entry: HistoryEntry = { hash, parents: parents ? parents.split(' ') : [], author, email, date: Number(date), subject };

      const tokens = headerEnd < 0 ? [] : record.slice(headerEnd + 1).replace(/^\n/, '').split('\0');
      const [additions, deletions, inlinePath] = (tokens[0] ?? '').split('\t');
      if (additions !== undefined && deletions !== undefined) {
        entry.additions = additions === '-' ? 0 : Number(additions);
        entry.deletions = deletions === '-' ? 0 : Number(deletions);
        if (inlinePath) {
          entry.path = inlinePath;
        } else {
          entry.oldPath = tokens[1];
          entry.path = tokens[2];
        }
      }
      entries.push(entry);
    }

    return entries;
  }

  // `for-each-ref --format=%(refname:short) %(objectname) %(upstream:short) %(upstream:track) %(committerdate:unix)
  // %(contents:subject) %(HEAD)` (fields split by 0x1f) over refs/heads.
  static parseBranches(output: string): BranchSummary[] {
    return output
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, hash, upstream, track, date, subject, head] = line.split(FIELD_SEPARATOR);
        return {
          name,
          hash,
          upstream: upstream || undefined,
          upstreamGone: track === '[gone]',
          ahead: GitOutputParser.readCount(track ?? '', /ahead (\d+)/),
          behind: GitOutputParser.readCount(track ?? '', /behind (\d+)/),
          date: Number(date),
          subject,
          isCurrent: head === '*',
        };
      });
  }

  // `for-each-ref --format=%(refname:short) %(objectname) %(*objectname) %(creatordate:unix) %(contents:subject)`
  // over refs/tags; an annotated tag is peeled to its commit.
  static parseTags(output: string): TagSummary[] {
    return output
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, hash, peeled, date, subject] = line.split(FIELD_SEPARATOR);
        return { name, hash: peeled || hash, date: Number(date), subject };
      });
  }

  // `remote -v`: "origin<tab>git@host:group/repo.git (fetch)"; one entry per remote, its fetch URL.
  static parseRemotes(output: string): RemoteEntry[] {
    const remotes: RemoteEntry[] = [];
    for (const line of output.split('\n')) {
      const match = /^(\S+)\t(\S+) \(fetch\)$/.exec(line);
      if (match && !remotes.some((remote) => remote.name === match[1])) {
        remotes.push({ name: match[1], url: match[2] });
      }
    }
    return remotes;
  }

  // `shortlog -sne`: "   296<tab>Ann Lee <ann@x.io>".
  static parseContributors(output: string): Contributor[] {
    const contributors: Contributor[] = [];
    for (const line of output.split('\n')) {
      const match = /^\s*(\d+)\t(.*) <(.*)>$/.exec(line);
      if (match) {
        contributors.push({ name: match[2], email: match[3], commits: Number(match[1]) });
      }
    }
    return contributors;
  }

  // `log --format=%H%x1f%an%x1f%ae%x1f%at`: one commit per line.
  static parseActivity(output: string): ActivityCommit[] {
    const commits: ActivityCommit[] = [];
    for (const line of output.split('\n')) {
      const [hash, author, email, date] = line.split(FIELD_SEPARATOR);
      if (hash && date) {
        commits.push({ hash, author, email: email.toLowerCase(), date: Number(date) });
      }
    }
    return commits;
  }

  // `log --format=%x1e%H --numstat --no-renames`: per commit the lines added and deleted and the files it touched.
  // Binary files count as touched with no lines.
  static parseActivityStats(output: string): Map<string, ActivityStats> {
    const statsByHash = new Map<string, ActivityStats>();
    for (const record of output.split(RECORD_SEPARATOR)) {
      const [hash, ...lines] = record.split('\n');
      if (!hash.trim()) {
        continue;
      }
      const stats: ActivityStats = { additions: 0, deletions: 0, files: [] };
      for (const line of lines) {
        const [additions, deletions, file] = line.split('\t');
        if (file === undefined) {
          continue;
        }
        stats.additions += additions === '-' ? 0 : Number(additions);
        stats.deletions += deletions === '-' ? 0 : Number(deletions);
        stats.files.push(file);
      }
      statsByHash.set(hash.trim(), stats);
    }
    return statsByHash;
  }

  // `stash list --format=%H%x1f%P%x1f%gd%x1f%gs%x1f%ct`: a stash is a commit on top of the commit it was made on.
  static parseStashes(output: string): StashInfo[] {
    return output
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, parents, ref, message, date] = line.split(FIELD_SEPARATOR);
        return { hash, base: parents.split(' ')[0], ref, message, date: Number(date) };
      });
  }

  // `worktree list --porcelain`: blocks of "worktree <path>", "HEAD <sha>", "branch <ref>" or "detached".
  static parseWorktrees(output: string, currentRoot: string): WorktreeInfo[] {
    const worktrees: WorktreeInfo[] = [];
    for (const block of output.split('\n\n')) {
      const lines = block.split('\n');
      const path = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length);
      const hash = lines.find((line) => line.startsWith('HEAD '))?.slice('HEAD '.length);
      if (!path || !hash) {
        continue;
      }
      const branch = lines.find((line) => line.startsWith('branch '))?.slice('branch refs/heads/'.length) ?? null;
      worktrees.push({ path, hash, branch, isCurrent: path === currentRoot });
    }
    return worktrees;
  }

  static parseRefs(output: string): RefInfo[] {
    const refs: RefInfo[] = [];

    for (const line of output.split('\n')) {
      if (!line) {
        continue;
      }

      const [hash, peeledHash, fullName, upstream, track] = line.split(FIELD_SEPARATOR);
      const target = peeledHash || hash;

      if (fullName.startsWith('refs/heads/')) {
        const ref: RefInfo = { name: fullName.slice('refs/heads/'.length), kind: 'head', hash: target };
        if (upstream) {
          ref.upstream = upstream;
          ref.ahead = GitOutputParser.readCount(track ?? '', /ahead (\d+)/);
          ref.behind = GitOutputParser.readCount(track ?? '', /behind (\d+)/);
        }
        refs.push(ref);
        continue;
      }

      if (fullName.startsWith('refs/remotes/')) {
        const name = fullName.slice('refs/remotes/'.length);
        // origin/HEAD only points at another remote branch and would duplicate its badge.
        if (name.endsWith('/HEAD')) {
          continue;
        }
        refs.push({ name, kind: 'remote', hash: target, remote: name.split('/')[0] });
        continue;
      }

      if (fullName.startsWith('refs/tags/')) {
        refs.push({ name: fullName.slice('refs/tags/'.length), kind: 'tag', hash: target });
      }
    }

    return refs;
  }

  // `--name-status -z`: "M\0path\0" or "R100\0old\0new\0".
  static parseNameStatus(output: string): ChangedFile[] {
    const tokens = output.split('\0');
    const files: ChangedFile[] = [];
    let index = 0;

    while (index < tokens.length) {
      const code = tokens[index++];
      if (!code) {
        continue;
      }

      const status = GitOutputParser.readStatus(code[0]);
      if (status === 'R' || status === 'C') {
        const oldPath = tokens[index++];
        const path = tokens[index++];
        files.push({ path, oldPath, status });
      } else {
        files.push({ path: tokens[index++], status });
      }
    }

    return files;
  }

  // `--numstat -z`: "12\t3\tpath\0", or "12\t3\t\0old\0new\0" for a rename; "-\t-\t" marks a binary file.
  static parseNumstat(output: string): Map<string, LineStats> {
    const tokens = output.split('\0');
    const statsByPath = new Map<string, LineStats>();
    let index = 0;

    while (index < tokens.length) {
      const token = tokens[index++];
      if (!token) {
        continue;
      }

      const [additions, deletions, inlinePath] = token.split('\t');
      let path = inlinePath;
      if (!path) {
        index++;
        path = tokens[index++];
      }

      const binary = additions === '-';
      statsByPath.set(path, {
        binary,
        additions: binary ? undefined : Number(additions),
        deletions: binary ? undefined : Number(deletions),
      });
    }

    return statsByPath;
  }

  static attachStats(files: ChangedFile[], statsByPath: Map<string, LineStats>): ChangedFile[] {
    for (const file of files) {
      const stats = statsByPath.get(file.path);
      if (!stats) {
        continue;
      }
      file.additions = stats.additions;
      file.deletions = stats.deletions;
      file.binary = stats.binary;
    }
    return files;
  }

  // `status --porcelain=v1 -z`: "XY path\0", and for a rename "XY new\0old\0".
  static parseStatus(output: string): WorkingDetails {
    const tokens = output.split('\0');
    const details: WorkingDetails = { staged: [], unstaged: [] };
    let index = 0;

    while (index < tokens.length) {
      const entry = tokens[index++];
      if (!entry || entry.length < 4) {
        continue;
      }

      const indexCode = entry[0];
      const worktreeCode = entry[1];
      const path = entry.slice(3);
      let oldPath: string | undefined;
      if (indexCode === 'R' || indexCode === 'C') {
        oldPath = tokens[index++];
      }

      if (indexCode === '?') {
        details.unstaged.push({ path, status: '?' });
        continue;
      }

      if (GitOutputParser.isConflict(indexCode, worktreeCode)) {
        details.unstaged.push({ path, status: 'U' });
        continue;
      }

      if (indexCode !== ' ') {
        details.staged.push({ path, oldPath, status: GitOutputParser.readStatus(indexCode) });
      }
      if (worktreeCode !== ' ') {
        details.unstaged.push({ path, status: GitOutputParser.readStatus(worktreeCode) });
      }
    }

    return details;
  }

  // `--shortstat --format=%x1e%H`: the hash, then " 7 files changed, 121 insertions(+), 3 deletions(-)" (absent for an empty commit).
  static parseShortStats(output: string): Map<string, CommitStats> {
    const statsByHash = new Map<string, CommitStats>();

    for (const record of output.split(RECORD_SEPARATOR)) {
      const [hash, ...rest] = record.trim().split('\n');
      if (!hash) {
        continue;
      }

      statsByHash.set(hash.trim(), GitOutputParser.parseShortStatLine(rest.join(' ')));
    }

    return statsByHash;
  }

  static parseShortStatLine(summary: string): CommitStats {
    return {
      files: GitOutputParser.readCount(summary, /(\d+) files? changed/),
      additions: GitOutputParser.readCount(summary, /(\d+) insertions?\(\+\)/),
      deletions: GitOutputParser.readCount(summary, /(\d+) deletions?\(-\)/),
    };
  }

  static parseAheadBehind(output: string): { ahead: number; behind: number } {
    const [ahead, behind] = output.trim().split(/\s+/).map(Number);
    return { ahead: ahead || 0, behind: behind || 0 };
  }

  private static readCount(text: string, pattern: RegExp): number {
    const match = pattern.exec(text);
    return match ? Number(match[1]) : 0;
  }

  private static isConflict(indexCode: string, worktreeCode: string): boolean {
    if (indexCode === 'U' || worktreeCode === 'U') {
      return true;
    }
    return (indexCode === 'A' && worktreeCode === 'A') || (indexCode === 'D' && worktreeCode === 'D');
  }

  private static readStatus(code: string): FileStatus {
    switch (code) {
      case 'A':
      case 'M':
      case 'D':
      case 'R':
      case 'C':
      case 'T':
      case 'U':
        return code;
      default:
        return 'M';
    }
  }
}
