import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { createStore } from '../src/store.js';
import { parseNok, fmtNok, escapeHtml } from '../src/security.js';

function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'julegaver-test-'));
  const store = createStore(path.join(dir, 'db.json'));
  const server = createApp({ store });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, store, dir, base: `http://127.0.0.1:${server.address().port}` }),
    ),
  );
}

function client(base) {
  let cookie = '';
  async function req(method, p, body) {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    let payload;
    if (body !== undefined) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      payload = new URLSearchParams(body).toString();
    }
    const res = await fetch(base + p, { method, headers, body: payload, redirect: 'manual' });
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
    for (const c of setCookies) {
      if (/Max-Age=0/.test(c)) cookie = '';
      else cookie = c.split(';')[0];
    }
    return { status: res.status, location: res.headers.get('location'), text: await res.text() };
  }
  return {
    get: (p) => req('GET', p),
    post: (p, body) => req('POST', p, body),
  };
}

function csrfOf(html) {
  const m = html.match(/name="csrf" value="([^"]+)"/);
  assert.ok(m, 'fant ikke csrf-token i HTML');
  return m[1];
}

function wishIdOf(html) {
  const m = html.match(/data-wish="([a-f0-9-]{36})"/);
  assert.ok(m, 'fant ikke data-wish i HTML');
  return m[1];
}

function pledgeIdOf(html) {
  const m = html.match(/\/pledges\/([a-f0-9-]{36})\/delete/);
  assert.ok(m, 'fant ikke pledge-id i HTML');
  return m[1];
}

async function registerFamily(base, { familyName, name, username, password, code }) {
  const c = client(base);
  const body = code
    ? { mode: 'join', familyCode: code, name, username, password }
    : { mode: 'create', familyName, name, username, password };
  const r = await c.post('/register', body);
  assert.equal(r.status, 303);
  assert.equal(r.location, '/');
  return c;
}

function familyCodeOf(dashboardHtml) {
  const m = dashboardHtml.match(/<code class="code">([A-Z2-9]{8})<\/code>/);
  assert.ok(m, 'fant ikke familiekode på oversikten');
  return m[1];
}

test('parseNok og fmtNok håndterer norske beløp', () => {
  assert.equal(parseNok('200'), 20000);
  assert.equal(parseNok('199,50'), 19950);
  assert.equal(parseNok('199.50'), 19950);
  assert.equal(parseNok('1.234,50'), 123450);
  assert.equal(parseNok('1 000 kr'), 100000);
  assert.equal(parseNok('abc'), null);
  assert.equal(parseNok(''), null);
  assert.equal(parseNok('-5'), null);
  assert.match(fmtNok(19950), /199,50\s?kr/);
  assert.match(fmtNok(123450), /1[\s ]234,50\s?kr/);
});

test('escapeHtml escaper farlige tegn', () => {
  assert.equal(escapeHtml('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
});

test('registrering, innlogging, utlogging', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const c = client(base);
  let r = await c.get('/register');
  assert.equal(r.status, 200);
  assert.match(r.text, /Opprett ny familie/);

  r = await c.post('/register', { mode: 'create', familyName: '', name: 'Anna', username: 'anna', password: 'passord123' });
  assert.equal(r.status, 400);
  assert.match(r.text, /Familienavnet/);

  r = await c.post('/register', { mode: 'create', familyName: 'Familien Hansen', name: 'Anna', username: 'anna', password: 'kort' });
  assert.equal(r.status, 400);
  assert.match(r.text, /minst 8 tegn/);

  r = await c.post('/register', { mode: 'create', familyName: 'Familien Hansen', name: 'Anna', username: 'anna', password: 'passord123' });
  assert.equal(r.status, 303);
  assert.equal(r.location, '/');

  r = await c.get('/');
  assert.equal(r.status, 200);
  assert.match(r.text, /Familien Hansen/);
  assert.match(r.text, /Hei, Anna/);

  const dup = client(base);
  r = await dup.post('/register', { mode: 'create', familyName: 'Annen', name: 'X', username: 'ANNA', password: 'passord123' });
  assert.equal(r.status, 400);
  assert.match(r.text, /allerede i bruk/);

  const wrong = client(base);
  r = await wrong.post('/login', { username: 'anna', password: 'feilpassord' });
  assert.equal(r.status, 401);

  const ok = client(base);
  r = await ok.post('/login', { username: 'anna', password: 'passord123' });
  assert.equal(r.status, 303);
  r = await ok.get('/');
  assert.equal(r.status, 200);

  const csrf = csrfOf(r.text);
  r = await ok.post('/logout', { csrf });
  assert.equal(r.status, 303);
  r = await ok.get('/');
  assert.equal(r.status, 303);
  assert.equal(r.location, '/login');
});

test('kjøpsmarkering er synlig for andre, men hemmelig for eieren', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const anna = await registerFamily(base, { familyName: 'Familien Hansen', name: 'Anna', username: 'anna', password: 'passord123' });
  const code = familyCodeOf((await anna.get('/')).text);
  const bjorn = await registerFamily(base, { name: 'Bjørn', username: 'bjorn', password: 'passord123', code });

  let r = await anna.get('/u/anna');
  const csrfAnna = csrfOf(r.text);
  r = await anna.post('/wishes', { csrf: csrfAnna, title: 'Ullgenser', description: 'Str M, blå', url: 'https://eksempel.no/genser', price: '499,50' });
  assert.equal(r.status, 303);

  r = await anna.get('/u/anna');
  const id = wishIdOf(r.text);
  assert.match(r.text, /Ullgenser/);
  assert.match(r.text, /499,50/);

  r = await bjorn.get('/u/anna');
  assert.equal(r.status, 200);
  assert.match(r.text, /Ullgenser/);
  assert.match(r.text, /Marker som kjøpt/);
  assert.match(r.text, /0 av 1 ønsker er kjøpt/);

  const csrfBjorn = csrfOf(r.text);
  r = await bjorn.post(`/wishes/${id}/toggle-buy`, { csrf: csrfBjorn });
  assert.equal(r.status, 303);

  r = await bjorn.get('/u/anna');
  assert.match(r.text, /Kjøpt av deg/);
  assert.match(r.text, /1 av 1 ønsker er kjøpt/);

  r = await anna.get('/u/anna');
  assert.match(r.text, /Ullgenser/);
  assert.ok(!r.text.includes('Kjøpt av'), 'eier skal ikke se kjøpsstatus');
  assert.ok(!r.text.includes('toggle-buy'), 'eier skal ikke se kjøpsknapp');
  assert.ok(!r.text.includes('Spleis'), 'eier skal ikke se spleisexjon');

  r = await bjorn.get('/');
  assert.match(r.text, /1 av 1 kjøpt/);
  r = await anna.get('/');
  assert.ok(!r.text.includes('1 av 1 kjøpt'), 'eier skal ikke se kjøpstatistikk for seg selv');

  r = await bjorn.post(`/wishes/${id}/toggle-buy`, { csrf: csrfOf((await bjorn.get('/u/anna')).text) });
  assert.equal(r.status, 303);
  r = await bjorn.get('/u/anna');
  assert.match(r.text, /Marker som kjøpt/);
  assert.match(r.text, /0 av 1 ønsker er kjøpt/);
});

test('spleising: bidrag vises for andre, skjules for eier, fullfinansiering', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const anna = await registerFamily(base, { familyName: 'Familien Hansen', name: 'Anna', username: 'anna', password: 'passord123' });
  const code = familyCodeOf((await anna.get('/')).text);
  const bjorn = await registerFamily(base, { name: 'Bjørn', username: 'bjorn', password: 'passord123', code });
  const cecilie = await registerFamily(base, { name: 'Cecilie', username: 'cecilie', password: 'passord123', code });

  let r = await anna.get('/u/anna');
  await anna.post('/wishes', { csrf: csrfOf(r.text), title: 'Sykkel', description: '', url: '', price: '199,50' });
  r = await anna.get('/u/anna');
  const id = wishIdOf(r.text);

  r = await bjorn.get('/u/anna');
  r = await bjorn.post(`/wishes/${id}/pledge`, { csrf: csrfOf(r.text), amount: '100' });
  assert.equal(r.status, 303);

  r = await bjorn.post(`/wishes/${id}/pledge`, { csrf: csrfOf((await bjorn.get('/u/anna')).text), amount: 'ikke et tall' });
  assert.equal(r.status, 303);
  assert.match(r.location, /error=/);

  r = await cecilie.get('/u/anna');
  r = await cecilie.post(`/wishes/${id}/pledge`, { csrf: csrfOf(r.text), amount: '99,50' });
  assert.equal(r.status, 303);

  r = await bjorn.get('/u/anna');
  assert.match(r.text, /100,00\s?kr/);
  assert.match(r.text, /99,50\s?kr/);
  assert.match(r.text, /Bjørn/);
  assert.match(r.text, /fullfinansiert/);
  assert.match(r.text, /199,50\s?kr av 199,50\s?kr/);

  r = await anna.get('/u/anna');
  assert.ok(!r.text.includes('Spleis'), 'eier skal ikke se spleis');
  assert.ok(!r.text.includes('100,00'), 'eier skal ikke se bidrag');

  const bjornPage = (await bjorn.get('/u/anna')).text;
  const pledgeId = pledgeIdOf(bjornPage);
  r = await cecilie.post(`/pledges/${pledgeId}/delete`, { csrf: csrfOf((await cecilie.get('/u/anna')).text) });
  assert.equal(r.status, 403, 'kan ikke fjerne andres bidrag');
  r = await bjorn.post(`/pledges/${pledgeId}/delete`, { csrf: csrfOf(bjornPage) });
  assert.equal(r.status, 303);
  r = await cecilie.get('/u/anna');
  assert.ok(!r.text.includes('100,00'), 'fjernet bidrag skal være borte');
  assert.match(r.text, /99,50\s?kr/);

  const ceciliePage = (await cecilie.get('/u/anna')).text;
  r = await cecilie.post(`/pledges/${pledgeIdOf(ceciliePage)}/delete`, { csrf: csrfOf(ceciliePage) });
  assert.equal(r.status, 303);
  r = await bjorn.get('/u/anna');
  assert.match(r.text, /Ingen har spleiset ennå/);
});

test('tilgangskontroll: CSRF, egne ønsker, andre familier', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const anna = await registerFamily(base, { familyName: 'Familien Hansen', name: 'Anna', username: 'anna', password: 'passord123' });
  const code = familyCodeOf((await anna.get('/')).text);
  const bjorn = await registerFamily(base, { name: 'Bjørn', username: 'bjorn', password: 'passord123', code });

  let r = await anna.get('/u/anna');
  await anna.post('/wishes', { csrf: csrfOf(r.text), title: 'Gave', description: '', url: '', price: '' });
  r = await anna.get('/u/anna');
  const id = wishIdOf(r.text);

  r = await anna.post('/wishes', { title: 'uten csrf' });
  assert.equal(r.status, 403);

  r = await anna.post(`/wishes/${id}/toggle-buy`, { csrf: csrfOf((await anna.get('/u/anna')).text) });
  assert.equal(r.status, 403);

  r = await anna.post(`/wishes/${id}/pledge`, { csrf: csrfOf((await anna.get('/u/anna')).text), amount: '50' });
  assert.equal(r.status, 403);

  r = await anna.post(`/wishes/${id}/delete`, { csrf: 'feil-token' });
  assert.equal(r.status, 403);

  const outsider = await registerFamily(base, { familyName: 'En annen familie', name: 'Ola', username: 'ola', password: 'passord123' });
  r = await outsider.get('/u/anna');
  assert.equal(r.status, 404);
  r = await outsider.get('/u/bjorn');
  assert.equal(r.status, 404);
  r = await outsider.post(`/wishes/${id}/toggle-buy`, { csrf: csrfOf((await outsider.get('/')).text) });
  assert.equal(r.status, 404);

  r = await bjorn.post('/register', { mode: 'join', familyCode: 'FEILKODE', name: 'X', username: 'x1', password: 'passord123' });
  assert.equal(r.status, 400);
  assert.match(r.text, /Fant ingen familie/);

  r = await client(base).get('/');
  assert.equal(r.status, 303);
  assert.equal(r.location, '/login');

  r = await bjorn.get('/u/ikke-eksisterende');
  assert.equal(r.status, 404);

  assert.ok(code);
});

test('brukerinnhold escapes (XSS) og eier kan redigere/slette eget ønske', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const anna = await registerFamily(base, { familyName: 'Familien Hansen', name: 'Anna', username: 'anna', password: 'passord123' });
  const code = familyCodeOf((await anna.get('/')).text);
  const bjorn = await registerFamily(base, { name: 'Bjørn', username: 'bjorn', password: 'passord123', code });

  let r = await anna.get('/u/anna');
  const csrf = csrfOf(r.text);
  r = await anna.post('/wishes', { csrf, title: 'Test', description: '', url: 'javascript:alert(1)', price: '' });
  assert.equal(r.status, 303);
  assert.match(r.location, /error=/, 'ugyldig lenke skal avvises');

  r = await anna.post('/wishes', { csrf, title: '<script>alert(1)</script>', description: '<b>fet</b>', url: '', price: '' });
  assert.equal(r.status, 303);

  r = await bjorn.get('/u/anna');
  assert.ok(!r.text.includes('<script>alert(1)</script>'), 'rå script skal ikke forekomme');
  assert.match(r.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  r = await anna.get('/u/anna');
  assert.match(r.text, /&lt;b&gt;fet&lt;\/b&gt;/);

  const id = wishIdOf(r.text);
  r = await anna.post(`/wishes/${id}/edit`, { csrf, title: 'Snill genser', description: '', url: '', price: '100' });
  assert.equal(r.status, 303);
  r = await anna.get('/u/anna');
  assert.match(r.text, /Snill genser/);
  assert.match(r.text, /100,00/);

  r = await anna.post(`/wishes/${id}/delete`, { csrf });
  assert.equal(r.status, 303);
  r = await anna.get('/u/anna');
  assert.ok(!r.text.includes('Snill genser'));
});

test('data lagres til fil og lastes ved omstart', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'julegaver-persist-'));
  const file = path.join(dir, 'db.json');

  let store = createStore(file);
  let server = createApp({ store });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const c = client(base);
  await c.post('/register', { mode: 'create', familyName: 'Familien Hansen', name: 'Anna', username: 'anna', password: 'passord123' });
  let r = await c.get('/u/anna');
  await c.post('/wishes', { csrf: csrfOf(r.text), title: ' persisted ', description: '', url: '', price: '' });
  await new Promise((r2) => server.close(r2));

  assert.ok(fs.existsSync(file));
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(Object.keys(onDisk.users).length === 1);
  assert.ok(Object.keys(onDisk.wishes).length === 1);

  store = createStore(file);
  server = createApp({ store });
  await new Promise((r2) => server.listen(0, '127.0.0.1', r2));
  const base2 = `http://127.0.0.1:${server.address().port}`;
  const c2 = client(base2);
  r = await c2.post('/login', { username: 'anna', password: 'passord123' });
  assert.equal(r.status, 303);
  r = await c2.get('/u/anna');
  assert.match(r.text, /persisted/);
  await new Promise((r2) => server.close(r2));
});
