import type { DateSettings } from './shared/DateFormatter';

export interface ChartCommit {
  hash: string;
  author: string;
  email: string;
  date: number;
  subject: string;
  additions: number;
  deletions: number;
  path: string;
  oldPath?: string;
}

export interface FileHistoryData {
  fileName: string;
  filePath: string;
  commits: ChartCommit[];
  truncated: boolean;
  userEmail: string | null;
  avatars: Record<string, string>;
  dates: DateSettings;
  locale: string;
}

export type HistoryWebviewMessage =
  | { type: 'ready' }
  | { type: 'openChange'; hash: string; path: string; oldPath?: string }
  | { type: 'showInGraph'; hash: string };

export type HistoryHostMessage =
  | { type: 'loading'; fileName: string }
  | { type: 'data'; data: FileHistoryData }
  | { type: 'avatars'; avatars: Record<string, string> };
