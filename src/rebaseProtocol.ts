import type { RebaseAction } from './rebase/RebaseTodo';

export interface RebaseRow {
  action: RebaseAction;
  hash: string;
  subject: string;
  author?: string;
  email?: string;
  date?: number;
}

export interface RebaseView {
  rows: RebaseRow[];
  onto: string | null;
  branch: string | null;
}

export type RebaseWebviewMessage =
  | { type: 'ready' }
  | { type: 'update'; rows: { action: RebaseAction; hash: string; subject: string }[] }
  | { type: 'start' }
  | { type: 'abort' };

export type RebaseHostMessage = { type: 'view'; view: RebaseView };
