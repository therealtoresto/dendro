import type { CompareCommit, CompareData, CompareHostMessage, CompareMode, CompareWebviewMessage } from '../src/compareProtocol';
import type { ChangedFile } from '../src/protocol';
import { AvatarStyle } from '../src/shared/AvatarStyle';
import { DateFormatter } from '../src/shared/DateFormatter';
import { FileIcons } from '../webview/FileIcons';
import { Format } from '../webview/Format';
import { Icons } from '../webview/Icons';

interface VsCodeApi {
  postMessage(message: CompareWebviewMessage): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const MODES: { mode: CompareMode; label: string; hint: string }[] = [
  { mode: 'diverged', label: 'Since they diverged', hint: 'What the right side changed after it left the left side' },
  { mode: 'direct', label: 'Direct difference', hint: 'Everything that differs between the two, both ways' },
];

// The compare page: which commits only one side has, and which files differ.
class CompareApp {
  private readonly api = acquireVsCodeApi();
  private data: CompareData | null = null;
  private dates = new DateFormatter({ relative: true, locale: '', format: '', shortFormat: '', timeFormat: '' }, 'en-US');

  constructor(private readonly root: HTMLElement) {
    root.innerHTML = '<div class="cp-empty">Pick what to compare…</div>';
    root.addEventListener('click', (event) => this.onClick(event.target as HTMLElement));
    window.addEventListener('message', (event: MessageEvent<CompareHostMessage>) => this.onHostMessage(event.data));
    this.api.postMessage({ type: 'ready' });
  }

  private onHostMessage(message: CompareHostMessage): void {
    if (message.type === 'loading') {
      this.root.classList.add('cp-loading');
      return;
    }
    this.root.classList.remove('cp-loading');
    if (message.type === 'error') {
      this.root.innerHTML = `<div class="cp-empty cp-error"></div>`;
      this.root.querySelector('.cp-error')!.textContent = message.message;
      return;
    }
    this.data = message.data;
    this.dates = new DateFormatter(message.data.dates, message.data.locale);
    this.render();
  }

  private render(): void {
    const data = this.data!;
    const left = Format.escapeHtml(data.left.ref);
    const right = Format.escapeHtml(data.right.ref);
    const totals = data.files.reduce(
      (sum, file) => ({ added: sum.added + (file.additions ?? 0), deleted: sum.deleted + (file.deletions ?? 0) }),
      { added: 0, deleted: 0 },
    );

    this.root.innerHTML = `
      <header class="cp-header glass">
        ${this.renderSide('left', data.left.ref, data.left.hash)}
        <button class="cp-swap" data-action="swap" title="Swap the two sides">${Icons.render('compare', 16)}</button>
        ${this.renderSide('right', data.right.ref, data.right.hash)}
        <div class="cp-modes">${MODES.map(
          (item) => `<button data-mode="${item.mode}" class="${item.mode === data.mode ? 'active' : ''}" title="${item.hint}">${item.label}</button>`,
        ).join('')}</div>
      </header>
      <p class="cp-summary">
        <b>${right}</b> has <b>${CompareApp.countText(data.rightCount)}</b> that <b>${left}</b> does not;
        <b>${left}</b> has <b>${CompareApp.countText(data.leftCount)}</b> that <b>${right}</b> does not.
        ${data.mergeBase ? `They split at <a class="cp-link mono" data-commit="${data.mergeBase}">${data.mergeBase.slice(0, 7)}</a>.` : 'They share no history.'}
      </p>
      <div class="cp-columns">
        ${this.renderCommits(`Only in ${left}`, data.onlyLeft, data.leftCount)}
        ${this.renderCommits(`Only in ${right}`, data.onlyRight, data.rightCount)}
      </div>
      <section class="cp-files glass">
        <h3>Files changed <span class="cp-count">${data.files.length}</span>
          <span class="cp-lines"><span class="add">+${totals.added.toLocaleString()}</span> <span class="del">−${totals.deleted.toLocaleString()}</span></span></h3>
        <div class="cp-file-list">${data.files.map((file, index) => this.renderFile(file, index)).join('') || '<div class="cp-none">No differences.</div>'}</div>
      </section>
      ${this.renderRecent()}`;
  }

  private renderSide(side: 'left' | 'right', ref: string, hash: string): string {
    return (
      `<button class="cp-side" data-pick="${side}" title="Pick another branch, tag or commit">` +
      `${Icons.render('branch', 14)}<span class="cp-side-name">${Format.escapeHtml(ref)}</span>` +
      `<span class="cp-side-sha">${hash.slice(0, 7)}</span>${Icons.render('down', 12)}</button>`
    );
  }

  private renderCommits(title: string, commits: CompareCommit[], total: number): string {
    const rows = commits
      .map(
        (commit) => `
        <button class="cp-commit" data-commit="${commit.hash}" title="Show in the Commit Graph">
          <span class="cp-avatar" style="background:${AvatarStyle.getColor(commit.email)}">${AvatarStyle.renderArt(commit.email)}</span>
          <span class="cp-commit-text">
            <span class="cp-subject">${Format.escapeHtml(commit.subject)}</span>
            <span class="cp-meta">${Format.escapeHtml(commit.author)} · ${Format.escapeHtml(this.dates.formatAgoOrDate(commit.date))}</span>
          </span>
          <span class="cp-sha">${commit.hash.slice(0, 7)}</span>
        </button>`,
      )
      .join('');
    const more = total > commits.length ? `<div class="cp-none">…and ${(total - commits.length).toLocaleString()} older</div>` : '';
    return (
      `<section class="cp-column glass"><h3>${title} <span class="cp-count">${total.toLocaleString()}</span></h3>` +
      `<div class="cp-commit-list">${rows || '<div class="cp-none">Nothing.</div>'}${more}</div></section>`
    );
  }

  private renderFile(file: ChangedFile, index: number): string {
    const { name, folder } = Format.splitPath(file.path);
    const lines = file.binary
      ? '<span class="cp-muted">binary</span>'
      : `<span class="add">+${file.additions ?? 0}</span> <span class="del">−${file.deletions ?? 0}</span>`;
    return `
      <button class="cp-file" data-file="${index}" title="${Format.escapeHtml(file.oldPath ? `${file.oldPath} → ${file.path}` : file.path)}">
        ${FileIcons.render(file.path)}
        <span class="cp-file-name">${Format.escapeHtml(name)}</span>
        <span class="cp-file-folder">${Format.escapeHtml(folder)}</span>
        <span class="cp-file-lines">${lines}</span>
        <span class="cp-status status-${file.status}">${file.status}</span>
      </button>`;
  }

  private renderRecent(): string {
    const data = this.data!;
    const others = data.recent.filter((pair) => pair.left !== data.left.ref || pair.right !== data.right.ref);
    if (others.length === 0) {
      return '';
    }
    const chips = others
      .map(
        (pair, index) =>
          `<button class="cp-chip" data-recent="${index}">${Format.escapeHtml(pair.left)} ↔ ${Format.escapeHtml(pair.right)}</button>`,
      )
      .join('');
    return `<div class="cp-recent"><span class="cp-muted">Recent</span>${chips}</div>`;
  }

  private onClick(target: HTMLElement): void {
    const data = this.data;
    const element = target.closest<HTMLElement>('[data-pick],[data-action],[data-mode],[data-commit],[data-file],[data-recent]');
    if (!element || !data) {
      return;
    }
    if (element.dataset.pick) {
      this.api.postMessage({ type: 'pick', side: element.dataset.pick as 'left' | 'right' });
    } else if (element.dataset.action === 'swap') {
      this.api.postMessage({ type: 'swap' });
    } else if (element.dataset.mode) {
      this.api.postMessage({ type: 'setMode', mode: element.dataset.mode as CompareMode });
    } else if (element.dataset.commit) {
      this.api.postMessage({ type: 'showCommit', hash: element.dataset.commit });
    } else if (element.dataset.file) {
      this.api.postMessage({ type: 'openFile', file: data.files[Number(element.dataset.file)] });
    } else if (element.dataset.recent) {
      const others = data.recent.filter((pair) => pair.left !== data.left.ref || pair.right !== data.right.ref);
      const pair = others[Number(element.dataset.recent)];
      this.api.postMessage({ type: 'openRecent', left: pair.left, right: pair.right });
    }
  }

  private static countText(count: number): string {
    return `${count.toLocaleString()} ${count === 1 ? 'commit' : 'commits'}`;
  }
}

new CompareApp(document.getElementById('app')!);
