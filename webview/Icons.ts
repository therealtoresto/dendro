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
    '<path d="M6.76 2.85 L7.12 1.06 L8.88 1.06 L9.24 2.85 L10.77 3.48 L12.29 2.47 L13.53 3.71 L12.52 5.23 L13.15 6.76 L14.94 7.12 L14.94 8.88 L13.15 9.24 L12.52 10.77 L13.53 12.29 L12.29 13.53 L10.77 12.52 L9.24 13.15 L8.88 14.94 L7.12 14.94 L6.76 13.15 L5.23 12.52 L3.71 13.53 L2.47 12.29 L3.48 10.77 L2.85 9.24 L1.06 8.88 L1.06 7.12 L2.85 6.76 L3.48 5.23 L2.47 3.71 L3.71 2.47 L5.23 3.48z"/><circle cx="8" cy="8" r="2.2"/>',
  compare: '<circle cx="4.5" cy="4" r="1.5"/><circle cx="11.5" cy="12" r="1.5"/><path d="M4.5 5.5v7h5M11.5 10.5v-7h-5"/>',
  folder: '<path d="M1.5 4.5a1 1 0 0 1 1-1H6l1.5 1.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"/>',
  folderOpen: '<path d="M1.5 12V4.5a1 1 0 0 1 1-1H6l1.5 1.5h5a1 1 0 0 1 1 1v1.5"/><path d="M1.5 12l2-5h11l-2 5z"/>',
  list: '<path d="M5.5 4h8.5M5.5 8h8.5M5.5 12h8.5M2.5 4h.01M2.5 8h.01M2.5 12h.01"/>',
  tree: '<path d="M3 3h5M3 3v9h4M3 7.5h4M10 7.5h4M10 12h4"/>',
  chevron: '<path d="M6 4l4 4-4 4"/>',
  cherry: '<circle cx="5" cy="11.5" r="2.5"/><circle cx="11.5" cy="12" r="2.5"/><path d="M5 9c0-4 3-6.5 6-7M11.5 9.5C11 6 10 3.5 11 2"/>',
  undo: '<path d="M4 7h6.5a3 3 0 0 1 0 6H8"/><path d="M6.5 4.5L4 7l2.5 2.5"/>',
  box: '<rect x="2.5" y="4.5" width="11" height="9" rx="1.5"/><path d="M2.5 7.5h11M6.5 10h3"/>',
  rings:
    '<circle cx="8" cy="8" r="6.5"/><circle cx="8.2" cy="8" r="4.2"/><circle cx="8.3" cy="8" r="2"/>',
  pulse: '<path d="M1.5 8.5h3l1.5-4 3 8 1.5-4h4"/>',
  laptop: '<rect x="3" y="3" width="10" height="7.5" rx="1"/><path d="M1.5 12.5h13"/>',
  laptopCheck: '<rect x="3" y="3" width="10" height="7.5" rx="1"/><path d="M1.5 12.5h13M6 6.8l1.4 1.4 2.6-2.7"/>',
  sidePanel: '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M10 2.5v11"/>',
  beaker: '<path d="M6 1.5h4M6.5 1.5v4.5L2.8 12.4a1.4 1.4 0 0 0 1.2 2.1h8a1.4 1.4 0 0 0 1.2-2.1L9.5 6V1.5"/><path d="M4.4 9.5h7.2"/>',
  pencil: '<path d="M10.5 2.5l3 3-8 8H2.5v-3z"/><path d="M8.5 4.5l3 3"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  trash: '<path d="M2.5 4.5h11M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M4 4.5l.7 8.6a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.6"/>',
  merge: '<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="9" r="1.5"/><path d="M4.5 5v6M4.5 5c0 3 2.5 4 5.5 4"/>',
  archive: '<rect x="2" y="3" width="12" height="3" rx="0.8"/><path d="M3 6v6.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6M6.5 9h3"/>',
  graph: '<circle cx="4" cy="3.5" r="1.5"/><circle cx="4" cy="12.5" r="1.5"/><circle cx="12" cy="8" r="1.5"/><path d="M4 5v6M10.5 8H8a4 4 0 0 1-4-3"/>',
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
