import { Icons } from './Icons';

interface FileKind {
  label: string;
  color: string;
}

const BY_EXTENSION: Record<string, FileKind> = {
  ts: { label: 'TS', color: '#3178c6' },
  tsx: { label: 'TSX', color: '#3178c6' },
  mts: { label: 'TS', color: '#3178c6' },
  js: { label: 'JS', color: '#c9a516' },
  jsx: { label: 'JSX', color: '#c9a516' },
  mjs: { label: 'JS', color: '#c9a516' },
  cjs: { label: 'JS', color: '#c9a516' },
  json: { label: '{ }', color: '#cb8a23' },
  md: { label: 'MD', color: '#519aba' },
  css: { label: 'CSS', color: '#a86cdc' },
  scss: { label: 'SCSS', color: '#c6538c' },
  less: { label: 'LESS', color: '#2a4d80' },
  html: { label: '<>', color: '#e44d26' },
  vue: { label: 'VUE', color: '#41b883' },
  svelte: { label: 'SV', color: '#ff3e00' },
  py: { label: 'PY', color: '#3572a5' },
  java: { label: 'JAVA', color: '#b07219' },
  kt: { label: 'KT', color: '#a97bff' },
  go: { label: 'GO', color: '#00add8' },
  rs: { label: 'RS', color: '#c46a3b' },
  rb: { label: 'RB', color: '#cc342d' },
  php: { label: 'PHP', color: '#777bb4' },
  cs: { label: 'C#', color: '#68217a' },
  sql: { label: 'SQL', color: '#e38c00' },
  sh: { label: '$', color: '#4eaa25' },
  zsh: { label: '$', color: '#4eaa25' },
  yml: { label: 'YML', color: '#cb171e' },
  yaml: { label: 'YML', color: '#cb171e' },
  xml: { label: 'XML', color: '#e37933' },
  svg: { label: 'SVG', color: '#e5a03b' },
  png: { label: 'IMG', color: '#a074c4' },
  jpg: { label: 'IMG', color: '#a074c4' },
  jpeg: { label: 'IMG', color: '#a074c4' },
  gif: { label: 'IMG', color: '#a074c4' },
  webp: { label: 'IMG', color: '#a074c4' },
  lock: { label: 'LCK', color: '#7f8b99' },
  txt: { label: 'TXT', color: '#7f8b99' },
};

const BY_NAME: Record<string, FileKind> = {
  dockerfile: { label: 'DKR', color: '#2496ed' },
  makefile: { label: 'MK', color: '#6d8086' },
  '.gitignore': { label: 'GIT', color: '#f05032' },
  'package.json': { label: 'NPM', color: '#cb3837' },
};

const TEST_COLOR = '#2ea043';

// Test files by the naming rules of the common test runners: x.spec.ts, x.test.js, x_test.go, test_x.py, XTest.java,
// and anything under __tests__.
const TEST_NAME = /\.(spec|test|e2e-spec|e2e)\.[a-z0-9]+$|_(test|spec)\.[a-z0-9]+$|^test_.+\.py$/;
const TEST_CLASS_NAME = /[a-z0-9](Test|Tests|Spec)\.(java|kt|cs|swift|scala|groovy)$/;

// A small colored tag that says the kind of a file at a glance; unknown kinds get the plain file icon.
export class FileIcons {
  static render(path: string): string {
    if (FileIcons.isTest(path)) {
      return `<span class="file-icon file-icon-test" style="--file-color:${TEST_COLOR}" title="Test file">${Icons.render('beaker', 11)}</span>`;
    }

    const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
    const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
    const kind = BY_NAME[name] ?? BY_EXTENSION[extension];

    if (!kind) {
      return `<span class="file-icon file-icon-plain">${Icons.render('file', 13)}</span>`;
    }
    return `<span class="file-icon" style="--file-color:${kind.color}">${kind.label}</span>`;
  }

  static isTest(path: string): boolean {
    const name = path.slice(path.lastIndexOf('/') + 1);
    return TEST_NAME.test(name.toLowerCase()) || TEST_CLASS_NAME.test(name) || /(^|\/)__tests__\//.test(path);
  }

  static renderFolder(open: boolean): string {
    return `<span class="folder-icon">${Icons.render(open ? 'folderOpen' : 'folder', 14)}</span>`;
  }
}
