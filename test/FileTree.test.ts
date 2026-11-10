import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FileTree, FolderNode } from '../webview/FileTree';

describe('FileTree', () => {
  it('puts folders before files, sorts by name and counts files per folder', () => {
    const tree = FileTree.build([
      { path: 'README.md', index: 0 },
      { path: 'src/b/d.ts', index: 1 },
      { path: 'src/a.ts', index: 2 },
      { path: 'src/b/c.ts', index: 3 },
    ]);

    assert.equal(tree.length, 2);
    const src = tree[0] as FolderNode;
    assert.equal(src.name, 'src');
    assert.equal(src.fileCount, 3);
    assert.deepEqual(
      src.children.map((node) => node.name),
      ['b', 'a.ts'],
    );
    assert.deepEqual(
      (src.children[0] as FolderNode).children.map((node) => node.name),
      ['c.ts', 'd.ts'],
    );
    assert.equal(tree[1].name, 'README.md');
  });

  it('shows a chain of single folders as one row', () => {
    const tree = FileTree.build([
      { path: 'server/src/rest/campaigns/dal.ts', index: 0 },
      { path: 'server/src/rest/campaigns/flow.ts', index: 1 },
    ]);

    assert.equal(tree.length, 1);
    const folder = tree[0] as FolderNode;
    assert.equal(folder.name, 'server/src/rest/campaigns');
    assert.equal(folder.path, 'server/src/rest/campaigns');
    assert.deepEqual(
      folder.children.map((node) => node.name),
      ['dal.ts', 'flow.ts'],
    );
  });
});
