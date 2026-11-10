export type RebaseAction = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop';

export interface RebaseStep {
  action: RebaseAction;
  hash: string;
  subject: string;
}

export interface RebaseTodoFile {
  steps: RebaseStep[];
  // Lines the editor does not change (exec, break, label, ...): kept, after the steps, as git wrote them.
  otherLines: string[];
}

const ACTION_BY_WORD: Record<string, RebaseAction> = {
  p: 'pick',
  pick: 'pick',
  r: 'reword',
  reword: 'reword',
  e: 'edit',
  edit: 'edit',
  s: 'squash',
  squash: 'squash',
  f: 'fixup',
  fixup: 'fixup',
  d: 'drop',
  drop: 'drop',
};

// The todo list of `git rebase -i`: one "<action> <sha> <subject>" per commit, oldest first; "#" lines are comments.
export class RebaseTodo {
  static parse(text: string): RebaseTodoFile {
    const steps: RebaseStep[] = [];
    const otherLines: string[] = [];

    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      const match = /^(\S+)\s+([0-9a-f]{4,40})\s*(.*)$/i.exec(trimmed);
      const action = match ? ACTION_BY_WORD[match[1].toLowerCase()] : undefined;
      if (match && action) {
        steps.push({ action, hash: match[2], subject: match[3] });
      } else {
        otherLines.push(trimmed);
      }
    }
    return { steps, otherLines };
  }

  static serialize(todo: RebaseTodoFile): string {
    const lines = todo.steps.map((step) => `${step.action} ${step.hash} ${step.subject}`.trimEnd());
    return [...lines, ...todo.otherLines].join('\n') + '\n';
  }

  // Squash and fixup fold a commit into the one before it, so the first kept step cannot be one of them.
  static findProblem(steps: RebaseStep[]): string | null {
    const kept = steps.filter((step) => step.action !== 'drop');
    if (kept.length === 0) {
      return 'Every commit is dropped; keep at least one, or abort the rebase.';
    }
    if (kept[0].action === 'squash' || kept[0].action === 'fixup') {
      return `The first commit cannot be ${kept[0].action === 'squash' ? 'squashed' : 'fixed up'}: there is no commit before it to fold into.`;
    }
    return null;
  }
}
