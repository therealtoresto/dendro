import * as vscode from 'vscode';
import { BlameCommit, BlameResult } from '../blame/BlameParser';
import type { AvatarService } from '../AvatarService';
import type { BlameService } from '../blame/BlameService';
import { BlameText } from '../blame/BlameText';
import { HeatmapScale, LineHeat } from '../blame/HeatmapScale';
import { Settings } from '../Settings';
import { AvatarStyle } from '../shared/AvatarStyle';
import type { DateFormatter } from '../shared/DateFormatter';

export type AnnotationKind = 'blame' | 'heatmap' | 'changes';

const TOGGLE_MODE_KEYS: Record<AnnotationKind, string> = {
  blame: 'blame.toggleMode',
  heatmap: 'heatmap.toggleMode',
  changes: 'changes.toggleMode',
};

const MAX_BLAME_WIDTH = 60;
const UNCOMMITTED_COLOR = '#e2c08d';
const UNPUSHED_COLOR = '#3794ff';
const HIGHLIGHT_COLOR = '#3794ff';

// Whole-file annotations, toggled per file or for the whole window: blame text in the gutter, a heatmap of how
// recently lines changed, or the lines not pushed yet. A file shows one kind at a time.
export class FileAnnotations implements vscode.Disposable {
  private readonly perFile = new Map<string, AnnotationKind>();
  private windowKind: AnnotationKind | null = null;
  private readonly types = new Map<string, vscode.TextEditorDecorationType>();
  private readonly usedTypes = new Map<vscode.TextEditor, Set<string>>();
  private readonly avatarIcons = new Map<string, vscode.Uri>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly disposables: vscode.Disposable[] = [];

  private pictureRefreshTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly blame: BlameService,
    private readonly avatars: AvatarService,
  ) {
    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors(() => this.refreshVisible()),
      vscode.window.onDidChangeActiveTextEditor(() => this.updateContext()),
      vscode.window.onDidChangeTextEditorSelection((event) => void this.highlightCommitLines(event.textEditor)),
      vscode.workspace.onDidChangeTextDocument((event) => this.onDocumentChanged(event.document)),
      vscode.workspace.onDidSaveTextDocument((document) => this.refreshDocument(document, 0)),
      vscode.workspace.onDidCloseTextDocument((document) => this.perFile.delete(document.uri.toString())),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('dendro')) {
          this.disposeTypes();
          this.refreshVisible();
        }
      }),
      blame.onDidChange(() => this.refreshVisible()),
      avatars.onDidResolve(() => this.schedulePictureRefresh()),
    );
  }

  // Pictures arrive one by one; blame annotations are redrawn once they stop coming.
  private schedulePictureRefresh(): void {
    clearTimeout(this.pictureRefreshTimer);
    this.pictureRefreshTimer = setTimeout(() => {
      for (const editor of vscode.window.visibleTextEditors) {
        if (this.getKind(editor.document) === 'blame' && Settings.get<boolean>('blame.avatars')) {
          void this.refresh(editor);
        }
      }
    }, 300);
  }

  dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    clearTimeout(this.pictureRefreshTimer);
    this.disposeTypes();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  getKind(document: vscode.TextDocument): AnnotationKind | null {
    return this.perFile.get(document.uri.toString()) ?? this.windowKind;
  }

  async toggle(kind: AnnotationKind, editor = vscode.window.activeTextEditor): Promise<void> {
    if (!editor) {
      return;
    }
    if (!this.blame.findRoot(editor.document.uri)) {
      void vscode.window.showInformationMessage('Dendro: this file is not in a git repository.');
      return;
    }

    const key = editor.document.uri.toString();
    if (Settings.get<string>(TOGGLE_MODE_KEYS[kind]) === 'window') {
      this.windowKind = this.windowKind === kind ? null : kind;
      this.perFile.clear();
      this.refreshVisible();
    } else {
      if (this.getKind(editor.document) === kind) {
        this.perFile.delete(key);
        if (this.windowKind === kind) {
          this.windowKind = null;
        }
      } else {
        this.perFile.set(key, kind);
      }
      await this.refresh(editor);
    }
    this.updateContext();
  }

  clearAll(): void {
    this.perFile.clear();
    this.windowKind = null;
    this.refreshVisible();
    this.updateContext();
  }

  private updateContext(): void {
    const document = vscode.window.activeTextEditor?.document;
    void vscode.commands.executeCommand('setContext', 'dendro.annotations', document ? this.getKind(document) ?? '' : '');
  }

  private refreshVisible(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      void this.refresh(editor);
    }
  }

  private refreshDocument(document: vscode.TextDocument, delay: number): void {
    const key = document.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(() => {
        for (const editor of vscode.window.visibleTextEditors) {
          if (editor.document === document) {
            void this.refresh(editor);
          }
        }
      }, delay),
    );
  }

  // Annotations of an edited file would point at the wrong lines, so they go away until blame catches up.
  private onDocumentChanged(document: vscode.TextDocument): void {
    if (!this.getKind(document)) {
      return;
    }
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document === document) {
        this.clearEditor(editor);
      }
    }
    this.refreshDocument(document, Settings.get<number>('blame.dirtyDelayMs'));
  }

  private clearEditor(editor: vscode.TextEditor): void {
    for (const typeKey of this.usedTypes.get(editor) ?? []) {
      const type = this.types.get(typeKey);
      if (type) {
        editor.setDecorations(type, []);
      }
    }
    this.usedTypes.delete(editor);
  }

  private async refresh(editor: vscode.TextEditor): Promise<void> {
    this.clearEditor(editor);
    const kind = this.getKind(editor.document);
    if (!kind) {
      return;
    }

    const blame = await this.blame.getBlame(editor.document);
    const root = this.blame.findRoot(editor.document.uri);
    if (!blame || !root || this.getKind(editor.document) !== kind) {
      return;
    }

    const dates = BlameText.createDateFormatter();
    const userEmail = await this.blame.getUserEmail(root);
    const context: AnnotationContext = { editor, blame, root, dates, userEmail };

    if (kind === 'blame') {
      this.applyBlame(context);
      await this.highlightCommitLines(editor);
    } else if (kind === 'heatmap') {
      this.applyHeatmap(context);
    } else {
      await this.applyChanges(context);
    }
  }

  private applyBlame(context: AnnotationContext): void {
    const { editor, blame } = context;
    const format = Settings.get<string>('blame.format');
    const compact = Settings.get<boolean>('blame.compact');
    const showAvatars = Settings.get<boolean>('blame.avatars');
    const heat = Settings.get<boolean>('blame.heatmap') ? this.computeHeat(blame) : null;
    const heatSide = Settings.get<string>('blame.heatmapPosition');

    const texts = blame.lines.map((line) =>
      line ? BlameText.format(format, blame.commits.get(line.sha)!, context.userEmail, context.dates) : '',
    );
    const width = Math.min(MAX_BLAME_WIDTH, Math.max(...texts.map((text) => text.length), 10) + 1);

    const textOptions: vscode.DecorationOptions[] = [];
    const avatarOptions: vscode.DecorationOptions[] = [];
    const hoverOnAnnotation = FileAnnotations.wantsAnnotationHover();

    blame.lines.forEach((line, index) => {
      if (!line || index >= editor.document.lineCount) {
        return;
      }
      const commit = blame.commits.get(line.sha)!;
      const repeatsAbove = compact && index > 0 && blame.lines[index - 1]?.sha === line.sha;
      const range = new vscode.Range(index, 0, index, 0);

      const before: vscode.ThemableDecorationAttachmentRenderOptions = {
        contentText: repeatsAbove ? ' ' : texts[index].replace(/ /g, ' '),
        width: `${width}ch`,
      };
      if (heat) {
        const color = FileAnnotations.getHeatColor(heat[index]);
        // The border is the only per-line style a gutter attachment takes, so the heat bar is drawn as one.
        before.border = `0 solid transparent; border-${heatSide}: 2px solid ${color}`;
      }

      const option: vscode.DecorationOptions = { range, renderOptions: { before } };
      if (hoverOnAnnotation && !repeatsAbove) {
        option.hoverMessage = FileAnnotations.buildQuickHover(commit, context);
      }
      textOptions.push(option);

      if (showAvatars) {
        avatarOptions.push({
          range,
          renderOptions: {
            before: repeatsAbove
              ? { contentText: ' ', width: '16px' }
              : { contentIconPath: this.getAvatarIcon(commit, context.root), width: '16px', height: '16px' },
          },
        });
      }
    });

    if (showAvatars) {
      this.setDecorations(editor, 'blame-avatar', avatarOptions, () => ({
        before: { margin: '0 4px 0 0', textDecoration: 'none; border-radius: 50%; vertical-align: middle' },
      }));
    }
    this.setDecorations(editor, 'blame-text', textOptions, () => ({
      before: {
        color: new vscode.ThemeColor('editorLineNumber.foreground'),
        backgroundColor: new vscode.ThemeColor('editorGutter.background'),
        margin: '0 1.5em 0 0',
        textDecoration: 'none; display: inline-block; overflow: hidden; white-space: pre; vertical-align: top',
      },
    }));
  }

  private applyHeatmap(context: AnnotationContext): void {
    const { editor, blame } = context;
    const heat = this.computeHeat(blame);
    const groups = new Map<string, vscode.DecorationOptions[]>();
    const hoverOnAnnotation = FileAnnotations.wantsAnnotationHover();

    heat.forEach((lineHeat, index) => {
      if (!blame.lines[index] || index >= editor.document.lineCount) {
        return;
      }
      const key = `heat-${lineHeat.hot ? 'hot' : 'cold'}-${lineHeat.level}`;
      const option: vscode.DecorationOptions = { range: editor.document.lineAt(index).range };
      if (hoverOnAnnotation) {
        option.hoverMessage = FileAnnotations.buildQuickHover(blame.commits.get(blame.lines[index].sha)!, context);
      }
      const group = groups.get(key) ?? [];
      group.push(option);
      groups.set(key, group);
    });

    for (const [key, options] of groups) {
      const [, side, level] = key.split('-');
      this.setDecorations(editor, key, options, () =>
        FileAnnotations.buildHeatOptions({ hot: side === 'hot', level: Number(level) }),
      );
    }
  }

  private async applyChanges(context: AnnotationContext): Promise<void> {
    const { editor, blame, root } = context;
    const unpushed = await this.blame.getUnpushedShas(root);
    const uncommittedLines: vscode.DecorationOptions[] = [];
    let unpushedLines: vscode.DecorationOptions[] = [];
    const hoverOnAnnotation = FileAnnotations.wantsAnnotationHover();

    const toOption = (index: number, commit: BlameCommit): vscode.DecorationOptions => ({
      range: editor.document.lineAt(index).range,
      hoverMessage: hoverOnAnnotation ? FileAnnotations.buildQuickHover(commit, context) : undefined,
    });

    blame.lines.forEach((line, index) => {
      if (!line || index >= editor.document.lineCount) {
        return;
      }
      const commit = blame.commits.get(line.sha)!;
      if (commit.uncommitted) {
        uncommittedLines.push(toOption(index, commit));
      } else if (unpushed.has(commit.sha)) {
        unpushedLines.push(toOption(index, commit));
      }
    });

    // Nothing local: show what the most recent commit to this file changed instead.
    if (uncommittedLines.length === 0 && unpushedLines.length === 0) {
      const latest = Array.from(blame.commits.values()).sort((left, right) => right.committerTime - left.committerTime)[0];
      if (latest) {
        unpushedLines = [];
        blame.lines.forEach((line, index) => {
          if (line?.sha === latest.sha && index < editor.document.lineCount) {
            unpushedLines.push(toOption(index, latest));
          }
        });
      }
    }

    const locations = new Set(Settings.get<string[]>('changes.locations'));
    this.setDecorations(editor, 'changes-uncommitted', uncommittedLines, () =>
      FileAnnotations.buildMarkOptions(UNCOMMITTED_COLOR, 1, locations),
    );
    this.setDecorations(editor, 'changes-unpushed', unpushedLines, () =>
      FileAnnotations.buildMarkOptions(UNPUSHED_COLOR, 1, locations),
    );
  }

  private async highlightCommitLines(editor: vscode.TextEditor): Promise<void> {
    if (this.getKind(editor.document) !== 'blame') {
      return;
    }
    const enabled = Settings.get<boolean>('blame.highlight.enabled');
    const blame = enabled ? await this.blame.getBlame(editor.document) : null;
    const sha = blame?.lines[editor.selection.active.line]?.sha;

    const lines: vscode.DecorationOptions[] = [];
    if (blame && sha) {
      blame.lines.forEach((line, index) => {
        if (line?.sha === sha && index < editor.document.lineCount) {
          lines.push({ range: new vscode.Range(index, 0, index, 0) });
        }
      });
    }

    const locations = new Set(Settings.get<string[]>('blame.highlight.locations'));
    this.setDecorations(editor, 'blame-highlight', lines, () =>
      FileAnnotations.buildMarkOptions(HIGHLIGHT_COLOR, 0.6, locations),
    );
  }

  private computeHeat(blame: BlameResult): LineHeat[] {
    const now = Date.now() / 1000;
    const times = blame.lines.map((line) => {
      const commit = line ? blame.commits.get(line.sha) : undefined;
      return commit && !commit.uncommitted ? BlameText.getCommitTime(commit) : now;
    });
    return HeatmapScale.compute(times, now, Settings.get<number>('heatmap.coldThresholdDays'));
  }

  private setDecorations(
    editor: vscode.TextEditor,
    typeKey: string,
    options: vscode.DecorationOptions[],
    createOptions: () => vscode.DecorationRenderOptions,
  ): void {
    let type = this.types.get(typeKey);
    if (!type) {
      type = vscode.window.createTextEditorDecorationType(createOptions());
      this.types.set(typeKey, type);
    }
    editor.setDecorations(type, options);

    const used = this.usedTypes.get(editor) ?? new Set<string>();
    used.add(typeKey);
    this.usedTypes.set(editor, used);
  }

  private disposeTypes(): void {
    for (const type of this.types.values()) {
      type.dispose();
    }
    this.types.clear();
    this.usedTypes.clear();
  }

  private getAvatarIcon(commit: BlameCommit, root: string): vscode.Uri {
    if (!commit.uncommitted && this.avatars.enabled) {
      const picture = this.avatars.peek(commit.email);
      if (picture) {
        return picture.file;
      }
      if (picture === undefined) {
        void this.avatars.request(commit.email, root, commit.sha);
      }
    }

    const key = commit.uncommitted ? 'you' : commit.email;
    let icon = this.avatarIcons.get(key);
    if (!icon) {
      icon = FileAnnotations.toSvgUri(
        commit.uncommitted
          ? `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="8" fill="#6b7280"/>` +
              `<text x="8" y="11" font-size="7" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="#fff">+</text></svg>`
          : AvatarStyle.renderArt(commit.email, true).replace('<svg ', '<svg width="16" height="16" '),
      );
      this.avatarIcons.set(key, icon);
    }
    return icon;
  }

  private static wantsAnnotationHover(): boolean {
    return (
      Settings.get<boolean>('hovers.enabled') &&
      Settings.get<boolean>('hovers.annotations.enabled') &&
      Settings.get<string>('hovers.annotations.over') === 'annotation'
    );
  }

  // Annotations cover many lines at once, so their hovers use what blame already knows (no extra git calls).
  private static buildQuickHover(commit: BlameCommit, context: AnnotationContext): vscode.MarkdownString {
    const values = BlameText.buildValues(commit, context.userEmail, context.dates);
    const markdown = new vscode.MarkdownString('', true);
    markdown.isTrusted = true;
    markdown.appendMarkdown(`$(account) **${values.author}**, ${values.ago} _(${values.date})_\n\n`);
    markdown.appendText(values.message);
    if (!commit.uncommitted) {
      const show = BlameText.buildCommandLink('dendro.showCommit', [commit.sha, context.root]);
      markdown.appendMarkdown(`\n\n[$(git-commit) ${values.sha}](${show} "Show in the Commit Graph")`);
    }
    return markdown;
  }

  private static getHeatColor(heat: LineHeat): string {
    const color = Settings.get<string>(heat.hot ? 'heatmap.hotColor' : 'heatmap.coldColor');
    return FileAnnotations.toRgba(color, HeatmapScale.getOpacity(heat.level));
  }

  private static buildHeatOptions(heat: LineHeat): vscode.DecorationRenderOptions {
    const locations = new Set(Settings.get<string[]>('heatmap.locations'));
    const color = Settings.get<string>(heat.hot ? 'heatmap.hotColor' : 'heatmap.coldColor');
    const strength = HeatmapScale.getOpacity(heat.level);
    const options = FileAnnotations.buildMarkOptions(color, strength, locations);

    if (Settings.get<boolean>('heatmap.fadeLines') && !heat.hot) {
      options.opacity = (0.55 + 0.35 * strength).toFixed(2);
    }
    return options;
  }

  private static buildMarkOptions(color: string, strength: number, locations: Set<string>): vscode.DecorationRenderOptions {
    const options: vscode.DecorationRenderOptions = {};
    if (locations.has('gutter')) {
      options.gutterIconPath = FileAnnotations.toSvgUri(
        `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><rect x="11" y="0" width="3" height="18" fill="${FileAnnotations.toRgba(color, strength)}"/></svg>`,
      );
      options.gutterIconSize = 'contain';
    }
    if (locations.has('line')) {
      options.backgroundColor = FileAnnotations.toRgba(color, 0.14 * strength);
      options.isWholeLine = true;
    }
    if (locations.has('overview')) {
      options.overviewRulerColor = FileAnnotations.toRgba(color, Math.max(0.35, strength));
      options.overviewRulerLane = vscode.OverviewRulerLane.Center;
    }
    return options;
  }

  private static toRgba(hex: string, alpha: number): string {
    const value = parseInt(hex.slice(1), 16);
    return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha.toFixed(2)})`;
  }

  private static toSvgUri(svg: string): vscode.Uri {
    return vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
  }
}

interface AnnotationContext {
  editor: vscode.TextEditor;
  blame: BlameResult;
  root: string;
  dates: DateFormatter;
  userEmail: string | null;
}
