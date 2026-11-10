import type { ChangedFile, CommitInfo, CommitStats, FileStatus, RefInfo, WorkingDetails } from '../protocol';

export const FIELD_SEPARATOR = '\x1f';
export const RECORD_SEPARATOR = '\x1e';

const BODY_PREVIEW_LENGTH = 240;

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
