import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LineChange } from '../src/blame/LineChange';

describe('LineChange', () => {
  it('splits a hunk into the code before and after the commit', () => {
    const change = LineChange.split(['-    return years.length;', '+    return years.filter((year) => year > 0).length;']);
    assert.deepEqual(change.before, ['return years.length;']);
    assert.deepEqual(change.after, ['return years.filter((year) => year > 0).length;']);
    assert.equal(change.truncated, false);
  });

  it('cuts only the indent both sides share and ignores blank lines', () => {
    const change = LineChange.split(['+    if (ok) {', '+', '+      run();', '+    }']);
    assert.deepEqual(change.after, ['if (ok) {', '', '  run();', '}']);
    assert.deepEqual(change.before, []);
  });

  it('notes a hunk cut short', () => {
    assert.equal(LineChange.split(['+a', '…']).truncated, true);
  });
});
