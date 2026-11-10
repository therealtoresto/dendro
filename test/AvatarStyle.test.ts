import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AvatarStyle } from '../src/shared/AvatarStyle';

describe('AvatarStyle.renderArt', () => {
  it('draws the same picture for the same email, whatever its case', () => {
    assert.equal(AvatarStyle.renderArt('Ann@Example.com'), AvatarStyle.renderArt('ann@example.com'));
  });

  it('draws different pictures for different people', () => {
    const pictures = new Set(['ann', 'bob', 'cid', 'dee', 'eve', 'fay'].map((name) => AvatarStyle.renderArt(`${name}@example.com`)));
    assert.equal(pictures.size, 6);
  });

  it('mirrors the pattern left to right and never leaves it empty', () => {
    for (const name of ['ann', 'bob', 'cid', 'dee', 'eve']) {
      const cells = Array.from(AvatarStyle.renderArt(`${name}@example.com`).matchAll(/<rect x="([\d.]+)" y="([\d.]+)"/g)).map(
        (match) => ({ x: Number(match[1]), y: Number(match[2]) }),
      );
      assert.ok(cells.length > 0);
      for (const cell of cells) {
        const mirror = cells.find((other) => Math.abs(other.x - (17.5 - cell.x)) < 0.01 && other.y === cell.y);
        assert.ok(mirror, `${name}: ${cell.x},${cell.y} has no mirror`);
      }
    }
  });
});
