import * as vscode from 'vscode';
import { Settings } from '../Settings';
import { DateFormatter } from '../shared/DateFormatter';
import { TokenTemplate } from '../shared/TokenTemplate';
import type { BlameCommit } from './BlameParser';
import type { BlameService, LineBlameInfo } from './BlameService';
import { LineChange } from './LineChange';

export interface HoverOptions {
  // The lines the commit changed; off where the card has no room for them.
  changes: boolean;
  // The language of the file, to show the changed lines as its code.
  languageId?: string;
  // Switches for the blame features, on the status bar card.
  controls?: boolean;
}

export type BlameCardAction = 'changes' | 'workingChanges' | 'previous' | 'graph' | 'lineHistory' | 'copySha';

// What a link on the card acts on; plain values, since command links carry their arguments as JSON.
export interface BlameCardTarget {
  root: string;
  sha: string;
  path: string;
  line: number;
  originalLine: number;
  previousSha?: string;
  previousPath?: string;
}

// Readable on dark and light themes alike: hovers cannot use theme colors.
const ADDED_COLOR = '#3fb950';
const DELETED_COLOR = '#f85149';
const DIM_COLOR = '#8b949e';

export class BlameText {
  static createDateFormatter(): DateFormatter {
    return new DateFormatter(Settings.readDateSettings(), Settings.getEditorLocale());
  }

  static getCommitTime(commit: BlameCommit): number {
    return Settings.get<string>('dates.source') === 'committed' ? commit.committerTime : commit.authorTime;
  }

  static buildValues(commit: BlameCommit, userEmail: string | null, dates: DateFormatter): Record<string, string> {
    const time = BlameText.getCommitTime(commit);
    const isYou = commit.uncommitted || (userEmail !== null && commit.email === userEmail);

    return {
      author: isYou ? 'You' : commit.author,
      email: commit.uncommitted ? '' : commit.email,
      ago: dates.formatAgo(time),
      date: dates.formatFull(time),
      agoOrDate: dates.formatAgoOrDate(time),
      message: commit.uncommitted ? 'Uncommitted changes' : commit.summary,
      sha: commit.uncommitted ? 'Working Tree' : commit.sha.slice(0, 7),
    };
  }

  static format(template: string, commit: BlameCommit, userEmail: string | null, dates: DateFormatter): string {
    return TokenTemplate.format(template, BlameText.buildValues(commit, userEmail, dates));
  }

  // The card behind a line: who and when, the message, what the commit changed, links to go further, and the lines
  // it changed here, as code of the file's language. The status bar card adds switches for the blame features.
  static async buildHover(blame: BlameService, info: LineBlameInfo, options: HoverOptions): Promise<vscode.MarkdownString> {
    const { commit } = info;
    const dates = BlameText.createDateFormatter();
    const userEmail = await blame.getUserEmail(info.root);
    const values = BlameText.buildValues(commit, userEmail, dates);
    const markdown = new vscode.MarkdownString('', true);
    markdown.isTrusted = true;
    markdown.supportHtml = true;
    const parts: string[] = [];

    if (Settings.get<boolean>('hovers.details')) {
      parts.push(await BlameText.buildDetails(blame, info, values));
    }

    if (options.changes && Settings.get<boolean>('hovers.changes')) {
      const change = await blame.getLineChange(info, Settings.get<number>('hovers.changesLines'));
      if (change && change.length > 0) {
        parts.push(BlameText.buildChange(change, options.languageId));
      }
    }

    if (options.controls) {
      parts.push(BlameText.buildControls());
    }

    markdown.appendMarkdown(parts.join('\n\n---\n\n'));
    return markdown;
  }

  private static async buildDetails(blame: BlameService, info: LineBlameInfo, values: Record<string, string>): Promise<string> {
    const { commit } = info;
    const lines: string[] = [];

    const picture = commit.uncommitted ? null : await BlameText.findPicture(blame, info);
    const icon = picture ? `![](${picture}|width=16,height=16)` : '$(account)';
    const author = commit.uncommitted ? '**You**' : `[**${BlameText.escape(values.author)}**](mailto:${commit.email} "${commit.email}")`;
    lines.push(`${icon}&nbsp; ${author} &nbsp;·&nbsp; ${values.ago} &nbsp;${BlameText.dim(values.date)}`);

    if (commit.uncommitted) {
      lines.push('**Uncommitted changes**');
      const target = BlameText.toTarget(info);
      lines.push(BlameText.buildLink('diff', 'Changes', 'Open the uncommitted changes of the file', 'workingChanges', target));
      return lines.join('\n\n');
    }

    const message = (await blame.getFullMessage(info.root, commit.sha)).trim();
    const [subject, ...body] = message.split('\n');
    lines.push(`**${BlameText.escape(subject)}**`);
    const rest = body.join('\n').trim();
    if (rest) {
      lines.push(BlameText.escape(rest).replace(/\n/g, '  \n'));
    }

    if (Settings.get<boolean>('hovers.facts')) {
      const stats = await blame.getCommitStats(info.root, commit.sha);
      const facts = [`\`${values.sha}\``];
      if (stats) {
        facts.push(`$(files) ${stats.files} ${stats.files === 1 ? 'file' : 'files'}`);
        facts.push(`${BlameText.color(`+${stats.added}`, ADDED_COLOR)} ${BlameText.color(`−${stats.deleted}`, DELETED_COLOR)}`);
      }
      lines.push(facts.join(' &nbsp;·&nbsp; '));
    }

    const actions = await BlameText.buildActions(blame, info);
    if (actions) {
      lines.push(actions);
    }
    return lines.join('\n\n');
  }

  private static async buildActions(blame: BlameService, info: LineBlameInfo): Promise<string> {
    const { commit } = info;
    const chosen = new Set(Settings.get<string[]>('hovers.actions'));
    const target = BlameText.toTarget(info);
    const links: string[] = [];

    if (chosen.has('changes')) {
      links.push(BlameText.buildLink('diff', 'Changes', 'Open the changes of this commit to the file', 'changes', target));
    }
    if (chosen.has('previous') && commit.previousSha) {
      links.push(BlameText.buildLink('history', 'Before', 'Open the file as it was before this commit', 'previous', target));
    }
    if (chosen.has('graph')) {
      links.push(BlameText.buildLink('git-commit', 'Graph', 'Show the commit in the Commit Graph', 'graph', target));
    }
    if (chosen.has('lineHistory')) {
      links.push(BlameText.buildLink('list-flat', 'Line History', 'Every commit that touched this line', 'lineHistory', target));
    }
    if (chosen.has('remote')) {
      const url = await blame.getCommitWebUrl(info.root, commit.sha);
      if (url) {
        links.push(`[$(link-external) Remote](${url} "Open the commit on ${new URL(url).host}")`);
      }
    }
    if (chosen.has('copySha')) {
      links.push(BlameText.buildLink('copy', 'Copy SHA', 'Copy the full commit SHA', 'copySha', target));
    }
    return links.join(' &nbsp;&nbsp; ');
  }

  // Highlighted code shows the lines before and after the commit as two blocks of the file's language; a plain diff
  // is one block with the -/+ lines.
  private static buildChange(change: string[], languageId: string | undefined): string {
    if (Settings.get<string>('hovers.changesStyle') === 'diff' || !languageId) {
      return BlameText.fence(change.join('\n'), 'diff');
    }

    const { before, after, truncated } = LineChange.split(change);
    const blocks: string[] = [];
    if (before.length > 0) {
      blocks.push(`${BlameText.color('− before', DELETED_COLOR)}\n\n${BlameText.fence(before.join('\n'), languageId)}`);
    }
    if (after.length > 0) {
      const label = before.length > 0 ? '+ after' : '+ added';
      blocks.push(`${BlameText.color(label, ADDED_COLOR)}\n\n${BlameText.fence(after.join('\n'), languageId)}`);
    }
    if (truncated) {
      blocks.push(BlameText.dim('More lines changed than the card shows.'));
    }
    return blocks.join('\n\n');
  }

  // Switches for the blame features right where the blame is read, so turning one off needs no trip to the settings.
  private static buildControls(): string {
    const toggle = (key: string, label: string) => {
      const isOn = Settings.get<boolean>(key);
      return `[$(${isOn ? 'pass-filled' : 'circle-large-outline'}) ${label}](${BlameText.buildCommandLink('dendro.blameCard', ['toggleSetting', { key }])} "${isOn ? 'Turn off' : 'Turn on'}")`;
    };
    const command = (icon: string, label: string, id: string, title: string) =>
      `[$(${icon}) ${label}](${BlameText.buildCommandLink(id, [])} "${title}")`;

    return [
      [toggle('inlineBlame.enabled', 'Line blame'), toggle('codeLens.enabled', 'CodeLens'), toggle('hovers.enabled', 'Hovers')].join(' &nbsp;&nbsp; '),
      [
        command('eye', 'File Blame', 'dendro.toggleFileBlame', 'Blame every line of this file'),
        command('flame', 'Heatmap', 'dendro.toggleFileHeatmap', 'Color the lines of this file by age'),
        command('settings-gear', 'Settings', 'dendro.showSettings', 'Open the Dendro settings'),
      ].join(' &nbsp;&nbsp; '),
    ].join('\n\n');
  }

  private static toTarget(info: LineBlameInfo): BlameCardTarget {
    return {
      root: info.root,
      sha: info.commit.sha,
      path: info.commit.uncommitted ? info.path : info.commit.path,
      line: info.line,
      originalLine: info.originalLine,
      previousSha: info.commit.previousSha,
      previousPath: info.commit.previousPath,
    };
  }

  private static buildLink(icon: string, label: string, title: string, action: BlameCardAction, target: BlameCardTarget): string {
    return `[$(${icon}) ${label}](${BlameText.buildCommandLink('dendro.blameCard', [action, target])} "${title}")`;
  }

  private static fence(code: string, language: string): string {
    const longest = Math.max(2, ...Array.from(code.matchAll(/`+/g), (match) => match[0].length));
    const ticks = '`'.repeat(longest + 1);
    return `${ticks}${language}\n${code}\n${ticks}`;
  }

  // Hovers allow only a color and a background color on a span, written exactly like this.
  private static color(text: string, color: string): string {
    return `<span style="color:${color};">${text}</span>`;
  }

  private static dim(text: string): string {
    return BlameText.color(BlameText.escapeHtml(text), DIM_COLOR);
  }

  private static escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // A hover should not wait long for a first download; the picture shows on the next hover once it is cached.
  private static async findPicture(blame: BlameService, info: LineBlameInfo): Promise<string | null> {
    if (!blame.avatars.enabled) {
      return null;
    }
    const known = blame.avatars.peek(info.commit.email);
    if (known !== undefined) {
      return known?.dataUri ?? null;
    }
    const image = await Promise.race([
      blame.avatars.request(info.commit.email, info.root, info.commit.sha),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 800)),
    ]);
    return image?.dataUri ?? null;
  }

  static buildCommandLink(command: string, args: unknown[]): string {
    return `command:${command}?${encodeURIComponent(JSON.stringify(args))}`;
  }

  private static escape(text: string): string {
    return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
  }
}
