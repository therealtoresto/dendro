export interface CalendarDay {
  key: string;
  date: Date;
}

export interface Streaks {
  current: number;
  longest: number;
}

const DAYS_IN_WEEK = 7;

// Days in local time, weeks starting on Monday: the grid of the contribution calendar and the sums over it.
export class ActivityCalendar {
  static getDayKey(date: Date): string {
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  }

  // Monday-based weekday: 0 is Monday, 6 is Sunday.
  static getWeekday(date: Date): number {
    return (date.getDay() + 6) % DAYS_IN_WEEK;
  }

  // Whole weeks up to the week of `today`, oldest first; the last week stops at today.
  static buildDays(today: Date, weeks: number): CalendarDay[] {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    start.setDate(start.getDate() - ActivityCalendar.getWeekday(start) - (weeks - 1) * DAYS_IN_WEEK);

    const days: CalendarDay[] = [];
    const end = ActivityCalendar.getDayKey(today);
    for (const date = new Date(start); ; date.setDate(date.getDate() + 1)) {
      const key = ActivityCalendar.getDayKey(date);
      days.push({ key, date: new Date(date) });
      if (key === end) {
        return days;
      }
    }
  }

  static countByDay(dates: number[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const seconds of dates) {
      const key = ActivityCalendar.getDayKey(new Date(seconds * 1000));
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }

  // A streak is a run of days with commits. The current one may end yesterday: today is not over yet.
  static getStreaks(days: CalendarDay[], counts: Map<string, number>): Streaks {
    let longest = 0;
    let run = 0;
    for (const day of days) {
      run = counts.has(day.key) ? run + 1 : 0;
      longest = Math.max(longest, run);
    }

    let current = 0;
    let index = days.length - 1;
    if (index >= 0 && !counts.has(days[index].key)) {
      index--;
    }
    while (index >= 0 && counts.has(days[index].key)) {
      current++;
      index--;
    }
    return { current, longest };
  }

  // Four steps above zero, cut at the quartiles of the days that have commits, so one huge day does not leave the
  // rest of the year in the lightest step.
  static getLevelLimits(counts: number[]): number[] {
    const sorted = counts.filter((count) => count > 0).sort((left, right) => left - right);
    if (sorted.length === 0) {
      return [1, 1, 1];
    }
    const at = (share: number) => sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
    return [at(0.25), at(0.5), at(0.75)];
  }

  static getLevel(count: number, limits: number[]): number {
    if (count <= 0) {
      return 0;
    }
    let level = 1;
    for (const limit of limits) {
      if (count > limit) {
        level++;
      }
    }
    return level;
  }

  // Commits per Monday-based weekday (rows) and hour (columns).
  static buildPunchCard(dates: number[]): number[][] {
    const grid = Array.from({ length: DAYS_IN_WEEK }, () => new Array<number>(24).fill(0));
    for (const seconds of dates) {
      const date = new Date(seconds * 1000);
      grid[ActivityCalendar.getWeekday(date)][date.getHours()]++;
    }
    return grid;
  }
}
