import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GraphLayout, RowLayout, Segment } from '../webview/GraphLayout';

const getSegments = (row: RowLayout, half: Segment['half']) =>
  row.segments
    .filter((segment) => segment.half === half)
    .map((segment) => `${segment.fromLane}>${segment.toLane}`)
    .sort();

describe('GraphLayout', () => {
  it('keeps a linear history in one lane', () => {
    const { rows, maxLanes } = GraphLayout.compute([
      { hash: 'c', parents: ['b'] },
      { hash: 'b', parents: ['a'] },
      { hash: 'a', parents: [] },
    ]);

    assert.equal(maxLanes, 1);
    assert.deepEqual(rows.map((row) => row.lane), [0, 0, 0]);
    assert.deepEqual(getSegments(rows[0], 'top'), []);
    assert.deepEqual(getSegments(rows[1], 'top'), ['0>0']);
    assert.deepEqual(getSegments(rows[2], 'bottom'), []);
  });

  it('opens a lane for the second parent of a merge and closes it at the fork point', () => {
    // m merges feature f into main; both come from base.
    const { rows } = GraphLayout.compute([
      { hash: 'm', parents: ['main1', 'f'] },
      { hash: 'f', parents: ['base'] },
      { hash: 'main1', parents: ['base'] },
      { hash: 'base', parents: [] },
    ]);

    assert.deepEqual(rows.map((row) => row.lane), [0, 1, 0, 0]);
    assert.deepEqual(getSegments(rows[0], 'bottom'), ['0>0', '0>1']);
    assert.deepEqual(getSegments(rows[1], 'top'), ['0>0', '1>1']);
    assert.deepEqual(getSegments(rows[3], 'top'), ['0>0', '1>0']);
    assert.equal(rows[3].laneCount, 2);
  });

  it('gives two branch tips their own lanes and joins them at the common parent', () => {
    const { rows, maxLanes } = GraphLayout.compute([
      { hash: 'x', parents: ['base'] },
      { hash: 'y', parents: ['base'] },
      { hash: 'base', parents: [] },
    ]);

    assert.equal(maxLanes, 2);
    assert.deepEqual(rows.map((row) => row.lane), [0, 1, 0]);
    assert.deepEqual(getSegments(rows[1], 'top'), ['0>0']);
    assert.deepEqual(getSegments(rows[2], 'top'), ['0>0', '1>0']);
  });

  it('reuses a freed lane once a row has passed, never right under the end of a line', () => {
    const { rows } = GraphLayout.compute([
      { hash: 'a2', parents: ['a1'] },
      { hash: 'b1', parents: ['a1'] },
      { hash: 'a1', parents: ['a0'] },
      { hash: 'c1', parents: ['root'] },
      { hash: 'a0', parents: ['root'] },
      { hash: 'd1', parents: ['root'] },
      { hash: 'root', parents: [] },
    ]);

    assert.equal(rows[3].lane, 2);
    assert.equal(rows[5].lane, 1);
  });

  it('puts an unrelated history beside the one that ended right above it', () => {
    const { rows } = GraphLayout.compute([
      { hash: 'new2', parents: ['new1'] },
      { hash: 'new1', parents: [] },
      { hash: 'old2', parents: ['old1'] },
      { hash: 'old1', parents: [] },
    ]);

    assert.deepEqual(rows.map((row) => row.lane), [0, 0, 1, 1]);
  });

  it('draws the Working Changes lane dashed down to HEAD', () => {
    const { rows } = GraphLayout.compute([
      { hash: 'WORKING', parents: ['h'], dashed: true },
      { hash: 'other', parents: ['h'] },
      { hash: 'h', parents: [] },
    ]);

    const dashedBelowWorking = rows[0].segments.filter((segment) => segment.half === 'bottom');
    assert.ok(dashedBelowWorking.every((segment) => segment.dashed));
    const intoHead = rows[2].segments.filter((segment) => segment.half === 'top' && segment.fromLane === 0);
    assert.ok(intoHead.every((segment) => segment.dashed));
    assert.ok(rows[2].segments.filter((segment) => segment.half === 'bottom').length === 0);
  });

  it('keeps a lane open for a parent that is not loaded yet', () => {
    const { rows } = GraphLayout.compute([
      { hash: 'b', parents: ['a'] },
      { hash: 'z', parents: [] },
    ]);

    assert.deepEqual(rows.map((row) => row.lane), [0, 1]);
    assert.deepEqual(getSegments(rows[1], 'bottom'), ['0>0']);
  });
});

describe('GraphLayout with the first lane kept for HEAD', () => {
  // Two commits fetched from the upstream, not pulled yet, on top of the local HEAD.
  const inputs = [
    { hash: 'up2', parents: ['up1'] },
    { hash: 'up1', parents: ['head'] },
    { hash: 'head', parents: ['base'] },
    { hash: 'base', parents: [] },
  ];

  it('puts the newer commits in their own lane that branches off HEAD', () => {
    const { rows } = GraphLayout.compute(inputs, 'head');

    assert.deepEqual(rows.map((row) => row.lane), [1, 1, 0, 0]);
    assert.deepEqual(getSegments(rows[0], 'top'), []);
    assert.deepEqual(getSegments(rows[2], 'top'), ['1>0']);
    assert.deepEqual(getSegments(rows[2], 'bottom'), ['0>0']);
  });

  it('draws nothing in the kept lane above HEAD', () => {
    const { rows } = GraphLayout.compute(inputs, 'head');

    for (const row of rows.slice(0, 2)) {
      assert.ok(row.segments.every((segment) => segment.fromLane !== 0 && segment.toLane !== 0));
    }
  });

  it('keeps one straight lane without it', () => {
    const { rows } = GraphLayout.compute(inputs);
    assert.deepEqual(rows.map((row) => row.lane), [0, 0, 0, 0]);
  });
});
