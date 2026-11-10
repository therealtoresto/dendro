import * as vscode from 'vscode';
import type { API } from './git/git';
import { GitService } from './git/GitService';
import { Settings } from './Settings';

const STARTUP_DELAY_MS = 15_000;
const MINUTE_MS = 60_000;
const MAX_BACKOFF_STEPS = 4;

// Fetches every open repository in the background, so the graph shows commits that are not pulled yet. A repository
// fetched recently by anything else (a manual fetch, the built-in auto fetch) is skipped; one that keeps failing,
// e.g. off the VPN, is retried at a growing interval and never interrupts the user.
export class AutoFetcher implements vscode.Disposable {
  private timer: NodeJS.Timeout | undefined;
  private readonly failures = new Map<string, number>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly api: API) {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('dendro.graph.autoFetch')) {
          this.schedule(0);
        }
      }),
    );
    this.schedule(STARTUP_DELAY_MS);
  }

  dispose(): void {
    clearTimeout(this.timer);
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private schedule(delay: number): void {
    clearTimeout(this.timer);
    if (!Settings.get<boolean>('graph.autoFetch.enabled')) {
      return;
    }
    this.timer = setTimeout(() => void this.fetchAll(), delay);
  }

  private async fetchAll(): Promise<void> {
    const interval = Settings.get<number>('graph.autoFetch.intervalMinutes') * MINUTE_MS;

    for (const repo of this.api.repositories) {
      if (repo.state.remotes.length === 0) {
        continue;
      }

      const root = repo.rootUri.fsPath;
      const failures = this.failures.get(root) ?? 0;
      const wait = interval * 2 ** Math.min(failures, MAX_BACKOFF_STEPS);
      const lastFetch = await new GitService(this.api.git.path, root).getLastFetchTime();
      if (lastFetch !== null && Date.now() - lastFetch < wait - MINUTE_MS / 4) {
        continue;
      }

      try {
        await repo.fetch({ all: true, prune: Settings.get<boolean>('graph.fetchPrune') });
        this.failures.delete(root);
      } catch {
        this.failures.set(root, failures + 1);
      }
    }

    this.schedule(Math.min(interval, 5 * MINUTE_MS));
  }
}
