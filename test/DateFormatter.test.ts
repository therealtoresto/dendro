import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DateFormatter, DateSettings } from '../src/shared/DateFormatter';
import { TokenTemplate } from '../src/shared/TokenTemplate';

const settings: DateSettings = { relative: true, locale: 'en-US', format: '', shortFormat: '', timeFormat: '' };
// 2026-11-03 14:05:09 in local time, so the test does not depend on the machine's time zone.
const moment = new Date(2026, 10, 3, 14, 5, 9).getTime() / 1000;

describe('DateFormatter', () => {
  it('formats the default Moment-style pattern', () => {
    const formatter = new DateFormatter(settings, 'en-US');
    assert.equal(formatter.formatFull(moment), 'November 3rd, 2026 2:05pm');
  });

  it('writes a readable date with the month in words and no comma inside the date', () => {
    const formatter = new DateFormatter(settings, 'en-US');
    assert.equal(formatter.formatReadable(moment).replace(/\u202f/g, ' '), 'November 3 2026, 2:05 PM');
  });

  it('formats every token and keeps [bracketed] text', () => {
    const formatter = new DateFormatter(settings, 'en-US');
    assert.equal(
      formatter.formatPattern(moment, 'YYYY YY MMMM MMM MM M Do DD D dddd ddd HH H hh h mm m ss s A a [at YYYY]'),
      '2026 26 November Nov 11 11 3rd 03 3 Tuesday Tue 14 14 02 2 05 5 09 9 PM pm at YYYY',
    );
  });

  it('uses the inflected month name of the locale', () => {
    const formatter = new DateFormatter({ ...settings, locale: 'uk-UA' }, 'en-US');
    assert.equal(formatter.formatPattern(moment, 'D MMMM YYYY'), '3 листопада 2026');
    assert.equal(formatter.formatPattern(moment, 'Do'), '3.');
  });

  it('falls back to the editor locale when the setting is empty or invalid', () => {
    assert.equal(new DateFormatter({ ...settings, locale: '' }, 'de-DE').locale, 'de-DE');
    assert.equal(new DateFormatter({ ...settings, locale: 'not a locale!' }, 'fr-FR').locale, 'fr-FR');
  });

  it('writes ages relatively, or as a short date when relative dates are off', () => {
    const formatter = new DateFormatter(settings, 'en-US');
    assert.equal(formatter.formatAgo(moment, moment + 3 * 86400 + 60), '3 days ago');
    assert.equal(formatter.formatAgo(moment, moment + 3600), '1 hour ago');
    assert.equal(formatter.formatCompact(moment, moment + 2 * 3600), '2h');

    const absolute = new DateFormatter({ ...settings, relative: false, shortFormat: 'DD.MM.YYYY' }, 'en-US');
    assert.equal(absolute.formatAgoOrDate(moment, moment + 3600), '03.11.2026');
    assert.equal(absolute.formatCompact(moment, moment + 3600), '03.11.2026');
  });
});

describe('TokenTemplate', () => {
  it('fills tokens, cuts long values and pads short ones', () => {
    const values = { author: 'Ann Lee', message: 'Fix the parser when the input is empty', ago: '2 days ago' };
    assert.equal(TokenTemplate.format('${author}, ${ago} • ${message|20}', values), 'Ann Lee, 2 days ago • Fix the parser when…');
    assert.equal(TokenTemplate.format('[${ago|12-}]', values), '[2 days ago  ]');
    assert.equal(TokenTemplate.format('${unknown}!', values), '!');
  });
});
