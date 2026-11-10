import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ActivityCalendar } from '../insights/ActivityCalendar';

const at = (year: number, month: number, day: number, hour = 12) => new Date(year, month - 1, day, hour).getTime() / 1000;

test('the calendar starts on a Monday and ends today', () => {
  const today = new Date(2026, 10, 12, 15);
  const days = ActivityCalendar.buildDays(today, 3);
  assert.equal(ActivityCalendar.getWeekday(days[0].date), 0);
  assert.equal(days[days.length - 1].key, ActivityCalendar.getDayKey(today));
  // 2026-11-12 is a Thursday: two whole weeks and Monday to Thursday.
  assert.equal(days.length, 14 + 4);
});

test('a streak may end yesterday, and the longest one is kept', () => {
  const today = new Date(2026, 10, 12, 9);
  const days = ActivityCalendar.buildDays(today, 2);
  const counts = ActivityCalendar.countByDay([at(2026, 11, 3), at(2026, 11, 4), at(2026, 11, 5), at(2026, 11, 10), at(2026, 11, 11), at(2026, 11, 11)]);
  assert.deepEqual(ActivityCalendar.getStreaks(days, counts), { current: 2, longest: 3 });
  assert.equal(counts.get('2026-11-11'), 2);
});

test('levels follow the quartiles of the active days', () => {
  const limits = ActivityCalendar.getLevelLimits([0, 1, 2, 3, 4, 5, 6, 7, 100]);
  assert.deepEqual(limits, [3, 5, 7]);
  assert.deepEqual([0, 1, 3, 4, 6, 100].map((count) => ActivityCalendar.getLevel(count, limits)), [0, 1, 1, 2, 3, 4]);
  assert.equal(ActivityCalendar.getLevel(5, ActivityCalendar.getLevelLimits([5, 5, 5])), 1);
});

test('the punch card counts by weekday and hour', () => {
  const grid = ActivityCalendar.buildPunchCard([at(2026, 11, 9, 10), at(2026, 11, 9, 10), at(2026, 11, 15, 23)]);
  assert.equal(grid[0][10], 2);
  assert.equal(grid[6][23], 1);
});
