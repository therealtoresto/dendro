import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TimeAxis } from '../history/TimeAxis';

const at = (year: number, month: number, day: number) => new Date(year, month, day, 12).getTime() / 1000;

describe('TimeAxis', () => {
  it('uses years for a long history', () => {
    const ticks = TimeAxis.buildTicks(at(2021, 5, 1), at(2026, 5, 1), 8, 'en-US');
    assert.deepEqual(
      ticks.map((tick) => tick.label),
      ['2022', '2023', '2024', '2025', '2026'],
    );
  });

  it('uses months for half a year and writes the year where it changes', () => {
    const ticks = TimeAxis.buildTicks(at(2026, 9, 10), at(2027, 1, 20), 8, 'en-US');
    assert.deepEqual(
      ticks.map((tick) => tick.label),
      ['Nov 2026', 'Dec', 'Jan 2027', 'Feb'],
    );
  });

  it('uses days for a short history', () => {
    const ticks = TimeAxis.buildTicks(at(2026, 10, 3), at(2026, 10, 6), 8, 'en-US');
    assert.deepEqual(
      ticks.map((tick) => tick.label),
      ['Nov 4', 'Nov 5', 'Nov 6'],
    );
  });
});
