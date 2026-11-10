import { readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { SettingsCatalog } from '../src/shared/SettingsCatalog';

const packagePath = path.join(process.cwd(), 'package.json');
const manifest = JSON.parse(readFileSync(packagePath, 'utf8'));
manifest.contributes.configuration = SettingsCatalog.buildConfiguration();
writeFileSync(packagePath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`package.json: ${SettingsCatalog.getItems().length} settings`);
