import type { WorkingSummary } from '../protocol';

// The built-in Git extension's change statuses (its `Status` object; TYPE_CHANGED is 18 in Cursor's copy).
export const GIT_STATUS = {
  INDEX_MODIFIED: 0,
  INDEX_ADDED: 1,
  INDEX_DELETED: 2,
  INDEX_RENAMED: 3,
  INDEX_COPIED: 4,
  MODIFIED: 5,
  DELETED: 6,
  UNTRACKED: 7,
  IGNORED: 8,
  INTENT_TO_ADD: 9,
  INTENT_TO_RENAME: 10,
  TYPE_CHANGED: 18,
} as const;

const ADDED_STATUSES = new Set<number>([
  GIT_STATUS.INDEX_ADDED,
  GIT_STATUS.INDEX_COPIED,
  GIT_STATUS.UNTRACKED,
  GIT_STATUS.INTENT_TO_ADD,
]);
const DELETED_STATUSES = new Set<number>([GIT_STATUS.INDEX_DELETED, GIT_STATUS.DELETED]);

export interface FileChange {
  path: string;
  status: number;
}

export interface ChangeGroups {
  merge: FileChange[];
  index: FileChange[];
  workingTree: FileChange[];
  untracked: FileChange[];
}

// One count per file, however many groups it is in: a file staged as new and edited again is one added file;
// one staged as edited and then deleted on disk is one deleted file; a merge conflict outranks everything.
export class WorkingChangeCounter {
  static count(groups: ChangeGroups): Omit<WorkingSummary, 'lines'> {
    const statusesByPath = new Map<string, number[]>();
    const conflicted = new Set(groups.merge.map((change) => change.path));
    const staged = new Set(groups.index.map((change) => change.path));

    for (const change of [...groups.index, ...groups.workingTree, ...groups.untracked]) {
      const statuses = statusesByPath.get(change.path) ?? [];
      statuses.push(change.status);
      statusesByPath.set(change.path, statuses);
    }

    const summary = { total: 0, added: 0, modified: 0, deleted: 0, conflicted: conflicted.size, staged: staged.size };
    for (const path of conflicted) {
      statusesByPath.delete(path);
    }

    for (const statuses of statusesByPath.values()) {
      const isDeleted = statuses.some((status) => DELETED_STATUSES.has(status));
      const isAdded = statuses.some((status) => ADDED_STATUSES.has(status));
      if (isDeleted) {
        summary.deleted++;
      } else if (isAdded) {
        summary.added++;
      } else {
        summary.modified++;
      }
    }

    summary.total = summary.added + summary.modified + summary.deleted + summary.conflicted;
    return summary;
  }
}
