import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BlameParser, UNCOMMITTED_SHA } from '../src/blame/BlameParser';
import { BlameSummary } from '../src/blame/BlameSummary';
import { HeatmapScale, HEAT_LEVELS } from '../src/blame/HeatmapScale';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

const PORCELAIN = [
  `${A} 1 1 2`,
  'author Ann Lee',
  'author-mail <ann@x.io>',
  'author-time 1700000000',
  'author-tz +0200',
  'committer Ann Lee',
  'committer-mail <ann@x.io>',
  'committer-time 1700000100',
  'committer-tz +0200',
  'summary First version',
  'filename src/a.ts',
  '\tconst a = 1;',
  `${A} 2 2`,
  '\tconst b = 2;',
  `${B} 7 3 1`,
  'author Bob',
  'author-mail <bob@x.io>',
  'author-time 1700500000',
  'author-tz +0200',
  'committer Bob',
  'committer-mail <bob@x.io>',
  'committer-time 1700500000',
  'committer-tz +0200',
  'summary Rename the file',
  `previous ${A} src/old name.ts`,
  'filename src/a.ts',
  '\tconst c = 3;',
  `${UNCOMMITTED_SHA} 4 4 1`,
  'author External file (--contents)',
  'author-mail <external.file>',
  'author-time 1700900000',
  'summary Version of src/a.ts from standard input',
  'filename src/a.ts',
  '\tconst d = 4;',
  '',
].join('\n');

describe('BlameParser', () => {
  it('maps every line to its commit, reading commit details only once per commit', () => {
    const blame = BlameParser.parse(PORCELAIN);

    assert.deepEqual(blame.lines, [
      { sha: A, originalLine: 1 },
      { sha: A, originalLine: 2 },
      { sha: B, originalLine: 7 },
      { sha: UNCOMMITTED_SHA, originalLine: 4 },
    ]);
    assert.equal(blame.commits.size, 3);

    const first = blame.commits.get(A)!;
    assert.equal(first.author, 'Ann Lee');
    assert.equal(first.email, 'ann@x.io');
    assert.equal(first.committerTime, 1700000100);
    assert.equal(first.summary, 'First version');
    assert.equal(first.uncommitted, false);
  });

  it('reads the previous commit and path, keeping spaces in the path', () => {
    const second = BlameParser.parse(PORCELAIN).commits.get(B)!;
    assert.equal(second.previousSha, A);
    assert.equal(second.previousPath, 'src/old name.ts');
  });

  it('marks lines that are not committed yet', () => {
    assert.equal(BlameParser.parse(PORCELAIN).commits.get(UNCOMMITTED_SHA)!.uncommitted, true);
  });
});

describe('HeatmapScale', () => {
  const now = 1_800_000_000;
  const day = 86400;

  it('splits lines at the threshold and ranks each side from newest to oldest', () => {
    const heat = HeatmapScale.compute([now - day, now - 10 * day, now - 200 * day, now - 900 * day, now - day], now, 90);

    assert.deepEqual(heat, [
      { hot: true, level: 0 },
      { hot: true, level: HEAT_LEVELS - 1 },
      { hot: false, level: 0 },
      { hot: false, level: HEAT_LEVELS - 1 },
      { hot: true, level: 0 },
    ]);
  });

  it('gives a file with one change time the brightest level', () => {
    assert.deepEqual(HeatmapScale.compute([now, now], now, 90), [
      { hot: true, level: 0 },
      { hot: true, level: 0 },
    ]);
    assert.equal(HeatmapScale.getOpacity(0), 1);
  });
});

describe('BlameSummary', () => {
  it('finds the newest change and orders authors by their share of the lines', () => {
    const blame = BlameParser.parse(PORCELAIN);

    const summary = BlameSummary.summarize(blame, 0, 2, 'ann@x.io');

    assert.equal(summary.latest?.sha, B);
    assert.deepEqual(
      summary.authors.map((author) => [author.name, author.lines]),
      [
        ['Ann Lee', 2],
        ['Bob', 1],
      ],
    );
  });

  it('counts uncommitted lines as the newest change, written by the user', () => {
    const blame = BlameParser.parse(PORCELAIN);

    const summary = BlameSummary.summarize(blame, 0, 3, 'me@x.io');

    assert.equal(summary.latest?.uncommitted, true);
    assert.deepEqual(
      summary.authors.map((author) => [author.name, author.lines]),
      [
        ['Ann Lee', 2],
        ['Bob', 1],
        ['You', 1],
      ],
    );
  });

  it('adds uncommitted lines to the committed lines of the same person', () => {
    const blame = BlameParser.parse(PORCELAIN);

    const summary = BlameSummary.summarize(blame, 0, 3, 'ann@x.io');

    assert.deepEqual(
      summary.authors.map((author) => [author.email, author.lines]),
      [
        ['ann@x.io', 3],
        ['bob@x.io', 1],
      ],
    );
  });
});
