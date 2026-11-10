import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RemoteUrl } from '../src/git/RemoteUrl';

describe('RemoteUrl', () => {
  it('reads the host, owner and repository of ssh, scp-style and https remotes', () => {
    assert.deepEqual(RemoteUrl.parse('git@gitlab.example.com:team/app.git'), {
      kind: 'gitlab',
      host: 'gitlab.example.com',
      owner: 'team',
      repo: 'app',
    });
    assert.deepEqual(RemoteUrl.parse('https://github.com/microsoft/vscode'), {
      kind: 'github',
      host: 'github.com',
      owner: 'microsoft',
      repo: 'vscode',
    });
    assert.deepEqual(RemoteUrl.parse('ssh://git@git.example.com:2222/group/sub/app.git'), {
      kind: 'other',
      host: 'git.example.com',
      owner: 'group/sub',
      repo: 'app',
    });
  });
});
