import * as vscode from 'vscode';
import { Settings } from '../Settings';
import { DateFormatter } from '../shared/DateFormatter';
import { TokenTemplate } from '../shared/TokenTemplate';
import type { BlameCommit } from './BlameParser';
import type { BlameService, LineBlameInfo } from './BlameService';

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

  // The hover card: who, when, the full message, links, and (when asked) the lines this commit changed here.
  static async buildHover(blame: BlameService, info: LineBlameInfo, withChanges: boolean): Promise<vscode.MarkdownString> {
    const { commit } = info;
    const dates = BlameText.createDateFormatter();
    const userEmail = await blame.getUserEmail(info.root);
    const values = BlameText.buildValues(commit, userEmail, dates);
    const markdown = new vscode.MarkdownString('', true);
    markdown.isTrusted = true;

    const showDetails = Settings.get<boolean>('hovers.details');
    if (showDetails) {
      const author = commit.uncommitted ? 'You' : `[${BlameText.escape(values.author)}](mailto:${commit.email})`;
      const picture = commit.uncommitted ? null : await BlameText.findPicture(blame, info);
      const icon = picture ? `![](${picture}|width=18,height=18)` : '$(account)';
      markdown.appendMarkdown(`${icon} **${author}**, ${values.ago} _(${BlameText.escape(values.date)})_\n\n`);

      const message = commit.uncommitted ? 'Uncommitted changes' : await blame.getFullMessage(info.root, commit.sha);
      markdown.appendMarkdown(`${BlameText.escape(message).replace(/\n/g, '  \n')}\n\n`);

      if (!commit.uncommitted) {
        const links = [
          `[$(git-commit) ${values.sha}](${BlameText.buildCommandLink('dendro.showCommit', [commit.sha, info.root])} "Show in the Commit Graph")`,
          `[$(diff) Open Changes](${BlameText.buildCommandLink('dendro.openLineChanges', [info.root, commit.sha, info.path])} "Open the changes of this commit to the file")`,
          `[$(copy) Copy SHA](${BlameText.buildCommandLink('dendro.copyText', [commit.sha])} "Copy the commit SHA")`,
        ];
        markdown.appendMarkdown(links.join('&nbsp;&nbsp;|&nbsp;&nbsp;') + '\n\n');
      }
    }

    if (withChanges && Settings.get<boolean>('hovers.changes')) {
      const change = await blame.getLineChange(info);
      if (change && change.length > 0) {
        if (showDetails) {
          markdown.appendMarkdown('---\n\n');
        }
        markdown.appendCodeblock(change.join('\n'), 'diff');
      }
    }

    return markdown;
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
