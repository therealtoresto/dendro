import * as vscode from 'vscode';
import type { BlameService } from '../blame/BlameService';
import { BlameText } from '../blame/BlameText';
import { Settings } from '../Settings';
import type { FileAnnotations } from './FileAnnotations';

// Hovers anywhere on a line: the current line when "Shown when over the: line & annotation" is set for it, and every
// line of an annotated file when the same is set for annotations. "Annotation only" hovers ride on the decorations.
export class BlameHovers implements vscode.HoverProvider {
  constructor(
    private readonly blame: BlameService,
    private readonly annotations: FileAnnotations,
  ) {}

  async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | null> {
    if (!Settings.get<boolean>('hovers.enabled') || !this.isWanted(document, position.line)) {
      return null;
    }

    const info = await this.blame.getLineInfo(document, position.line);
    if (!info) {
      return null;
    }
    const markdown = await BlameText.buildHover(this.blame, info, { changes: true, languageId: document.languageId });
    return new vscode.Hover(markdown, document.lineAt(position.line).range);
  }

  private isWanted(document: vscode.TextDocument, line: number): boolean {
    if (this.annotations.getKind(document)) {
      return (
        Settings.get<boolean>('hovers.annotations.enabled') && Settings.get<string>('hovers.annotations.over') === 'line'
      );
    }

    const editor = vscode.window.activeTextEditor;
    const isCurrentLine = editor?.document === document && editor.selection.active.line === line;
    return (
      isCurrentLine &&
      Settings.get<boolean>('hovers.currentLine.enabled') &&
      Settings.get<string>('hovers.currentLine.over') === 'line'
    );
  }
}
