// The "-old" / "+new" lines of a hunk split into the code before and after the commit, so each side can be shown as
// code of the file's language. The indent both sides share is cut, so deep code does not drift off a narrow card.
export interface SplitChange {
  before: string[];
  after: string[];
  truncated: boolean;
}

export class LineChange {
  static split(lines: string[]): SplitChange {
    const before: string[] = [];
    const after: string[] = [];
    let truncated = false;

    for (const line of lines) {
      if (line.startsWith('-')) {
        before.push(line.slice(1));
      } else if (line.startsWith('+')) {
        after.push(line.slice(1));
      } else if (line === '…') {
        truncated = true;
      }
    }

    const indent = LineChange.findCommonIndent([...before, ...after]);
    return { before: before.map((line) => line.slice(indent)), after: after.map((line) => line.slice(indent)), truncated };
  }

  // Blank lines do not count: they carry no indent of their own.
  static findCommonIndent(lines: string[]): number {
    let indent = Infinity;
    for (const line of lines) {
      if (line.trim() === '') {
        continue;
      }
      const leading = /^[ \t]*/.exec(line)![0].length;
      indent = Math.min(indent, leading);
    }
    return indent === Infinity ? 0 : indent;
  }
}
