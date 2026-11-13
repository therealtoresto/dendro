import type { SettingsHostMessage, SettingsWebviewMessage } from '../src/settingsProtocol';
import { SettingItem, SettingSection, SettingValues, SETTINGS_SECTIONS } from '../src/shared/SettingsCatalog';
import { Previews } from './Previews';

interface VsCodeApi {
  postMessage(message: SettingsWebviewMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const SECTION_ICONS: Record<string, string> = {
  graph: '<circle cx="4" cy="3.5" r="1.5"/><circle cx="4" cy="12.5" r="1.5"/><circle cx="12" cy="6" r="1.5"/><path d="M4 5v6M12 7.5c0 2.5-8 1.5-8 3.5"/>',
  inlineBlame: '<path d="M2 4h7M2 8h5M2 12h7"/><path d="M11 8h3" stroke-dasharray="1 1.5"/>',
  statusBar: '<rect x="1.5" y="10" width="13" height="3.5" rx="1"/><path d="M4 11.75h3"/>',
  codeLens: '<path d="M2 3.5h12M2 6.5h7" stroke-dasharray="1.5 1.2"/><path d="M2 10h12M2 13h9"/>',
  hovers: '<path d="M2.5 3h11v7h-6l-3 3v-3h-2z"/>',
  fileBlame: '<circle cx="8" cy="8" r="2"/><path d="M8 1.5V6M8 10v4.5"/>',
  fileChanges: '<path d="M4.5 2v12M11.5 2v12M2 5h5M9 11h5"/>',
  fileHeatmap: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1.5"/>',
  avatars: '<circle cx="8" cy="6" r="2.8"/><path d="M2.5 14c.8-3 3-4.3 5.5-4.3s4.7 1.3 5.5 4.3"/>',
  dates: '<rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 6.5h12M5 1.5v3M11 1.5v3"/>',
};

// The board groups the sections by where they show up; the catalog's own groups name the package.json blocks.
const BOARD_GROUPS: { title: string; sections: string[] }[] = [
  { title: 'Graph', sections: ['graph'] },
  { title: 'On the current line', sections: ['inlineBlame', 'statusBar', 'codeLens', 'hovers'] },
  { title: 'Across a whole file', sections: ['fileBlame', 'fileChanges', 'fileHeatmap'] },
  { title: 'Everywhere', sections: ['avatars', 'dates'] },
];

const DENDRO_MARK =
  '<path d="M1.5 8H5.1"/><path d="M8.7 4.4H6.4Q5.1 4.4 5.1 5.7V10.3Q5.1 11.6 6.4 11.6H8.7"/><path d="M13.5 2.6H10Q8.7 2.6 8.7 3.9V4.9Q8.7 6.2 10 6.2H13.5"/><path d="M13.5 9.8H10Q8.7 9.8 8.7 11.1V12.1Q8.7 13.4 10 13.4H13.5"/>' +
  '<g fill="currentColor" stroke="none"><circle cx="13.5" cy="2.6" r="1.25"/><circle cx="13.5" cy="6.2" r="1.25"/><circle cx="13.5" cy="9.8" r="1.25"/><circle cx="13.5" cy="13.4" r="1.25"/></g>';

const SEARCH_ICON = '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/>';

class SettingsApp {
  private readonly api = acquireVsCodeApi();
  private values: SettingValues = {};
  private locale = 'en-US';
  private sectionId: string;
  private query = '';
  private shownView = '';
  private textTimer: number | undefined;
  private readonly search: HTMLInputElement;
  private readonly content: HTMLElement;

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <header class="st-top glass">
        <div class="st-brand">${SettingsApp.renderSvg(DENDRO_MARK, 18)}<b>Dendro</b><span>settings</span></div>
        <label class="st-search">${SettingsApp.renderSvg(SEARCH_ICON, 14)}<input type="search" placeholder="Find a setting" spellcheck="false"></label>
        <a class="st-all" data-native-settings="dendro">Settings UI</a>
      </header>
      <main class="st-content"></main>`;
    this.search = root.querySelector('.st-search input')!;
    this.content = root.querySelector('.st-content')!;
    this.sectionId = (this.api.getState() as { section?: string } | undefined)?.section ?? 'graph';

    this.search.addEventListener('input', () => {
      this.query = this.search.value.trim().toLowerCase();
      this.render();
    });
    this.search.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this.clearSearch();
      }
    });
    root.querySelector('.st-all')!.addEventListener('click', () => this.api.postMessage({ type: 'openNativeSettings', query: 'dendro' }));
    this.content.addEventListener('change', (event) => this.onChange(event.target as HTMLElement));
    this.content.addEventListener('click', (event) => this.onClick(event.target as HTMLElement));
    this.content.addEventListener('input', (event) => this.onInput(event.target as HTMLElement));
    window.addEventListener('message', (event: MessageEvent<SettingsHostMessage>) => this.onHostMessage(event.data));

    this.api.postMessage({ type: 'ready' });
  }

  private onHostMessage(message: SettingsHostMessage): void {
    if (message.type === 'focusSection') {
      this.clearSearch();
      this.showSection(message.id);
      return;
    }

    const focused = document.activeElement as HTMLInputElement | null;
    const focusedKey = focused?.dataset?.key;
    const caret = focused?.selectionStart ?? null;

    this.values = message.values;
    this.locale = message.locale;
    this.render();

    // Re-rendering after every saved keystroke must not throw the cursor out of the field being typed in.
    if (focusedKey) {
      const field = this.content.querySelector<HTMLInputElement>(`[data-key="${focusedKey}"]:not([type=checkbox])`);
      if (field) {
        field.focus();
        if (caret !== null && field.type === 'text') {
          field.setSelectionRange(caret, caret);
        }
      }
    }
  }

  private clearSearch(): void {
    if (this.query === '' && this.search.value === '') {
      return;
    }
    this.search.value = '';
    this.query = '';
    this.render();
  }

  private showSection(id: string): void {
    if (!SETTINGS_SECTIONS.some((section) => section.id === id)) {
      return;
    }
    this.sectionId = id;
    this.api.setState({ section: id });
    this.render();
  }

  // The board stays put and only the part below it scrolls, so every tile is in sight at any scroll position.
  // A re-render after a changed value keeps the scroll position; opening another section starts at the top.
  private render(): void {
    const view = this.query ? `search:${this.query}` : this.sectionId;
    const scrollTop = view === this.shownView ? (this.content.querySelector('.st-scroll')?.scrollTop ?? 0) : 0;
    this.shownView = view;

    if (this.query) {
      this.content.innerHTML = `<div class="st-scroll">${this.renderResults()}</div>`;
    } else {
      const section = SETTINGS_SECTIONS.find((candidate) => candidate.id === this.sectionId) ?? SETTINGS_SECTIONS[0];
      this.content.innerHTML = `${this.renderBoard()}<div class="st-scroll">${this.renderSection(section)}</div>`;
    }
    this.content.querySelector('.st-scroll')!.scrollTop = scrollTop;
  }

  private renderBoard(): string {
    const groups = BOARD_GROUPS.map((group) => {
      const tiles = group.sections
        .map((id) => SETTINGS_SECTIONS.find((section) => section.id === id))
        .filter((section): section is SettingSection => section !== undefined)
        .map((section) => this.renderTile(section))
        .join('');
      return `<div class="st-group"><div class="st-group-title">${group.title}</div><div class="st-tiles">${tiles}</div></div>`;
    });
    return `<nav class="st-board">${groups.join('')}</nav>`;
  }

  private renderTile(section: SettingSection): string {
    const isOn = section.enabledKey ? this.values[section.enabledKey] === true : true;
    const classes = ['st-tile', section.id === this.sectionId ? 'active' : '', isOn ? '' : 'off'].join(' ');
    const toggle = section.enabledKey ? this.renderSwitch(section.enabledKey, isOn, false, `Turn ${section.title} on or off`) : '';
    return `<div class="${classes}" data-section="${section.id}" role="button" tabindex="0">
      <span class="st-tile-icon">${SettingsApp.renderIcon(section.id)}</span>
      <span class="st-tile-text"><span class="st-tile-title">${section.title}</span><span class="st-tile-state">${this.describeState(section)}</span></span>
      ${toggle}
    </div>`;
  }

  // One line under a tile title: off, or how many of its switches are on.
  private describeState(section: SettingSection): string {
    if (section.enabledKey && this.values[section.enabledKey] !== true) {
      return 'Off';
    }
    const switches = section.items.filter((item) => item.type === 'boolean' && item.key !== section.enabledKey);
    if (switches.length === 0) {
      return `${section.items.length} ${section.items.length === 1 ? 'option' : 'options'}`;
    }
    const on = switches.filter((item) => this.values[item.key] === true).length;
    return `${on} of ${switches.length} on`;
  }

  private renderSection(section: SettingSection): string {
    const preview = Previews.render(section.id, this.values, this.locale);
    const prefix = section.items[0]?.key.split('.')[0] ?? '';
    const isOn = section.enabledKey ? this.values[section.enabledKey] === true : true;
    const toggle = section.enabledKey ? this.renderSwitch(section.enabledKey, isOn, false, `Turn ${section.title} on or off`, 'large') : '';
    const items = section.items.filter((item) => item.key !== section.enabledKey);

    return `
      <section class="st-detail${isOn ? '' : ' off'}">
        <header class="st-detail-head">
          <div class="st-detail-text"><h1>${section.title}</h1><p>${section.description}</p></div>
          ${toggle}
        </header>
        ${preview ? `<div class="st-stage">${preview}</div>` : ''}
        <div class="st-rows">${items.map((item) => this.renderItem(item, section)).join('')}</div>
        <footer class="st-foot">
          <span>Stored as <code>dendro.${prefix}.*</code> in settings.json</span>
          <a data-native-settings="dendro.${prefix}">Open in the Settings UI</a>
        </footer>
      </section>`;
  }

  private renderResults(): string {
    const blocks = SETTINGS_SECTIONS.map((section) => {
      const items = section.items.filter((item) => this.matches(item));
      if (items.length === 0) {
        return '';
      }
      return `<section class="st-result">
        <a class="st-result-title" data-open-section="${section.id}">${SettingsApp.renderIcon(section.id)}${section.title}</a>
        <div class="st-rows">${items.map((item) => this.renderItem(item, section)).join('')}</div>
      </section>`;
    }).join('');
    return blocks || `<div class="st-none">No setting matches "${Previews.escape(this.query)}".</div>`;
  }

  private matches(item: SettingItem): boolean {
    const words = [item.key, item.label, item.note ?? '', item.description ?? '', ...(item.options ?? []).map((option) => option.label)];
    return words.join(' ').toLowerCase().includes(this.query);
  }

  private renderItem(item: SettingItem, section: SettingSection): string {
    const parentOff = item.dependsOn ? this.values[item.dependsOn] !== true : false;
    const sectionOff = section.enabledKey && item.key !== section.enabledKey ? this.values[section.enabledKey] !== true : false;
    const disabled = parentOff || sectionOff;
    const wide = item.control === 'text' || item.control === 'cards' || item.control === 'order';
    const nested = item.dependsOn && item.dependsOn !== section.enabledKey;
    const classes = ['st-row', `st-row-${item.control}`, wide ? 'wide' : '', nested ? 'nested' : '', disabled ? 'disabled' : ''].join(' ');
    const note = item.note ? `<div class="st-note">${Previews.escape(item.note)}</div>` : '';
    const example = item.example
      ? `<div class="st-example">${Previews.escape(Previews.renderExample(item.example, this.values, this.locale))}</div>`
      : '';
    return `<div class="${classes}">
      <div class="st-row-text"><div class="st-label">${Previews.escape(item.label)}</div>${wide ? '' : note}</div>
      <div class="st-control">${this.renderControl(item, disabled)}</div>
      ${wide ? example + note : example}
    </div>`;
  }

  private renderSwitch(key: string, checked: boolean, disabled: boolean, title: string, size = ''): string {
    return `<label class="st-switch ${size}" title="${Previews.escape(title)}"><input type="checkbox" role="switch" data-key="${key}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}><i></i></label>`;
  }

  private renderControl(item: SettingItem, disabled: boolean): string {
    const value = this.values[item.key];
    const key = `data-key="${item.key}"`;
    const off = disabled ? 'disabled' : '';

    switch (item.control) {
      case 'checkbox':
        return this.renderSwitch(item.key, value === true, disabled, item.label);
      case 'number':
        return `<input type="number" ${key} value="${value}" min="${item.min ?? ''}" max="${item.max ?? ''}" ${off}>`;
      case 'text':
        return `<input type="text" ${key} value="${Previews.escape(String(value ?? ''))}" placeholder="${Previews.escape(item.placeholder ?? '')}" spellcheck="false" ${off}>`;
      case 'color':
        return `<label class="st-color"><input type="color" ${key} value="${value}" ${off}><code>${value}</code></label>`;
      case 'select':
        return `<select ${key} ${off}>${item
          .options!.map(
            (option) =>
              `<option value="${option.value}" ${String(option.value) === String(value) ? 'selected' : ''}>${Previews.escape(option.label)}</option>`,
          )
          .join('')}</select>`;
      case 'segmented':
        return `<div class="st-segmented">${item
          .options!.map(
            (option) =>
              `<button ${key} data-value="${option.value}" class="${option.value === value ? 'active' : ''}" ${off}>${Previews.escape(option.label)}</button>`,
          )
          .join('')}</div>`;
      case 'order': {
        const order = Array.isArray(value) ? value.map(String) : [];
        const chips = order
          .map((id) => item.options!.find((option) => option.value === id))
          .filter((option) => option !== undefined)
          .map((option) => `<span class="order-chip">${Previews.escape(option!.label)}</span>`)
          .join('<span class="order-arrow">›</span>');
        return `<div class="order-chips">${chips}<button class="order-reset" ${key} data-reset ${off}>Reset</button></div>`;
      }
      case 'cards': {
        const selected = new Set(Array.isArray(value) ? value : []);
        return `<div class="st-flags">${item
          .options!.map((option) => {
            const isOn = selected.has(String(option.value));
            const description = option.description ? `<span class="st-flag-note">${Previews.escape(option.description)}</span>` : '';
            return `<label class="st-flag${isOn ? ' on' : ''}"><input type="checkbox" ${key} data-flag="${option.value}" ${isOn ? 'checked' : ''} ${off}><span class="st-flag-mark"></span><span class="st-flag-text"><span>${Previews.escape(option.label)}</span>${description}</span></label>`;
          })
          .join('')}</div>`;
      }
    }
  }

  private onChange(target: HTMLElement): void {
    const input = target as HTMLInputElement | HTMLSelectElement;
    const key = input.dataset.key;
    const item = key ? SETTINGS_SECTIONS.flatMap((section) => section.items).find((candidate) => candidate.key === key) : undefined;
    if (!item) {
      return;
    }

    if (item.control === 'cards') {
      const flags = Array.from(this.content.querySelectorAll<HTMLInputElement>(`input[data-key="${key}"]`))
        .filter((box) => box.checked)
        .map((box) => box.dataset.flag!);
      this.update(item, flags);
      return;
    }
    if (item.control === 'checkbox') {
      this.update(item, (input as HTMLInputElement).checked);
      return;
    }
    if (item.type === 'number') {
      const number = Number(input.value);
      if (input.value !== '' && Number.isFinite(number)) {
        this.update(item, number);
      }
      return;
    }
    if (item.control !== 'text') {
      this.update(item, input.value);
    }
  }

  // Text settings save as you type, so the example under the field follows each keystroke.
  private onInput(target: HTMLElement): void {
    const input = target as HTMLInputElement;
    if (input.type !== 'text' || !input.dataset.key) {
      return;
    }
    const item = SETTINGS_SECTIONS.flatMap((section) => section.items).find((candidate) => candidate.key === input.dataset.key);
    if (!item) {
      return;
    }
    window.clearTimeout(this.textTimer);
    this.textTimer = window.setTimeout(() => this.update(item, input.value), 400);
  }

  private onClick(target: HTMLElement): void {
    const opener = target.closest<HTMLElement>('[data-open-section]');
    if (opener) {
      this.clearSearch();
      this.showSection(opener.dataset.openSection!);
      return;
    }

    // The switch on a tile changes the setting; the rest of the tile opens the section.
    const tile = target.closest<HTMLElement>('.st-tile');
    if (tile && !target.closest('.st-switch')) {
      this.showSection(tile.dataset.section!);
      return;
    }

    const segment = target.closest<HTMLButtonElement>('.st-segmented button');
    if (segment?.dataset.key) {
      const item = SETTINGS_SECTIONS.flatMap((section) => section.items).find((candidate) => candidate.key === segment.dataset.key);
      if (item) {
        this.update(item, segment.dataset.value!);
      }
      return;
    }

    const reset = target.closest<HTMLButtonElement>('[data-reset]');
    if (reset?.dataset.key) {
      const item = SETTINGS_SECTIONS.flatMap((section) => section.items).find((candidate) => candidate.key === reset.dataset.key);
      if (item) {
        this.update(item, item.default);
        this.render();
      }
      return;
    }

    const link = target.closest<HTMLElement>('[data-native-settings]');
    if (link) {
      this.api.postMessage({ type: 'openNativeSettings', query: link.dataset.nativeSettings! });
    }
  }

  private update(item: SettingItem, value: boolean | number | string | string[]): void {
    this.values = { ...this.values, [item.key]: value };
    this.api.postMessage({ type: 'update', key: item.key, value });
  }

  private static renderIcon(sectionId: string, size = 16): string {
    return SettingsApp.renderSvg(SECTION_ICONS[sectionId] ?? '', size);
  }

  private static renderSvg(body: string, size: number): string {
    return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  }
}

new SettingsApp(document.getElementById('app')!);
