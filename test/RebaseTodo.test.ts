import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RebaseTodo } from '../src/rebase/RebaseTodo';

const GIT_TODO = `pick 1a2b3c4 Add the parser
s 5d6e7f8 Fix a typo
f 9a8b7c6 Another typo
exec npm test

# Rebase 0000000..9a8b7c6 onto 0000000 (3 commands)
# p, pick <commit> = use commit
`;

describe('RebaseTodo', () => {
  it('reads steps with short action names and keeps other commands', () => {
    const todo = RebaseTodo.parse(GIT_TODO);

    assert.deepEqual(
      todo.steps.map((step) => [step.action, step.hash, step.subject]),
      [
        ['pick', '1a2b3c4', 'Add the parser'],
        ['squash', '5d6e7f8', 'Fix a typo'],
        ['fixup', '9a8b7c6', 'Another typo'],
      ],
    );
    assert.deepEqual(todo.otherLines, ['exec npm test']);
  });

  it('writes the steps back in their new order, comments left out', () => {
    const todo = RebaseTodo.parse(GIT_TODO);
    todo.steps.reverse();
    todo.steps[2].action = 'drop';

    assert.equal(
      RebaseTodo.serialize(todo),
      'fixup 9a8b7c6 Another typo\nsquash 5d6e7f8 Fix a typo\ndrop 1a2b3c4 Add the parser\nexec npm test\n',
    );
  });

  it('refuses a plan that folds the first kept commit or drops everything', () => {
    const steps = RebaseTodo.parse(GIT_TODO).steps;
    assert.equal(RebaseTodo.findProblem(steps), null);
    assert.match(RebaseTodo.findProblem([{ ...steps[0], action: 'drop' }, steps[1]]) ?? '', /cannot be squashed/);
    assert.match(RebaseTodo.findProblem(steps.map((step) => ({ ...step, action: 'drop' as const }))) ?? '', /Every commit is dropped/);
  });
});
