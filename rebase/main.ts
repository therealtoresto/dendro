import type { RebaseAction } from '../src/rebase/RebaseTodo';
import { RebaseTodo } from '../src/rebase/RebaseTodo';
import type { RebaseHostMessage, RebaseRow, RebaseView, RebaseWebviewMessage } from '../src/rebaseProtocol';
import { AvatarStyle } from '../src/shared/AvatarStyle';
import { DateFormatter } from '../src/shared/DateFormatter';
import { Format } from '../webview/Format';

interface VsCodeApi {
  postMessage(message: RebaseWebviewMessage): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const ACTIONS: { action: RebaseAction; key: string; hint: string }[] = [
  { action: 'pick', key: 'p', hint: 'Keep the commit as it is' },
  { action: 'reword', key: 'r', hint: 'Keep it, and edit its message' },
  { action: 'edit', key: 'e', hint: 'Stop after it, to amend it' },
  { action: 'squash', key: 's', hint: 'Fold it into the commit above, joining the messages' },
  { action: 'fixup', key: 'f', hint: 'Fold it into the commit above, dropping its message' },
  { action: 'drop', key: 'd', hint: 'Leave it out' },
];

// The rebase plan, top to bottom in the order git applies it: drag rows to reorder, pick an action per commit.
class RebaseApp {
  private readonly api = acquireVsCodeApi();
  private view: RebaseView | null = null;
  private selected = 0;
  private dragFrom: number | null = null;
  private readonly dates = new DateFormatter({ relative: true, locale: '', format: '', shortFormat: '', timeFormat: '' }, navigator.language);

  constructor(private readonly root: HTMLElement) {
    root.addEventListener('click', (event) => this.onClick(event.target as HTMLElement));
    root.addEventListener('dragstart', (event) => this.onDragStart(event));
    root.addEventListener('dragover', (event) => this.onDragOver(event));
    root.addEventListener('drop', (event) => this.onDrop(event));
    root.addEventListener('dragend', () => this.clearDrag());
    document.addEventListener('keydown', (event) => this.onKeyDown(event));
    window.addEventListener('message', (event: MessageEvent<RebaseHostMessage>) => {
      this.view = event.data.view;
      this.selected = Math.min(this.selected, Math.max(0, this.view.rows.length - 1));
      this.render();
    });
    this.api.postMessage({ type: 'ready' });
  }

  private get rows(): RebaseRow[] {
    return this.view?.rows ?? [];
  }

  private render(): void {
    const view = this.view!;
    const problem = RebaseTodo.findProblem(this.rows);
    const counts = ACTIONS.map((item) => ({ ...item, count: this.rows.filter((row) => row.action === item.action).length }))
      .filter((item) => item.count > 0)
      .map((item) => `${item.count} ${item.action}`)
      .join(' · ');

    this.root.innerHTML = `
      <header class="rb-header glass">
        <div>
          <div class="rb-title">Rebase ${Format.escapeHtml(view.branch ?? 'HEAD')}${view.onto ? ` onto <code>${view.onto}</code>` : ''}</div>
          <div class="rb-summary">${this.rows.length} commits · ${counts}</div>
        </div>
        <div class="rb-buttons">
          <button class="rb-abort" data-action="abort">Abort</button>
          <button class="rb-start" data-action="start" ${problem ? 'disabled' : ''}>Start rebase</button>
        </div>
      </header>
      ${problem ? `<div class="rb-problem glass">${Format.escapeHtml(problem)}</div>` : ''}
      <p class="rb-hint">Top to bottom is the order git applies them. Drag a row to move it; keys: ${ACTIONS.map((item) => `<kbd>${item.key}</kbd> ${item.action}`).join(', ')}, <kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> move.</p>
      <ol class="rb-list">${this.rows.map((row, index) => this.renderRow(row, index)).join('')}</ol>`;
  }

  private renderRow(row: RebaseRow, index: number): string {
    const actions = ACTIONS.map(
      (item) =>
        `<button class="rb-action action-${item.action}${item.action === row.action ? ' active' : ''}" data-set="${item.action}" data-index="${index}" title="${item.hint} (${item.key})">${item.action}</button>`,
    ).join('');
    const avatar = row.email
      ? `<span class="rb-avatar" style="background:${AvatarStyle.getColor(row.email)}">${AvatarStyle.renderArt(row.email)}</span>`
      : '<span class="rb-avatar"></span>';
    const meta = [row.author, row.date ? this.dates.formatAgoOrDate(row.date) : ''].filter(Boolean).join(' · ');

    return `
      <li class="rb-row glass row-${row.action}${index === this.selected ? ' selected' : ''}" draggable="true" data-row="${index}">
        <span class="rb-grip" title="Drag to move">⋮⋮</span>
        <span class="rb-actions">${actions}</span>
        ${avatar}
        <span class="rb-text">
          <span class="rb-subject">${Format.escapeHtml(row.subject)}</span>
          <span class="rb-meta">${Format.escapeHtml(meta)}</span>
        </span>
        <code class="rb-sha">${row.hash.slice(0, 7)}</code>
      </li>`;
  }

  private setAction(index: number, action: RebaseAction): void {
    this.rows[index].action = action;
    this.commit();
  }

  private move(from: number, to: number): void {
    if (to < 0 || to >= this.rows.length || from === to) {
      return;
    }
    const [row] = this.rows.splice(from, 1);
    this.rows.splice(to, 0, row);
    this.selected = to;
    this.commit();
  }

  private commit(): void {
    this.render();
    this.api.postMessage({ type: 'update', rows: this.rows.map(({ action, hash, subject }) => ({ action, hash, subject })) });
  }

  private onClick(target: HTMLElement): void {
    const button = target.closest<HTMLElement>('[data-set],[data-action]');
    if (button?.dataset.set) {
      this.selected = Number(button.dataset.index);
      this.setAction(this.selected, button.dataset.set as RebaseAction);
      return;
    }
    if (button?.dataset.action === 'start') {
      this.api.postMessage({ type: 'start' });
      return;
    }
    if (button?.dataset.action === 'abort') {
      this.api.postMessage({ type: 'abort' });
      return;
    }
    const row = target.closest<HTMLElement>('[data-row]');
    if (row) {
      this.selected = Number(row.dataset.row);
      this.render();
    }
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.rows.length === 0) {
      return;
    }
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      this.move(this.selected, this.selected + (event.key === 'ArrowUp' ? -1 : 1));
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      this.selected = Math.min(this.rows.length - 1, Math.max(0, this.selected + (event.key === 'ArrowUp' ? -1 : 1)));
      this.render();
      return;
    }
    const item = ACTIONS.find((candidate) => candidate.key === event.key.toLowerCase());
    if (item && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      this.setAction(this.selected, item.action);
    }
  }

  private onDragStart(event: DragEvent): void {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-row]');
    if (row && event.dataTransfer) {
      this.dragFrom = Number(row.dataset.row);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', row.dataset.row!);
      row.classList.add('dragging');
    }
  }

  private onDragOver(event: DragEvent): void {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-row]');
    if (this.dragFrom === null || !row) {
      return;
    }
    event.preventDefault();
    this.root.querySelectorAll('.drop-before').forEach((element) => element.classList.remove('drop-before'));
    row.classList.add('drop-before');
  }

  private onDrop(event: DragEvent): void {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-row]');
    const from = this.dragFrom;
    this.clearDrag();
    if (row && from !== null) {
      event.preventDefault();
      this.move(from, Number(row.dataset.row));
    }
  }

  private clearDrag(): void {
    this.dragFrom = null;
    this.root.querySelectorAll('.drop-before, .dragging').forEach((element) => element.classList.remove('drop-before', 'dragging'));
  }
}

new RebaseApp(document.getElementById('app')!);
