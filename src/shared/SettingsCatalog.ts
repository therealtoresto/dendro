// The one list of Dendro settings. package.json's `contributes.configuration` is generated from it
// (`npm run sync-config`), the extension reads its defaults from it, and the Settings screen is drawn from it.

export type SettingType = 'boolean' | 'number' | 'string' | 'enum' | 'flags' | 'color';
export type SettingControl = 'checkbox' | 'number' | 'text' | 'select' | 'segmented' | 'cards' | 'color';

export interface SettingOption {
  value: string | number;
  label: string;
  description?: string;
}

export interface SettingItem {
  key: string;
  type: SettingType;
  control: SettingControl;
  label: string;
  default: boolean | number | string | string[];
  description?: string;
  note?: string;
  options?: SettingOption[];
  min?: number;
  max?: number;
  placeholder?: string;
  dependsOn?: string;
  example?: 'dateFull' | 'dateShort' | 'time' | 'inlineBlame' | 'statusBar' | 'fileBlame';
}

export type SectionGroup = 'Views' | 'Editor' | 'General';

export interface SettingSection {
  id: string;
  group: SectionGroup;
  title: string;
  description: string;
  enabledKey?: string;
  items: SettingItem[];
}

const LOCATIONS: SettingOption[] = [
  { value: 'gutter', label: 'Gutter' },
  { value: 'line', label: 'Line background' },
  { value: 'overview', label: 'Scrollbar' },
];

const TOGGLE_MODES: SettingOption[] = [
  { value: 'file', label: 'per file' },
  { value: 'window', label: 'for every file at once' },
];

const HOVER_TARGETS: SettingOption[] = [
  { value: 'annotation', label: 'the blame text only' },
  { value: 'line', label: 'anywhere on the line' },
];

const GRAPH_MARKERS: SettingOption[] = [
  { value: 'head', label: 'HEAD', description: 'The checked-out commit' },
  { value: 'localBranches', label: 'Local branches', description: 'Tips of local branches' },
  { value: 'remoteBranches', label: 'Remote branches', description: 'Tips of remote branches' },
  { value: 'tags', label: 'Tags', description: 'Tagged commits' },
  { value: 'workingTree', label: 'Working Changes', description: 'Uncommitted changes on top' },
];

export const SETTINGS_SECTIONS: SettingSection[] = [
  {
    id: 'graph',
    group: 'Views',
    title: 'Commit Graph',
    description: 'Shows the history of your branches as a graph, with pull, push and the changes of every commit',
    items: [
      {
        key: 'graph.location',
        type: 'enum',
        control: 'segmented',
        label: 'Open the Commit Graph',
        default: 'editor',
        options: [
          { value: 'editor', label: 'as an editor tab' },
          { value: 'panel', label: 'in the bottom panel' },
        ],
        note: 'The bottom panel keeps the graph next to the terminal while you edit.',
      },
      {
        key: 'graph.initialRows',
        type: 'number',
        control: 'number',
        label: 'Commits loaded when the graph opens',
        default: 500,
        min: 50,
        max: 10000,
      },
      {
        key: 'graph.pageRows',
        type: 'number',
        control: 'number',
        label: 'Commits added each time you scroll to the end',
        default: 500,
        min: 50,
        max: 10000,
      },
      {
        key: 'graph.scrollAheadRows',
        type: 'number',
        control: 'number',
        label: 'Start loading more this many rows before the end',
        default: 60,
        min: 0,
        max: 1000,
      },
      {
        key: 'graph.searchLimit',
        type: 'number',
        control: 'number',
        label: 'Most results per search',
        default: 2000,
        min: 50,
        max: 20000,
      },
      {
        key: 'graph.showBranches',
        type: 'enum',
        control: 'select',
        label: 'Branches in the graph',
        default: 'all',
        options: [
          { value: 'all', label: 'every branch (default)' },
          { value: 'smart', label: 'the current branch, its upstream and the default branch' },
          { value: 'current', label: 'only the current branch' },
        ],
      },
      {
        key: 'graph.showRemoteBranches',
        type: 'boolean',
        control: 'checkbox',
        label: 'Include remote branches',
        default: true,
      },
      {
        key: 'graph.showTags',
        type: 'boolean',
        control: 'checkbox',
        label: 'Include tags',
        default: true,
      },
      {
        key: 'graph.order',
        type: 'enum',
        control: 'select',
        label: 'Commit order',
        default: 'date',
        options: [
          { value: 'date', label: 'newest commit date first (default)' },
          { value: 'author-date', label: 'newest author date first' },
          { value: 'topo', label: 'each branch kept together' },
        ],
      },
      {
        key: 'graph.columns',
        type: 'flags',
        control: 'cards',
        label: 'Columns',
        default: ['refs', 'graph', 'author', 'changes', 'date', 'sha'],
        options: [
          { value: 'refs', label: 'Branch / Tag', description: 'Badges, when they have a column of their own' },
          { value: 'graph', label: 'Graph', description: 'The lanes of the branches' },
          { value: 'author', label: 'Author', description: 'Picture or name of the author' },
          { value: 'changes', label: 'Changes', description: 'Files changed and the added / deleted lines' },
          { value: 'date', label: 'Date', description: 'When the commit was made' },
          { value: 'sha', label: 'SHA', description: 'The short commit id' },
        ],
      },
      {
        key: 'graph.dimMergeCommits',
        type: 'boolean',
        control: 'checkbox',
        label: 'Fade merge commits',
        default: false,
      },
      {
        key: 'graph.pillLayout',
        type: 'enum',
        control: 'select',
        label: 'Where branch and tag badges go',
        default: 'column',
        options: [
          { value: 'column', label: 'their own column (default)' },
          { value: 'inline', label: 'before the commit message' },
        ],
      },
      {
        key: 'graph.pillsPerRow',
        type: 'number',
        control: 'select',
        label: 'Badges per row before the rest fold into "+N"',
        default: 2,
        options: [
          { value: 1, label: '1' },
          { value: 2, label: '2 (default)' },
          { value: 3, label: '3' },
          { value: 4, label: '4' },
          { value: 6, label: '6' },
        ],
      },
      {
        key: 'graph.showRemoteNames',
        type: 'boolean',
        control: 'checkbox',
        label: 'Name the remote on remote branch badges',
        default: true,
      },
      {
        key: 'graph.showUpstreamStatus',
        type: 'boolean',
        control: 'checkbox',
        label: 'Show ahead / behind counts on branches that track a remote',
        default: true,
      },
      {
        key: 'graph.avatars',
        type: 'boolean',
        control: 'checkbox',
        label: 'Show author pictures (otherwise names)',
        default: true,
      },
      {
        key: 'graph.rowHover.enabled',
        type: 'boolean',
        control: 'checkbox',
        label: 'Open a commit card when the pointer rests on a row',
        default: true,
        note: 'Author with picture, date, files added / modified / deleted, changed lines and the full message.',
      },
      {
        key: 'graph.rowHover.delayMs',
        type: 'number',
        control: 'number',
        label: 'Wait before opening it (ms)',
        default: 400,
        min: 0,
        max: 3000,
        dependsOn: 'graph.rowHover.enabled',
      },
      {
        key: 'graph.multiSelect',
        type: 'boolean',
        control: 'checkbox',
        label: 'Compare two commits with Cmd/Ctrl+click',
        default: true,
      },
      {
        key: 'graph.scrollMarkers.enabled',
        type: 'boolean',
        control: 'checkbox',
        label: 'Mark commits on the scrollbar',
        default: true,
      },
      {
        key: 'graph.scrollMarkers.kinds',
        type: 'flags',
        control: 'cards',
        label: 'Scrollbar marks',
        default: ['head', 'localBranches', 'workingTree'],
        options: GRAPH_MARKERS,
        dependsOn: 'graph.scrollMarkers.enabled',
        note: 'The selected commit and search results are always marked.',
      },
      {
        key: 'graph.minimap.enabled',
        type: 'boolean',
        control: 'checkbox',
        label: 'Show daily commit activity above the graph',
        default: false,
      },
      {
        key: 'graph.minimap.kinds',
        type: 'flags',
        control: 'cards',
        label: 'Activity strip marks',
        default: ['head', 'localBranches', 'tags'],
        options: GRAPH_MARKERS,
        dependsOn: 'graph.minimap.enabled',
      },
      {
        key: 'graph.maxGraphWidth',
        type: 'number',
        control: 'number',
        label: 'Widest the graph column grows on its own (px)',
        default: 220,
        min: 60,
        max: 800,
        note: 'A width you set by dragging the column border wins over this.',
      },
      {
        key: 'graph.diffLocation',
        type: 'enum',
        control: 'segmented',
        label: 'Open file diffs',
        default: 'beside',
        options: [
          { value: 'beside', label: 'beside the graph' },
          { value: 'active', label: 'in place of the graph' },
        ],
      },
      {
        key: 'graph.fetchPrune',
        type: 'boolean',
        control: 'checkbox',
        label: 'Remove remote branches that no longer exist when fetching',
        default: true,
      },
    ],
  },
  {
    id: 'inlineBlame',
    group: 'Editor',
    title: 'Inline Blame',
    description: 'Who changed the line under the cursor and when, written after the line',
    enabledKey: 'inlineBlame.enabled',
    items: [
      {
        key: 'inlineBlame.enabled',
        type: 'boolean',
        control: 'checkbox',
        label: 'Show blame after the current line',
        default: true,
      },
      {
        key: 'inlineBlame.format',
        type: 'string',
        control: 'text',
        label: 'Text',
        default: '${author}, ${agoOrDate} • ${message|50}',
        dependsOn: 'inlineBlame.enabled',
        example: 'inlineBlame',
        note: 'Tokens: ${author} ${email} ${ago} ${date} ${agoOrDate} ${message} ${sha}. ${message|50} cuts a value to 50 characters, ${ago|14-} pads it to 14.',
      },
    ],
  },
  {
    id: 'statusBar',
    group: 'Editor',
    title: 'Status Bar Blame',
    description: 'Who changed the line under the cursor, in the status bar',
    enabledKey: 'statusBar.enabled',
    items: [
      {
        key: 'statusBar.enabled',
        type: 'boolean',
        control: 'checkbox',
        label: 'Show blame in the status bar',
        default: true,
      },
      {
        key: 'statusBar.format',
        type: 'string',
        control: 'text',
        label: 'Text',
        default: '${author}, ${agoOrDate}',
        dependsOn: 'statusBar.enabled',
        example: 'statusBar',
      },
      {
        key: 'statusBar.alignment',
        type: 'enum',
        control: 'segmented',
        label: 'Position',
        default: 'right',
        options: [
          { value: 'left', label: 'left' },
          { value: 'right', label: 'right' },
        ],
        dependsOn: 'statusBar.enabled',
      },
      {
        key: 'statusBar.command',
        type: 'enum',
        control: 'select',
        label: 'When clicked',
        default: 'showInGraph',
        options: [
          { value: 'showInGraph', label: 'show the commit in the Commit Graph' },
          { value: 'openChanges', label: "open the line's changes (diff)" },
          { value: 'copySha', label: 'copy the commit SHA' },
        ],
        dependsOn: 'statusBar.enabled',
      },
    ],
  },
  {
    id: 'hovers',
    group: 'Editor',
    title: 'Hovers',
    description: 'A card with the commit behind a line when you point at it',
    enabledKey: 'hovers.enabled',
    items: [
      {
        key: 'hovers.enabled',
        type: 'boolean',
        control: 'checkbox',
        label: 'Show blame cards on hover',
        default: true,
      },
      {
        key: 'hovers.currentLine.enabled',
        type: 'boolean',
        control: 'checkbox',
        label: 'Card for the current line',
        default: true,
        dependsOn: 'hovers.enabled',
      },
      {
        key: 'hovers.currentLine.over',
        type: 'enum',
        control: 'select',
        label: 'Shown when over the',
        default: 'annotation',
        options: HOVER_TARGETS,
        dependsOn: 'hovers.currentLine.enabled',
      },
      {
        key: 'hovers.annotations.enabled',
        type: 'boolean',
        control: 'checkbox',
        label: 'Cards while a file is annotated (blame, heatmap, changes)',
        default: true,
        dependsOn: 'hovers.enabled',
      },
      {
        key: 'hovers.annotations.over',
        type: 'enum',
        control: 'select',
        label: 'Shown when over the',
        default: 'line',
        options: HOVER_TARGETS,
        dependsOn: 'hovers.annotations.enabled',
      },
      {
        key: 'hovers.details',
        type: 'boolean',
        control: 'checkbox',
        label: 'Include author, date, message and links',
        default: true,
        dependsOn: 'hovers.enabled',
      },
      {
        key: 'hovers.changes',
        type: 'boolean',
        control: 'checkbox',
        label: 'Include the diff of the line',
        default: true,
        dependsOn: 'hovers.enabled',
      },
    ],
  },
  {
    id: 'fileBlame',
    group: 'Editor',
    title: 'File Blame',
    description: 'Blame for every line of a file, switched on when you need it',
    items: [
      {
        key: 'blame.toggleMode',
        type: 'enum',
        control: 'select',
        label: 'Switch annotations on and off',
        default: 'file',
        options: TOGGLE_MODES,
      },
      {
        key: 'blame.format',
        type: 'string',
        control: 'text',
        label: 'Text',
        default: '${message|40} ${agoOrDate|14-}',
        example: 'fileBlame',
      },
      {
        key: 'blame.heatmap',
        type: 'boolean',
        control: 'checkbox',
        label: 'Color a bar by how old each line is',
        default: true,
        note: 'Recent lines get the hot color, older ones the cold color; within each, the newer the line, the brighter the bar.',
      },
      {
        key: 'blame.heatmapPosition',
        type: 'enum',
        control: 'segmented',
        label: 'Bar side',
        default: 'right',
        options: [
          { value: 'left', label: 'left' },
          { value: 'right', label: 'right' },
        ],
        dependsOn: 'blame.heatmap',
      },
      {
        key: 'blame.avatars',
        type: 'boolean',
        control: 'checkbox',
        label: 'Show author pictures',
        default: true,
      },
      {
        key: 'blame.compact',
        type: 'boolean',
        control: 'checkbox',
        label: 'Write the blame once for consecutive lines of one commit',
        default: true,
              },
      {
        key: 'blame.highlight.enabled',
        type: 'boolean',
        control: 'checkbox',
        label: 'Mark the other lines of the commit under the cursor',
        default: true,
      },
      {
        key: 'blame.highlight.locations',
        type: 'flags',
        control: 'cards',
        label: 'Mark them in',
        default: ['gutter', 'line', 'overview'],
        options: LOCATIONS,
        dependsOn: 'blame.highlight.enabled',
      },
      {
        key: 'blame.dirtyDelayMs',
        type: 'number',
        control: 'number',
        label: 'Wait after typing before blaming an unsaved file again (ms)',
        default: 2500,
        min: 0,
        max: 60000,
        note: 'Also applies to inline blame and the status bar.',
      },
      {
        key: 'blame.dirtyMaxLines',
        type: 'number',
        control: 'number',
        label: 'Blame unsaved files longer than this many lines only on save',
        default: 5000,
        min: 100,
        max: 1000000,
      },
    ],
  },
  {
    id: 'fileChanges',
    group: 'Editor',
    title: 'File Changes',
    description: 'Marks the lines you have not committed or not pushed yet',
    items: [
      {
        key: 'changes.toggleMode',
        type: 'enum',
        control: 'select',
        label: 'Switch annotations on and off',
        default: 'file',
        options: TOGGLE_MODES,
      },
      {
        key: 'changes.locations',
        type: 'flags',
        control: 'cards',
        label: 'Mark them in',
        default: ['gutter', 'line', 'overview'],
        options: LOCATIONS,
        note: 'When there are none, the lines of the last commit that touched the file are marked.',
      },
    ],
  },
  {
    id: 'fileHeatmap',
    group: 'Editor',
    title: 'File Heatmap',
    description: 'Colors every line by how recently it changed',
    items: [
      {
        key: 'heatmap.toggleMode',
        type: 'enum',
        control: 'select',
        label: 'Switch annotations on and off',
        default: 'file',
        options: TOGGLE_MODES,
      },
      {
        key: 'heatmap.locations',
        type: 'flags',
        control: 'cards',
        label: 'Show it in',
        default: ['gutter', 'overview'],
        options: LOCATIONS,
      },
      {
        key: 'heatmap.fadeLines',
        type: 'boolean',
        control: 'checkbox',
        label: 'Dim lines older than the threshold',
        default: true,
      },
      {
        key: 'heatmap.coldThresholdDays',
        type: 'number',
        control: 'number',
        label: 'Lines older than this many days count as old',
        default: 90,
        min: 1,
        max: 3650,
      },
      {
        key: 'heatmap.hotColor',
        type: 'color',
        control: 'color',
        label: 'Color of recent lines',
        default: '#f66a0a',
      },
      {
        key: 'heatmap.coldColor',
        type: 'color',
        control: 'color',
        label: 'Color of old lines',
        default: '#0a60f6',
      },
    ],
  },
  {
    id: 'avatars',
    group: 'General',
    title: 'Avatars',
    description: 'Account pictures of commit authors in the graph, hovers and blame annotations',
    enabledKey: 'avatars.pictures',
    items: [
      {
        key: 'avatars.pictures',
        type: 'boolean',
        control: 'checkbox',
        label: 'Show account pictures of commit authors',
        default: true,
        note: 'An author without a picture is shown by initials. Pictures are cached for a week.',
      },
      {
        key: 'avatars.sources',
        type: 'flags',
        control: 'cards',
        label: 'Look for pictures on',
        default: ['github', 'gitlab', 'gravatar'],
        options: [
          { value: 'github', label: 'GitHub', description: 'noreply addresses, and the authors of github.com repositories' },
          { value: 'gitlab', label: 'GitLab', description: 'the repository host; needs "Dendro: Connect GitLab for Avatars"' },
          { value: 'gravatar', label: 'Gravatar', description: 'sends an MD5 hash of the author email' },
        ],
        dependsOn: 'avatars.pictures',
      },
      {
        key: 'avatars.fallback',
        type: 'enum',
        control: 'select',
        label: 'Authors with no picture get',
        default: 'initials',
        options: [
          { value: 'initials', label: 'their initials (default)' },
          { value: 'identicon', label: 'a geometric pattern (Gravatar identicon)' },
          { value: 'retro', label: 'an 8-bit face (Gravatar retro)' },
          { value: 'robohash', label: 'a robot (Gravatar robohash)' },
          { value: 'monsterid', label: 'a monster (Gravatar monsterid)' },
          { value: 'wavatar', label: 'a face (Gravatar wavatar)' },
        ],
        dependsOn: 'avatars.pictures',
        note: 'The generated pictures come from Gravatar, so they need Gravatar in the list above.',
      },
    ],
  },
  {
    id: 'dates',
    group: 'General',
    title: 'Dates & Times',
    description: 'How dates and times look everywhere in Dendro',
    items: [
      {
        key: 'dates.relative',
        type: 'boolean',
        control: 'checkbox',
        label: 'Write recent dates relatively',
        default: true,
        note: 'For example "3 days ago" instead of a date.',
      },
      {
        key: 'dates.locale',
        type: 'string',
        control: 'text',
        label: 'Language of dates',
        default: '',
        placeholder: "defaults to Cursor's locale",
        example: 'dateFull',
        note: 'A language tag such as en-US or uk-UA.',
      },
      {
        key: 'dates.format',
        type: 'string',
        control: 'text',
        label: 'Full date',
        default: 'MMMM Do, YYYY h:mma',
        example: 'dateFull',
        note: 'Tokens: YYYY YY MMMM MMM MM M Do DD D dddd ddd HH H hh h mm ss A a. Text in [brackets] stays as written.',
      },
      {
        key: 'dates.shortFormat',
        type: 'string',
        control: 'text',
        label: 'Short date',
        default: '',
        placeholder: 'defaults to the locale short date format',
        example: 'dateShort',
      },
      {
        key: 'dates.timeFormat',
        type: 'string',
        control: 'text',
        label: 'Time',
        default: '',
        placeholder: 'defaults to the locale time format',
        example: 'time',
      },
      {
        key: 'dates.source',
        type: 'enum',
        control: 'select',
        label: 'Date of a commit',
        default: 'authored',
        options: [
          { value: 'authored', label: 'when it was written — author date (default)' },
          { value: 'committed', label: 'when it was committed — committer date' },
        ],
      },
    ],
  },
];

export type SettingValues = Record<string, boolean | number | string | string[]>;

export class SettingsCatalog {
  static getItems(): SettingItem[] {
    return SETTINGS_SECTIONS.flatMap((section) => section.items);
  }

  static findItem(key: string): SettingItem | undefined {
    return SettingsCatalog.getItems().find((item) => item.key === key);
  }

  static getDefaults(): SettingValues {
    const values: SettingValues = {};
    for (const item of SettingsCatalog.getItems()) {
      values[item.key] = item.default;
    }
    return values;
  }

  // The `contributes.configuration` block of package.json, one titled group per section.
  static buildConfiguration(): { title: string; properties: Record<string, Record<string, unknown>> }[] {
    return SETTINGS_SECTIONS.map((section) => ({
      title: `Dendro: ${section.title}`,
      properties: Object.fromEntries(
        section.items.map((item) => [`dendro.${item.key}`, SettingsCatalog.buildProperty(item)]),
      ),
    }));
  }

  private static buildProperty(item: SettingItem): Record<string, unknown> {
    const description = item.note ? `${item.label}. ${item.note}` : item.label;
    const property: Record<string, unknown> = { description, default: item.default };

    switch (item.type) {
      case 'boolean':
        property.type = 'boolean';
        break;
      case 'number':
        property.type = 'number';
        if (item.options) {
          property.enum = item.options.map((option) => option.value);
        }
        if (item.min !== undefined) {
          property.minimum = item.min;
        }
        if (item.max !== undefined) {
          property.maximum = item.max;
        }
        break;
      case 'enum':
        property.type = 'string';
        property.enum = item.options!.map((option) => option.value);
        property.enumDescriptions = item.options!.map((option) => option.label);
        break;
      case 'flags':
        property.type = 'array';
        property.items = { type: 'string', enum: item.options!.map((option) => option.value) };
        property.uniqueItems = true;
        break;
      case 'color':
        property.type = 'string';
        property.format = 'color-hex';
        break;
      default:
        property.type = 'string';
    }

    return property;
  }

  // A value from settings.json can be anything; the screen and the code only ever see one that fits the item.
  static normalize(item: SettingItem, value: unknown): boolean | number | string | string[] {
    switch (item.type) {
      case 'boolean':
        return typeof value === 'boolean' ? value : (item.default as boolean);
      case 'number': {
        const number = typeof value === 'number' && Number.isFinite(value) ? value : (item.default as number);
        return Math.min(item.max ?? Infinity, Math.max(item.min ?? -Infinity, number));
      }
      case 'enum':
        return item.options!.some((option) => option.value === value) ? (value as string) : (item.default as string);
      case 'flags':
        return Array.isArray(value)
          ? value.filter((flag) => item.options!.some((option) => option.value === flag))
          : (item.default as string[]);
      case 'color':
        return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : (item.default as string);
      default:
        return typeof value === 'string' ? value : (item.default as string);
    }
  }
}
