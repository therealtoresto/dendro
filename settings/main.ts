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

class SettingsApp {
  private readonly api = acquireVsCodeApi();
  private values: SettingValues = {};
  private locale = 'en-US';
  private sectionId: string;
  private textTimer: number | undefined;
  private readonly nav: HTMLElement;
  private readonly content: HTMLElement;

  constructor(root: HTMLElement) {
    root.innerHTML = '<nav class="nav glass"></nav><main class="content"></main>';
    this.nav = root.querySelector('.nav')!;
    this.content = root.querySelector('.content')!;
    this.sectionId = (this.api.getState() as { section?: string } | undefined)?.section ?? 'graph';

    this.nav.addEventListener('click', (event) => {
      const link = (event.target as HTMLElement).closest<HTMLElement>('[data-section]');
      if (link) {
        this.showSection(link.dataset.section!);
      }
    });
    this.content.addEventListener('change', (event) => this.onChange(event.target as HTMLElement));
    this.content.addEventListener('click', (event) => this.onClick(event.target as HTMLElement));
    this.content.addEventListener('input', (event) => this.onInput(event.target as HTMLElement));
    window.addEventListener('message', (event: MessageEvent<SettingsHostMessage>) => this.onHostMessage(event.data));

    this.api.postMessage({ type: 'ready' });
  }

  private onHostMessage(message: SettingsHostMessage): void {
    if (message.type === 'focusSection') {
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

  private showSection(id: string): void {
    if (!SETTINGS_SECTIONS.some((section) => section.id === id)) {
      return;
    }
    this.sectionId = id;
    this.api.setState({ section: id });
    this.render();
    this.content.scrollTop = 0;
  }

  private render(): void {
    this.renderNav();
    const section = SETTINGS_SECTIONS.find((candidate) => candidate.id === this.sectionId) ?? SETTINGS_SECTIONS[0];
    this.content.innerHTML = this.renderSection(section);
  }

  private renderNav(): void {
    const groups = Array.from(new Set(SETTINGS_SECTIONS.map((section) => section.group)));
    this.nav.innerHTML =
      `<div class="nav-title">${SettingsApp.renderIcon('fileBlame')} Dendro Settings</div>` +
      groups
        .map((group) => {
          const links = SETTINGS_SECTIONS.filter((section) => section.group === group)
            .map((section) => {
              const booleans = section.items.filter((item) => item.type === 'boolean');
              const enabled = booleans.filter((item) => this.values[item.key] === true).length;
              const isOn = section.enabledKey ? this.values[section.enabledKey] === true : true;
              const count = booleans.length > 0 ? `<span class="nav-count">${enabled}/${booleans.length}</span>` : '';
              return `<a class="nav-link${section.id === this.sectionId ? ' active' : ''}${isOn ? '' : ' off'}" data-section="${section.id}">
                ${SettingsApp.renderIcon(section.id)}
                <span class="nav-label">${section.title}</span>${count}</a>`;
            })
            .join('');
          return `<div class="nav-group">${group}</div>${links}`;
        })
        .join('');
  }

  private renderSection(section: SettingSection): string {
    const preview = Previews.render(section.id, this.values, this.locale);
    const settingsQuery = section.items[0]?.key.split('.')[0] ?? '';

    return `
      <header class="section-header">
        <div class="section-icon">${SettingsApp.renderIcon(section.id, 20)}</div>
        <div>
          <h1>${section.title}</h1>
          <p>${section.description}</p>
        </div>
      </header>
      ${preview ? `<div class="preview glass"><div class="preview-title">Live preview</div>${preview}</div>` : ''}
      <div class="items glass">${section.items.map((item) => this.renderItem(item)).join('')}</div>
      <footer class="section-footer">
        For every option in JSON, open the
        <a data-native-settings="dendro.${settingsQuery}">Settings UI</a>
        and search for <code>dendro.${settingsQuery}</code>.
      </footer>`;
  }

  private renderItem(item: SettingItem): string {
    const disabled = item.dependsOn ? this.values[item.dependsOn] !== true : false;
    const classes = ['item', `item-${item.control}`, item.dependsOn ? 'nested' : '', disabled ? 'disabled' : ''].join(' ');
    const note = item.note ? `<div class="note">ⓘ ${Previews.escape(item.note)}</div>` : '';
    const example = item.example
      ? `<div class="example">Example: <i>${Previews.escape(Previews.renderExample(item.example, this.values, this.locale))}</i></div>`
      : '';
    return `<div class="${classes}">${this.renderControl(item, disabled)}${example}${note}</div>`;
  }

  private renderControl(item: SettingItem, disabled: boolean): string {
    const value = this.values[item.key];
    const key = `data-key="${item.key}"`;
    const off = disabled ? 'disabled' : '';
    const label = Previews.escape(item.label);

    switch (item.control) {
      case 'checkbox':
        return `<label class="check"><input type="checkbox" ${key} ${value === true ? 'checked' : ''} ${off}><span>${label}</span></label>`;
      case 'number':
        return `<label class="row-field"><span>${label}</span><input type="number" ${key} value="${value}" min="${item.min ?? ''}" max="${item.max ?? ''}" ${off}></label>`;
      case 'text':
        return `<label class="block-field"><span class="field-label">${label}</span><input type="text" ${key} value="${Previews.escape(String(value ?? ''))}" placeholder="${Previews.escape(item.placeholder ?? '')}" spellcheck="false" ${off}></label>`;
      case 'color':
        return `<label class="row-field"><span>${label}</span><input type="color" ${key} value="${value}" ${off}><code>${value}</code></label>`;
      case 'select':
        return `<label class="block-field"><span class="field-label">${label}</span><select ${key} ${off}>${item
          .options!.map(
            (option) =>
              `<option value="${option.value}" ${String(option.value) === String(value) ? 'selected' : ''}>${Previews.escape(option.label)}</option>`,
          )
          .join('')}</select></label>`;
      case 'segmented':
        return `<div class="row-field"><span>${label}</span><div class="segmented">${item
          .options!.map(
            (option) =>
              `<button ${key} data-value="${option.value}" class="${option.value === value ? 'active' : ''}" ${off}>${Previews.escape(option.label)}</button>`,
          )
          .join('')}</div></div>`;
      case 'cards': {
        const selected = new Set(Array.isArray(value) ? value : []);
        return `<div class="field-label">${label}</div><div class="cards">${item
          .options!.map(
            (option) =>
              `<label class="card${selected.has(String(option.value)) ? ' checked' : ''}"><span class="card-title"><input type="checkbox" ${key} data-flag="${option.value}" ${selected.has(String(option.value)) ? 'checked' : ''} ${off}>${Previews.escape(option.label)}</span>${option.description ? `<span class="card-description">${Previews.escape(option.description)}</span>` : ''}</label>`,
          )
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
    const segment = target.closest<HTMLButtonElement>('.segmented button');
    if (segment?.dataset.key) {
      const item = SETTINGS_SECTIONS.flatMap((section) => section.items).find((candidate) => candidate.key === segment.dataset.key);
      if (item) {
        this.update(item, segment.dataset.value!);
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
    return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${SECTION_ICONS[sectionId] ?? ''}</svg>`;
  }
}

new SettingsApp(document.getElementById('app')!);
