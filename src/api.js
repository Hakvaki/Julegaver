'use strict';

const { HttpError, sendJson } = require('./http');
const {
  hashPassword,
  verifyPassword,
  newId,
  makeInviteCode,
  createSession,
  destroySession,
  sessionCookie,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} = require('./auth');

const USERNAME_RE = /^[\p{L}\p{N}_.-]{2,30}$/u;

function cleanString(value, max) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function cleanPrice(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100000000) {
    throw new HttpError(400, 'Ugyldig pris');
  }
  return Math.round(n * 100) / 100;
}

function cleanUrl(value) {
  const url = cleanString(value, 500);
  if (!url) return '';
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpError(400, 'Ugyldig lenke (må starte med http:// eller https://)');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new HttpError(400, 'Ugyldig lenke (kun http/https)');
  }
  return parsed.toString();
}

function cleanPriority(value) {
  const n = Number(value ?? 2);
  if (![1, 2, 3].includes(n)) throw new HttpError(400, 'Ugyldig prioritet');
  return n;
}

function requireUser(ctx) {
  if (!ctx.user) throw new HttpError(401, 'Du må være logget inn');
  return ctx.user;
}

function getMember(db, familyId, userId) {
  return db
    .prepare('SELECT family_id, user_id, role, joined_at FROM family_members WHERE family_id = ? AND user_id = ?')
    .get(familyId, userId);
}

function requireMember(db, familyId, userId) {
  const family = db.prepare('SELECT id FROM families WHERE id = ?').get(familyId);
  if (!family) throw new HttpError(404, 'Fant ikke familien');
  const member = getMember(db, familyId, userId);
  if (!member) throw new HttpError(403, 'Du er ikke medlem av denne familien');
  return member;
}

function getItem(db, itemId) {
  return db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
}

function requireItemForMember(db, itemId, userId) {
  const item = getItem(db, itemId);
  if (!item) throw new HttpError(404, 'Fant ikke ønsket');
  requireMember(db, item.family_id, userId);
  return item;
}

function removeMemberData(db, familyId, userId) {
  db.prepare(
    'DELETE FROM claims WHERE user_id = ? AND item_id IN (SELECT id FROM items WHERE family_id = ?)'
  ).run(userId, familyId);
  db.prepare(
    `DELETE FROM contributions WHERE user_id = ?
     AND spleise_id IN (SELECT s.id FROM spleises s JOIN items i ON i.id = s.item_id WHERE i.family_id = ?)`
  ).run(userId, familyId);
  db.prepare('DELETE FROM items WHERE family_id = ? AND owner_id = ?').run(familyId, userId);
  db.prepare('DELETE FROM family_members WHERE family_id = ? AND user_id = ?').run(familyId, userId);
}

function spleiseToJson(db, spleise, viewerId, item) {
  const contributors = db
    .prepare(
      `SELECT c.id, c.amount, c.created_at, u.id AS user_id, u.username
       FROM contributions c JOIN users u ON u.id = c.user_id
       WHERE c.spleise_id = ? ORDER BY c.created_at`
    )
    .all(spleise.id);
  const contributed = contributors.reduce((sum, c) => sum + c.amount, 0);
  const myContribution = contributors.find((c) => c.user_id === viewerId) || null;
  return {
    id: spleise.id,
    itemId: spleise.item_id,
    target: spleise.target,
    contributed: Math.round(contributed * 100) / 100,
    status: spleise.status,
    boughtTogether: !!spleise.bought_together,
    createdBy: spleise.created_by,
    isCreator: spleise.created_by === viewerId,
    contributors: contributors.map((c) => ({
      id: c.id,
      username: c.username,
      amount: c.amount,
      mine: c.user_id === viewerId,
    })),
    myContributionId: myContribution ? myContribution.id : null,
    isFull: contributed >= spleise.target,
  };
}

function itemToJson(db, item, viewerId) {
  const base = {
    id: item.id,
    familyId: item.family_id,
    ownerId: item.owner_id,
    title: item.title,
    description: item.description,
    url: item.url,
    price: item.price,
    priority: item.priority,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
  if (item.owner_id === viewerId) {
    return { ...base, isMine: true, myClaim: null, claims: null, spleise: null };
  }
  const claims = db
    .prepare(
      `SELECT u.username, c.status FROM claims c JOIN users u ON u.id = c.user_id
       WHERE c.item_id = ? ORDER BY c.created_at`
    )
    .all(item.id);
  const myClaim = db
    .prepare('SELECT status FROM claims WHERE item_id = ? AND user_id = ?')
    .get(item.id, viewerId);
  const spleiseRow = db
    .prepare('SELECT * FROM spleises WHERE item_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(item.id);
  return {
    ...base,
    isMine: false,
    myClaim: myClaim ? myClaim.status : null,
    claims,
    spleise: spleiseRow ? spleiseToJson(db, spleiseRow, viewerId, item) : null,
  };
}

function familyToJson(db, family, member) {
  const members = db
    .prepare(
      `SELECT u.id, u.username, m.role, m.joined_at
       FROM family_members m JOIN users u ON u.id = m.user_id
       WHERE m.family_id = ? ORDER BY m.joined_at`
    )
    .all(family.id);
  return {
    id: family.id,
    name: family.name,
    inviteCode: family.invite_code,
    role: member ? member.role : null,
    createdAt: family.created_at,
    members: members.map((m) => ({
      id: m.id,
      username: m.username,
      role: m.role,
      joinedAt: m.joined_at,
    })),
  };
}

function registerRoutes(router, db) {
  // ---------- Auth ----------
  router.add('POST', '/api/auth/register', (req, res, ctx) => {
    const username = cleanString(ctx.body.username, 30);
    const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
    if (!USERNAME_RE.test(username)) {
      throw new HttpError(400, 'Brukernavn må være 2-30 tegn (bokstaver, tall, _ . -)');
    }
    if (password.length < 6) throw new HttpError(400, 'Passordet må være minst 6 tegn');
    const id = newId();
    try {
      db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
        id,
        username,
        hashPassword(password),
        Date.now()
      );
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) {
        throw new HttpError(409, 'Brukernavnet er allerede i bruk');
      }
      throw err;
    }
    const session = createSession(db, id);
    sendAuth(res, { id, username, created_at: Date.now() }, session);
  });

  router.add('POST', '/api/auth/login', (req, res, ctx) => {
    const username = cleanString(ctx.body.username, 30);
    const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, 'Feil brukernavn eller passord');
    }
    const session = createSession(db, user.id);
    sendAuth(res, { id: user.id, username: user.username, created_at: user.created_at }, session);
  });

  router.add('POST', '/api/auth/logout', (req, res, ctx) => {
    const cookies = ctx.cookies;
    destroySession(db, cookies[SESSION_COOKIE]);
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  });

  router.add('GET', '/api/me', (req, res, ctx) => {
    const user = requireUser(ctx);
    const families = db
      .prepare(
        `SELECT f.id, f.name, f.created_at, m.role,
          (SELECT COUNT(*) FROM family_members mm WHERE mm.family_id = f.id) AS member_count
         FROM families f JOIN family_members m ON m.family_id = f.id
         WHERE m.user_id = ? ORDER BY f.created_at`
      )
      .all(user.id)
      .map((f) => ({
        id: f.id,
        name: f.name,
        role: f.role,
        memberCount: f.member_count,
        createdAt: f.created_at,
      }));
    sendJson(res, 200, { user, families });
  });

  // ---------- Familier ----------
  router.add('POST', '/api/families', (req, res, ctx) => {
    const user = requireUser(ctx);
    const name = cleanString(ctx.body.name, 60);
    if (!name) throw new HttpError(400, 'Familien må ha et navn');
    const id = newId();
    const now = Date.now();
    let code = makeInviteCode();
    while (db.prepare('SELECT id FROM families WHERE invite_code = ?').get(code)) {
      code = makeInviteCode();
    }
    db.prepare('INSERT INTO families (id, name, invite_code, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run(
      id,
      name,
      code,
      user.id,
      now
    );
    db.prepare('INSERT INTO family_members (family_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(
      id,
      user.id,
      'admin',
      now
    );
    const family = db.prepare('SELECT * FROM families WHERE id = ?').get(id);
    sendJson(res, 201, { family: familyToJson(db, family, getMember(db, id, user.id)) });
  });

  router.add('POST', '/api/families/join', (req, res, ctx) => {
    const user = requireUser(ctx);
    const code = cleanString(ctx.body.inviteCode, 20).toUpperCase();
    if (!code) throw new HttpError(400, 'Oppgi invitasjonskode');
    const family = db.prepare('SELECT * FROM families WHERE invite_code = ?').get(code);
    if (!family) throw new HttpError(404, 'Ugyldig invitasjonskode');
    const existing = getMember(db, family.id, user.id);
    if (!existing) {
      db.prepare('INSERT INTO family_members (family_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(
        family.id,
        user.id,
        'member',
        Date.now()
      );
    }
    sendJson(res, 200, { family: familyToJson(db, family, getMember(db, family.id, user.id)) });
  });

  router.add('GET', '/api/families/:id', (req, res, ctx) => {
    const user = requireUser(ctx);
    const member = requireMember(db, ctx.params.id, user.id);
    const family = db.prepare('SELECT * FROM families WHERE id = ?').get(ctx.params.id);
    sendJson(res, 200, { family: familyToJson(db, family, member) });
  });

  router.add('POST', '/api/families/:id/rotate-code', (req, res, ctx) => {
    const user = requireUser(ctx);
    const member = requireMember(db, ctx.params.id, user.id);
    if (member.role !== 'admin') throw new HttpError(403, 'Kun admin kan bytte invitasjonskode');
    let code = makeInviteCode();
    while (db.prepare('SELECT id FROM families WHERE invite_code = ?').get(code)) {
      code = makeInviteCode();
    }
    db.prepare('UPDATE families SET invite_code = ? WHERE id = ?').run(code, ctx.params.id);
    const family = db.prepare('SELECT * FROM families WHERE id = ?').get(ctx.params.id);
    sendJson(res, 200, { family: familyToJson(db, family, member) });
  });

  router.add('POST', '/api/families/:id/leave', (req, res, ctx) => {
    const user = requireUser(ctx);
    requireMember(db, ctx.params.id, user.id);
    removeMemberData(db, ctx.params.id, user.id);
    sendJson(res, 200, { ok: true });
  });

  router.add('DELETE', '/api/families/:id/members/:userId', (req, res, ctx) => {
    const user = requireUser(ctx);
    const member = requireMember(db, ctx.params.id, user.id);
    if (member.role !== 'admin') throw new HttpError(403, 'Kun admin kan fjerne medlemmer');
    if (ctx.params.userId === user.id) throw new HttpError(400, 'Bruk "forlat familie" for å fjerne deg selv');
    requireMember(db, ctx.params.id, ctx.params.userId);
    removeMemberData(db, ctx.params.id, ctx.params.userId);
    sendJson(res, 200, { ok: true });
  });

  // ---------- Ønskelister ----------
  router.add('GET', '/api/families/:id/lists', (req, res, ctx) => {
    const user = requireUser(ctx);
    requireMember(db, ctx.params.id, user.id);
    const family = db.prepare('SELECT * FROM families WHERE id = ?').get(ctx.params.id);
    const members = db
      .prepare(
        `SELECT u.id, u.username FROM family_members m JOIN users u ON u.id = m.user_id
         WHERE m.family_id = ? ORDER BY u.username COLLATE NOCASE`
      )
      .all(ctx.params.id);
    const items = db
      .prepare('SELECT * FROM items WHERE family_id = ? ORDER BY created_at')
      .all(ctx.params.id);
    const result = members.map((m) => ({
      id: m.id,
      username: m.username,
      items: items.filter((i) => i.owner_id === m.id).map((i) => itemToJson(db, i, user.id)),
    }));
    sendJson(res, 200, { family: { id: family.id, name: family.name }, members: result });
  });

  router.add('POST', '/api/families/:id/items', (req, res, ctx) => {
    const user = requireUser(ctx);
    requireMember(db, ctx.params.id, user.id);
    const data = validateItemInput(ctx.body);
    const id = newId();
    const now = Date.now();
    db.prepare(
      `INSERT INTO items (id, family_id, owner_id, title, description, url, price, priority, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, ctx.params.id, user.id, data.title, data.description, data.url, data.price, data.priority, now, now);
    sendJson(res, 201, { item: itemToJson(db, getItem(db, id), user.id) });
  });

  router.add('PUT', '/api/items/:id', (req, res, ctx) => {
    const user = requireUser(ctx);
    const item = getItem(db, ctx.params.id);
    if (!item) throw new HttpError(404, 'Fant ikke ønsket');
    if (item.owner_id !== user.id) throw new HttpError(403, 'Du kan bare redigere dine egne ønsker');
    requireMember(db, item.family_id, user.id);
    const data = validateItemInput(ctx.body);
    db.prepare(
      `UPDATE items SET title = ?, description = ?, url = ?, price = ?, priority = ?, updated_at = ?
       WHERE id = ?`
    ).run(data.title, data.description, data.url, data.price, data.priority, Date.now(), item.id);
    sendJson(res, 200, { item: itemToJson(db, getItem(db, item.id), user.id) });
  });

  router.add('DELETE', '/api/items/:id', (req, res, ctx) => {
    const user = requireUser(ctx);
    const item = getItem(db, ctx.params.id);
    if (!item) throw new HttpError(404, 'Fant ikke ønsket');
    if (item.owner_id !== user.id) throw new HttpError(403, 'Du kan bare slette dine egne ønsker');
    requireMember(db, item.family_id, user.id);
    db.prepare('DELETE FROM items WHERE id = ?').run(item.id);
    sendJson(res, 200, { ok: true });
  });

  // ---------- Reservasjon / kjøp ----------
  router.add('POST', '/api/items/:id/claim', (req, res, ctx) => {
    const user = requireUser(ctx);
    const item = requireItemForMember(db, ctx.params.id, user.id);
    if (item.owner_id === user.id) throw new HttpError(403, 'Du kan ikke reservere ditt eget ønske');
    const status = ctx.body.status;
    if (!['reserved', 'bought'].includes(status)) {
      throw new HttpError(400, 'Status må være "reserved" eller "bought"');
    }
    const now = Date.now();
    db.prepare(
      `INSERT INTO claims (id, item_id, user_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (item_id, user_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`
    ).run(newId(), item.id, user.id, status, now, now);
    sendJson(res, 200, { item: itemToJson(db, item, user.id) });
  });

  router.add('DELETE', '/api/items/:id/claim', (req, res, ctx) => {
    const user = requireUser(ctx);
    const item = requireItemForMember(db, ctx.params.id, user.id);
    if (item.owner_id === user.id) throw new HttpError(403, 'Du kan ikke endre ditt eget ønske her');
    db.prepare('DELETE FROM claims WHERE item_id = ? AND user_id = ?').run(item.id, user.id);
    sendJson(res, 200, { item: itemToJson(db, item, user.id) });
  });

  // ---------- Spleis ----------
  router.add('POST', '/api/items/:id/spleise', (req, res, ctx) => {
    const user = requireUser(ctx);
    const item = requireItemForMember(db, ctx.params.id, user.id);
    if (item.owner_id === user.id) throw new HttpError(403, 'Du kan ikke spleise på ditt eget ønske');
    const target = cleanPrice(ctx.body.target ?? ctx.body.targetAmount);
    if (!target || target <= 0) throw new HttpError(400, 'Spleisen må ha et målbeløp større enn 0');
    const open = db
      .prepare("SELECT id FROM spleises WHERE item_id = ? AND status = 'open'")
      .get(item.id);
    if (open) throw new HttpError(409, 'Det finnes allerede en åpen spleis på dette ønsket - bidra til den i stedet');
    const id = newId();
    const now = Date.now();
    db.prepare(
      'INSERT INTO spleises (id, item_id, created_by, target, status, bought_together, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)'
    ).run(id, item.id, user.id, target, 'open', now, now);
    const spleise = db.prepare('SELECT * FROM spleises WHERE id = ?').get(id);
    sendJson(res, 201, { spleise: spleiseToJson(db, spleise, user.id, item) });
  });

  router.add('POST', '/api/spleises/:id/contribute', (req, res, ctx) => {
    const user = requireUser(ctx);
    const spleise = getSpleise(db, ctx.params.id);
    const item = requireItemForMember(db, spleise.item_id, user.id);
    if (item.owner_id === user.id) throw new HttpError(403, 'Du kan ikke bidra til ditt eget ønske');
    if (spleise.status !== 'open') throw new HttpError(409, 'Spleisen er lukket');
    const amount = Number(ctx.body.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) {
      throw new HttpError(400, 'Ugyldig beløp');
    }
    db.prepare('INSERT INTO contributions (id, spleise_id, user_id, amount, created_at) VALUES (?, ?, ?, ?, ?)').run(
      newId(),
      spleise.id,
      user.id,
      Math.round(amount * 100) / 100,
      Date.now()
    );
    sendJson(res, 201, { spleise: spleiseToJson(db, getSpleise(db, spleise.id), user.id, item) });
  });

  router.add('DELETE', '/api/spleises/:id/contributions/:contributionId', (req, res, ctx) => {
    const user = requireUser(ctx);
    const spleise = getSpleise(db, ctx.params.id);
    requireItemForMember(db, spleise.item_id, user.id);
    const contribution = db
      .prepare('SELECT * FROM contributions WHERE id = ? AND spleise_id = ?')
      .get(ctx.params.contributionId, spleise.id);
    if (!contribution) throw new HttpError(404, 'Fant ikke bidraget');
    if (contribution.user_id !== user.id) throw new HttpError(403, 'Du kan bare fjerne ditt eget bidrag');
    if (spleise.status !== 'open') throw new HttpError(409, 'Spleisen er lukket');
    db.prepare('DELETE FROM contributions WHERE id = ?').run(contribution.id);
    sendJson(res, 200, { ok: true });
  });

  router.add('POST', '/api/spleises/:id/close', (req, res, ctx) => {
    const user = requireUser(ctx);
    const spleise = getSpleise(db, ctx.params.id);
    const item = requireItemForMember(db, spleise.item_id, user.id);
    if (item.owner_id === user.id) throw new HttpError(403, 'Ikke aktuelt på ditt eget ønske');
    const isContributor = db
      .prepare('SELECT id FROM contributions WHERE spleise_id = ? AND user_id = ?')
      .get(spleise.id, user.id);
    if (spleise.created_by !== user.id && !isContributor) {
      throw new HttpError(403, 'Bare den som startet spleisen eller en bidragsyter kan lukke den');
    }
    const boughtTogether = ctx.body.boughtTogether === true ? 1 : 0;
    db.prepare("UPDATE spleises SET status = 'closed', bought_together = ?, updated_at = ? WHERE id = ?").run(
      boughtTogether,
      Date.now(),
      spleise.id
    );
    sendJson(res, 200, { spleise: spleiseToJson(db, getSpleise(db, spleise.id), user.id, item) });
  });

  router.add('POST', '/api/spleises/:id/reopen', (req, res, ctx) => {
    const user = requireUser(ctx);
    const spleise = getSpleise(db, ctx.params.id);
    const item = requireItemForMember(db, spleise.item_id, user.id);
    if (spleise.created_by !== user.id) throw new HttpError(403, 'Bare den som startet spleisen kan åpne den igjen');
    db.prepare("UPDATE spleises SET status = 'open', bought_together = 0, updated_at = ? WHERE id = ?").run(
      Date.now(),
      spleise.id
    );
    sendJson(res, 200, { spleise: spleiseToJson(db, getSpleise(db, spleise.id), user.id, item) });
  });
}

function getSpleise(db, id) {
  const spleise = db.prepare('SELECT * FROM spleises WHERE id = ?').get(id);
  if (!spleise) throw new HttpError(404, 'Fant ikke spleisen');
  return spleise;
}

function validateItemInput(body) {
  const title = cleanString(body.title, 120);
  if (!title) throw new HttpError(400, 'Tittel er påkrevd');
  return {
    title,
    description: cleanString(body.description, 1000),
    url: cleanUrl(body.url),
    price: cleanPrice(body.price),
    priority: cleanPriority(body.priority),
  };
}

function sendAuth(res, user, session) {
  sendJson(
    res,
    200,
    { user },
    { 'Set-Cookie': sessionCookie(session.token, Math.floor(SESSION_TTL_MS / 1000)) }
  );
}

module.exports = { registerRoutes, itemToJson, spleiseToJson };
