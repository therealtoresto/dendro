export interface Tick {
  time: number;
  label: string;
}

type Unit = 'day' | 'month' | 'year';

interface Step {
  unit: Unit;
  count: number;
  seconds: number;
}

const DAY = 86400;
const STEPS: Step[] = [
  { unit: 'day', count: 1, seconds: DAY },
  { unit: 'day', count: 2, seconds: 2 * DAY },
  { unit: 'day', count: 7, seconds: 7 * DAY },
  { unit: 'month', count: 1, seconds: 30 * DAY },
  { unit: 'month', count: 3, seconds: 91 * DAY },
  { unit: 'month', count: 6, seconds: 182 * DAY },
  { unit: 'year', count: 1, seconds: 365 * DAY },
  { unit: 'year', count: 2, seconds: 730 * DAY },
  { unit: 'year', count: 5, seconds: 1826 * DAY },
];

// Calendar-aligned ticks (midnights, first days of months, new years) at the finest step that still fits.
export class TimeAxis {
  static buildTicks(start: number, end: number, maxTicks: number, locale: string): Tick[] {
    const span = Math.max(DAY, end - start);
    const step = STEPS.find((candidate) => span / candidate.seconds <= maxTicks) ?? STEPS[STEPS.length - 1];
    const ticks: Tick[] = [];

    let cursor = TimeAxis.alignStart(new Date(start * 1000), step);
    let previous: Date | null = null;
    while (cursor.getTime() / 1000 <= end) {
      const time = cursor.getTime() / 1000;
      if (time >= start) {
        ticks.push({ time, label: TimeAxis.formatLabel(cursor, previous, step.unit, locale) });
        previous = new Date(cursor);
      }
      cursor = TimeAxis.advance(cursor, step);
    }
    return ticks;
  }

  private static alignStart(date: Date, step: Step): Date {
    if (step.unit === 'day') {
      return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }
    if (step.unit === 'month') {
      const month = Math.floor(date.getMonth() / step.count) * step.count;
      return new Date(date.getFullYear(), month, 1);
    }
    const year = Math.floor(date.getFullYear() / step.count) * step.count;
    return new Date(year, 0, 1);
  }

  private static advance(date: Date, step: Step): Date {
    if (step.unit === 'day') {
      return new Date(date.getFullYear(), date.getMonth(), date.getDate() + step.count);
    }
    if (step.unit === 'month') {
      return new Date(date.getFullYear(), date.getMonth() + step.count, 1);
    }
    return new Date(date.getFullYear() + step.count, 0, 1);
  }

  // The year is written where it changes, so "Nov", "Dec", "Jan 2027" read without repeating it.
  private static formatLabel(date: Date, previous: Date | null, unit: Unit, locale: string): string {
    if (unit === 'year') {
      return String(date.getFullYear());
    }
    const yearChanged = !previous || previous.getFullYear() !== date.getFullYear();
    const options: Intl.DateTimeFormatOptions =
      unit === 'day' ? { month: 'short', day: 'numeric' } : { month: 'short', ...(yearChanged ? { year: 'numeric' } : {}) };
    return new Intl.DateTimeFormat(locale, options).format(date);
  }
}
