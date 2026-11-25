// Tests for the /ics-to-gcal/api/extract route in the site Worker, with Workers AI stubbed.
//   node --test ics-to-gcal/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../worker.js';

const IMG = 'data:image/jpeg;base64,' + 'A'.repeat(100);
const GOOD = { events: [{ title: 'Dinner', date: '2026-11-28', end_date: '', start_time: '19:00', end_time: '',
  all_day: false, time_zone: '', location: '', description: '', questions: [] }], notes: '' };

function env({ password = 'pw', aiResult = { response: GOOD }, aiError } = {}) {
  const calls = [];
  return {
    calls,
    ICS_TO_GCAL_PASSWORD: password,
    ASSETS: { fetch: req => new Response('asset ' + new URL(req.url).pathname) },
    AI: { run: async (model, input) => { calls.push({ model, input }); if (aiError) throw aiError; return aiResult; } }
  };
}

const post = (body, headers = {}) => new Request('https://tools.evanyoung.dev/ics-to-gcal/api/extract', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-tool-password': 'pw', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body)
});
const okBody = { image: IMG, today: '2026-11-25', timeZone: 'America/Los_Angeles', hint: '' };

test('other paths fall through to static assets', async () => {
  const res = await worker.fetch(new Request('https://tools.evanyoung.dev/nope'), env());
  assert.equal(await res.text(), 'asset /nope');
});

test('only POST is accepted', async () => {
  const res = await worker.fetch(new Request('https://tools.evanyoung.dev/ics-to-gcal/api/extract'), env());
  assert.equal(res.status, 405);
});

test('a wrong or missing password is refused before any model call', async () => {
  const e = env();
  assert.equal((await worker.fetch(post(okBody, { 'x-tool-password': 'nope' }), e)).status, 401);
  const noHeader = new Request('https://tools.evanyoung.dev/ics-to-gcal/api/extract', { method: 'POST', body: JSON.stringify(okBody) });
  assert.equal((await worker.fetch(noHeader, e)).status, 401);
  assert.equal(e.calls.length, 0);
});

test('an unset password secret means the route is off', async () => {
  const res = await worker.fetch(post(okBody), env({ password: '' }));
  assert.equal(res.status, 503);
});

test('bad bodies are rejected', async () => {
  assert.equal((await worker.fetch(post('not json'), env())).status, 400);
  assert.equal((await worker.fetch(post({ ...okBody, image: 'https://example.com/a.png' }), env())).status, 400);
  assert.equal((await worker.fetch(post({ ...okBody, today: 'yesterday' }), env())).status, 400);
});

test('a good request sends the image and prompt to the model and returns clean events', async () => {
  const e = env();
  const res = await worker.fetch(post({ ...okBody, hint: 'at my place' }), e);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.events[0].title, 'Dinner');
  assert.equal(data.events[0].start_time, '19:00');
  const { input } = e.calls[0];
  const content = input.messages.at(-1).content;
  assert.ok(content.some(c => c.type === 'image_url' && c.image_url.url === IMG));
  assert.ok(content.some(c => c.type === 'text' && c.text.includes('at my place')));
  assert.equal(input.response_format.type, 'json_schema');
});

test('model output as a fenced string is still parsed', async () => {
  const res = await worker.fetch(post(okBody), env({ aiResult: { response: '```json\n' + JSON.stringify(GOOD) + '\n```' } }));
  assert.equal((await res.json()).events[0].title, 'Dinner');
});

test('OpenAI-style choices output is parsed too', async () => {
  const res = await worker.fetch(post(okBody), env({ aiResult: { choices: [{ message: { content: JSON.stringify(GOOD) } }] } }));
  assert.equal((await res.json()).events[0].title, 'Dinner');
});

test('a model failure becomes a 502 with a readable error', async () => {
  const res = await worker.fetch(post(okBody), env({ aiError: new Error('3036: account limit reached') }));
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /limit/);
});
