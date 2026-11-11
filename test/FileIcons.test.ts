import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FileIcons } from '../webview/FileIcons';

describe('FileIcons.isTest', () => {
  it('knows test files by the naming rules of common runners', () => {
    const tests = [
      'server/src/Tests/unit/MetaAdsAudienceSync.spec.ts',
      'src/app.test.tsx',
      'e2e/login.e2e-spec.ts',
      'pkg/git/remote_test.go',
      'tests/test_parser.py',
      'src/main/java/RemoteUrlTest.java',
      'src/__tests__/helpers.js',
    ];
    for (const path of tests) {
      assert.equal(FileIcons.isTest(path), true, path);
    }
  });

  it('leaves other files alone', () => {
    const others = ['src/testing.ts', 'src/contest.ts', 'docs/latest.md', 'src/Test.java', 'src/spec/readme.md'];
    for (const path of others) {
      assert.equal(FileIcons.isTest(path), false, path);
    }
  });
});
