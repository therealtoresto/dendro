import { RefInfo, WORKING_CHANGES_KEY } from '../src/protocol';
import type { ListRow } from './CommitList';

export type MarkerKind =
  | 'head'
  | 'localBranches'
  | 'remoteBranches'
  | 'tags'
  | 'workingTree'
  | 'selection'
  | 'searchResults';

export interface RowMarker {
  index: number;
  kind: MarkerKind;
}

export const MARKER_COLORS: Record<MarkerKind, string> = {
  head: '#22c55e',
  localBranches: '#3b82f6',
  remoteBranches: '#a855f7',
  tags: '#eab308',
  workingTree: '#f97316',
  selection: '#e5e7eb',
  searchResults: '#facc15',
};

export interface MarkerSource {
  rows: ListRow[];
  refsByHash: Map<string, RefInfo[]>;
  headHash: string | null;
  selectedKey: string | null;
  compareKey: string | null;
  matches: Set<string> | null;
}

export class Markers {
  static collect(source: MarkerSource, kinds: Set<string>): RowMarker[] {
    const markers: RowMarker[] = [];

    source.rows.forEach((row, index) => {
      if (row.key === WORKING_CHANGES_KEY) {
        if (kinds.has('workingTree')) {
          markers.push({ index, kind: 'workingTree' });
        }
        return;
      }

      if (kinds.has('searchResults') && source.matches?.has(row.key)) {
        markers.push({ index, kind: 'searchResults' });
      }
      if (kinds.has('head') && row.key === source.headHash) {
        markers.push({ index, kind: 'head' });
      }

      const refs = source.refsByHash.get(row.key);
      if (refs) {
        if (kinds.has('localBranches') && refs.some((ref) => ref.kind === 'head')) {
          markers.push({ index, kind: 'localBranches' });
        }
        if (kinds.has('remoteBranches') && refs.some((ref) => ref.kind === 'remote')) {
          markers.push({ index, kind: 'remoteBranches' });
        }
        if (kinds.has('tags') && refs.some((ref) => ref.kind === 'tag')) {
          markers.push({ index, kind: 'tags' });
        }
      }

      if (kinds.has('selection') && (row.key === source.selectedKey || row.key === source.compareKey)) {
        markers.push({ index, kind: 'selection' });
      }
    });

    return markers;
  }
}
