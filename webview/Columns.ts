export type ColumnId = 'refs' | 'graph' | 'message' | 'author' | 'changes' | 'date' | 'sha';

interface ColumnSpec {
  id: ColumnId;
  title: string;
  defaultWidth: number;
  minWidth: number;
  side: 'left' | 'flex' | 'right';
}

export const COLUMN_SPECS: ColumnSpec[] = [
  { id: 'refs', title: 'Branch / Tag', defaultWidth: 170, minWidth: 40, side: 'left' },
  { id: 'graph', title: 'Graph', defaultWidth: 0, minWidth: 32, side: 'left' },
  { id: 'message', title: 'Commit message', defaultWidth: 0, minWidth: 120, side: 'flex' },
  { id: 'author', title: 'Author', defaultWidth: 66, minWidth: 30, side: 'right' },
  { id: 'changes', title: 'Changes', defaultWidth: 100, minWidth: 44, side: 'right' },
  { id: 'date', title: 'Date', defaultWidth: 60, minWidth: 36, side: 'right' },
  { id: 'sha', title: 'SHA', defaultWidth: 72, minWidth: 44, side: 'right' },
];

const MAX_COLUMN_WIDTH = 800;

export type ColumnWidths = Partial<Record<ColumnId, number>>;

interface ReorderHandlers {
  // The column dropped, and the column it now stands before (null: at the end).
  onMove(id: ColumnId, before: ColumnId | null): void;
}

// The pointer must travel this far before a press on a header becomes a drag, so a click stays a click.
const DRAG_THRESHOLD = 5;

interface ResizeHandlers {
  onResize(id: ColumnId, width: number): void;
  onReset(id: ColumnId): void;
}

// Every column but the message has a width of its own; the message takes the rest. The handle on a border resizes
// the fixed column next to it: the one on its left for columns before the message, the one on its right after it.
export class Columns {
  static getSpec(id: ColumnId): ColumnSpec {
    return COLUMN_SPECS.find((spec) => spec.id === id)!;
  }

  static applyWidths(widths: ColumnWidths, graphWidth: number): void {
    const style = document.documentElement.style;
    for (const spec of COLUMN_SPECS) {
      if (spec.side === 'flex') {
        continue;
      }
      const width = spec.id === 'graph' ? graphWidth : widths[spec.id] ?? spec.defaultWidth;
      style.setProperty(`--col-${spec.id}`, `${width}px`);
    }
  }

  static renderHeader(columns: ColumnId[]): string {
    const messageIndex = columns.indexOf('message');
    let html = '';

    columns.forEach((id, index) => {
      const spec = Columns.getSpec(id);
      let handle = '';
      const next = columns[index + 1];
      if (next) {
        const resized = index < messageIndex ? id : next;
        handle = `<span class="col-resize" data-resize="${resized}" data-direction="${index < messageIndex ? 1 : -1}" title="Drag to resize, double-click to reset"></span>`;
      }
      html += `<div class="cell ${id}"><span class="col-title">${spec.title}</span>${handle}</div>`;
    });

    return html;
  }

  static attachResize(header: HTMLElement, readWidth: (id: ColumnId) => number, handlers: ResizeHandlers): void {
    header.addEventListener('dblclick', (event) => {
      const handle = (event.target as HTMLElement).closest<HTMLElement>('.col-resize');
      if (handle) {
        handlers.onReset(handle.dataset.resize as ColumnId);
      }
    });

    header.addEventListener('pointerdown', (event) => {
      const handle = (event.target as HTMLElement).closest<HTMLElement>('.col-resize');
      if (!handle) {
        return;
      }
      event.preventDefault();

      const id = handle.dataset.resize as ColumnId;
      const direction = Number(handle.dataset.direction);
      const startX = event.clientX;
      const startWidth = readWidth(id);
      const minWidth = Columns.getSpec(id).minWidth;

      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        // Capture only keeps the drag alive outside the handle; the drag still works without it.
      }
      document.body.classList.add('resizing');

      const onMove = (move: PointerEvent) => {
        const width = startWidth + direction * (move.clientX - startX);
        handlers.onResize(id, Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(minWidth, width))));
      };
      const onUp = () => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        document.body.classList.remove('resizing');
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
    });
  }

  // A header dragged sideways moves its column: the drop goes before the column under the pointer's left half,
  // after it under the right half.
  static attachReorder(header: HTMLElement, handlers: ReorderHandlers): void {
    header.addEventListener('pointerdown', (event) => {
      const target = event.target as HTMLElement;
      const cell = target.closest<HTMLElement>('.cell');
      if (!cell || target.closest('.col-resize') || event.button !== 0) {
        return;
      }
      const id = Columns.readId(cell);
      const startX = event.clientX;
      let dragging = false;
      let drop: { before: ColumnId | null; cell: HTMLElement; side: 'before' | 'after' } | null = null;

      const clearMarks = () => {
        header.querySelectorAll('.col-drop-before, .col-drop-after').forEach((element) => element.classList.remove('col-drop-before', 'col-drop-after'));
      };

      const onMove = (move: PointerEvent) => {
        if (!dragging) {
          if (Math.abs(move.clientX - startX) < DRAG_THRESHOLD) {
            return;
          }
          dragging = true;
          try {
            header.setPointerCapture(move.pointerId);
          } catch {
            // Capture only keeps the drag alive outside the header; the drag still works without it.
          }
          cell.classList.add('col-dragging');
          document.body.classList.add('moving-column');
        }

        clearMarks();
        drop = null;
        const cells = Array.from(header.querySelectorAll<HTMLElement>('.cell'));
        for (let index = 0; index < cells.length; index++) {
          const box = cells[index].getBoundingClientRect();
          if (move.clientX < box.left || move.clientX > box.right || cells[index] === cell) {
            continue;
          }
          const side = move.clientX < box.left + box.width / 2 ? 'before' : 'after';
          const next = side === 'before' ? cells[index] : cells[index + 1];
          drop = { before: next ? Columns.readId(next) : null, cell: cells[index], side };
          cells[index].classList.add(side === 'before' ? 'col-drop-before' : 'col-drop-after');
          break;
        }
      };

      const onUp = () => {
        header.removeEventListener('pointermove', onMove);
        header.removeEventListener('pointerup', onUp);
        header.removeEventListener('pointercancel', onUp);
        clearMarks();
        cell.classList.remove('col-dragging');
        document.body.classList.remove('moving-column');
        if (dragging && drop && drop.before !== id) {
          handlers.onMove(id, drop.before);
        }
      };

      header.addEventListener('pointermove', onMove);
      header.addEventListener('pointerup', onUp);
      header.addEventListener('pointercancel', onUp);
    });
  }

  // A full order with every column once: unknown names dropped, missing ones put back at their default place.
  static normalizeOrder(saved: string[]): ColumnId[] {
    const known = COLUMN_SPECS.map((spec) => spec.id);
    const order = saved.filter((id): id is ColumnId => (known as string[]).includes(id));
    const unique = order.filter((id, index) => order.indexOf(id) === index);
    known.forEach((id, index) => {
      if (!unique.includes(id)) {
        unique.splice(Math.min(index, unique.length), 0, id);
      }
    });
    return unique;
  }

  private static readId(cell: HTMLElement): ColumnId {
    return COLUMN_SPECS.find((spec) => cell.classList.contains(spec.id))!.id;
  }
}
