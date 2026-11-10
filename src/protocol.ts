// Shared by the extension host and the webview: everything here must stay plain data.

import type { SettingValues } from './shared/SettingsCatalog';

export const WORKING_CHANGES_KEY = 'WORKING';

export interface CommitInfo {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  date: number;
  commitDate: number;
  subject: string;
  bodyPreview: string;
}

export interface CommitStats {
  files: number;
  additions: number;
  deletions: number;
}

export type RefKind = 'head' | 'remote' | 'tag' | 'worktree';

export interface RefInfo {
  name: string;
  kind: RefKind;
  hash: string;
  remote?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  path?: string;
}

export interface StashInfo {
  hash: string;
  base: string;
  ref: string;
  message: string;
  date: number;
}

export interface WorktreeInfo {
  path: string;
  hash: string;
  branch: string | null;
  isCurrent: boolean;
}

export type CommitAction =
  | 'copySha'
  | 'copyMessage'
  | 'checkout'
  | 'createBranch'
  | 'cherryPick'
  | 'revert'
  | 'reset'
  | 'createTag'
  | 'mergeIntoCurrent'
  | 'rebaseCurrentOnto';

export interface HeadInfo {
  branch: string | null;
  hash: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface RepoSummary {
  root: string;
  name: string;
}

// Uncommitted files by what happened to them; `lines` counts tracked files only (git diff against HEAD).
export interface WorkingSummary {
  total: number;
  added: number;
  modified: number;
  deleted: number;
  conflicted: number;
  staged: number;
  lines?: CommitStats;
}

// What the row hover card needs beyond the list row: the whole message and the files by what happened to them.
export interface CommitHoverInfo {
  hash: string;
  message: string;
  files: number;
  added: number;
  modified: number;
  deleted: number;
}

export interface ComparisonDetails {
  base: string;
  target: string;
  files: ChangedFile[];
}

export interface RemoteSummary {
  name: string;
  host: string;
  kind: 'github' | 'gitlab' | 'other';
}

export interface GraphState {
  repos: RepoSummary[];
  root: string | null;
  head: HeadInfo;
  working: WorkingSummary;
  incoming: string[];
  remote: RemoteSummary | null;
  lastFetch: number | null;
  settings: SettingValues;
  locale: string;
}

export type FileStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U' | '?';

export interface ChangedFile {
  path: string;
  oldPath?: string;
  status: FileStatus;
  additions?: number;
  deletions?: number;
  binary?: boolean;
}

export interface CommitDetails {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  authorDate: number;
  committer: string;
  committerEmail: string;
  commitDate: number;
  message: string;
  files: ChangedFile[];
}

export interface WorkingDetails {
  staged: ChangedFile[];
  unstaged: ChangedFile[];
}

export type RemoteAction = 'pull' | 'push' | 'fetch';

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'loadMore' }
  | { type: 'loadUntil'; hashes: string[] }
  | { type: 'refresh' }
  | { type: 'pickRepo' }
  | { type: 'pickBranch' }
  | { type: 'updateSetting'; key: string; value: boolean | number | string | string[] }
  | { type: 'openSettings'; section?: string }
  | { type: 'openInsights' }
  | { type: 'showComparison'; base: string; target: string }
  | { type: 'hoverCommit'; hash: string }
  | { type: 'commitAction'; action: CommitAction; hash: string }
  | { type: 'dropRef'; ref: RefInfo; targetHash: string }
  | { type: 'showCommit'; hash: string }
  | { type: 'showWorkingChanges' }
  | { type: 'openCommitDiff'; hash: string; parent: string | null; file: ChangedFile }
  | { type: 'openWorkingDiff'; file: ChangedFile; staged: boolean }
  | { type: 'openFile'; path: string; ref: string | null }
  | { type: 'remote'; action: RemoteAction }
  | { type: 'checkoutRef'; ref: RefInfo }
  | { type: 'search'; query: string }
  | { type: 'copy'; text: string };

export type HostMessage =
  | { type: 'state'; state: GraphState }
  | { type: 'refs'; refs: RefInfo[] }
  | { type: 'extras'; stashes: StashInfo[]; worktrees: WorktreeInfo[] }
  | { type: 'commits'; commits: CommitInfo[]; append: boolean; hasMore: boolean }
  | { type: 'loading'; value: boolean }
  | { type: 'commitStats'; stats: Record<string, CommitStats> }
  | { type: 'commitDetails'; details: CommitDetails }
  | { type: 'workingDetails'; details: WorkingDetails }
  | { type: 'comparisonDetails'; details: ComparisonDetails }
  | { type: 'busy'; action: RemoteAction | null; automatic?: boolean }
  | { type: 'remoteResult'; action: RemoteAction; ok: boolean; message?: string }
  | { type: 'searchResult'; query: string; hashes: string[] }
  | { type: 'loadUntilDone'; found: boolean }
  | { type: 'reveal'; hash: string }
  | { type: 'avatars'; avatars: Record<string, string>; reset?: boolean }
  | { type: 'hoverInfo'; info: CommitHoverInfo }
  | { type: 'setSearch'; query: string }
  | { type: 'error'; message: string };
