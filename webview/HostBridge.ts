import type { WebviewMessage } from '../src/protocol';
import type { ColumnWidths } from './Columns';

interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export interface SavedViewState {
  detailsWidth?: number;
  selectedKey?: string | null;
  columnWidths?: ColumnWidths;
}

export class HostBridge {
  private static readonly api = acquireVsCodeApi();

  static post(message: WebviewMessage): void {
    HostBridge.api.postMessage(message);
  }

  static readViewState(): SavedViewState {
    return (HostBridge.api.getState() as SavedViewState | undefined) ?? {};
  }

  static saveViewState(update: SavedViewState): void {
    HostBridge.api.setState({ ...HostBridge.readViewState(), ...update });
  }
}
