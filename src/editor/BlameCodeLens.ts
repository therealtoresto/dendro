import * as vscode from 'vscode';
import type { BlameService } from '../blame/BlameService';
import { BlameSummary } from '../blame/BlameSummary';
import { BlameText } from '../blame/BlameText';
import { Settings } from '../Settings';

type LensKind = 'latest' | 'authors';

class BlameLens extends vscode.CodeLens {
  constructor(
    range: vscode.Range,
    readonly document: vscode.TextDocument,
    readonly startLine: number,
    readonly endLine: number,
    readonly kind: LensKind,
  ) {
    super(range);
  }
}

const CONTAINER_KINDS = new Set([
  vscode.SymbolKind.Class,
  vscode.SymbolKind.Interface,
  vscode.SymbolKind.Module,
  vscode.SymbolKind.Namespace,
  vscode.SymbolKind.Package,
  vscode.SymbolKind.Enum,
  vscode.SymbolKind.Struct,
]);
const BLOCK_KINDS = new Set([vscode.SymbolKind.Function, vscode.SymbolKind.Method, vscode.SymbolKind.Constructor]);
const MAX_SYMBOL_DEPTH = 3;

interface Span {
  anchor: vscode.Range;
  startLine: number;
  endLine: number;
}

// Above the file, its classes and its functions: who changed that block last and when, and how many people wrote it.
export class BlameCodeLens implements vscode.CodeLensProvider<BlameLens>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];

  readonly onDidChangeCodeLenses = this.changeEmitter.event;

  constructor(private readonly blame: BlameService) {
    this.disposables.push(
      blame.onDidChange(() => this.changeEmitter.fire()),
      vscode.workspace.onDidSaveTextDocument(() => this.changeEmitter.fire()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('dendro.codeLens') || event.affectsConfiguration('dendro.dates')) {
          this.changeEmitter.fire();
        }
      }),
    );
  }

  dispose(): void {
    this.changeEmitter.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  async provideCodeLenses(document: vscode.TextDocument): Promise<BlameLens[]> {
    if (!Settings.get<boolean>('codeLens.enabled') || !this.blame.findBlameRoot(document.uri)) {
      return [];
    }
    // A file git does not know yet (or cannot blame) gets no lenses rather than empty ones.
    if (!(await this.blame.getBlame(document))) {
      return [];
    }

    const kinds: LensKind[] = [];
    if (Settings.get<boolean>('codeLens.recentChange')) {
      kinds.push('latest');
    }
    if (Settings.get<boolean>('codeLens.authors')) {
      kinds.push('authors');
    }

    const lenses: BlameLens[] = [];
    for (const span of await this.findSpans(document)) {
      for (const kind of kinds) {
        lenses.push(new BlameLens(span.anchor, document, span.startLine, span.endLine, kind));
      }
    }
    return lenses;
  }

  async resolveCodeLens(lens: BlameLens): Promise<BlameLens> {
    const blame = await this.blame.getBlame(lens.document);
    const root = this.blame.findBlameRoot(lens.document.uri);
    if (!blame || !root) {
      lens.command = { title: '', command: '' };
      return lens;
    }

    const userEmail = await this.blame.getUserEmail(root);
    const summary = BlameSummary.summarize(blame, lens.startLine, lens.endLine, userEmail);
    const historyCommand = {
      title: '',
      command: 'dendro.showLineHistory',
      arguments: [lens.document.uri, lens.startLine + 1, lens.endLine + 1],
    };

    if (lens.kind === 'latest') {
      const latest = summary.latest;
      if (!latest) {
        lens.command = { ...historyCommand, title: '' };
      } else if (latest.uncommitted) {
        lens.command = { ...historyCommand, title: '$(edit) You, uncommitted changes', tooltip: 'Show the history of these lines' };
      } else {
        const values = BlameText.buildValues(latest, userEmail, BlameText.createDateFormatter());
        lens.command = {
          title: `$(history) ${values.author}, ${values.agoOrDate}`,
          tooltip: `${latest.summary}\n\nShow ${latest.sha.slice(0, 7)} in the Commit Graph`,
          command: 'dendro.showCommit',
          arguments: [latest.sha, root],
        };
      }
      return lens;
    }

    const names = summary.authors.map((author) => (userEmail !== null && author.email === userEmail ? 'You' : author.name));
    const count = names.length;
    let title = `${count} authors (${names[0]} and ${count - 1} other${count - 1 === 1 ? '' : 's'})`;
    if (count === 1) {
      title = `1 author (${names[0]})`;
    }
    const tooltip = summary.authors
      .map((author, index) => `${names[index]}: ${author.lines} line${author.lines === 1 ? '' : 's'}`)
      .join('\n');
    lens.command = { ...historyCommand, title: `$(person) ${title}`, tooltip: `${tooltip}\n\nShow the history of these lines` };
    return lens;
  }

  private async findSpans(document: vscode.TextDocument): Promise<Span[]> {
    const scopes = new Set(Settings.get<string[]>('codeLens.scopes'));
    const spans: Span[] = [];

    if (scopes.has('file') && document.lineCount > 0) {
      spans.push({ anchor: new vscode.Range(0, 0, 0, 0), startLine: 0, endLine: document.lineCount - 1 });
    }
    if (!scopes.has('containers') && !scopes.has('blocks')) {
      return spans;
    }

    const symbols = await vscode.commands
      .executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>('vscode.executeDocumentSymbolProvider', document.uri)
      .then(
        (found) => found ?? [],
        () => [],
      );

    const visit = (symbol: vscode.DocumentSymbol | vscode.SymbolInformation, depth: number) => {
      const range = 'range' in symbol ? symbol.range : symbol.location.range;
      const isContainer = CONTAINER_KINDS.has(symbol.kind);
      const wanted = (isContainer && scopes.has('containers')) || (BLOCK_KINDS.has(symbol.kind) && scopes.has('blocks'));

      // A file-level lens already sits on line 0; a one-line symbol is not worth a lens of its own.
      if (wanted && range.end.line > range.start.line && !(range.start.line === 0 && scopes.has('file'))) {
        spans.push({ anchor: new vscode.Range(range.start, range.start), startLine: range.start.line, endLine: range.end.line });
      }
      if ('children' in symbol && depth < MAX_SYMBOL_DEPTH && (isContainer || depth === 0)) {
        for (const child of symbol.children) {
          visit(child, depth + 1);
        }
      }
    };
    for (const symbol of symbols) {
      visit(symbol, 0);
    }

    return spans;
  }
}
