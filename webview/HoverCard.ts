import type { CommitHoverInfo, CommitInfo, CommitStats, RefInfo } from '../src/protocol';
import { AvatarStyle } from '../src/shared/AvatarStyle';
import type { DateFormatter } from '../src/shared/DateFormatter';
import { Format } from './Format';
import { HostBridge } from './HostBridge';
import { Icons } from './Icons';
import { RefBadges } from './RefBadges';

export interface HoverSubject {
  commit: CommitInfo;
  refs: RefInfo[];
  headBranch: string | null;
  laneColor: string;
  stats: CommitStats | undefined;
  avatar: string | undefined;
  dates: DateFormatter;
  useCommitDate: boolean;
  incomingFrom: string | null;
}

const MAX_WIDTH = 540;
const GAP = 6;
const HIDE_GRACE_MS = 160;

// The card shown while the pointer rests on a commit row: who, when, what the commit did to how many files, and
// the whole message. It stays open while the pointer moves onto it, so its text can be selected and the SHA copied.
export class HoverCard {
  private readonly element: HTMLElement;
  private subject: HoverSubject | null = null;
  private info: CommitHoverInfo | null = null;
  private hideTimer: number | undefined;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'hover-card glass-strong';
    this.element.hidden = true;
    document.body.appendChild(this.element);

    this.element.addEventListener('mouseenter', () => window.clearTimeout(this.hideTimer));
    this.element.addEventListener('mouseleave', () => this.scheduleHide());
    this.element.addEventListener('click', (event) => {
      const copy = (event.target as HTMLElement).closest<HTMLElement>('[data-copy]');
      if (copy) {
        HostBridge.post({ type: 'copy', text: copy.dataset.copy! });
      }
    });
  }

  get shownHash(): string | null {
    return this.element.hidden ? null : this.subject?.commit.hash ?? null;
  }

  show(subject: HoverSubject, info: CommitHoverInfo | null, anchor: DOMRect, pointerX: number): void {
    window.clearTimeout(this.hideTimer);
    this.subject = subject;
    this.info = info;
    this.render();
    this.element.hidden = false;
    this.place(anchor, pointerX);
  }

  updateInfo(info: CommitHoverInfo): void {
    if (this.subject?.commit.hash !== info.hash || this.element.hidden) {
      return;
    }
    this.info = info;
    const top = this.element.style.top;
    this.render();
    this.element.style.top = top;
  }

  updateAvatar(email: string, avatar: string): void {
    if (this.subject && !this.element.hidden && this.subject.commit.email.toLowerCase() === email) {
      this.subject = { ...this.subject, avatar };
      this.render();
    }
  }

  scheduleHide(): void {
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.hide(), HIDE_GRACE_MS);
  }

  hide(): void {
    window.clearTimeout(this.hideTimer);
    this.element.hidden = true;
    this.subject = null;
  }

  private render(): void {
    const subject = this.subject;
    if (!subject) {
      return;
    }

    const { commit, dates } = subject;
    const time = subject.useCommitDate ? commit.commitDate : commit.date;
    const picture = subject.avatar
      ? `<img class="avatar-image" src="${subject.avatar}" alt="">`
      : '';
    const message = this.info?.message ?? (commit.bodyPreview ? `${commit.subject}\n\n${commit.bodyPreview}…` : commit.subject);
    const [title, ...bodyLines] = message.split('\n');
    const body = bodyLines.join('\n').trim();
    const badges = RefBadges.renderAll(subject.refs, subject.headBranch, subject.laneColor);

    this.element.innerHTML = `
      <div class="hc-head">
        <span class="avatar hc-avatar" style="background:${AvatarStyle.getColor(commit.email)}">${Format.escapeHtml(AvatarStyle.getInitials(commit.author))}${picture}</span>
        <div class="hc-who">
          <div class="hc-line">
            <span class="hc-author" title="${Format.escapeHtml(commit.email)}">${Format.escapeHtml(commit.author)}</span>
            <span class="hc-time">${Icons.render('history', 12)} ${Format.escapeHtml(dates.formatAgo(time))}
              <i>(${Format.escapeHtml(dates.formatFull(time))})</i></span>
          </div>
          <div class="hc-line">
            <button class="hc-sha" data-copy="${commit.hash}" title="Copy the full SHA">${Icons.render('copy', 11)}${commit.hash.slice(0, 7)}</button>
            ${this.renderFileCounts()}
            ${this.renderLineCounts(subject.stats)}
          </div>
        </div>
      </div>
      ${subject.incomingFrom ? `<div class="hc-incoming">↓ On ${Format.escapeHtml(subject.incomingFrom)}, not pulled yet</div>` : ''}
      ${badges ? `<div class="hc-badges">${badges}</div>` : ''}
      <div class="hc-message">
        <div class="hc-title">${Format.escapeHtml(title)}</div>
        ${body ? `<div class="hc-body">${Format.escapeHtml(body)}</div>` : ''}
      </div>`;
  }

  private renderFileCounts(): string {
    const info = this.info;
    if (!info) {
      return '<span class="hc-muted">…</span>';
    }
    return (
      `<span class="hc-files"><span class="count-added">+${info.added}</span> ` +
      `<span class="count-modified">~${info.modified}</span> <span class="count-deleted">−${info.deleted}</span></span>` +
      `<span class="hc-muted">(${info.files} ${info.files === 1 ? 'file' : 'files'} changed)</span>`
    );
  }

  private renderLineCounts(stats: CommitStats | undefined): string {
    if (!stats) {
      return '';
    }
    const additions = `${stats.additions} ${stats.additions === 1 ? 'addition' : 'additions'}`;
    const deletions = `${stats.deletions} ${stats.deletions === 1 ? 'deletion' : 'deletions'}`;
    return `<span class="hc-lines"><span class="lines-added">${additions}</span>, <span class="lines-deleted">${deletions}</span></span>`;
  }

  // Below the row near the pointer, or above it when there is no room below; never off screen.
  private place(anchor: DOMRect, pointerX: number): void {
    const card = this.element;
    card.style.maxWidth = `${Math.min(MAX_WIDTH, window.innerWidth - 2 * GAP)}px`;
    card.style.left = '0px';
    card.style.top = '0px';

    const width = card.offsetWidth;
    const height = card.offsetHeight;
    const left = Math.max(GAP, Math.min(pointerX - 40, window.innerWidth - width - GAP));
    const below = anchor.bottom + GAP;
    const top = below + height <= window.innerHeight - GAP ? below : Math.max(GAP, anchor.top - height - GAP);

    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }
}
