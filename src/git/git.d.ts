// The part of the built-in Git extension API (vscode.git, API version 1) that Dendro uses.

import { Event, Uri } from 'vscode';

export interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): API;
}

export interface API {
  readonly git: { readonly path: string };
  readonly repositories: Repository[];
  readonly onDidOpenRepository: Event<Repository>;
  readonly onDidCloseRepository: Event<Repository>;
}

export interface UpstreamRef {
  readonly remote: string;
  readonly name: string;
}

export interface Branch {
  readonly name?: string;
  readonly commit?: string;
  readonly upstream?: UpstreamRef;
  readonly ahead?: number;
  readonly behind?: number;
}

export interface Remote {
  readonly name: string;
  readonly fetchUrl?: string;
  readonly pushUrl?: string;
}

export interface Change {
  readonly uri: Uri;
  readonly status: number;
}

export interface RepositoryState {
  readonly HEAD: Branch | undefined;
  readonly remotes: Remote[];
  readonly mergeChanges: Change[];
  readonly indexChanges: Change[];
  readonly workingTreeChanges: Change[];
  readonly untrackedChanges?: Change[];
  readonly onDidChange: Event<void>;
}

export interface FetchOptions {
  remote?: string;
  ref?: string;
  all?: boolean;
  prune?: boolean;
  depth?: number;
}

export interface Repository {
  readonly rootUri: Uri;
  readonly state: RepositoryState;
  status(): Promise<void>;
  fetch(options?: FetchOptions): Promise<void>;
  pull(unshallow?: boolean): Promise<void>;
  push(remoteName?: string, branchName?: string, setUpstream?: boolean): Promise<void>;
}
