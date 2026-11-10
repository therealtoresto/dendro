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
}
