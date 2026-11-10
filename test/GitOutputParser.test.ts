import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FIELD_SEPARATOR as F, GitOutputParser, RECORD_SEPARATOR as R } from '../src/git/GitOutputParser';

describe('GitOutputParser', () => {
  it('reads log records with a multi-line body and a root commit', () => {
    const output =
      ['h2', 'h1', 'Ann Lee', 'ann@x.io', '1700000100', '1700000200', 'Fix it', 'Line one\n\nLine two\n'].join(F) +
      R +
      '\n' +
      ['h1', '', 'Bob', 'bob@x.io', '1700000000', '1700000000', 'Init', ''].join(F) +
      R +
      '\n';

    const commits = GitOutputParser.parseLog(output);

    assert.equal(commits.length, 2);
    assert.deepEqual(commits[0].parents, ['h1']);
    assert.equal(commits[0].bodyPreview, 'Line one Line two');
    assert.deepEqual(commits[1].parents, []);
    assert.equal(commits[1].date, 1700000000);
    assert.equal(commits[0].commitDate, 1700000200);
  });

  it('reads refs, peels annotated tags and skips origin/HEAD', () => {
    const output = [
      ['aaa', '', 'refs/heads/master', 'origin/master', '[ahead 2, behind 16]'].join(F),
      ['aaa', '', 'refs/remotes/origin/master'].join(F),
      ['aaa', '', 'refs/remotes/origin/HEAD'].join(F),
      ['tagobj', 'ccc', 'refs/tags/v1.0'].join(F),
      ['ddd', '', 'refs/heads/feature/x'].join(F),
    ].join('\n');

    const refs = GitOutputParser.parseRefs(output);

    assert.deepEqual(refs, [
      { name: 'master', kind: 'head', hash: 'aaa', upstream: 'origin/master', ahead: 2, behind: 16 },
      { name: 'origin/master', kind: 'remote', hash: 'aaa', remote: 'origin' },
      { name: 'v1.0', kind: 'tag', hash: 'ccc' },
      { name: 'feature/x', kind: 'head', hash: 'ddd' },
    ]);
  });

  it('joins name-status and numstat, including renames and binary files', () => {
    const nameStatus = 'M\0src/a.ts\0R087\0old/b.ts\0new/b.ts\0A\0img.png\0D\0gone.txt\0';
    const numstat = '3\t1\tsrc/a.ts\0' + '2\t2\t\0old/b.ts\0new/b.ts\0' + '-\t-\timg.png\0' + '0\t9\tgone.txt\0';

    const files = GitOutputParser.attachStats(
      GitOutputParser.parseNameStatus(nameStatus),
      GitOutputParser.parseNumstat(numstat),
    );

    assert.deepEqual(files, [
      { path: 'src/a.ts', status: 'M', additions: 3, deletions: 1, binary: false },
      { path: 'new/b.ts', oldPath: 'old/b.ts', status: 'R', additions: 2, deletions: 2, binary: false },
      { path: 'img.png', status: 'A', additions: undefined, deletions: undefined, binary: true },
      { path: 'gone.txt', status: 'D', additions: 0, deletions: 9, binary: false },
    ]);
  });

  it('splits porcelain status into staged and unstaged, with renames, conflicts and untracked files', () => {
    const output = 'M  staged.ts\0 M edited.ts\0MM both.ts\0R  new.ts\0old.ts\0UU conflict.ts\0?? fresh.ts\0';

    const details = GitOutputParser.parseStatus(output);

    assert.deepEqual(details.staged, [
      { path: 'staged.ts', oldPath: undefined, status: 'M' },
      { path: 'both.ts', oldPath: undefined, status: 'M' },
      { path: 'new.ts', oldPath: 'old.ts', status: 'R' },
    ]);
    assert.deepEqual(details.unstaged, [
      { path: 'edited.ts', status: 'M' },
      { path: 'both.ts', status: 'M' },
      { path: 'conflict.ts', status: 'U' },
      { path: 'fresh.ts', status: '?' },
    ]);
  });

  it('reads short stats, including a commit with no changes and one with only additions', () => {
    const output =
      R + 'aaa\n\n 7 files changed, 121 insertions(+), 3 deletions(-)\n' +
      R + 'bbb\n' +
      R + 'ccc\n\n 1 file changed, 1 insertion(+)\n';

    const stats = GitOutputParser.parseShortStats(output);

    assert.deepEqual(stats.get('aaa'), { files: 7, additions: 121, deletions: 3 });
    assert.deepEqual(stats.get('bbb'), { files: 0, additions: 0, deletions: 0 });
    assert.deepEqual(stats.get('ccc'), { files: 1, additions: 1, deletions: 0 });
  });

  it('reads ahead / behind counts', () => {
    assert.deepEqual(GitOutputParser.parseAheadBehind('2\t16\n'), { ahead: 2, behind: 16 });
  });
});

describe('GitOutputParser history', () => {
  it('reads commits with the path of the file in each one, across a rename', () => {
    const output =
      R + ['h3', 'h2', 'Ann Lee', 'ann@x.io', '1700000300', 'Tidy'].join(F) + '\n\nM\tsrc/new.ts\n' +
      R + ['h2', 'h1', 'Bob', 'bob@x.io', '1700000200', 'Move it'].join(F) + '\n\nR091\tsrc/old.ts\tsrc/new.ts\n' +
      R + ['h1', '', 'Bob', 'bob@x.io', '1700000100', 'Start'].join(F) + '\n\nA\tsrc/old.ts\n';

    const history = GitOutputParser.parseHistory(output);

    assert.deepEqual(
      history.map((entry) => [entry.hash, entry.path, entry.oldPath]),
      [
        ['h3', 'src/new.ts', undefined],
        ['h2', 'src/new.ts', 'src/old.ts'],
        ['h1', 'src/old.ts', undefined],
      ],
    );
    assert.deepEqual(history[0].parents, ['h2']);
  });

  it('reads line history, which has no file lines', () => {
    const output = R + ['h9', 'h8', 'Dee', 'dee@x.io', '1700000900', 'Fix the edge'].join(F) + '\n';
    const [entry] = GitOutputParser.parseHistory(output);
    assert.equal(entry.subject, 'Fix the edge');
    assert.equal(entry.path, undefined);
  });
});

describe('GitOutputParser history with line counts', () => {
  it('reads the added and deleted lines of the file in each commit, across a rename', () => {
    const output =
      R + ['h2', 'h1', 'Ann Lee', 'ann@x.io', '1700000200', 'Move it'].join(F) + '\0\n1\t1\t\0src/old.ts\0src/new.ts\0' +
      R + ['h1', '', 'Bob', 'bob@x.io', '1700000100', 'Start'].join(F) + '\0\n56\t9\tsrc/old.ts\0' +
      R + ['h0', '', 'Bob', 'bob@x.io', '1700000000', 'Logo'].join(F) + '\0\n-\t-\tsrc/logo.png\0';

    const history = GitOutputParser.parseHistoryStats(output);

    assert.deepEqual(
      history.map((entry) => [entry.hash, entry.additions, entry.deletions, entry.path, entry.oldPath]),
      [
        ['h2', 1, 1, 'src/new.ts', 'src/old.ts'],
        ['h1', 56, 9, 'src/old.ts', undefined],
        ['h0', 0, 0, 'src/logo.png', undefined],
      ],
    );
  });
});

describe('GitOutputParser stashes and worktrees', () => {
  it('reads stashes with the commit they were made on', () => {
    const output = ['s1', 'b1 i1', 'stash@{0}', 'On master: try the cache', '1700000000'].join(F) + '\n';
    assert.deepEqual(GitOutputParser.parseStashes(output), [
      { hash: 's1', base: 'b1', ref: 'stash@{0}', message: 'On master: try the cache', date: 1700000000 },
    ]);
  });

  it('reads worktrees, the current one marked, a detached one without a branch', () => {
    const output = [
      'worktree /repo\nHEAD aaa\nbranch refs/heads/main',
      'worktree /repo-review\nHEAD bbb\nbranch refs/heads/feature/x',
      'worktree /repo-old\nHEAD ccc\ndetached',
      '',
    ].join('\n\n');

    assert.deepEqual(GitOutputParser.parseWorktrees(output, '/repo'), [
      { path: '/repo', hash: 'aaa', branch: 'main', isCurrent: true },
      { path: '/repo-review', hash: 'bbb', branch: 'feature/x', isCurrent: false },
      { path: '/repo-old', hash: 'ccc', branch: null, isCurrent: false },
    ]);
  });
});

describe('GitOutputParser repository lists', () => {
  it('reads branches with their upstream state and the current one', () => {
    const output = [
      ['main', 'aaa', 'origin/main', '[ahead 2, behind 3]', '1700000000', 'Fix', '*'].join(F),
      ['old', 'bbb', 'origin/old', '[gone]', '1600000000', 'Old work', ' '].join(F),
      ['local', 'ccc', '', '', '1650000000', 'Try', ' '].join(F),
    ].join('\n');

    const branches = GitOutputParser.parseBranches(output);

    assert.deepEqual(
      branches.map((branch) => [branch.name, branch.upstream, branch.ahead, branch.behind, branch.upstreamGone, branch.isCurrent]),
      [
        ['main', 'origin/main', 2, 3, false, true],
        ['old', 'origin/old', 0, 0, true, false],
        ['local', undefined, 0, 0, false, false],
      ],
    );
  });

  it('reads tags, peeling annotated ones to their commit', () => {
    const output = [['v2', 'tagobj', 'commit2', '1700000000', 'Release 2'].join(F), ['v1', 'commit1', '', '1600000000', 'Init'].join(F)].join('\n');
    assert.deepEqual(
      GitOutputParser.parseTags(output).map((tag) => [tag.name, tag.hash]),
      [
        ['v2', 'commit2'],
        ['v1', 'commit1'],
      ],
    );
  });

  it('reads remotes once each, by their fetch URL', () => {
    const output = 'origin\tgit@example.com:team/app.git (fetch)\norigin\tgit@example.com:team/app.git (push)\nfork\thttps://example.com/me/app (fetch)\n';
    assert.deepEqual(GitOutputParser.parseRemotes(output), [
      { name: 'origin', url: 'git@example.com:team/app.git' },
      { name: 'fork', url: 'https://example.com/me/app' },
    ]);
  });

  it('reads contributors with their commit counts', () => {
    const output = '   296\tAnn Lee <ann@x.io>\n    12\tBob Stone <bob@x.io>\n';
    assert.deepEqual(GitOutputParser.parseContributors(output), [
      { name: 'Ann Lee', email: 'ann@x.io', commits: 296 },
      { name: 'Bob Stone', email: 'bob@x.io', commits: 12 },
    ]);
  });
});
