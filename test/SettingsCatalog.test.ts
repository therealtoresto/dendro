import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { SettingsCatalog } from '../src/shared/SettingsCatalog';

describe('SettingsCatalog', () => {
  it('matches the configuration in package.json (run `npm run sync-config` after changing the catalog)', () => {
    const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    assert.deepEqual(manifest.contributes.configuration, SettingsCatalog.buildConfiguration());
  });

  it('has unique keys, defaults that fit their own rules, and dependencies on existing boolean keys', () => {
    const items = SettingsCatalog.getItems();
    const keys = items.map((item) => item.key);
    assert.equal(new Set(keys).size, keys.length);

    for (const item of items) {
      assert.deepEqual(SettingsCatalog.normalize(item, item.default), item.default, item.key);
      if (item.dependsOn) {
        assert.equal(SettingsCatalog.findItem(item.dependsOn)?.type, 'boolean', `${item.key} depends on ${item.dependsOn}`);
      }
    }
  });

  it('replaces a value of the wrong shape with the default and keeps numbers in range', () => {
    const rows = SettingsCatalog.findItem('graph.initialRows')!;
    assert.equal(SettingsCatalog.normalize(rows, 'a lot'), 500);
    assert.equal(SettingsCatalog.normalize(rows, 1), 50);

    const order = SettingsCatalog.findItem('graph.order')!;
    assert.equal(SettingsCatalog.normalize(order, 'random'), 'date');

    const columns = SettingsCatalog.findItem('graph.columns')!;
    assert.deepEqual(SettingsCatalog.normalize(columns, ['sha', 'nope']), ['sha']);
  });
});
