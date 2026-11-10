export interface DateSettings {
  relative: boolean;
  locale: string;
  format: string;
  shortFormat: string;
  timeFormat: string;
}

const DEFAULT_FORMAT = 'MMMM Do, YYYY h:mma';
const TOKEN_PATTERN = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|Do|DD|D|dddd|ddd|HH|H|hh|h|mm|m|ss|s|A|a|LT|L/g;

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

const AGE_STEPS: { limit: number; size: number; unit: Intl.RelativeTimeFormatUnit; short: string }[] = [
  { limit: HOUR, size: MINUTE, unit: 'minute', short: 'm' },
  { limit: DAY, size: HOUR, unit: 'hour', short: 'h' },
  { limit: WEEK, size: DAY, unit: 'day', short: 'd' },
  { limit: MONTH, size: WEEK, unit: 'week', short: 'w' },
  { limit: YEAR, size: MONTH, unit: 'month', short: 'mo' },
  { limit: Infinity, size: YEAR, unit: 'year', short: 'y' },
];

// Dates in Moment-style patterns ("MMMM Do, YYYY h:mma"), with month and weekday names from the chosen locale.
export class DateFormatter {
  readonly locale: string;

  constructor(
    private readonly settings: DateSettings,
    fallbackLocale: string,
  ) {
    this.locale = DateFormatter.pickLocale(settings.locale, fallbackLocale);
  }

  static pickLocale(wanted: string, fallback: string): string {
    for (const candidate of [wanted.trim(), fallback, 'en-US']) {
      if (!candidate) {
        continue;
      }
      if (candidate === 'system') {
        return Intl.DateTimeFormat().resolvedOptions().locale;
      }
      try {
        if (Intl.DateTimeFormat.supportedLocalesOf(candidate).length > 0) {
          return candidate;
        }
      } catch {
        // An invalid tag throws; the next candidate is tried.
      }
    }
    return 'en-US';
  }

  formatFull(unixSeconds: number): string {
    return this.formatPattern(unixSeconds, this.settings.format || DEFAULT_FORMAT);
  }

  formatShortDate(unixSeconds: number): string {
    if (this.settings.shortFormat) {
      return this.formatPattern(unixSeconds, this.settings.shortFormat);
    }
    return new Intl.DateTimeFormat(this.locale, { dateStyle: 'short' }).format(unixSeconds * 1000);
  }

  // "Nov 6 2026, 7:24 PM": the month's short name, the parts in the locale's order, no comma inside the date.
  formatReadable(unixSeconds: number): string {
    const parts = new Intl.DateTimeFormat(this.locale, { month: 'short', day: 'numeric', year: 'numeric' }).formatToParts(unixSeconds * 1000);
    const date = parts
      .map((part) => (part.type === 'literal' ? part.value.replace(/,\s*/g, ' ') : part.value))
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    return `${date}, ${this.formatTime(unixSeconds)}`;
  }

  formatTime(unixSeconds: number): string {
    if (this.settings.timeFormat) {
      return this.formatPattern(unixSeconds, this.settings.timeFormat);
    }
    return new Intl.DateTimeFormat(this.locale, { timeStyle: 'short' }).format(unixSeconds * 1000);
  }

  formatAgo(unixSeconds: number, now = Date.now() / 1000): string {
    const age = Math.max(0, now - unixSeconds);
    const relative = new Intl.RelativeTimeFormat(this.locale, { numeric: 'auto' });
    if (age < MINUTE) {
      return relative.format(0, 'second');
    }
    const step = AGE_STEPS.find((candidate) => age < candidate.limit)!;
    return relative.format(-Math.floor(age / step.size), step.unit);
  }

  formatAgoOrDate(unixSeconds: number, now?: number): string {
    return this.settings.relative ? this.formatAgo(unixSeconds, now) : this.formatShortDate(unixSeconds);
  }

  // The graph's date column: "5m", "2h", "3d" when relative dates are on, else the short date.
  formatCompact(unixSeconds: number, now = Date.now() / 1000): string {
    if (!this.settings.relative) {
      return this.formatShortDate(unixSeconds);
    }
    const age = Math.max(0, now - unixSeconds);
    if (age < MINUTE) {
      return 'now';
    }
    const step = AGE_STEPS.find((candidate) => age < candidate.limit)!;
    return `${Math.floor(age / step.size)}${step.short}`;
  }

  formatPattern(unixSeconds: number, pattern: string): string {
    const date = new Date(unixSeconds * 1000);
    return pattern.replace(TOKEN_PATTERN, (token: string, literal: string | undefined) =>
      literal !== undefined ? literal : this.formatToken(date, token),
    );
  }

  private formatToken(date: Date, token: string): string {
    const hours = date.getHours();
    switch (token) {
      case 'YYYY':
        return String(date.getFullYear());
      case 'YY':
        return String(date.getFullYear()).slice(-2);
      case 'MMMM':
        return this.readMonthName(date, 'long');
      case 'MMM':
        return this.readMonthName(date, 'short');
      case 'MM':
        return DateFormatter.pad(date.getMonth() + 1);
      case 'M':
        return String(date.getMonth() + 1);
      case 'Do':
        return this.formatOrdinal(date.getDate());
      case 'DD':
        return DateFormatter.pad(date.getDate());
      case 'D':
        return String(date.getDate());
      case 'dddd':
        return new Intl.DateTimeFormat(this.locale, { weekday: 'long' }).format(date);
      case 'ddd':
        return new Intl.DateTimeFormat(this.locale, { weekday: 'short' }).format(date);
      case 'HH':
        return DateFormatter.pad(hours);
      case 'H':
        return String(hours);
      case 'hh':
        return DateFormatter.pad(hours % 12 || 12);
      case 'h':
        return String(hours % 12 || 12);
      case 'mm':
        return DateFormatter.pad(date.getMinutes());
      case 'm':
        return String(date.getMinutes());
      case 'ss':
        return DateFormatter.pad(date.getSeconds());
      case 's':
        return String(date.getSeconds());
      case 'A':
        return hours < 12 ? 'AM' : 'PM';
      case 'a':
        return hours < 12 ? 'am' : 'pm';
      case 'L':
        return new Intl.DateTimeFormat(this.locale, { dateStyle: 'short' }).format(date);
      case 'LT':
        return new Intl.DateTimeFormat(this.locale, { timeStyle: 'short' }).format(date);
      default:
        return token;
    }
  }

  // Month names read inside a date, so languages that inflect them (uk: "листопада") get the right form.
  private readMonthName(date: Date, width: 'long' | 'short'): string {
    const parts = new Intl.DateTimeFormat(this.locale, { day: 'numeric', month: width }).formatToParts(date);
    return parts.find((part) => part.type === 'month')?.value ?? '';
  }

  private formatOrdinal(day: number): string {
    if (!this.locale.toLowerCase().startsWith('en')) {
      return `${day}.`;
    }
    const lastTwo = day % 100;
    if (lastTwo >= 11 && lastTwo <= 13) {
      return `${day}th`;
    }
    const suffixes: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' };
    return `${day}${suffixes[day % 10] ?? 'th'}`;
  }

  private static pad(value: number): string {
    return String(value).padStart(2, '0');
  }
}
