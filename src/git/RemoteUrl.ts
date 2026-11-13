export interface RemoteInfo {
  kind: 'github' | 'gitlab' | 'other';
  host: string;
  owner: string;
  repo: string;
}

export class RemoteUrl {
  // "git@host:group/sub/repo.git", "ssh://git@host:22/group/repo.git" and "https://host/group/repo" alike.
  static parse(url: string): RemoteInfo | null {
    const match = /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)(?::\d+)?[:/](.+?)(?:\.git)?\/?$/i.exec(url);
    if (!match) {
      return null;
    }
    const host = match[1].toLowerCase();
    const parts = match[2].split('/');
    const kind = host === 'github.com' ? 'github' : host.includes('gitlab') ? 'gitlab' : 'other';
    return { kind, host, owner: parts.slice(0, -1).join('/'), repo: parts[parts.length - 1] };
  }

  // The https page of the repository; an ssh remote of the same host serves its pages over https.
  static buildWebUrl(url: string): string | null {
    const info = RemoteUrl.parse(url);
    if (!info || !info.owner) {
      return null;
    }
    return `https://${info.host}/${info.owner}/${info.repo}`;
  }

  // GitLab puts commits under "/-/commit", the other common hosts under "/commit".
  static buildCommitUrl(webUrl: string, sha: string): string {
    return webUrl.includes('gitlab') ? `${webUrl}/-/commit/${sha}` : `${webUrl}/commit/${sha}`;
  }
}
