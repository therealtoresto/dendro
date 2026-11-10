import type { BlameCommit, BlameResult } from './BlameParser';

export interface AuthorShare {
  name: string;
  email: string;
  lines: number;
}

export interface SpanSummary {
  latest: BlameCommit | null;
  authors: AuthorShare[];
}

// Who wrote a block of lines and its newest change. Lines not committed yet count as the newest change and as
// written by the user; authors are listed by how many of the lines are theirs.
export class BlameSummary {
  static summarize(blame: BlameResult, startLine: number, endLine: number, userEmail: string | null): SpanSummary {
    const sharesByEmail = new Map<string, AuthorShare>();
    let latest: BlameCommit | null = null;

    for (let line = startLine; line <= endLine; line++) {
      const entry = blame.lines[line];
      if (!entry) {
        continue;
      }
      const commit = blame.commits.get(entry.sha)!;

      if (!latest || BlameSummary.isNewer(commit, latest)) {
        latest = commit;
      }

      const email = commit.uncommitted ? userEmail ?? 'you' : commit.email;
      const share = sharesByEmail.get(email) ?? { name: commit.uncommitted ? 'You' : commit.author, email, lines: 0 };
      share.lines++;
      sharesByEmail.set(email, share);
    }

    const authors = Array.from(sharesByEmail.values()).sort((left, right) => right.lines - left.lines);
    return { latest, authors };
  }

  private static isNewer(commit: BlameCommit, than: BlameCommit): boolean {
    if (commit.uncommitted !== than.uncommitted) {
      return commit.uncommitted;
    }
    return commit.committerTime > than.committerTime;
  }
}
