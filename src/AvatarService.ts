import { createHash } from 'node:crypto';
import * as vscode from 'vscode';
import { GitService } from './git/GitService';
import { RemoteInfo, RemoteUrl } from './git/RemoteUrl';
import { Settings } from './Settings';

export interface AvatarImage {
  file: vscode.Uri;
  dataUri: string;
}

interface IndexEntry {
  file?: string;
  contentType?: string;
  checkedAt: number;
}

const FOUND_TTL_MS = 7 * 24 * 3600 * 1000;
const MISSING_TTL_MS = 24 * 3600 * 1000;
const REQUEST_TIMEOUT_MS = 6000;
const MAX_PARALLEL = 4;
const SIZE = 64;
const INDEX_KEY = 'dendro.avatarIndex';

// Account pictures for commit authors, from the repository host (GitHub; GitLab with a token), then Gravatar.
// Pictures are downloaded here and cached on disk for a week, so webviews show them as data URIs and never call
// those services themselves; an author with no picture is remembered for a day and shown with initials.
export class AvatarService implements vscode.Disposable {
  private readonly images = new Map<string, AvatarImage | null>();
  private readonly pending = new Map<string, Promise<AvatarImage | null>>();
  private readonly remotes = new Map<string, Promise<RemoteInfo | null>>();
  private readonly queue: (() => void)[] = [];
  private running = 0;
  private readonly changeEmitter = new vscode.EventEmitter<string>();

  // Fires with the email of an author whose picture just arrived.
  readonly onDidResolve = this.changeEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly gitPath: string,
  ) {}

  dispose(): void {
    this.changeEmitter.dispose();
  }

  get enabled(): boolean {
    return Settings.get<boolean>('avatars.pictures');
  }

  // What is known right now, without waiting: undefined means "not looked up yet".
  peek(email: string): AvatarImage | null | undefined {
    return this.images.get(AvatarService.normalize(email));
  }

  request(email: string, root: string, sampleSha?: string): Promise<AvatarImage | null> {
    const key = AvatarService.normalize(email);
    if (!this.enabled || !key) {
      return Promise.resolve(null);
    }
    if (this.images.has(key)) {
      return Promise.resolve(this.images.get(key)!);
    }

    let pending = this.pending.get(key);
    if (!pending) {
      pending = this.schedule(() => this.load(key, root, sampleSha)).then((image) => {
        this.images.set(key, image);
        this.pending.delete(key);
        if (image) {
          this.changeEmitter.fire(key);
        }
        return image;
      });
      this.pending.set(key, pending);
    }
    return pending;
  }

  async forgetAll(): Promise<void> {
    this.images.clear();
    await this.context.globalState.update(INDEX_KEY, {});
  }

  async connectGitLab(root: string | undefined): Promise<void> {
    const remote = root ? await this.getRemote(root) : null;
    const host = await vscode.window.showInputBox({
      title: 'GitLab host for avatars',
      value: remote && remote.kind !== 'github' ? remote.host : '',
      prompt: 'The GitLab server whose user pictures Dendro should show',
      placeHolder: 'gitlab.example.com',
    });
    if (!host) {
      return;
    }
    const token = await vscode.window.showInputBox({
      title: `Personal access token for ${host}`,
      prompt: 'A token with the read_user scope. It is kept in Cursor\'s secret storage and sent only to this host.',
      password: true,
      ignoreFocusOut: true,
    });
    if (token === undefined) {
      return;
    }

    const key = AvatarService.getTokenKey(host.trim());
    if (token.trim()) {
      await this.context.secrets.store(key, token.trim());
    } else {
      await this.context.secrets.delete(key);
    }
    await this.forgetAll();
    void vscode.window.showInformationMessage(`Dendro: avatars from ${host.trim()} ${token.trim() ? 'connected' : 'disconnected'}.`);
  }

  private schedule<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve) => {
      const run = () => {
        this.running++;
        task()
          .then(resolve, () => resolve(null as T))
          .finally(() => {
            this.running--;
            this.queue.shift()?.();
          });
      };
      if (this.running < MAX_PARALLEL) {
        run();
      } else {
        this.queue.push(run);
      }
    });
  }

  private async load(email: string, root: string, sampleSha?: string): Promise<AvatarImage | null> {
    const index = this.context.globalState.get<Record<string, IndexEntry>>(INDEX_KEY, {});
    const cached = index[email];
    const now = Date.now();

    if (cached?.file && now - cached.checkedAt < FOUND_TTL_MS) {
      const image = await this.readCached(cached);
      if (image) {
        return image;
      }
    }
    if (cached && !cached.file && now - cached.checkedAt < MISSING_TTL_MS) {
      return null;
    }

    const picture = await this.download(email, root, sampleSha);
    const entry: IndexEntry = { checkedAt: now };
    let image: AvatarImage | null = null;

    if (picture) {
      const extension = picture.contentType.includes('png') ? 'png' : picture.contentType.includes('gif') ? 'gif' : 'jpg';
      const file = vscode.Uri.joinPath(this.context.globalStorageUri, 'avatars', `${AvatarService.hash(email)}.${extension}`);
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.context.globalStorageUri, 'avatars'));
      await vscode.workspace.fs.writeFile(file, picture.bytes);
      entry.file = file.toString();
      entry.contentType = picture.contentType;
      image = { file, dataUri: AvatarService.toDataUri(picture.bytes, picture.contentType) };
    }

    const latest = this.context.globalState.get<Record<string, IndexEntry>>(INDEX_KEY, {});
    await this.context.globalState.update(INDEX_KEY, { ...latest, [email]: entry });
    return image;
  }

  private async readCached(entry: IndexEntry): Promise<AvatarImage | null> {
    try {
      const file = vscode.Uri.parse(entry.file!);
      const bytes = await vscode.workspace.fs.readFile(file);
      return { file, dataUri: AvatarService.toDataUri(bytes, entry.contentType ?? 'image/png') };
    } catch {
      return null;
    }
  }

  private async download(
    email: string,
    root: string,
    sampleSha?: string,
  ): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    const sources = new Set(Settings.get<string[]>('avatars.sources'));
    const remote = await this.getRemote(root);

    if (sources.has('github')) {
      const url = await this.findGitHubAvatar(email, remote, sampleSha);
      const picture = url ? await AvatarService.fetchImage(url) : null;
      if (picture) {
        return picture;
      }
    }

    if (sources.has('gitlab') && remote && remote.kind !== 'github') {
      const picture = await this.findGitLabAvatar(email, remote.host);
      if (picture) {
        return picture;
      }
    }

    if (sources.has('gravatar')) {
      const fallback = Settings.get<string>('avatars.fallback');
      const style = fallback === 'initials' ? '404' : fallback;
      const hash = createHash('md5').update(email).digest('hex');
      return AvatarService.fetchImage(`https://www.gravatar.com/avatar/${hash}?s=${SIZE}&d=${style}`);
    }
    return null;
  }

  private async findGitHubAvatar(email: string, remote: RemoteInfo | null, sampleSha?: string): Promise<string | null> {
    const noReply = /^(?:(\d+)\+)?([^@]+)@users\.noreply\.github\.com$/.exec(email);
    if (noReply) {
      return noReply[1]
        ? `https://avatars.githubusercontent.com/u/${noReply[1]}?s=${SIZE}`
        : `https://github.com/${noReply[2]}.png?size=${SIZE}`;
    }
    if (remote?.kind !== 'github' || !remote.owner || !remote.repo || !sampleSha) {
      return null;
    }

    // GitHub links a commit to its author's account, so one commit of the author is enough to find the picture.
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
    const session = await vscode.authentication.getSession('github', [], { silent: true }).then(
      (found) => found,
      () => undefined,
    );
    if (session) {
      headers.Authorization = `Bearer ${session.accessToken}`;
    }
    const response = await AvatarService.fetchJson(
      `https://api.github.com/repos/${remote.owner}/${remote.repo}/commits/${sampleSha}`,
      headers,
    );
    const avatarUrl = (response as { author?: { avatar_url?: string } } | null)?.author?.avatar_url;
    return avatarUrl ? `${avatarUrl}${avatarUrl.includes('?') ? '&' : '?'}s=${SIZE}` : null;
  }

  // Without a token a private GitLab answers every email with a Gravatar address, which the Gravatar step covers.
  private async findGitLabAvatar(email: string, host: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    const token = await this.context.secrets.get(AvatarService.getTokenKey(host));
    if (!token) {
      return null;
    }
    const headers = { 'PRIVATE-TOKEN': token };
    const response = await AvatarService.fetchJson(
      `https://${host}/api/v4/avatar?email=${encodeURIComponent(email)}&size=${SIZE}`,
      headers,
    );
    const avatarUrl = (response as { avatar_url?: string } | null)?.avatar_url;
    if (!avatarUrl || /gravatar\.com/.test(avatarUrl)) {
      return null;
    }
    const sameHost = new URL(avatarUrl).host === host;
    return AvatarService.fetchImage(avatarUrl, sameHost ? headers : {});
  }

  private getRemote(root: string): Promise<RemoteInfo | null> {
    let remote = this.remotes.get(root);
    if (!remote) {
      remote = new GitService(this.gitPath, root)
        .run(['remote', 'get-url', 'origin'])
        .then((url) => RemoteUrl.parse(url.trim()))
        .catch(() => null);
      this.remotes.set(root, remote);
    }
    return remote;
  }

  private static async fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  }

  private static async fetchImage(
    url: string,
    headers: Record<string, string> = {},
  ): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      const contentType = response.headers.get('content-type') ?? '';
      if (!response.ok || !contentType.startsWith('image/')) {
        return null;
      }
      return { bytes: new Uint8Array(await response.arrayBuffer()), contentType };
    } catch {
      return null;
    }
  }

  private static toDataUri(bytes: Uint8Array, contentType: string): string {
    return `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`;
  }

  private static normalize(email: string): string {
    return email.trim().toLowerCase();
  }

  private static hash(value: string): string {
    return createHash('sha1').update(value).digest('hex');
  }

  private static getTokenKey(host: string): string {
    return `dendro.gitlab.token.${host.toLowerCase()}`;
  }
}
