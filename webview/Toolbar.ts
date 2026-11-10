import type { GraphState, RemoteAction } from '../src/protocol';
import type { DateFormatter } from '../src/shared/DateFormatter';
import { HostBridge } from './HostBridge';
import { Icons } from './Icons';
import { RemoteButtons } from './RemoteButtons';

interface ToolbarHandlers {
  onSearchInput(query: string): void;
  onSearchStep(direction: 1 | -1): void;
  onSearchClear(): void;
}

export class Toolbar {
  private readonly repoButton: HTMLButtonElement;
  private readonly branchButton: HTMLButtonElement;
  private readonly remoteButtons: RemoteButtons;
  private readonly branchesSelect: HTMLSelectElement;
  private readonly searchInput: HTMLInputElement;
  private readonly searchStatus: HTMLElement;

  constructor(
    element: HTMLElement,
    private readonly handlers: ToolbarHandlers,
  ) {
    element.innerHTML = `
      <button class="tool tool-repo" title="Choose repository">${Icons.render('repo')}<span class="tool-label"></span></button>
      <button class="tool tool-branch" title="Checkout another branch">${Icons.render('branch')}<span class="tool-label"></span></button>
      <span class="tool-separator"></span>
      <span class="remote-buttons"></span>
      <button class="tool tool-refresh" title="Refresh">${Icons.render('refresh')}</button>
      <span class="tool-separator"></span>
      <select class="tool tool-select branches-select" title="Which branches the graph shows">
        <option value="all">All branches</option>
        <option value="smart">Smart branches</option>
        <option value="current">Current branch</option>
      </select>
      <div class="search">
        ${Icons.render('search')}
        <input class="search-input" type="text" placeholder="Search message, author or SHA  (Enter = next)" spellcheck="false">
        <span class="search-status"></span>
        <button class="icon-button search-prev" title="Previous match (Shift+Enter)">${Icons.render('up')}</button>
        <button class="icon-button search-next" title="Next match (Enter)">${Icons.render('down')}</button>
        <button class="icon-button search-clear" title="Clear (Esc)">${Icons.render('close')}</button>
      </div>
      <button class="tool tool-settings" title="Dendro settings">${Icons.render('gear')}</button>`;

    this.repoButton = element.querySelector('.tool-repo')!;
    this.branchButton = element.querySelector('.tool-branch')!;
    this.remoteButtons = new RemoteButtons(element.querySelector('.remote-buttons')!);
    this.branchesSelect = element.querySelector('.branches-select')!;
    this.searchInput = element.querySelector('.search-input')!;
    this.searchStatus = element.querySelector('.search-status')!;

    this.repoButton.addEventListener('click', () => HostBridge.post({ type: 'pickRepo' }));
    this.branchButton.addEventListener('click', () => HostBridge.post({ type: 'pickBranch' }));
    element.querySelector('.tool-refresh')!.addEventListener('click', () => HostBridge.post({ type: 'refresh' }));
    this.branchesSelect.addEventListener('change', () =>
      HostBridge.post({ type: 'updateSetting', key: 'graph.showBranches', value: this.branchesSelect.value }),
    );
    element.querySelector('.tool-settings')!.addEventListener('click', () => HostBridge.post({ type: 'openSettings' }));

    this.searchInput.addEventListener('input', () => handlers.onSearchInput(this.searchInput.value));
    this.searchInput.addEventListener('keydown', (event) => this.onSearchKey(event));
    element.querySelector('.search-prev')!.addEventListener('click', () => handlers.onSearchStep(-1));
    element.querySelector('.search-next')!.addEventListener('click', () => handlers.onSearchStep(1));
    element.querySelector('.search-clear')!.addEventListener('click', () => this.clearSearch());
  }

  render(state: GraphState, dates: DateFormatter): void {
    const { head } = state;
    const hasRepo = state.root !== null;
    const repoName = state.repos.find((repo) => repo.root === state.root)?.name ?? 'No repository';

    this.repoButton.hidden = state.repos.length < 2;
    this.repoButton.querySelector('.tool-label')!.textContent = repoName;

    this.branchButton.disabled = !hasRepo;
    this.branchButton.querySelector('.tool-label')!.textContent =
      head.branch ?? (head.hash ? `detached at ${head.hash.slice(0, 7)}` : 'no commits');

    this.remoteButtons.render(state, dates);
    this.branchesSelect.value = String(state.settings['graph.showBranches']);
  }

  setBusy(action: RemoteAction | null, automatic: boolean): void {
    this.remoteButtons.setBusy(action, automatic);
  }

  showRemoteResult(action: RemoteAction, ok: boolean, message?: string): void {
    this.remoteButtons.showResult(action, ok, message);
  }

  setSearchStatus(text: string): void {
    this.searchStatus.textContent = text;
  }

  focusSearch(): void {
    this.searchInput.focus();
    this.searchInput.select();
  }

  private onSearchKey(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.handlers.onSearchStep(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.clearSearch();
    }
  }

  private clearSearch(): void {
    this.searchInput.value = '';
    this.handlers.onSearchClear();
  }
}
