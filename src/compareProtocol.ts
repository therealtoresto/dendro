import type { ChangedFile } from './protocol';
import type { DateSettings } from './shared/DateFormatter';

export type CompareMode = 'diverged' | 'direct';

export interface CompareSide {
  ref: string;
  hash: string;
}

export interface CompareCommit {
  hash: string;
  author: string;
  email: string;
  date: number;
  subject: string;
}

export interface CompareData {
  left: CompareSide;
  right: CompareSide;
  mode: CompareMode;
  mergeBase: string | null;
  onlyLeft: CompareCommit[];
  onlyRight: CompareCommit[];
  leftCount: number;
  rightCount: number;
  sideLimit: number;
  files: ChangedFile[];
  recent: { left: string; right: string }[];
  dates: DateSettings;
  locale: string;
}

export type CompareWebviewMessage =
  | { type: 'ready' }
  | { type: 'pick'; side: 'left' | 'right' }
  | { type: 'swap' }
  | { type: 'setMode'; mode: CompareMode }
  | { type: 'openFile'; file: ChangedFile }
  | { type: 'showCommit'; hash: string }
  | { type: 'openRecent'; left: string; right: string };

export type CompareHostMessage =
  | { type: 'loading' }
  | { type: 'data'; data: CompareData }
  | { type: 'error'; message: string };
