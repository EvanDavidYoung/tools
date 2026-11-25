// Screenshot → calendar event logic, shared by index.html (in the browser) and
// ../worker.js (the free Workers AI route). No DOM, no network: pure functions.

// ---------- What the model must return ----------

const FIELDS = ['title', 'date', 'start_time', 'end_time', 'end_date', 'time_zone', 'location'];

export const EXTRACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['events', 'notes'],
  properties: {
    events: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'date', 'end_date', 'start_time', 'end_time', 'all_day',
                   'time_zone', 'location', 'description', 'questions'],
        properties: {
          title: { type: 'string', description: 'Short calendar title, or "" if unknown.' },
          date: { type: 'string', description: 'Start date as YYYY-MM-DD, or "" if unknown.' },
          end_date: { type: 'string', description: 'Last day as YYYY-MM-DD for multi-day events, else "".' },
          start_time: { type: 'string', description: 'Start time as 24-hour HH:MM, or "" if unknown or all-day.' },
          end_time: { type: 'string', description: 'End time as 24-hour HH:MM, or "" if unknown.' },
          all_day: { type: 'boolean' },
          time_zone: { type: 'string', description: 'IANA zone such as America/New_York, or "" for the viewer\'s zone.' },
          location: { type: 'string' },
          description: { type: 'string' },
          questions: {
            type: 'array',
            description: 'One short question per field the screenshot does not settle.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['field', 'question'],
              properties: {
                field: { type: 'string', enum: FIELDS },
                question: { type: 'string' }
              }
            }
          }
        }
      }
    },
    notes: { type: 'string', description: 'Anything the user should know, e.g. why no event was found. Usually "".' }
  }
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function buildPrompt({ today, timeZone, hint = '' }) {
  const weekday = WEEKDAYS[isoToDate(today).getUTCDay()];
  let p = `Read this screenshot and pull out every calendar event in it: an invite, a flyer, a ticket, a booking confirmation, or a message proposing a time.

Today is ${weekday}, ${today}. The viewer's time zone is ${timeZone}.

Rules:
- Resolve relative dates ("this Friday", "tomorrow", "next week Tue") against today. With no year shown, pick the next upcoming date.
- Fill a field only when the screenshot (or the extra details below) states it or it clearly follows. Never invent a date, time or place. Leave anything you can't tell as "".
- For every field you leave empty that someone would need, and for any guess you are unsure of, add one short question naming that field, such as {"field":"start_time","question":"What time does dinner start?"}. Title and date are always needed; start_time is needed unless the event is all day.
- Don't ask about end_time just because it's missing; ask only if the screenshot hints at a length you can't pin down. Turn a stated duration into an end_time.
- time_zone: set an IANA name only when the screenshot names a zone, or a place clearly in a different zone from the viewer. Otherwise "".
- title: what you'd type into a calendar ("Dinner with Sam", "Dentist"), not a sentence.
- description: useful details from the screenshot (links, confirmation numbers, who is coming), not a restatement of the date and time.
- If there is no event at all, return an empty events list and say what you saw in notes.`;
  if (hint.trim()) p += `\n\nExtra details from the user:\n"""\n${hint.trim()}\n"""`;
  return p;
}

// ---------- Reading what came back ----------

// Models wrap JSON in prose or code fences, or hand back an already-parsed object.
export function parseModelJson(raw) {
  if (raw && typeof raw === 'object') return raw;
  const text = String(raw ?? '');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{'), end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The model returned no JSON.');
  return JSON.parse(body.slice(start, end + 1));
}

const str = v => (typeof v === 'string' ? v.trim() : '');

export function isoToDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function validDate(v) {
  const m = str(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const d = isoToDate(m[0]);
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() + 1 === +m[2] && d.getUTCDate() === +m[3] ? m[0] : '';
}

// "19:05", "7:05 PM", "7pm" → "19:05"; anything else → "".
export function parseTime(v) {
  const m = str(v).toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/);
  if (!m) return '';
  let h = +m[1];
  const mi = m[2] ? +m[2] : 0;
  const ap = m[3] ? m[3][0] : '';
  if (!m[2] && !ap) return '';
  if (ap) { if (h < 1 || h > 12) return ''; h = (h % 12) + (ap === 'p' ? 12 : 0); }
  if (h > 23 || mi > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

export function validZone(z) {
  z = str(z);
  if (!z) return '';
  try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return z; } catch { return ''; }
}

const DEFAULT_QUESTIONS = {
  title: 'What should this event be called?',
  date: 'What date is it?',
  start_time: 'What time does it start?'
};

function normalizeEvent(e) {
  e = e && typeof e === 'object' ? e : {};
  const ev = {
    title: str(e.title),
    date: validDate(e.date),
    end_date: validDate(e.end_date),
    start_time: parseTime(e.start_time),
    end_time: parseTime(e.end_time),
    all_day: e.all_day === true,
    time_zone: validZone(e.time_zone),
    location: str(e.location),
    description: str(e.description),
    questions: []
  };
  const seen = new Set();
  for (const q of Array.isArray(e.questions) ? e.questions : []) {
    const field = str(q?.field), question = str(q?.question);
    if (!FIELDS.includes(field) || !question || seen.has(field)) continue;
    seen.add(field);
    ev.questions.push({ field, question });
  }
  for (const f of missingFields(ev)) {
    if (!seen.has(f) && DEFAULT_QUESTIONS[f]) ev.questions.push({ field: f, question: DEFAULT_QUESTIONS[f] });
  }
  return ev;
}

export function normalizeExtraction(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    events: Array.isArray(r.events) ? r.events.map(normalizeEvent) : [],
    notes: str(r.notes)
  };
}

// Fields that must be filled before the event can be added. end_date is listed when it's before the start.
export function missingFields(ev) {
  const out = [];
  if (!str(ev.title)) out.push('title');
  if (!validDate(ev.date)) out.push('date');
  if (!ev.all_day && !parseTime(ev.start_time)) out.push('start_time');
  if (validDate(ev.date) && validDate(ev.end_date) && ev.end_date < ev.date) out.push('end_date');
  return out;
}

// ---------- Writing .ics ----------

export function addDays(iso, n) {
  const d = isoToDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const compactDate = iso => iso.replace(/-/g, '');

function escapeText(v) {
  return v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// RFC 5545 §3.1: lines over 75 octets continue on the next line after a space. Never split a character.
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let cur = '', size = 0, limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > limit) { parts.push(cur); cur = ''; size = 0; limit = 74; }
    cur += ch; size += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

function stamp(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function randomUid() {
  return (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

// events: drafts as produced by normalizeExtraction and edited by the user. Assumes missingFields(ev) is empty.
export function toICS(events, { now = Date.now(), uid = randomUid, defaultZone = 'UTC' } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//evanyoung.dev//ics-to-gcal//EN', 'CALSCALE:GREGORIAN'];
  for (const ev of events) {
    lines.push('BEGIN:VEVENT', `UID:${uid()}@tools.evanyoung.dev`, `DTSTAMP:${stamp(now)}`);
    if (ev.all_day) {
      const last = validDate(ev.end_date) && ev.end_date >= ev.date ? ev.end_date : ev.date;
      lines.push(`DTSTART;VALUE=DATE:${compactDate(ev.date)}`, `DTEND;VALUE=DATE:${compactDate(addDays(last, 1))}`);
    } else {
      const zone = validZone(ev.time_zone) || defaultZone;
      const start = parseTime(ev.start_time);
      let endDate = validDate(ev.end_date) && ev.end_date >= ev.date ? ev.end_date : ev.date;
      let end = parseTime(ev.end_time);
      if (!end) {
        const [h, m] = start.split(':').map(Number);
        end = `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        if (h === 23) endDate = addDays(endDate, 1);
      } else if (endDate === ev.date && end <= start) {
        endDate = addDays(endDate, 1); // 22:00–01:30 runs past midnight
      }
      const t = hm => hm.replace(':', '') + '00';
      lines.push(`DTSTART;TZID=${zone}:${compactDate(ev.date)}T${t(start)}`,
                 `DTEND;TZID=${zone}:${compactDate(endDate)}T${t(end)}`);
    }
    lines.push(`SUMMARY:${escapeText(str(ev.title))}`);
    if (str(ev.location)) lines.push(`LOCATION:${escapeText(str(ev.location))}`);
    if (str(ev.description)) lines.push(`DESCRIPTION:${escapeText(str(ev.description))}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

// ---------- Calendar grid ----------

// `rows` weeks of ISO dates (Sunday first), with the week holding `today` in the middle row
// when weekOffset is 0. weekOffset moves the whole grid by whole weeks.
export function calendarWeeks(today, weekOffset = 0, rows = 5) {
  const sunday = addDays(today, -isoToDate(today).getUTCDay());
  let day = addDays(sunday, 7 * (weekOffset - Math.floor(rows / 2)));
  const weeks = [];
  for (let r = 0; r < rows; r++) {
    const week = [];
    for (let c = 0; c < 7; c++) { week.push(day); day = addDays(day, 1); }
    weeks.push(week);
  }
  return weeks;
}
