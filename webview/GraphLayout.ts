export interface LayoutInput {
  hash: string;
  parents: string[];
  dashed?: boolean;
}

// A line inside one row: the top half runs from the row's top edge to the node's centre line,
// the bottom half from the centre line to the bottom edge.
export interface Segment {
  half: 'top' | 'bottom';
  fromLane: number;
  toLane: number;
  color: number;
  dashed: boolean;
}

export interface RowLayout {
  lane: number;
  color: number;
  segments: Segment[];
  laneCount: number;
}

export interface GraphLayoutResult {
  rows: RowLayout[];
  maxLanes: number;
}

interface LaneSlot {
  waitsFor: string;
  color: number;
  dashed: boolean;
  hidden?: boolean;
}

export class GraphLayout {
  // Every lane waits for one commit hash. A commit takes the first lane waiting for it (others waiting for it
  // merge into it), its first parent continues that lane, and each further parent joins the lane already waiting
  // for it or opens a free one.
  //
  // `keepFirstLaneFor` holds the first lane for that commit (HEAD) from the top of the list, drawing nothing until
  // the commit's row: newer commits (not pulled yet, other branches) then branch off to the right of it instead of
  // taking its place.
  static compute(inputs: LayoutInput[], keepFirstLaneFor?: string): GraphLayoutResult {
    const lanes: (LaneSlot | null)[] = [];
    const rows: RowLayout[] = [];
    const freedAt: number[] = [];
    let nextColor = 0;
    let maxLanes = 0;

    if (keepFirstLaneFor) {
      lanes[0] = { waitsFor: keepFirstLaneFor, color: nextColor++, dashed: false, hidden: true };
    }

    inputs.forEach((input, row) => {
      const segments: Segment[] = [];
      const waiting = GraphLayout.findLanesWaitingFor(lanes, input.hash);

      let lane: number;
      if (waiting.length > 0) {
        lane = waiting[0];
      } else {
        lane = GraphLayout.findFreeLane(lanes, -1, freedAt, row);
        lanes[lane] = { waitsFor: input.hash, color: nextColor++, dashed: false };
      }
      const nodeColor = lanes[lane]!.color;

      for (let index = 0; index < lanes.length; index++) {
        const slot = lanes[index];
        if (!slot || slot.hidden || (index === lane && waiting.length === 0)) {
          continue;
        }
        const toLane = slot.waitsFor === input.hash ? lane : index;
        segments.push({ half: 'top', fromLane: index, toLane, color: slot.color, dashed: slot.dashed });
      }
      const topLaneCount = lanes.length;

      for (const index of waiting) {
        if (index !== lane) {
          lanes[index] = null;
          freedAt[index] = row;
        }
      }

      const [firstParent, ...otherParents] = input.parents;
      if (!firstParent) {
        freedAt[lane] = row;
      }
      lanes[lane] = firstParent
        ? { waitsFor: firstParent, color: nodeColor, dashed: Boolean(input.dashed) }
        : null;

      const mergeLanes = new Set<number>();
      for (const parent of otherParents) {
        const existing = lanes.findIndex((slot, index) => index !== lane && slot?.waitsFor === parent);
        if (existing >= 0) {
          mergeLanes.add(existing);
          continue;
        }
        const freeLane = GraphLayout.findFreeLane(lanes, lane, freedAt, row);
        lanes[freeLane] = { waitsFor: parent, color: nextColor++, dashed: false };
        mergeLanes.add(freeLane);
      }

      for (let index = 0; index < lanes.length; index++) {
        const slot = lanes[index];
        if (!slot) {
          continue;
        }
        if (index === lane) {
          segments.push({ half: 'bottom', fromLane: lane, toLane: lane, color: slot.color, dashed: slot.dashed });
          continue;
        }
        if (mergeLanes.has(index)) {
          segments.push({ half: 'bottom', fromLane: lane, toLane: index, color: slot.color, dashed: false });
        }
        if (GraphLayout.continuesFromAbove(segments, index)) {
          segments.push({ half: 'bottom', fromLane: index, toLane: index, color: slot.color, dashed: slot.dashed });
        }
      }

      while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
        lanes.pop();
      }

      const laneCount = Math.max(topLaneCount, lanes.length, lane + 1);
      maxLanes = Math.max(maxLanes, laneCount);
      rows.push({ lane, color: nodeColor, segments, laneCount });
    });

    return { rows, maxLanes };
  }

  private static findLanesWaitingFor(lanes: (LaneSlot | null)[], hash: string): number[] {
    const found: number[] = [];
    for (let index = 0; index < lanes.length; index++) {
      if (lanes[index]?.waitsFor === hash) {
        found.push(index);
      }
    }
    return found;
  }

  // A lane that ended in this row or the row above is not handed to a new line yet: right under the end of one
  // branch, a new one in the same column would read as its continuation.
  private static findFreeLane(lanes: (LaneSlot | null)[], taken: number, freedAt: number[], row: number): number {
    const isResting = (index: number) => freedAt[index] !== undefined && freedAt[index] >= row - 1;
    for (let index = 0; index < lanes.length; index++) {
      if (lanes[index] === null && index !== taken && !isResting(index)) {
        return index;
      }
    }

    let index = lanes.length;
    while (index === taken || isResting(index)) {
      index++;
    }
    while (lanes.length < index) {
      lanes.push(null);
    }
    return index;
  }

  // A lane that passed straight through the top half keeps going; a lane opened in this row for a merge parent
  // starts at the node instead.
  private static continuesFromAbove(segments: Segment[], lane: number): boolean {
    return segments.some((segment) => segment.half === 'top' && segment.fromLane === lane && segment.toLane === lane);
  }
}
