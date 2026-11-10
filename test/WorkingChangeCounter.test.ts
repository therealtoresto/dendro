import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GIT_STATUS, WorkingChangeCounter } from '../src/git/WorkingChangeCounter';

const empty = { merge: [], index: [], workingTree: [], untracked: [] };

describe('WorkingChangeCounter', () => {
  it('sorts files into added, modified and deleted', () => {
    const summary = WorkingChangeCounter.count({
      ...empty,
      workingTree: [
        { path: 'a.ts', status: GIT_STATUS.MODIFIED },
        { path: 'b.ts', status: GIT_STATUS.DELETED },
        { path: 'c.ts', status: GIT_STATUS.TYPE_CHANGED },
      ],
      untracked: [{ path: 'new.ts', status: GIT_STATUS.UNTRACKED }],
    });

    assert.deepEqual(summary, { total: 4, added: 1, modified: 2, deleted: 1, conflicted: 0, staged: 0 });
  });

  it('counts a file once when it is both staged and changed again', () => {
    const summary = WorkingChangeCounter.count({
      ...empty,
      index: [
        { path: 'new.ts', status: GIT_STATUS.INDEX_ADDED },
        { path: 'edited.ts', status: GIT_STATUS.INDEX_MODIFIED },
        { path: 'renamed.ts', status: GIT_STATUS.INDEX_RENAMED },
      ],
      workingTree: [
        { path: 'new.ts', status: GIT_STATUS.MODIFIED },
        { path: 'edited.ts', status: GIT_STATUS.DELETED },
      ],
    });

    assert.deepEqual(summary, { total: 3, added: 1, modified: 1, deleted: 1, conflicted: 0, staged: 3 });
  });

  it('counts a merge conflict as a conflict only', () => {
    const summary = WorkingChangeCounter.count({
      ...empty,
      merge: [{ path: 'both.ts', status: 17 }],
      workingTree: [{ path: 'both.ts', status: GIT_STATUS.MODIFIED }],
    });

    assert.deepEqual(summary, { total: 1, added: 0, modified: 0, deleted: 0, conflicted: 1, staged: 0 });
  });
});
