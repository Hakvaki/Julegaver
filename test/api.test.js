'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');

let server;
let base;
let db;

before(async () => {
  const app = createApp(':memory:');
  server = app.server;
  db = app.db;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

class Client {
  constructor() {
    this.cookie = null;
  }
  async req(path, { method = 'GET', body, headers: extraHeaders } = {}) {
    const headers = { ...extraHeaders };
    if (this.cookie) headers.cookie = this.cookie;
    if (body) headers['content-type'] = 'application/json';
    const res = await fetch(base + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of setCookies) {
      const [pair] = c.split(';');
      const idx = pair.indexOf('=');
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (value === '' || /Max-Age=0/.test(c)) this.cookie = null;
      else if (name) this.cookie = `${name}=${value}`;
    }
    let data = null;
    try { data = await res.json(); } catch { /* ignore */ }
    return { status: res.status, data, setCookies };
  }
  post(path, body) { return this.req(path, { method: 'POST', body }); }
  put(path, body) { return this.req(path, { method: 'PUT', body }); }
  del(path) { return this.req(path, { method: 'DELETE' }); }
}

async function register(username) {
  const c = new Client();
  const res = await c.post('/api/auth/register', { username, password: 'passord123' });
  assert.equal(res.status, 200);
  return c;
}

test('registrering, validering og duplikat', async () => {
  const c = new Client();
  let res = await c.post('/api/auth/register', { username: 'a', password: 'passord123' });
  assert.equal(res.status, 400); // for kort brukernavn
  res = await c.post('/api/auth/register', { username: 'ok_bruker', password: '123' });
  assert.equal(res.status, 400); // for kort passord
  res = await c.post('/api/auth/register', { username: 'ok_bruker', password: 'passord123' });
  assert.equal(res.status, 200);
  assert.equal(res.data.user.username, 'ok_bruker');
  res = await c.post('/api/auth/register', { username: 'OK_Bruker', password: 'passord123' });
  assert.equal(res.status, 409); // duplikat (case-insensitive)
  res = await c.post('/api/auth/login', { username: 'ok_bruker', password: 'feil passord' });
  assert.equal(res.status, 401);
  res = await c.post('/api/auth/login', { username: 'ok_bruker', password: 'passord123' });
  assert.equal(res.status, 200);
});

test('hel flyt: familie, lister, kjøp, spleis og hemmelighold', async () => {
  const alice = await register('alice');
  const bob = await register('bob');
  const carol = await register('carol');
  const outsider = await register('outsider');

  // Alice oppretter familie
  let res = await alice.post('/api/families', { name: 'Familien Test' });
  assert.equal(res.status, 201);
  const familyId = res.data.family.id;
  const inviteCode = res.data.family.inviteCode;
  assert.ok(familyId && inviteCode);
  assert.equal(res.data.family.role, 'admin');

  // Uten innlogging / uten medlemskap
  res = await outsider.req(`/api/families/${familyId}/lists`);
  assert.equal(res.status, 403);
  const anon = new Client();
  res = await anon.req(`/api/families/${familyId}/lists`);
  assert.equal(res.status, 401);

  // Bob blir med via kode
  res = await bob.post('/api/families/join', { inviteCode: inviteCode.toLowerCase() });
  assert.equal(res.status, 200);
  res = await bob.post('/api/families/join', { inviteCode: 'FEILKODE' });
  assert.equal(res.status, 404);

  // Carol blir med også
  res = await carol.post('/api/families/join', { inviteCode: inviteCode });
  assert.equal(res.status, 200);

  // Alice legger til et ønske
  res = await alice.post(`/api/families/${familyId}/items`, {
    title: 'Ullgenser',
    description: 'Str. L, gjerne mørk',
    url: 'https://example.com/genser',
    price: 1299,
    priority: 3,
  });
  assert.equal(res.status, 201);
  const itemId = res.data.item.id;
  assert.equal(res.data.item.isMine, true);
  assert.equal(res.data.item.claims, null); // eier ser aldri claims

  // Bob legger til et ønske
  res = await bob.post(`/api/families/${familyId}/items`, { title: 'Brettspill', price: 499 });
  assert.equal(res.status, 201);
  const bobItemId = res.data.item.id;

  // Validering
  res = await alice.post(`/api/families/${familyId}/items`, { title: '' });
  assert.equal(res.status, 400);
  res = await alice.post(`/api/families/${familyId}/items`, { title: 'X', url: 'ikke-en-url' });
  assert.equal(res.status, 400);

  // Bob ser listene: Alice sitt ønske er synlig, eget skjult claims
  res = await bob.req(`/api/families/${familyId}/lists`);
  assert.equal(res.status, 200);
  const members = res.data.members;
  assert.equal(members.length, 3);
  const aliceEntry = members.find((m) => m.username === 'alice');
  const bobEntry = members.find((m) => m.username === 'bob');
  const aliceItem = aliceEntry.items.find((i) => i.id === itemId);
  assert.equal(aliceItem.isMine, false);
  assert.equal(aliceItem.myClaim, null);
  assert.deepEqual(aliceItem.claims, []);
  const bobItem = bobEntry.items.find((i) => i.id === bobItemId);
  assert.equal(bobItem.isMine, true);
  assert.equal(bobItem.claims, null);

  // Alice kan ikke reservere/kjøpe eget ønske
  res = await alice.post(`/api/items/${itemId}/claim`, { status: 'bought' });
  assert.equal(res.status, 403);

  // Bob reserverer deretter kjøper
  res = await bob.post(`/api/items/${itemId}/claim`, { status: 'reserved' });
  assert.equal(res.status, 200);
  assert.equal(res.data.item.myClaim, 'reserved');
  res = await bob.post(`/api/items/${itemId}/claim`, { status: 'bought' });
  assert.equal(res.status, 200);
  assert.equal(res.data.item.myClaim, 'bought');
  res = await bob.post(`/api/items/${itemId}/claim`, { status: 'tull' });
  assert.equal(res.status, 400);

  // Alice ser fortsatt ingenting om kjøpet (overraskelsen er bevart)
  res = await alice.req(`/api/families/${familyId}/lists`);
  const aliceView = res.data.members.find((m) => m.username === 'alice').items.find((i) => i.id === itemId);
  assert.equal(aliceView.claims, null);
  assert.equal(aliceView.spleise, null);
  assert.equal(aliceView.myClaim, null);

  // Carol ser at Bob har kjøpt
  res = await carol.req(`/api/families/${familyId}/lists`);
  const carolView = res.data.members.find((m) => m.username === 'alice').items.find((i) => i.id === itemId);
  assert.equal(carolView.claims.length, 1);
  assert.equal(carolView.claims[0].status, 'bought');
  assert.equal(carolView.claims[0].username, 'bob');

  // Bob angrer kjøpet
  res = await bob.del(`/api/items/${itemId}/claim`);
  assert.equal(res.status, 200);
  assert.equal(res.data.item.myClaim, null);

  // Spleis: Carol starter spleis på Alice sitt ønske
  res = await carol.post(`/api/items/${itemId}/spleise`, { target: 1299 });
  assert.equal(res.status, 201);
  const spleiseId = res.data.spleise.id;
  assert.equal(res.data.spleise.contributed, 0);

  // Kun én åpen spleis om gangen
  res = await bob.post(`/api/items/${itemId}/spleise`, { target: 500 });
  assert.equal(res.status, 409);

  // Eier kan ikke spleise på eget ønske
  res = await alice.post(`/api/items/${itemId}/spleise`, { target: 100 });
  assert.equal(res.status, 403);

  // Bidrag
  res = await carol.post(`/api/spleises/${spleiseId}/contribute`, { amount: 800 });
  assert.equal(res.status, 201);
  assert.equal(res.data.spleise.contributed, 800);
  res = await bob.post(`/api/spleises/${spleiseId}/contribute`, { amount: 499 });
  assert.equal(res.status, 201);
  assert.equal(res.data.spleise.contributed, 1299);
  assert.equal(res.data.spleise.isFull, true);
  res = await alice.post(`/api/spleises/${spleiseId}/contribute`, { amount: 1 });
  assert.equal(res.status, 403); // eier kan ikke bidra
  res = await carol.post(`/api/spleises/${spleiseId}/contribute`, { amount: -5 });
  assert.equal(res.status, 400);

  // Utenforstående har ikke tilgang
  res = await outsider.post(`/api/spleises/${spleiseId}/contribute`, { amount: 10 });
  assert.equal(res.status, 403);

  // Hent spleisen på nytt via listene for å finne bidragene
  res = await carol.req(`/api/families/${familyId}/lists`);
  const spView = res.data.members.find((m) => m.username === 'alice').items.find((i) => i.id === itemId).spleise;
  assert.equal(spView.contributors.length, 2);

  // Carol fjerner eget bidrag, legger til igjen
  const carolContrib = spView.contributors.find((c) => c.username === 'carol');
  res = await carol.del(`/api/spleises/${spleiseId}/contributions/${carolContrib.id}`);
  assert.equal(res.status, 200);
  res = await carol.post(`/api/spleises/${spleiseId}/contribute`, { amount: 800 });
  assert.equal(res.status, 201);
  const carolContribNew = res.data.spleise.contributors.find((c) => c.username === 'carol');

  // Bob kan ikke fjerne Carols bidrag
  res = await bob.del(`/api/spleises/${spleiseId}/contributions/${carolContribNew.id}`);
  assert.equal(res.status, 403);

  // Lukk spleisen som "kjøpt sammen"
  res = await carol.post(`/api/spleises/${spleiseId}/close`, { boughtTogether: true });
  assert.equal(res.status, 200);
  assert.equal(res.data.spleise.status, 'closed');
  assert.equal(res.data.spleise.boughtTogether, true);

  // Bidrag på lukket spleis avvises
  res = await bob.post(`/api/spleises/${spleiseId}/contribute`, { amount: 10 });
  assert.equal(res.status, 409);

  // Bob (ikke skaper) kan ikke lukke
  res = await bob.post(`/api/spleises/${spleiseId}/reopen`);
  assert.equal(res.status, 403);

  // Carol ser spleisen i listene, Alice ser fortsatt ingenting
  res = await carol.req(`/api/families/${familyId}/lists`);
  const carolItem = res.data.members.find((m) => m.username === 'alice').items.find((i) => i.id === itemId);
  assert.equal(carolItem.spleise.status, 'closed');
  assert.equal(carolItem.spleise.contributors.length, 2);
  res = await alice.req(`/api/families/${familyId}/lists`);
  const aliceItem2 = res.data.members.find((m) => m.username === 'alice').items.find((i) => i.id === itemId);
  assert.equal(aliceItem2.spleise, null);

  // Redigering av eget ønske
  res = await alice.put(`/api/items/${itemId}`, { title: 'Ullgenser (oppdatert)', price: 1399, priority: 2 });
  assert.equal(res.status, 200);
  assert.equal(res.data.item.title, 'Ullgenser (oppdatert)');
  res = await bob.put(`/api/items/${itemId}`, { title: 'hack' });
  assert.equal(res.status, 403);

  // Sletting: kun eier kan slette sitt eget ønske
  res = await bob.del(`/api/items/${itemId}`); // alice sitt ønske
  assert.equal(res.status, 403);
  res = await alice.del(`/api/items/${bobItemId}`); // bob sitt ønske
  assert.equal(res.status, 403);
  res = await alice.del(`/api/items/${itemId}`); // eget ønske
  assert.equal(res.status, 200);
  res = await alice.req(`/api/families/${familyId}/lists`);
  assert.equal(res.data.members.find((m) => m.username === 'alice').items.length, 0);

  // Forlat familie
  res = await bob.post(`/api/families/${familyId}/leave`);
  assert.equal(res.status, 200);
  res = await bob.req(`/api/families/${familyId}/lists`);
  assert.equal(res.status, 403);
  res = await alice.req(`/api/families/${familyId}/lists`);
  assert.equal(res.data.members.length, 2);
});

test('admin kan bytte kode og fjerne medlemmer', async () => {
  const admin = await register('admin1');
  const member = await register('medlem1');
  let res = await admin.post('/api/families', { name: 'Admin-familie' });
  const familyId = res.data.family.id;
  const oldCode = res.data.family.inviteCode;
  res = await member.post('/api/families/join', { inviteCode: oldCode });
  assert.equal(res.status, 200);

  // Medlem kan ikke bytte kode
  res = await member.post(`/api/families/${familyId}/rotate-code`);
  assert.equal(res.status, 403);

  // Admin bytter kode; gammel kode virker ikke lenger
  res = await admin.post(`/api/families/${familyId}/rotate-code`);
  assert.equal(res.status, 200);
  assert.notEqual(res.data.family.inviteCode, oldCode);
  const stranger = await register('fremmed1');
  res = await stranger.post('/api/families/join', { inviteCode: oldCode });
  assert.equal(res.status, 404);

  // Admin fjerner medlem
  const fam = await admin.req(`/api/families/${familyId}`);
  const memberId = fam.data.family.members.find((m) => m.username === 'medlem1').id;
  res = await admin.del(`/api/families/${familyId}/members/${memberId}`);
  assert.equal(res.status, 200);
  res = await member.req(`/api/families/${familyId}/lists`);
  assert.equal(res.status, 403);
});

test('statiske filer serveres', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Julegaver/);
  const resJs = await fetch(base + '/app.js');
  assert.equal(resJs.status, 200);
  const resTraversal = await fetch(base + '/../server.js');
  assert.equal(resTraversal.status, 404);
});

test('sesjonstoken lagres kun hashet i databasen', async () => {
  const c = new Client();
  const res = await c.post('/api/auth/register', { username: 'hashuser', password: 'passord123' });
  assert.equal(res.status, 200);
  const cookieToken = c.cookie.split('=')[1];
  const rows = db.prepare('SELECT token FROM sessions').all();
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.token !== cookieToken));
  assert.ok(rows.every((r) => /^[a-f0-9]{64}$/.test(r.token)));
  const me = await c.req('/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.user.username, 'hashuser');
});

test('HTTPS (x-forwarded-proto) gir Secure-flagg på sesjons-cookie', async () => {
  const c = new Client();
  const res = await c.req('/api/auth/register', {
    method: 'POST',
    body: { username: 'secureuser', password: 'passord123' },
    headers: { 'x-forwarded-proto': 'https' },
  });
  assert.equal(res.status, 200);
  const sessionCookieHeader = res.setCookies.find((c2) => c2.startsWith('julegaver_session='));
  assert.ok(sessionCookieHeader);
  assert.match(sessionCookieHeader, /Secure/);
  assert.match(sessionCookieHeader, /HttpOnly/);

  const plain = new Client();
  const res2 = await plain.post('/api/auth/register', { username: 'plainuser', password: 'passord123' });
  const plainCookie = res2.setCookies.find((c2) => c2.startsWith('julegaver_session='));
  assert.ok(plainCookie);
  assert.doesNotMatch(plainCookie, /Secure/);
});

test('innlogging er rate-limitet etter mange feilede forsøk', async () => {
  const c = new Client();
  await c.post('/api/auth/register', { username: 'rateuser', password: 'passord123' });
  let last;
  for (let i = 0; i < 12; i++) {
    last = await c.post('/api/auth/login', { username: 'rateuser', password: 'feil passord' });
  }
  assert.equal(last.status, 429);
  const withCorrectPassword = await c.post('/api/auth/login', { username: 'rateuser', password: 'passord123' });
  assert.equal(withCorrectPassword.status, 429);
});
