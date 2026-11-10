import type { WorkingSummary } from '../src/protocol';

const KINDS: { key: 'added' | 'modified' | 'deleted' | 'conflicted'; symbol: string; label: string }[] = [
  { key: 'added', symbol: '+', label: 'added' },
  { key: 'modified', symbol: '~', label: 'modified' },
  { key: 'deleted', symbol: '−', label: 'deleted' },
  { key: 'conflicted', symbol: '!', label: 'in conflict' },
];

// "+2 ~3 −1" for the uncommitted files; kinds with no files are left out.
export class WorkingCounters {
  static render(summary: WorkingSummary, withStaged: boolean): string {
    let html = '';
    for (const kind of KINDS) {
      const count = summary[kind.key];
      if (count === 0) {
        continue;
      }
      const title = `${count} ${count === 1 ? 'file' : 'files'} ${kind.label}`;
      html += `<span class="wip-count wip-${kind.key}" title="${title}">${kind.symbol}${count}</span>`;
    }
    if (withStaged && summary.staged > 0) {
      html += `<span class="wip-count wip-staged" title="${summary.staged} staged for the next commit">${summary.staged} staged</span>`;
    }
    return `<span class="wip-counters">${html}</span>`;
  }
}
