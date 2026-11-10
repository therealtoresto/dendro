import type { SettingValues } from './shared/SettingsCatalog';

export type SettingsWebviewMessage =
  | { type: 'ready' }
  | { type: 'update'; key: string; value: boolean | number | string | string[] }
  | { type: 'openNativeSettings'; query: string };

export type SettingsHostMessage =
  | { type: 'values'; values: SettingValues; locale: string }
  | { type: 'focusSection'; id: string };
