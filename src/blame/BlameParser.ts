export const UNCOMMITTED_SHA = '0000000000000000000000000000000000000000';

export interface BlameCommit {
  sha: string;
  author: string;
  email: string;
  authorTime: number;
  committer: string;
  committerTime: number;
  summary: string;
  path: string;
  previousSha?: string;
  previousPath?: string;
  uncommitted: boolean;
}

export interface BlameLine {
  sha: string;
  originalLine: number;
}

export interface BlameResult {
  commits: Map<string, BlameCommit>;
  lines: BlameLine[];
}

// `git blame --porcelain`: per line a header "<sha> <original line> <final line> [<group size>]", the commit's
// key-value lines the first time that commit appears, then the line's content after a tab.
export class BlameParser {
  static parse(output: string): BlameResult {
    const commits = new Map<string, BlameCommit>();
    const lines: BlameLine[] = [];
    let current: { sha: string; originalLine: number; finalLine: number } | null = null;

    for (const line of output.split('\n')) {
      if (line.startsWith('\t')) {
        if (current) {
          lines[current.finalLine - 1] = { sha: current.sha, originalLine: current.originalLine };
        }
        continue;
      }

      const header = /^([0-9a-f]{40}) (\d+) (\d+)/.exec(line);
      if (header) {
        current = { sha: header[1], originalLine: Number(header[2]), finalLine: Number(header[3]) };
        if (!commits.has(current.sha)) {
          commits.set(current.sha, BlameParser.createCommit(current.sha));
        }
        continue;
      }

      if (current) {
        BlameParser.readField(commits.get(current.sha)!, line);
      }
    }

    return { commits, lines };
  }

  private static createCommit(sha: string): BlameCommit {
    return {
      sha,
      author: '',
      email: '',
      authorTime: 0,
      committer: '',
      committerTime: 0,
      summary: '',
      path: '',
      uncommitted: sha === UNCOMMITTED_SHA,
    };
  }

  private static readField(commit: BlameCommit, line: string): void {
    const space = line.indexOf(' ');
    const key = space < 0 ? line : line.slice(0, space);
    const value = space < 0 ? '' : line.slice(space + 1);

    switch (key) {
      case 'author':
        commit.author = value;
        break;
      case 'author-mail':
        commit.email = value.replace(/^<|>$/g, '');
        break;
      case 'author-time':
        commit.authorTime = Number(value);
        break;
      case 'committer':
        commit.committer = value;
        break;
      case 'committer-time':
        commit.committerTime = Number(value);
        break;
      case 'summary':
        commit.summary = value;
        break;
      case 'filename':
        commit.path = value;
        break;
      case 'previous': {
        const split = value.indexOf(' ');
        commit.previousSha = value.slice(0, split);
        commit.previousPath = value.slice(split + 1);
        break;
      }
    }
  }
}
