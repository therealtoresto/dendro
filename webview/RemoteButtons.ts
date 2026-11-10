import type { GraphState, RemoteAction } from '../src/protocol';
import type { DateFormatter } from '../src/shared/DateFormatter';
import { Format } from './Format';
import { HostBridge } from './HostBridge';
import { IconName, Icons } from './Icons';

type ButtonState =
  | 'idle'
  | 'incoming'
  | 'diverged'
  | 'outgoing'
  | 'publish'
  | 'blocked'
  | 'stale'
  | 'busy'
  | 'success'
  | 'error'
  | 'disabled';

interface ButtonView {
  state: ButtonState;
  icon: IconName;
  label: string;
  count: string;
  note: string;
}

interface ActionResult {
  ok: boolean;
  message?: string;
  until: number;
}

const SUCCESS_SHOWN_MS = 2500;
const ERROR_SHOWN_MS = 8000;
const POPOVER_DELAY_MS = 300;
const POPOVER_GRACE_MS = 180;
const MINUTE = 60;

const ACTIONS: RemoteAction[] = ['pull', 'push', 'fetch'];

// Pull, Push and Fetch: each button shows by its color what it would do now (commits to pull, to push, a branch
// to publish, a stale fetch), spins while running, flashes the result, and explains itself in a card on hover.
export class RemoteButtons {
  private readonly buttons = new Map<RemoteAction, HTMLButtonElement>();
  private readonly results = new Map<RemoteAction, ActionResult>();
  private readonly popover: HTMLElement;
  private state: GraphState | null = null;
  private dates: DateFormatter | null = null;
  private busy: RemoteAction | null = null;
  private busyIsAutomatic = false;
  private hovered: RemoteAction | null = null;
  private popoverTimer: number | undefined;
  private resultTimer: number | undefined;

  constructor(container: HTMLElement) {
    container.innerHTML = ACTIONS.map((action) => `<button class="tool remote-button" data-action="${action}"></button>`).join('');
    for (const action of ACTIONS) {
      const button = container.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
      this.buttons.set(action, button);
      button.addEventListener('click', () => {
        this.hidePopover();
        HostBridge.post({ type: 'remote', action });
      });
      button.addEventListener('mouseenter', () => this.schedulePopover(action));
      button.addEventListener('mouseleave', () => this.scheduleHidePopover());
    }

    this.popover = document.createElement('div');
    this.popover.className = 'tool-popover glass-strong';
    this.popover.hidden = true;
    document.body.appendChild(this.popover);
    this.popover.addEventListener('mouseenter', () => window.clearTimeout(this.popoverTimer));
    this.popover.addEventListener('mouseleave', () => this.scheduleHidePopover());
    this.popover.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('[data-open-settings]')) {
        HostBridge.post({ type: 'openSettings', section: 'graph' });
      }
    });
  }

  render(state: GraphState, dates: DateFormatter): void {
    this.state = state;
    this.dates = dates;
    this.renderButtons();
  }

  setBusy(action: RemoteAction | null, automatic: boolean): void {
    this.busy = action;
    this.busyIsAutomatic = automatic;
    this.renderButtons();
  }

  showResult(action: RemoteAction, ok: boolean, message?: string): void {
    this.results.set(action, { ok, message, until: Date.now() + (ok ? SUCCESS_SHOWN_MS : ERROR_SHOWN_MS) });
    this.renderButtons();
    window.clearTimeout(this.resultTimer);
    this.resultTimer = window.setTimeout(() => this.renderButtons(), ok ? SUCCESS_SHOWN_MS + 50 : ERROR_SHOWN_MS + 50);
  }

  private renderButtons(): void {
    if (!this.state || !this.dates) {
      return;
    }
    for (const action of ACTIONS) {
      const button = this.buttons.get(action)!;
      const view = this.describe(action);
      button.className = `tool remote-button state-${view.state}`;
      button.disabled = view.state === 'disabled' || (this.busy !== null && this.busy !== action);
      const icon = view.state === 'busy' ? '<span class="spinner"></span>' : Icons.render(view.icon);
      button.innerHTML =
        `${icon}<span>${Format.escapeHtml(view.label)}</span>` +
        (view.count ? `<span class="tool-count">${view.count}</span>` : '') +
        (view.note ? `<span class="tool-note">${Format.escapeHtml(view.note)}</span>` : '');
    }
    if (this.hovered && !this.popover.hidden) {
      this.popover.innerHTML = this.describePopover(this.hovered);
    }
  }

  private describe(action: RemoteAction): ButtonView {
    const state = this.state!;
    const { head } = state;
    const result = this.readResult(action);

    if (this.busy === action) {
      const labels: Record<RemoteAction, string> = { pull: 'Pulling…', push: 'Pushing…', fetch: 'Fetching…' };
      return { state: 'busy', icon: action, label: labels[action], count: '', note: this.busyIsAutomatic ? '(auto)' : '' };
    }
    if (result) {
      const label = action[0].toUpperCase() + action.slice(1);
      return { state: result.ok ? 'success' : 'error', icon: result.ok ? 'check' : 'close', label, count: '', note: '' };
    }

    if (action === 'pull') {
      if (!state.root || !head.branch || !head.upstream) {
        return { state: 'disabled', icon: 'pull', label: 'Pull', count: '', note: '' };
      }
      if (head.behind > 0) {
        return { state: head.ahead > 0 ? 'diverged' : 'incoming', icon: 'pull', label: 'Pull', count: `${head.behind}↓`, note: '' };
      }
      return { state: 'idle', icon: 'pull', label: 'Pull', count: '', note: '' };
    }

    if (action === 'push') {
      if (!state.root || !head.branch) {
        return { state: 'disabled', icon: 'push', label: 'Push', count: '', note: '' };
      }
      if (!head.upstream) {
        return { state: 'publish', icon: 'push', label: 'Publish', count: '', note: '' };
      }
      if (head.ahead > 0) {
        return { state: head.behind > 0 ? 'blocked' : 'outgoing', icon: 'push', label: 'Push', count: `${head.ahead}↑`, note: '' };
      }
      return { state: 'idle', icon: 'push', label: 'Push', count: '', note: '' };
    }

    if (!state.root || !state.remote) {
      return { state: 'disabled', icon: 'fetch', label: 'Fetch', count: '', note: '' };
    }
    const note = state.lastFetch ? `(${this.dates!.formatCompact(state.lastFetch / 1000)})` : '(never)';
    return { state: this.isFetchStale() ? 'stale' : 'idle', icon: 'fetch', label: 'Fetch', count: '', note };
  }

  // Stale: never fetched, or the last fetch is older than two auto-fetch rounds (half an hour when auto-fetch is off).
  private isFetchStale(): boolean {
    const state = this.state!;
    if (!state.lastFetch) {
      return true;
    }
    const autoFetch = state.settings['graph.autoFetch.enabled'] !== false;
    const minutes = autoFetch ? Number(state.settings['graph.autoFetch.intervalMinutes'] ?? 5) * 2 : 30;
    return Date.now() - state.lastFetch > minutes * MINUTE * 1000;
  }

  private readResult(action: RemoteAction): ActionResult | null {
    const result = this.results.get(action);
    if (!result || result.until < Date.now()) {
      this.results.delete(action);
      return null;
    }
    return result;
  }

  private schedulePopover(action: RemoteAction): void {
    window.clearTimeout(this.popoverTimer);
    const delay = this.popover.hidden ? POPOVER_DELAY_MS : 0;
    this.popoverTimer = window.setTimeout(() => this.showPopover(action), delay);
  }

  private scheduleHidePopover(): void {
    window.clearTimeout(this.popoverTimer);
    this.popoverTimer = window.setTimeout(() => this.hidePopover(), POPOVER_GRACE_MS);
  }

  private hidePopover(): void {
    window.clearTimeout(this.popoverTimer);
    this.popover.hidden = true;
    this.hovered = null;
  }

  private showPopover(action: RemoteAction): void {
    if (!this.state || !this.dates) {
      return;
    }
    this.hovered = action;
    this.popover.innerHTML = this.describePopover(action);
    this.popover.hidden = false;

    const anchor = this.buttons.get(action)!.getBoundingClientRect();
    const width = this.popover.offsetWidth;
    this.popover.style.top = `${anchor.bottom + 6}px`;
    this.popover.style.left = `${Math.max(6, Math.min(anchor.left, window.innerWidth - width - 6))}px`;
  }

  private describePopover(action: RemoteAction): string {
    const state = this.state!;
    const { head } = state;
    const branch = head.branch ? this.code(head.branch) : 'HEAD';
    const upstream = head.upstream ? this.code(head.upstream) : '';
    const host = this.describeHost();
    const lines: string[] = [];

    if (action === 'fetch') {
      lines.push(
        state.remote
          ? `<div class="tp-title">Fetch from ${this.code(state.remote.name)}${host}</div>`
          : '<div class="tp-title">This repository has no remote to fetch from</div>',
      );
      lines.push(this.describeLastFetch());
      lines.push(this.describeAutoFetch());
    } else if (action === 'pull') {
      if (!head.branch) {
        lines.push('<div class="tp-title">HEAD is detached; check out a branch to pull</div>');
      } else if (!head.upstream) {
        lines.push(`<div class="tp-title">${branch} has no upstream to pull from</div>`);
      } else if (head.behind === 0) {
        lines.push(`<div class="tp-title">${branch} has everything ${upstream} has</div>`);
      } else {
        lines.push(`<div class="tp-title">Pull ${this.plural(head.behind, 'commit')} from ${upstream} into ${branch}</div>`);
        if (head.ahead > 0) {
          lines.push(
            `<div class="tp-warning">The branches have diverged: ${this.plural(head.ahead, 'local commit')} too. ` +
              'Pull merges or rebases them, as your Git settings say.</div>',
          );
        }
      }
      lines.push(this.describeLastFetch());
    } else {
      if (!head.branch) {
        lines.push('<div class="tp-title">HEAD is detached; check out a branch to push</div>');
      } else if (!head.upstream) {
        lines.push(`<div class="tp-title">Publish ${branch}${host ? ` to ${this.code(state.remote?.name ?? 'origin')}${host}` : ''}</div>`);
        lines.push('<div class="tp-muted">The branch is not on the remote yet; it will be pushed and tracked.</div>');
      } else if (head.ahead === 0) {
        lines.push(`<div class="tp-title">Nothing to push: ${upstream} has every commit of ${branch}</div>`);
      } else {
        lines.push(`<div class="tp-title">Push ${this.plural(head.ahead, 'commit')} from ${branch} to ${upstream}</div>`);
        if (head.behind > 0) {
          lines.push(
            `<div class="tp-warning">${upstream} has ${this.plural(head.behind, 'commit')} you do not have. ` +
              'Pull first, or the push is rejected.</div>',
          );
        }
      }
    }

    const result = this.readResult(action);
    if (result && !result.ok && result.message) {
      lines.push(`<div class="tp-error">Last ${action} failed: ${Format.escapeHtml(result.message)}</div>`);
    }
    return lines.join('');
  }

  private describeLastFetch(): string {
    const { lastFetch } = this.state!;
    if (!lastFetch) {
      return '<div class="tp-muted">Never fetched</div>';
    }
    const seconds = lastFetch / 1000;
    const dates = this.dates!;
    return `<div class="tp-muted">Last fetched ${Format.escapeHtml(dates.formatAgo(seconds))} <i>(${Format.escapeHtml(dates.formatFull(seconds))})</i></div>`;
  }

  private describeAutoFetch(): string {
    const { settings, lastFetch } = this.state!;
    const gear = `<button class="tp-gear" data-open-settings title="Fetch settings">${Icons.render('gear', 13)}</button>`;
    if (settings['graph.autoFetch.enabled'] === false) {
      return `<div class="tp-auto"><span>${Icons.render('close', 12)} Auto-fetch is off</span>${gear}</div>`;
    }

    const minutes = Number(settings['graph.autoFetch.intervalMinutes'] ?? 5);
    let next = '';
    if (lastFetch) {
      const left = Math.max(0, Math.round((lastFetch + minutes * MINUTE * 1000 - Date.now()) / (MINUTE * 1000)));
      next = left <= 0 ? ' · next any moment' : ` · next in about ${this.plural(left, 'minute')}`;
    }
    return (
      `<div class="tp-auto"><span>${Icons.render('check', 12)} Auto-fetch every ${this.plural(minutes, 'minute')}` +
      `<span class="tp-muted">${next}</span></span>${gear}</div>`
    );
  }

  private describeHost(): string {
    const remote = this.state!.remote;
    if (!remote) {
      return '';
    }
    const names: Record<string, string> = { github: 'GitHub', gitlab: 'GitLab' };
    return ` on ${Format.escapeHtml(names[remote.kind] ?? remote.host)}`;
  }

  private code(text: string): string {
    return `<code>${Format.escapeHtml(text)}</code>`;
  }

  private plural(count: number, word: string): string {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
  }
}
