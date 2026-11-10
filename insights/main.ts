import type { FileCount, InsightsData, InsightsHostMessage, InsightsStats, InsightsWebviewMessage } from '../src/insightsProtocol';
import { AvatarStyle } from '../src/shared/AvatarStyle';
import { Format } from '../webview/Format';
import { ActivityCalendar, CalendarDay } from './ActivityCalendar';

interface VsCodeApi {
  postMessage(message: InsightsWebviewMessage): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

type Scope = 'all' | 'me';

interface Contributor {
  name: string;
  email: string;
  commits: number;
}

const WEEKS = 53;
const TOP_CONTRIBUTORS = 10;
const PUNCH_ROW = 26;
const PUNCH_MIN_COLUMN = 18;
// The card's padding and border on both sides.
const CARD_INSET = 34;
const PUNCH_LABEL_WIDTH = 44;
const PUNCH_TOP = 20;

// The repository at a glance: a year of commits as a calendar, a few numbers, who commits, which files change most
// and when in the week the work happens. "Me" narrows everything but the contributor list to the user's commits.
class InsightsApp {
  private readonly api = acquireVsCodeApi();
  private data: InsightsData | null = null;
  private stats: InsightsStats | null = null;
  private scope: Scope = 'all';
  private readonly avatars = new Map<string, string>();
  private readonly tooltip: HTMLElement;
  private readonly content: HTMLElement;
  private days: CalendarDay[] = [];
  private dayCounts = new Map<string, number>();
  private punch: number[][] = [];

  constructor(root: HTMLElement) {
    root.innerHTML = '<div class="in-content"></div><div class="in-tooltip glass-strong" hidden></div>';
    this.content = root.querySelector('.in-content')!;
    this.tooltip = root.querySelector('.in-tooltip')!;

    root.addEventListener('click', (event) => this.onClick(event.target as HTMLElement));
    root.addEventListener('mouseover', (event) => this.onPointer(event));
    root.addEventListener('mousemove', (event) => this.onPointer(event));
    root.addEventListener('mouseleave', () => (this.tooltip.hidden = true));
    window.addEventListener('message', (event: MessageEvent<InsightsHostMessage>) => this.onMessage(event.data));
    let resizeFrame = 0;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => this.data && this.render());
    });
    this.api.postMessage({ type: 'ready' });
  }

  private get locale(): string {
    return this.data?.locale || navigator.language;
  }

  private onMessage(message: InsightsHostMessage): void {
    switch (message.type) {
      case 'loading':
        this.data = null;
        this.stats = null;
        this.content.innerHTML = `<div class="in-loading">Reading the history of ${Format.escapeHtml(message.repoName)}…</div>`;
        return;
      case 'data':
        this.data = message.data;
        this.avatars.clear();
        for (const [email, uri] of Object.entries(message.data.avatars)) {
          this.avatars.set(email, uri);
        }
        if (!message.data.userEmail) {
          this.scope = 'all';
        }
        this.render();
        return;
      case 'stats':
        this.stats = message.stats;
        this.render();
        return;
      case 'avatars':
        for (const [email, uri] of Object.entries(message.avatars)) {
          this.avatars.set(email, uri);
        }
        if (this.data) {
          this.render();
        }
        return;
    }
  }

  // Indexes into data.commits that the scope keeps.
  private getScopedIndexes(): number[] {
    const data = this.data!;
    const indexes: number[] = [];
    data.commits.forEach((commit, index) => {
      if (this.scope === 'all' || data.authors[commit.author].email === data.userEmail) {
        indexes.push(index);
      }
    });
    return indexes;
  }

  private render(): void {
    const data = this.data!;
    const indexes = this.getScopedIndexes();
    const dates = indexes.map((index) => data.commits[index].date);

    this.days = ActivityCalendar.buildDays(new Date(), WEEKS);
    const counts = ActivityCalendar.countByDay(dates);
    this.dayCounts = new Map(this.days.filter((day) => counts.has(day.key)).map((day) => [day.key, counts.get(day.key)!]));
    this.punch = ActivityCalendar.buildPunchCard(dates);

    const yearTotal = Array.from(this.dayCounts.values()).reduce((sum, count) => sum + count, 0);
    this.content.innerHTML =
      this.renderHeader() +
      this.renderTiles(indexes, yearTotal) +
      this.renderCalendar(yearTotal) +
      `<div class="in-columns">${this.renderContributors()}${this.renderFiles()}</div>` +
      this.renderPunchCard();
  }

  private renderHeader(): string {
    const data = this.data!;
    const since = data.firstCommitDate ? ` since ${this.formatDate(data.firstCommitDate, { month: 'long', year: 'numeric' })}` : '';
    const scopeButton = (scope: Scope, label: string, disabled = false) =>
      `<button class="${this.scope === scope ? 'active' : ''}" data-scope="${scope}" ${disabled ? 'disabled title="Set user.email in git to see your own commits"' : ''}>${label}</button>`;

    return `
      <header class="in-header">
        <div>
          <div class="in-title">${Format.escapeHtml(data.repoName)}${data.branch ? `<span class="in-branch">${Format.escapeHtml(data.branch)}</span>` : ''}</div>
          <div class="in-subtitle">${this.formatNumber(data.totalCommits)} commits${since} · the last year below, merges not counted</div>
        </div>
        <div class="in-controls">
          <div class="in-segmented">${scopeButton('all', 'Everyone')}${scopeButton('me', 'Only me', !data.userEmail)}</div>
          <button class="in-refresh" data-action="refresh" title="Read the history again">↻</button>
        </div>
      </header>`;
  }

  private renderTiles(indexes: number[], yearTotal: number): string {
    const data = this.data!;
    const streaks = ActivityCalendar.getStreaks(this.days, this.dayCounts);
    const activeWeeks = new Set(Array.from(this.dayCounts.keys()).map((key) => Math.floor(this.days.findIndex((day) => day.key === key) / 7))).size;
    const authors = new Set(indexes.map((index) => data.commits[index].author)).size;

    let busiest: [string, number] | null = null;
    for (const entry of this.dayCounts) {
      if (!busiest || entry[1] > busiest[1]) {
        busiest = entry;
      }
    }
    const busiestDay = busiest ? this.days.find((day) => day.key === busiest![0])!.date : null;

    let lines = '<span class="in-pending">reading…</span>';
    let linesNote = 'added and removed';
    if (this.stats) {
      const additions = indexes.reduce((sum, index) => sum + this.stats!.additions[index], 0);
      const deletions = indexes.reduce((sum, index) => sum + this.stats!.deletions[index], 0);
      lines = this.formatCompact(additions + deletions);
      linesNote = `+${this.formatCompact(additions)} / −${this.formatCompact(deletions)}`;
    }

    const tile = (label: string, value: string, note: string) =>
      `<div class="in-tile glass"><div class="in-tile-label">${label}</div><div class="in-tile-value">${value}</div><div class="in-tile-note">${note}</div></div>`;

    return `<section class="in-tiles">
      ${tile('Commits', this.formatNumber(yearTotal), 'in the last year')}
      ${tile('Active days', this.formatNumber(this.dayCounts.size), `of ${this.days.length} days`)}
      ${tile('Current streak', this.formatDays(streaks.current), streaks.current > 0 ? 'days in a row with commits' : 'no commits yesterday or today')}
      ${tile('Longest streak', this.formatDays(streaks.longest), 'in the last year')}
      ${tile('Per active week', activeWeeks > 0 ? (yearTotal / activeWeeks).toLocaleString(this.locale, { maximumFractionDigits: 1 }) : '0', `commits, over ${activeWeeks} weeks with commits`)}
      ${tile('Busiest day', busiest ? this.formatNumber(busiest[1]) : '—', busiestDay ? this.formatDate(busiestDay.getTime() / 1000, { day: 'numeric', month: 'short', year: 'numeric' }) : 'no commits')}
      ${tile('Contributors', this.formatNumber(authors), this.scope === 'me' ? 'only you' : 'with commits this year')}
      ${tile('Lines changed', lines, linesNote)}
    </section>`;
  }

  private renderCalendar(yearTotal: number): string {
    const limits = ActivityCalendar.getLevelLimits(Array.from(this.dayCounts.values()));
    const cells = this.days
      .map((day, index) => {
        const count = this.dayCounts.get(day.key) ?? 0;
        const row = ActivityCalendar.getWeekday(day.date) + 1;
        const column = Math.floor(index / 7) + 1;
        return `<i class="in-day level-${ActivityCalendar.getLevel(count, limits)}" data-day="${index}" style="grid-row:${row};grid-column:${column}"></i>`;
      })
      .join('');

    // A month's name goes over the first week that holds its 1st day.
    const months = this.days
      .filter((day) => day.date.getDate() === 1 && day.date.getTime() > this.days[6].date.getTime())
      .map((day) => {
        const column = Math.floor(this.days.indexOf(day) / 7) + 1;
        return `<span style="grid-column:${column} / span 4">${this.formatDate(day.date.getTime() / 1000, { month: 'short' })}</span>`;
      })
      .join('');

    const monday = this.days[0].date;
    const weekdays = [0, 2, 4]
      .map((offset) => {
        const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + offset);
        return `<span style="grid-row:${offset + 1}">${this.formatDate(date.getTime() / 1000, { weekday: 'short' })}</span>`;
      })
      .join('');

    const steps = [0, 1, 2, 3, 4].map((level) => `<i class="in-day level-${level}"></i>`).join('');
    const stepNote = yearTotal > 0 ? `Steps: 1–${limits[0]}, up to ${limits[1]}, up to ${limits[2]}, more` : '';

    return `<section class="in-card glass in-calendar-card">
      <div class="in-card-title">${this.formatNumber(yearTotal)} commits in the last year</div>
      <div class="in-calendar">
        <div class="in-months">${months}</div>
        <div class="in-weekdays">${weekdays}</div>
        <div class="in-days">${cells}</div>
      </div>
      <div class="in-legend"><span class="in-step-note">${stepNote}</span><span>Less</span>${steps}<span>More</span></div>
    </section>`;
  }

  private renderContributors(): string {
    const data = this.data!;
    const byAuthor = new Map<number, number>();
    for (const commit of data.commits) {
      byAuthor.set(commit.author, (byAuthor.get(commit.author) ?? 0) + 1);
    }
    const contributors: Contributor[] = Array.from(byAuthor.entries())
      .map(([author, commits]) => ({ ...data.authors[author], commits }))
      .sort((left, right) => right.commits - left.commits);
    const total = data.commits.length;
    const max = contributors[0]?.commits ?? 1;

    const rows = contributors
      .slice(0, TOP_CONTRIBUTORS)
      .map((person) => {
        const isMe = person.email === data.userEmail;
        const share = Math.round((person.commits / total) * 100);
        return `<div class="in-bar-row${isMe ? ' me' : ''}">
          ${this.renderAvatar(person)}
          <span class="in-bar-name" title="${Format.escapeHtml(person.email)}">${Format.escapeHtml(person.name)}${isMe ? ' <em>you</em>' : ''}</span>
          <span class="in-bar-track"><i style="width:${(person.commits / max) * 100}%"></i></span>
          <span class="in-bar-value">${this.formatNumber(person.commits)}</span>
          <span class="in-bar-share">${share}%</span>
        </div>`;
      })
      .join('');
    const rest = contributors.length - TOP_CONTRIBUTORS;

    return `<section class="in-card glass">
      <div class="in-card-title">Top contributors <span class="in-card-note">commits in the last year, everyone</span></div>
      ${rows || '<div class="in-empty">No commits in the last year.</div>'}
      ${rest > 0 ? `<div class="in-more">and ${rest} more</div>` : ''}
    </section>`;
  }

  private renderFiles(): string {
    let body = '<div class="in-empty">Reading which files changed…</div>';
    if (this.stats) {
      const files: FileCount[] = this.scope === 'me' ? this.stats.myFiles : this.stats.files;
      const max = files[0]?.commits ?? 1;
      body = files.length === 0
        ? '<div class="in-empty">No files changed in the last year.</div>'
        : files
            .map((file) => {
              const { name, folder } = Format.splitPath(file.path);
              return `<div class="in-bar-row in-file" data-file="${Format.escapeHtml(file.path)}" title="Open ${Format.escapeHtml(file.path)}">
                <span class="in-bar-name"><span class="in-file-name">${Format.escapeHtml(name)}</span><span class="in-file-folder">${Format.escapeHtml(folder)}</span></span>
                <span class="in-bar-track"><i style="width:${(file.commits / max) * 100}%"></i></span>
                <span class="in-bar-value">${this.formatNumber(file.commits)}</span>
              </div>`;
            })
            .join('');
    }
    return `<section class="in-card glass">
      <div class="in-card-title">Most changed files <span class="in-card-note">commits that touched them</span></div>
      ${body}
    </section>`;
  }

  // Columns stretch to the card's width; rows keep their height, so the dots stay round and the labels keep their size.
  private renderPunchCard(): string {
    const max = Math.max(1, ...this.punch.flat());
    const column = Math.max(PUNCH_MIN_COLUMN, (this.content.clientWidth - CARD_INSET - PUNCH_LABEL_WIDTH) / 24);
    const maxRadius = Math.min(column, PUNCH_ROW) / 2 - 2;
    const width = Math.floor(PUNCH_LABEL_WIDTH + 24 * column);
    const height = PUNCH_TOP + 7 * PUNCH_ROW;
    const monday = this.days[0].date;

    const parts: string[] = [];
    for (let hour = 0; hour < 24; hour += 3) {
      const x = PUNCH_LABEL_WIDTH + hour * column + column / 2;
      parts.push(`<text class="in-axis" x="${x}" y="12" text-anchor="middle">${this.formatHour(hour)}</text>`);
    }
    this.punch.forEach((hours, weekday) => {
      const y = PUNCH_TOP + weekday * PUNCH_ROW + PUNCH_ROW / 2;
      const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + weekday);
      parts.push(`<text class="in-axis" x="0" y="${y + 4}">${this.formatDate(date.getTime() / 1000, { weekday: 'short' })}</text>`);
      parts.push(`<line class="in-grid" x1="${PUNCH_LABEL_WIDTH}" x2="${width}" y1="${y}" y2="${y}"/>`);
      hours.forEach((count, hour) => {
        const x = PUNCH_LABEL_WIDTH + hour * column + column / 2;
        const radius = count > 0 ? Math.max(2.5, Math.sqrt(count / max) * maxRadius) : 0;
        parts.push(
          `<rect class="in-punch-hit" x="${x - column / 2}" y="${y - PUNCH_ROW / 2}" width="${column}" height="${PUNCH_ROW}" data-punch="${weekday}:${hour}"/>` +
            (radius > 0 ? `<circle class="in-punch-dot" cx="${x}" cy="${y}" r="${radius.toFixed(1)}"/>` : ''),
        );
      });
    });

    return `<section class="in-card glass">
      <div class="in-card-title">When commits happen <span class="in-card-note">by weekday and hour, your local time; the bigger the dot, the more commits</span></div>
      <div class="in-punch-scroll"><svg class="in-punch" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${parts.join('')}</svg></div>
    </section>`;
  }

  private renderAvatar(person: { name: string; email: string }): string {
    const picture = this.avatars.get(person.email);
    if (picture) {
      return `<img class="in-avatar" src="${picture}" alt="">`;
    }
    return `<span class="in-avatar" style="background:${AvatarStyle.getColor(person.email)}">${Format.escapeHtml(AvatarStyle.getInitials(person.name))}</span>`;
  }

  private onClick(target: HTMLElement): void {
    const scopeButton = target.closest<HTMLButtonElement>('[data-scope]');
    if (scopeButton && !scopeButton.disabled) {
      this.scope = scopeButton.dataset.scope as Scope;
      this.render();
      return;
    }
    if (target.closest('[data-action="refresh"]')) {
      this.api.postMessage({ type: 'refresh' });
      return;
    }
    const file = target.closest<HTMLElement>('[data-file]');
    if (file) {
      this.api.postMessage({ type: 'openFile', path: file.dataset.file! });
    }
  }

  private onPointer(event: MouseEvent): void {
    const target = event.target as Element;
    const day = target.closest<HTMLElement>('[data-day]');
    const punch = target.closest<SVGElement>('[data-punch]');

    if (day) {
      const entry = this.days[Number(day.dataset.day)];
      const count = this.dayCounts.get(entry.key) ?? 0;
      const date = this.formatDate(entry.date.getTime() / 1000, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      this.showTooltip(`<b>${count === 0 ? 'No' : this.formatNumber(count)} commit${count === 1 ? '' : 's'}</b><div class="in-tip-meta">${date}</div>`, event);
    } else if (punch) {
      const [weekday, hour] = punch.dataset.punch!.split(':').map(Number);
      const count = this.punch[weekday][hour];
      const monday = this.days[0].date;
      const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + weekday);
      const name = this.formatDate(date.getTime() / 1000, { weekday: 'long' });
      this.showTooltip(
        `<b>${count === 0 ? 'No' : this.formatNumber(count)} commit${count === 1 ? '' : 's'}</b><div class="in-tip-meta">${name}, ${this.formatHour(hour)}–${this.formatHour((hour + 1) % 24)}</div>`,
        event,
      );
    } else {
      this.tooltip.hidden = true;
    }
  }

  private showTooltip(html: string, event: MouseEvent): void {
    const tooltip = this.tooltip;
    tooltip.innerHTML = html;
    tooltip.hidden = false;
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    const left = event.clientX + 14 + width > window.innerWidth ? event.clientX - width - 14 : event.clientX + 14;
    const top = event.clientY - height - 12 < 8 ? event.clientY + 16 : event.clientY - height - 12;
    tooltip.style.left = `${Math.max(8, left)}px`;
    tooltip.style.top = `${top}px`;
  }

  private formatDate(seconds: number, options: Intl.DateTimeFormatOptions): string {
    return new Date(seconds * 1000).toLocaleDateString(this.locale, options);
  }

  private formatHour(hour: number): string {
    return new Date(2000, 0, 1, hour).toLocaleTimeString(this.locale, { hour: '2-digit', minute: '2-digit' });
  }

  private formatNumber(value: number): string {
    return value.toLocaleString(this.locale);
  }

  private formatCompact(value: number): string {
    return value.toLocaleString(this.locale, { notation: 'compact', maximumFractionDigits: 1 });
  }

  private formatDays(count: number): string {
    return `${this.formatNumber(count)} <small>${count === 1 ? 'day' : 'days'}</small>`;
  }
}

new InsightsApp(document.getElementById('app')!);
