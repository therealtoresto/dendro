const PATHS = {
  branch:
    '<circle cx="5" cy="3.5" r="1.5"/><circle cx="5" cy="12.5" r="1.5"/><circle cx="11" cy="5" r="1.5"/>' +
    '<path d="M5 5v6M11 6.5c0 3-6 2-6 4.5"/>',
  cloud: '<path d="M4.5 12.5h7a3 3 0 0 0 .3-6 4 4 0 0 0-7.6 1A2.5 2.5 0 0 0 4.5 12.5z"/>',
  tag: '<path d="M2.5 2.5h5l6 6-5 5-6-6z"/><circle cx="5.5" cy="5.5" r="1"/>',
  check: '<path d="M3 8.5l3 3 7-7"/>',
  pull: '<path d="M8 2.5v10M3.5 8l4.5 4.5L12.5 8"/>',
  push: '<path d="M8 13.5v-10M3.5 8L8 3.5 12.5 8"/>',
  fetch:
    '<path d="M4.5 11.5A2.5 2.5 0 0 1 4.2 6.5a4 4 0 0 1 7.6-1 3 3 0 0 1 .7 5.9"/><path d="M8 7.5v6M6 11.5l2 2 2-2"/>',
  refresh: '<path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>',
  up: '<path d="M4 10l4-4 4 4"/>',
  down: '<path d="M4 6l4 4 4-4"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1"/><path d="M10.5 5.5v-3h-8v8h3"/>',
  file: '<path d="M9 2.5H4a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6.5z"/><path d="M9 2.5v4h4"/>',
  history: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1.5"/>',
  repo: '<path d="M3.5 13v-9.5a1 1 0 0 1 1-1h8v9h-8a1 1 0 0 0 0 2h8"/>',
  gear:
    '<circle cx="8" cy="8" r="2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>',
  compare: '<circle cx="4.5" cy="4" r="1.5"/><circle cx="11.5" cy="12" r="1.5"/><path d="M4.5 5.5v7h5M11.5 10.5v-7h-5"/>',
  folder: '<path d="M1.5 4.5a1 1 0 0 1 1-1H6l1.5 1.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"/>',
  folderOpen: '<path d="M1.5 12V4.5a1 1 0 0 1 1-1H6l1.5 1.5h5a1 1 0 0 1 1 1v1.5"/><path d="M1.5 12l2-5h11l-2 5z"/>',
  list: '<path d="M5.5 4h8.5M5.5 8h8.5M5.5 12h8.5M2.5 4h.01M2.5 8h.01M2.5 12h.01"/>',
  tree: '<path d="M3 3h5M3 3v9h4M3 7.5h4M10 7.5h4M10 12h4"/>',
  chevron: '<path d="M6 4l4 4-4 4"/>',
  rings:
    '<circle cx="8" cy="8" r="6.5"/><circle cx="8.2" cy="8" r="4.2"/><circle cx="8.3" cy="8" r="2"/>',
} as const;

export type IconName = keyof typeof PATHS;

export class Icons {
  static render(name: IconName, size = 14): string {
    return (
      `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" ` +
      `stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`
    );
  }
}
