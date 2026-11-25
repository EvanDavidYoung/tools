// Tests for the screenshot → event → .ics logic shared by the page and the Worker.
//   node --test ics-to-gcal/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXTRACT_SCHEMA, buildPrompt, parseModelJson, normalizeExtraction,
  missingFields, toICS, calendarWeeks, parseTime, addDays
} from '../events.js';

const blank = over => ({
  title: '', date: '', end_date: '', start_time: '', end_time: '', all_day: false,
  time_zone: '', location: '', description: '', questions: [], ...over
});

// ---------- schema ----------

test('schema is strict enough for structured outputs', () => {
  assert.equal(EXTRACT_SCHEMA.additionalProperties, false);
  const ev = EXTRACT_SCHEMA.properties.events.items;
  assert.equal(ev.additionalProperties, false);
  assert.deepEqual([...ev.required].sort(), Object.keys(ev.properties).sort());
});

// ---------- prompt ----------

test('prompt anchors relative dates to today and the viewer zone', () => {
  const p = buildPrompt({ today: '2026-11-25', timeZone: 'America/Los_Angeles' });
  assert.match(p, /Wednesday, 2026-11-25/);
  assert.match(p, /America\/Los_Angeles/);
  assert.doesNotMatch(p, /Extra details/);
});

test('prompt carries the extra details the user typed', () => {
  const p = buildPrompt({ today: '2026-11-25', timeZone: 'UTC', hint: 'it is at 7pm' });
  assert.match(p, /Extra details from the user:\n"""\nit is at 7pm\n"""/);
});

// ---------- parsing model output ----------

test('parseModelJson takes objects, strings and fenced strings', () => {
  assert.deepEqual(parseModelJson({ events: [] }), { events: [] });
  assert.deepEqual(parseModelJson('{"events":[]}'), { events: [] });
  assert.deepEqual(parseModelJson('Here you go:\n```json\n{"events":[1]}\n```'), { events: [1] });
});

test('parseModelJson throws on junk', () => {
  assert.throws(() => parseModelJson('no json here'), /no JSON/i);
});

// ---------- normalizing ----------

test('parseTime accepts 24h and am/pm', () => {
  assert.equal(parseTime('19:05'), '19:05');
  assert.equal(parseTime('7:05 PM'), '19:05');
  assert.equal(parseTime('7pm'), '19:00');
  assert.equal(parseTime('12am'), '00:00');
  assert.equal(parseTime('12:30 pm'), '12:30');
  assert.equal(parseTime('25:00'), '');
  assert.equal(parseTime('soon'), '');
});

test('normalizeExtraction cleans fields and drops impossible values', () => {
  const { events, notes } = normalizeExtraction({
    notes: '  one invite ',
    events: [{
      title: '  Dinner at Joe\'s ', date: '2026-02-30', end_date: 'tomorrow',
      start_time: '7 pm', end_time: '', all_day: 'no', time_zone: 'Mars/Olympus',
      location: ' 12 Main St ', description: '', questions: []
    }]
  });
  assert.equal(notes, 'one invite');
  const e = events[0];
  assert.equal(e.title, "Dinner at Joe's");
  assert.equal(e.date, '');            // Feb 30 doesn't exist
  assert.equal(e.end_date, '');
  assert.equal(e.start_time, '19:00');
  assert.equal(e.all_day, false);
  assert.equal(e.time_zone, '');       // not a real zone
  assert.equal(e.location, '12 Main St');
  // A blanked required field gets a question even if the model didn't ask one.
  assert.ok(e.questions.some(q => q.field === 'date'));
});

test('normalizeExtraction keeps valid questions and drops unknown fields', () => {
  const { events } = normalizeExtraction({ events: [blank({
    title: 'x', date: '2026-12-01', start_time: '09:00',
    questions: [{ field: 'end_time', question: 'How long is it?' }, { field: 'vibes', question: '?' }, { field: 'date', question: '' }]
  })] });
  assert.deepEqual(events[0].questions, [{ field: 'end_time', question: 'How long is it?' }]);
});

test('normalizeExtraction survives a missing or malformed events list', () => {
  assert.deepEqual(normalizeExtraction({}).events, []);
  assert.deepEqual(normalizeExtraction({ events: 'nope' }).events, []);
  assert.deepEqual(normalizeExtraction(null).events, []);
});

// ---------- what's missing ----------

test('missingFields: timed events need title, date and start', () => {
  assert.deepEqual(missingFields(blank()), ['title', 'date', 'start_time']);
  assert.deepEqual(missingFields(blank({ title: 'a', date: '2026-12-01', start_time: '10:00' })), []);
});

test('missingFields: all-day events need no start time', () => {
  assert.deepEqual(missingFields(blank({ title: 'a', date: '2026-12-01', all_day: true })), []);
});

test('missingFields: an end date before the start is flagged', () => {
  assert.deepEqual(missingFields(blank({ title: 'a', date: '2026-12-05', end_date: '2026-12-01', all_day: true })), ['end_date']);
});

// ---------- .ics output ----------

const NOW = Date.UTC(2026, 10, 25, 21, 56, 0);

test('toICS writes a timed event in its zone, CRLF, with a 1h default end', () => {
  const ics = toICS([blank({ title: 'Dinner', date: '2026-11-28', start_time: '19:00', time_zone: 'America/New_York' })],
                    { now: NOW, uid: () => 'u1' });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.match(ics, /\r\nUID:u1@tools\.evanyoung\.dev\r\n/);
  assert.match(ics, /\r\nDTSTAMP:20261125T215600Z\r\n/);
  assert.match(ics, /\r\nDTSTART;TZID=America\/New_York:20261128T190000\r\n/);
  assert.match(ics, /\r\nDTEND;TZID=America\/New_York:20261128T200000\r\n/);
  assert.match(ics, /\r\nSUMMARY:Dinner\r\n/);
});

test('toICS uses the fallback zone when none is given', () => {
  const ics = toICS([blank({ title: 'x', date: '2026-11-28', start_time: '09:30', end_time: '10:15' })],
                    { now: NOW, uid: () => 'u', defaultZone: 'Europe/Paris' });
  assert.match(ics, /DTSTART;TZID=Europe\/Paris:20261128T093000/);
  assert.match(ics, /DTEND;TZID=Europe\/Paris:20261128T101500/);
});

test('toICS rolls an end time before the start into the next day', () => {
  const ics = toICS([blank({ title: 'Late show', date: '2026-12-31', start_time: '22:00', end_time: '01:30', time_zone: 'UTC' })],
                    { now: NOW, uid: () => 'u' });
  assert.match(ics, /DTEND;TZID=UTC:20270101T013000/);
});

test('toICS writes all-day events with an exclusive end date', () => {
  const one = toICS([blank({ title: 'Trip', date: '2026-12-30', all_day: true })], { now: NOW, uid: () => 'u' });
  assert.match(one, /DTSTART;VALUE=DATE:20261230\r\nDTEND;VALUE=DATE:20261231/);
  const span = toICS([blank({ title: 'Trip', date: '2026-12-30', end_date: '2027-01-02', all_day: true })], { now: NOW, uid: () => 'u' });
  assert.match(span, /DTEND;VALUE=DATE:20270103/);
});

test('toICS escapes text and folds long lines at 75 octets', () => {
  const ics = toICS([blank({
    title: 'Pho, banh mi; and \\ more', date: '2026-11-28', start_time: '12:00',
    description: 'Line one\nLine two ' + 'é'.repeat(60)
  })], { now: NOW, uid: () => 'u', defaultZone: 'UTC' });
  assert.match(ics, /SUMMARY:Pho\\, banh mi\\; and \\\\ more/);
  assert.match(ics, /DESCRIPTION:Line one\\nLine two/);
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `too long: ${line}`);
  // Unfolding restores the text without splitting a character.
  const unfolded = ics.replace(/\r\n[ \t]/g, '');
  assert.ok(unfolded.includes('é'.repeat(60)));
});

test('toICS leaves out empty optional fields', () => {
  const ics = toICS([blank({ title: 'x', date: '2026-11-28', all_day: true })], { now: NOW, uid: () => 'u' });
  assert.doesNotMatch(ics, /LOCATION|DESCRIPTION/);
});

// ---------- calendar ----------

test('addDays crosses months and years', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('calendarWeeks puts this week in the middle row', () => {
  const weeks = calendarWeeks('2026-11-25', 0, 5);
  assert.equal(weeks.length, 5);
  assert.ok(weeks.every(w => w.length === 7));
  assert.equal(weeks[0][0], '2026-11-08');   // a Sunday, two weeks before this week
  assert.ok(weeks[2].includes('2026-11-25'));
  assert.equal(weeks[4][6], '2026-12-12');
});

test('calendarWeeks shifts by whole weeks', () => {
  assert.equal(calendarWeeks('2026-11-25', 1, 5)[0][0], '2026-11-15');
  assert.equal(calendarWeeks('2026-11-25', -2, 5)[0][0], '2026-10-25');
});
