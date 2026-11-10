import { AvatarStyle } from '../src/shared/AvatarStyle';
import { DateFormatter } from '../src/shared/DateFormatter';
import type { SettingValues } from '../src/shared/SettingsCatalog';
import { TokenTemplate } from '../src/shared/TokenTemplate';

const DAY = 86400;
const NOW = Date.now() / 1000;

interface SampleCommit {
  author: string;
  email: string;
  message: string;
  sha: string;
  time: number;
}

const SAMPLE_COMMITS: SampleCommit[] = [
  { author: 'Ann Lee', email: 'ann@example.com', message: 'Count only the rings of grown years', sha: 'e5c7b90', time: NOW - 3 * DAY },
  { author: 'Bob Stone', email: 'bob@example.com', message: 'Draw lanes with curves', sha: '4f1a2c3', time: NOW - 40 * DAY },
  { author: 'You', email: 'you@example.com', message: 'Keep the selected row on reload', sha: '91b0d7e', time: NOW - 2 * 3600 },
  { author: 'Dee Ray', email: 'dee@example.com', message: 'Read refs in one call', sha: '7a3e5f1', time: NOW - 400 * DAY },
];

const CODE_LINES = [
  { code: '<k>export</k> <k>class</k> <t>Rings</t> {', commit: 1 },
  { code: '  <k>static</k> <f>count</f>(years: <t>number</t>[]) {', commit: 1 },
  { code: '    <k>return</k> years.<f>filter</f>((year) =&gt; year &gt; 0).length;', commit: 2 },
  { code: '  }', commit: 0 },
  { code: '}', commit: 3 },
];

export class Previews {
  static createDates(values: SettingValues, locale: string): DateFormatter {
    return new DateFormatter(
      {
        relative: Boolean(values['dates.relative']),
        locale: String(values['dates.locale'] ?? ''),
        format: String(values['dates.format'] ?? ''),
        shortFormat: String(values['dates.shortFormat'] ?? ''),
        timeFormat: String(values['dates.timeFormat'] ?? ''),
      },
      locale,
    );
  }

  static formatSample(template: string, values: SettingValues, locale: string, commit = SAMPLE_COMMITS[0]): string {
    const dates = Previews.createDates(values, locale);
    return TokenTemplate.format(template, {
      author: commit.author,
      email: commit.email,
      ago: dates.formatAgo(commit.time),
      date: dates.formatFull(commit.time),
      agoOrDate: dates.formatAgoOrDate(commit.time),
      message: commit.message,
      sha: commit.sha,
    });
  }

  static renderExample(example: string, values: SettingValues, locale: string): string {
    const dates = Previews.createDates(values, locale);
    const time = SAMPLE_COMMITS[0].time;
    switch (example) {
      case 'dateFull':
        return dates.formatFull(time);
      case 'dateShort':
        return dates.formatShortDate(time);
      case 'time':
        return dates.formatTime(time);
      case 'inlineBlame':
        return Previews.formatSample(String(values['inlineBlame.format']), values, locale);
      case 'statusBar':
        return Previews.formatSample(String(values['statusBar.format']), values, locale);
      case 'fileBlame':
        return Previews.formatSample(String(values['blame.format']), values, locale);
      default:
        return '';
    }
  }

  static render(sectionId: string, values: SettingValues, locale: string): string {
    switch (sectionId) {
      case 'graph':
        return Previews.renderGraph(values);
      case 'inlineBlame':
        return Previews.renderInlineBlame(values, locale);
      case 'statusBar':
        return Previews.renderStatusBar(values, locale);
      case 'codeLens':
        return Previews.renderCodeLens(values, locale);
      case 'hovers':
        return Previews.renderHover(values, locale);
      case 'fileBlame':
        return Previews.renderFileBlame(values, locale);
      case 'fileChanges':
        return Previews.renderFileChanges(values);
      case 'fileHeatmap':
        return Previews.renderHeatmap(values);
      case 'dates':
        return Previews.renderDates(values, locale);
      default:
        return '';
    }
  }

  private static renderGraph(values: SettingValues): string {
    const columns = new Set(values['graph.columns'] as string[]);
    const inline = values['graph.pillLayout'] === 'inline';
    const maxPills = Number(values['graph.pillsPerRow']);
    const remoteNames = values['graph.showRemoteNames'] !== false;
    const upstream = values['graph.showUpstreamStatus'] !== false;
    const avatars = values['graph.avatars'] !== false;
    const dimMerges = values['graph.dimMergeCommits'] === true;
    const showRefs = columns.has('refs') && !inline;

    const rows = [
      { lane: 0, pills: [`main${remoteNames ? ' <i>☁ origin</i>' : ' <i>☁</i>'}${upstream ? ' <i>↑1</i>' : ''}`], message: 'Count only the rings of grown years', author: 0, merge: false, changes: [12, 3] },
      { lane: 1, pills: ['curved-lanes'], message: 'Draw lanes with curves', author: 1, merge: false, changes: [40, 0] },
      { lane: 0, pills: [], message: 'Merge branch curved-lanes', author: 0, merge: true, changes: [0, 0] },
      { lane: 0, pills: ['🏷 v2.4', 'release'], message: 'Keep the selected row on reload', author: 2, merge: false, changes: [5, 20] },
      { lane: 1, pills: [`${remoteNames ? 'origin/' : ''}hotfix`], message: 'Read refs in one call', author: 3, merge: false, changes: [2, 1] },
    ];

    const minimap =
      values['graph.minimap.enabled'] === true
        ? `<div class="pv-minimap">${Array.from({ length: 48 }, (_, index) => `<i style="height:${4 + ((index * 37) % 23)}px"></i>`).join('')}</div>`
        : '';

    const body = rows
      .map((row) => {
        const commit = SAMPLE_COMMITS[row.author];
        const pills = row.pills.slice(0, maxPills).map((pill) => `<span class="pv-pill">${pill}</span>`);
        if (row.pills.length > maxPills) {
          pills.push(`<span class="pv-pill pv-more">+${row.pills.length - maxPills}</span>`);
        }
        const pillsHtml = pills.join('');
        const author = avatars
          ? `<span class="pv-avatar" style="background:${AvatarStyle.getColor(commit.email)}">${AvatarStyle.renderArt(commit.email)}</span>`
          : `<span class="pv-muted">${commit.author}</span>`;
        const [added, deleted] = row.changes;
        const total = added + deleted;
        const bar = total
          ? `<span class="pv-bar" style="width:${Math.min(100, 20 + Math.log(total + 1) * 18)}%"><b style="width:${(added / total) * 100}%"></b></span>`
          : '';
        return `<div class="pv-row${row.merge && dimMerges ? ' pv-dim' : ''}">
          ${showRefs ? `<span class="pv-refs">${pillsHtml}</span>` : ''}
          ${columns.has('graph') ? `<span class="pv-lanes"><span class="pv-node lane-${row.lane}${row.merge ? ' merge' : ''}"></span></span>` : ''}
          <span class="pv-message">${inline ? pillsHtml : ''}${row.message}</span>
          ${columns.has('author') ? `<span class="pv-author">${author}</span>` : ''}
          ${columns.has('changes') ? `<span class="pv-changes">${bar}</span>` : ''}
          ${columns.has('date') ? '<span class="pv-muted pv-date">3d</span>' : ''}
          ${columns.has('sha') ? `<span class="pv-muted pv-sha">${commit.sha}</span>` : ''}
        </div>`;
      })
      .join('');

    const markers = values['graph.scrollMarkers.enabled'] !== false ? '<div class="pv-scrollbar"><i style="top:8%"></i><i style="top:46%"></i><i style="top:70%"></i></div>' : '';
    return `<div class="pv-graph">${minimap}<div class="pv-rows">${body}${markers}</div></div>`;
  }

  private static renderInlineBlame(values: SettingValues, locale: string): string {
    const annotation =
      values['inlineBlame.enabled'] !== false
        ? `<span class="pv-inline">${Previews.escape(Previews.formatSample(String(values['inlineBlame.format']), values, locale))}</span>`
        : '';
    return Previews.renderCode(CODE_LINES.map((line, index) => (index === 2 ? `${line.code}${annotation}` : line.code)), 2);
  }

  private static renderStatusBar(values: SettingValues, locale: string): string {
    const text = Previews.escape(Previews.formatSample(String(values['statusBar.format']), values, locale));
    const item = values['statusBar.enabled'] !== false ? `<span class="pv-status-item">⎇ ${text}</span>` : '';
    const left = values['statusBar.alignment'] === 'left';
    return `<div class="pv-statusbar"><span>⎇ main ↓16 ↑1</span>${left ? item : ''}<span class="pv-spacer"></span>${left ? '' : item}<span>Ln 3, Col 12</span></div>`;
  }

  private static renderCodeLens(values: SettingValues, locale: string): string {
    if (values['codeLens.enabled'] === false) {
      return '<div class="pv-empty">CodeLens is off.</div>';
    }
    const dates = Previews.createDates(values, locale);
    const scopes = new Set(values['codeLens.scopes'] as string[]);
    const describeLens = (author: string, time: number, authors: string) => {
      const parts: string[] = [];
      if (values['codeLens.recentChange'] !== false) {
        parts.push(`⟲ ${author}, ${dates.formatAgoOrDate(time)}`);
      }
      if (values['codeLens.authors'] !== false) {
        parts.push(`☺ ${authors}`);
      }
      return parts.join(' | ');
    };
    const renderLens = (text: string, indented: boolean) =>
      text ? `<div class="pv-lens${indented ? ' pv-lens-indent' : ''}">${text}</div>` : '';

    const commits = SAMPLE_COMMITS;
    const lines: string[] = [];
    if (scopes.has('file')) {
      lines.push(renderLens(describeLens(commits[0].author, commits[0].time, '3 authors (Ann Lee and 2 others)'), false));
    }
    if (scopes.has('containers')) {
      lines.push(renderLens(describeLens(commits[1].author, commits[1].time, '2 authors (Bob Stone and 1 other)'), false));
    }
    lines.push(`<div class="pv-code-line"><span class="pv-ln">1</span><span>${CODE_LINES[0].code}</span></div>`);
    if (scopes.has('blocks')) {
      lines.push(renderLens(describeLens(commits[2].author, commits[2].time, '1 author (You)'), true));
    }
    CODE_LINES.slice(1).forEach((line, index) => {
      lines.push(`<div class="pv-code-line"><span class="pv-ln">${index + 2}</span><span>${line.code}</span></div>`);
    });
    return `<div class="pv-code">${lines.join('')}</div>`;
  }

  private static renderHover(values: SettingValues, locale: string): string {
    if (values['hovers.enabled'] === false) {
      return '<div class="pv-empty">Hovers are off.</div>';
    }
    const dates = Previews.createDates(values, locale);
    const commit = SAMPLE_COMMITS[0];
    const details =
      values['hovers.details'] !== false
        ? `<div><b>${commit.author}</b>, ${dates.formatAgo(commit.time)} <i class="pv-muted">(${dates.formatFull(commit.time)})</i></div>
           <div class="pv-hover-message">${commit.message}</div>
           <div class="pv-links"><a>⎇ ${commit.sha}</a> | <a>Open Changes</a> | <a>Copy SHA</a></div>`
        : '';
    const changes =
      values['hovers.changes'] !== false
        ? `<pre class="pv-diff"><span class="del">-    return years.length;</span>\n<span class="add">+    return years.filter((year) =&gt; year &gt; 0).length;</span></pre>`
        : '';
    return `<div class="pv-hover">${details}${changes || details ? '' : '<span class="pv-muted">Nothing to show.</span>'}${changes}</div>`;
  }

  private static renderFileBlame(values: SettingValues, locale: string): string {
    const format = String(values['blame.format']);
    const compact = values['blame.compact'] !== false;
    const avatars = values['blame.avatars'] !== false;
    const heatmap = values['blame.heatmap'] !== false;
    const heatSide = values['blame.heatmapPosition'] === 'left' ? 'left' : 'right';
    const heatColors = ['#f66a0a', '#f66a0a', '#c95a2a', '#0a60f6', '#0a60f6aa'];

    const gutters = CODE_LINES.map((line, index) => {
      const commit = SAMPLE_COMMITS[line.commit];
      const repeats = compact && index > 0 && CODE_LINES[index - 1].commit === line.commit;
      const text = repeats ? '' : Previews.escape(Previews.formatSample(format, values, locale, commit));
      const avatar = avatars
        ? `<span class="pv-avatar small" style="${repeats ? 'visibility:hidden;' : ''}background:${AvatarStyle.getColor(commit.email)}">${AvatarStyle.renderArt(commit.email)}</span>`
        : '';
      const border = heatmap ? `border-${heatSide}: 2px solid ${heatColors[line.commit]}` : '';
      return `${avatar}<span class="pv-blame" style="${border}">${text}</span>`;
    });
    return Previews.renderCode(CODE_LINES.map((line) => line.code), -1, gutters);
  }

  private static renderFileChanges(values: SettingValues): string {
    const locations = new Set(values['changes.locations'] as string[]);
    return Previews.renderMarked(locations, (index) => (index === 2 ? '#e2c08d' : index === 1 ? '#3794ff' : null), false);
  }

  private static renderHeatmap(values: SettingValues): string {
    const locations = new Set(values['heatmap.locations'] as string[]);
    const hot = String(values['heatmap.hotColor']);
    const cold = String(values['heatmap.coldColor']);
    const colors = [cold, cold, hot, hot, cold];
    return Previews.renderMarked(locations, (index) => colors[index], values['heatmap.fadeLines'] !== false);
  }

  private static renderMarked(locations: Set<string>, colorOf: (index: number) => string | null, fadeCold: boolean): string {
    const lines = CODE_LINES.map((line, index) => {
      const color = colorOf(index);
      const background = color && locations.has('line') ? `background:${color}24;` : '';
      const fade = fadeCold && (index === 0 || index === 4) ? 'opacity:0.6;' : '';
      const gutter = color && locations.has('gutter') ? `<i class="pv-gutter-mark" style="background:${color}"></i>` : '<i class="pv-gutter-mark"></i>';
      return `<div class="pv-code-line" style="${background}${fade}"><span class="pv-ln">${gutter}${index + 1}</span><span>${line.code}</span></div>`;
    });
    const ruler = locations.has('overview')
      ? `<div class="pv-ruler">${CODE_LINES.map((_, index) => {
          const color = colorOf(index);
          return color ? `<i style="top:${index * 20 + 6}px;background:${color}"></i>` : '';
        }).join('')}</div>`
      : '';
    return `<div class="pv-code">${lines.join('')}${ruler}</div>`;
  }

  private static renderDates(values: SettingValues, locale: string): string {
    const dates = Previews.createDates(values, locale);
    const time = SAMPLE_COMMITS[0].time;
    const rows = [
      ['Relative', values['dates.relative'] !== false ? dates.formatAgo(time) : 'off — dates are shown as the short date'],
      ['Date', dates.formatFull(time)],
      ['Short date', dates.formatShortDate(time)],
      ['Time', dates.formatTime(time)],
      ['Locale', dates.locale],
    ];
    return `<table class="pv-dates">${rows.map(([label, value]) => `<tr><td class="pv-muted">${label}</td><td>${Previews.escape(value)}</td></tr>`).join('')}</table>`;
  }

  private static renderCode(lines: string[], currentLine: number, gutters?: string[]): string {
    return `<div class="pv-code">${lines
      .map(
        (code, index) =>
          `<div class="pv-code-line${index === currentLine ? ' current' : ''}">${gutters ? `<span class="pv-gutter">${gutters[index]}</span>` : ''}<span class="pv-ln">${index + 1}</span><span>${code}</span></div>`,
      )
      .join('')}</div>`;
  }

  static escape(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
