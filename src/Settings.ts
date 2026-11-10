import * as vscode from 'vscode';
import type { DateSettings } from './shared/DateFormatter';
import { SettingsCatalog, SettingValues } from './shared/SettingsCatalog';

type SettingValue = SettingValues[string];

// settings.json can hold anything under a key; everything Dendro reads goes through the catalog's rules first.
export class Settings {
  static readAll(): SettingValues {
    const config = vscode.workspace.getConfiguration('dendro');
    const values: SettingValues = {};
    for (const item of SettingsCatalog.getItems()) {
      values[item.key] = SettingsCatalog.normalize(item, config.get(item.key));
    }
    return values;
  }

  static get<T extends SettingValue>(key: string): T {
    const item = SettingsCatalog.findItem(key);
    if (!item) {
      throw new Error(`Unknown Dendro setting: ${key}`);
    }
    return SettingsCatalog.normalize(item, vscode.workspace.getConfiguration('dendro').get(key)) as T;
  }

  static async update(key: string, value: unknown): Promise<void> {
    const item = SettingsCatalog.findItem(key);
    if (!item) {
      return;
    }
    await vscode.workspace
      .getConfiguration('dendro')
      .update(key, SettingsCatalog.normalize(item, value), vscode.ConfigurationTarget.Global);
  }

  static readDateSettings(): DateSettings {
    return {
      relative: Settings.get<boolean>('dates.relative'),
      locale: Settings.get<string>('dates.locale'),
      format: Settings.get<string>('dates.format'),
      shortFormat: Settings.get<string>('dates.shortFormat'),
      timeFormat: Settings.get<string>('dates.timeFormat'),
    };
  }

  static getEditorLocale(): string {
    return vscode.env.language;
  }
}
