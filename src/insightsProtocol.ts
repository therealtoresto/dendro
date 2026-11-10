export interface InsightsAuthor {
  name: string;
  email: string;
}

export interface InsightsCommit {
  date: number;
  // Index into InsightsData.authors.
  author: number;
}

export interface FileCount {
  path: string;
  commits: number;
}

export interface InsightsData {
  repoName: string;
  branch: string | null;
  since: number;
  commits: InsightsCommit[];
  authors: InsightsAuthor[];
  userEmail: string | null;
  totalCommits: number;
  firstCommitDate: number | null;
  avatars: Record<string, string>;
  locale: string;
}

// Line counts per commit, in the order of InsightsData.commits, and the files changed most often.
export interface InsightsStats {
  additions: number[];
  deletions: number[];
  files: FileCount[];
  myFiles: FileCount[];
}

export type InsightsWebviewMessage = { type: 'ready' } | { type: 'refresh' } | { type: 'openFile'; path: string };

export type InsightsHostMessage =
  | { type: 'loading'; repoName: string }
  | { type: 'data'; data: InsightsData }
  | { type: 'stats'; stats: InsightsStats }
  | { type: 'avatars'; avatars: Record<string, string> };
