import type { RemoteAction, WorkingSummary } from './protocol';
import type { DateSettings } from './shared/DateFormatter';

export interface OverviewBranch {
  name: string;
  hash: string;
  upstream?: string;
  upstreamGone: boolean;
  ahead: number;
  behind: number;
  date: number;
  subject: string;
  isCurrent: boolean;
  merged: boolean;
}

export interface OverviewCommit {
  hash: string;
  subject: string;
  author: string;
  email: string;
  date: number;
}

// The current branch against the default one: `onlyHere` commits it has that the default branch lacks, and
// `onlyThere` commits the default branch gained since they parted.
export interface OverviewBase {
  name: string;
  ref: string;
  onlyHere: number;
  onlyThere: number;
}

export interface OverviewState {
  repoName: string;
  repoCount: number;
  branch: string | null;
  headHash: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  lastFetch: number | null;
  base: OverviewBase | null;
  working: WorkingSummary;
  stashes: number;
  branches: OverviewBranch[];
  commits: OverviewCommit[];
  avatars: Record<string, string>;
  dates: DateSettings;
  locale: string;
}

export type BranchAction = 'show' | 'checkout' | 'compare' | 'merge' | 'rebase' | 'delete';

export type OverviewHostMessage =
  | { type: 'state'; state: OverviewState }
  | { type: 'empty'; text: string }
  | { type: 'busy'; action: RemoteAction | null }
  | { type: 'avatars'; avatars: Record<string, string> };

export type OverviewWebviewMessage =
  | { type: 'ready' }
  | { type: 'openGraph'; hash?: string }
  | { type: 'remote'; action: RemoteAction }
  | { type: 'switchRepository' }
  | { type: 'openInsights' }
  | { type: 'openSettings' }
  | { type: 'openSourceControl' }
  | { type: 'compareBranches' }
  | { type: 'stash' }
  | { type: 'createBranch' }
  | { type: 'branchAction'; action: BranchAction; name: string }
  | { type: 'updateFromBase'; how: 'rebase' | 'merge' }
  | { type: 'deleteMerged' };
