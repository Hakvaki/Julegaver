import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { hashPassword, verifyPassword, randomToken, hashToken, parseNok, safeUrl } from './security.js';
import { parseCookies, readBody, formFields, send, redirect } from './httphelp.js';
import * as views from './views.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CSS_FILE = path.join(here, '..', 'public', 'style.css');

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const USERNAME_RE = /^[A-Za-z0-9_-]{3,30}$/;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function createApp({ store }) {
  const { data } = store;
  const save = () => store.save();

  function session(req) {
    const sid = parseCookies(req).sid;
    if (!sid) return null;
    const key = hashToken(sid);
    const rec = data.sessions[key];
    if (!rec) return null;
    if (rec.expiresAt < Date.now()) {
      delete data.sessions[key];
      save();
      return null;
    }
    const user = data.users[rec.userId];
    if (!user) return null;
    rec.expiresAt = Date.now() + SESSION_TTL_MS;
    return { sid, rec, user };
  }

  function startSession(res, userId) {
    const sid = randomToken(32);
    data.sessions[hashToken(sid)] = {
      userId,
      csrf: randomToken(16),
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    save();
    res.setHeader(
      'Set-Cookie',
      `sid=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    );
  }

  function csrfOk(sess, fields) {
    const a = String(fields.csrf || '');
    const b = sess.rec.csrf;
    return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }

  function requireSession(req, res) {
    const sess = session(req);
    if (!sess) redirect(res, '/login');
    return sess;
  }

  const findUserByUsername = (username) =>
    Object.values(data.users).find((u) => u.username.toLowerCase() === username.toLowerCase()) || null;

  const familyOf = (user) => data.families[user.familyId] || null;

  const wishesOf = (userId) =>
    Object.values(data.wishes)
      .filter((w) => w.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt);

  function validateWish(f) {
    const errors = [];
    const title = String(f.title || '').trim();
    const description = String(f.description || '').trim();
    if (!title || title.length > 200) errors.push('Tittelen må være 1–200 tegn.');
    if (description.length > 2000) errors.push('Beskrivelsen kan være maks 2000 tegn.');
    let url = null;
    const rawUrl = String(f.url || '').trim();
    if (rawUrl) {
      url = rawUrl.length <= 500 ? safeUrl(rawUrl) : null;
      if (!url) errors.push('Lenken må være en gyldig http(s)-adresse.');
    }
    let priceOre = null;
    const rawPrice = String(f.price || '').trim();
    if (rawPrice) {
      priceOre = parseNok(rawPrice);
      if (priceOre === null) errors.push('Prisen må være et beløp i kr, f.eks. 199,50.');
    }
    return { errors, title, description, url, priceOre };
  }

  function handleRegister(req, res, f) {
    const mode = f.mode;
    const name = String(f.name || '').trim();
    const username = String(f.username || '').trim();
    const password = String(f.password || '');
    const errors = [];
    if (!name || name.length > 60) errors.push('Navnet ditt må være 1–60 tegn.');
    if (!USERNAME_RE.test(username)) errors.push('Brukernavnet må være 3–30 tegn (A–Z, 0–9, _ eller -).');
    if (password.length < 8) errors.push('Passordet må være minst 8 tegn.');
    if (username && Object.values(data.users).some((u) => u.username.toLowerCase() === username.toLowerCase()))
      errors.push('Brukernavnet er allerede i bruk.');

    let familyId = null;
    if (mode === 'create') {
      const familyName = String(f.familyName || '').trim();
      if (!familyName || familyName.length > 60) {
        errors.push('Familienavnet må være 1–60 tegn.');
      } else {
        familyId = crypto.randomUUID();
        let code;
        do {
          code = Array.from({ length: 8 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
        } while (Object.values(data.families).some((fa) => fa.code === code));
        data.families[familyId] = { id: familyId, name: familyName, code, createdAt: Date.now() };
      }
    } else if (mode === 'join') {
      const code = String(f.familyCode || '').trim().toUpperCase();
      const fam = Object.values(data.families).find((fa) => fa.code === code);
      if (!fam) errors.push('Fant ingen familie med den koden – sjekk at du har skrevet riktig.');
      else familyId = fam.id;
    } else {
      errors.push('Velg om du vil opprette en ny familie eller bli med i en eksisterende.');
    }

    if (errors.length) {
      send(res, 400, views.registerPage({ errors, values: f }));
      return;
    }
    const { salt, hash } = hashPassword(password);
    const userId = crypto.randomUUID();
    data.users[userId] = {
      id: userId,
      familyId,
      name,
      username,
      salt,
      passwordHash: hash,
      createdAt: Date.now(),
    };
    save();
    startSession(res, userId);
    redirect(res, '/');
  }

  function handleLogin(req, res, f) {
    const username = String(f.username || '').trim();
    const password = String(f.password || '');
    const user = findUserByUsername(username);
    if (!user || !verifyPassword(password, user.salt, user.passwordHash)) {
      send(res, 401, views.loginPage({ error: 'Feil brukernavn eller passord.', values: f }));
      return;
    }
    startSession(res, user.id);
    redirect(res, '/');
  }

  function handleLogout(req, res, sess) {
    delete data.sessions[hashToken(sess.sid)];
    save();
    res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
    redirect(res, '/login');
  }

  function handleDashboard(req, res, sess) {
    const fam = familyOf(sess.user);
    const members = Object.values(data.users)
      .filter((u) => u.familyId === sess.user.familyId)
      .sort((a, b) => a.createdAt - b.createdAt);
    const stats = {};
    for (const m of members) {
      const ws = wishesOf(m.id);
      stats[m.id] = { total: ws.length, bought: ws.filter((w) => w.boughtBy.length > 0).length };
    }
    const myPurchases = Object.values(data.wishes)
      .filter((w) => w.boughtBy.includes(sess.user.id))
      .map((wish) => ({ wish, owner: data.users[wish.userId] }))
      .sort((a, b) => b.wish.createdAt - a.wish.createdAt);
    const myPledges = Object.values(data.wishes)
      .flatMap((w) =>
        w.pledges.filter((p) => p.userId === sess.user.id).map((pledge) => ({ wish: w, owner: data.users[w.userId], pledge })),
      )
      .sort((a, b) => b.pledge.createdAt - a.pledge.createdAt);
    send(res, 200, views.dashboard({ user: sess.user, family: fam, members, stats, myPurchases, myPledges, csrf: sess.rec.csrf }));
  }

  function handleWishlist(req, res, sess, username, url) {
    const target = findUserByUsername(username);
    if (!target || target.familyId !== sess.user.familyId) {
      send(res, 404, views.errorPage('404 – fant ikke denne personen i familien din.'));
      return;
    }
    send(
      res,
      200,
      views.wishlistPage({
        viewer: sess.user,
        target,
        wishes: wishesOf(target.id),
        isOwner: target.id === sess.user.id,
        csrf: sess.rec.csrf,
        users: data.users,
        error: url.searchParams.get('error'),
      }),
    );
  }

  function handleAddWish(req, res, sess, f) {
    const v = validateWish(f);
    const back = `/u/${sess.user.username}`;
    if (v.errors.length) {
      redirect(res, `${back}?error=${encodeURIComponent(v.errors.join(' '))}`);
      return;
    }
    const id = crypto.randomUUID();
    data.wishes[id] = {
      id,
      userId: sess.user.id,
      title: v.title,
      description: v.description,
      url: v.url,
      priceOre: v.priceOre,
      boughtBy: [],
      pledges: [],
      createdAt: Date.now(),
    };
    save();
    redirect(res, back);
  }

  function ownWishOr403(res, sess, wishId) {
    const w = data.wishes[wishId];
    if (!w || w.userId !== sess.user.id) {
      send(res, 403, views.errorPage('Du kan bare endre dine egne ønsker.'));
      return null;
    }
    return w;
  }

  function handleEditWish(req, res, sess, f, wishId) {
    const w = ownWishOr403(res, sess, wishId);
    if (!w) return;
    const v = validateWish(f);
    const back = `/u/${sess.user.username}`;
    if (v.errors.length) {
      redirect(res, `${back}?error=${encodeURIComponent(v.errors.join(' '))}`);
      return;
    }
    w.title = v.title;
    w.description = v.description;
    w.url = v.url;
    w.priceOre = v.priceOre;
    save();
    redirect(res, back);
  }

  function handleDeleteWish(req, res, sess, wishId) {
    const w = ownWishOr403(res, sess, wishId);
    if (!w) return;
    delete data.wishes[wishId];
    save();
    redirect(res, `/u/${sess.user.username}`);
  }

  function otherFamilyWishOr404(res, sess, wishId) {
    const w = data.wishes[wishId];
    const owner = w && data.users[w.userId];
    if (!w || !owner || owner.familyId !== sess.user.familyId) {
      send(res, 404, views.errorPage('404 – ikke funnet.'));
      return null;
    }
    if (owner.id === sess.user.id) {
      send(res, 403, views.errorPage('Du kan ikke kjøpe eller spleise på ditt eget ønske.'));
      return null;
    }
    return { w, owner };
  }

  function handleToggleBuy(req, res, sess, wishId) {
    const found = otherFamilyWishOr404(res, sess, wishId);
    if (!found) return;
    const { w, owner } = found;
    const i = w.boughtBy.indexOf(sess.user.id);
    if (i === -1) w.boughtBy.push(sess.user.id);
    else w.boughtBy.splice(i, 1);
    save();
    redirect(res, `/u/${owner.username}`);
  }

  function handlePledge(req, res, sess, f, wishId) {
    const found = otherFamilyWishOr404(res, sess, wishId);
    if (!found) return;
    const { w, owner } = found;
    const amount = parseNok(String(f.amount || ''));
    if (amount === null || amount <= 0 || amount > 100_000_000) {
      redirect(res, `/u/${owner.username}?error=${encodeURIComponent('Ugyldig beløp – skriv f.eks. 200 eller 199,50.')}`);
      return;
    }
    w.pledges.push({ id: crypto.randomUUID(), userId: sess.user.id, amount, createdAt: Date.now() });
    save();
    redirect(res, `/u/${owner.username}`);
  }

  function handleDeletePledge(req, res, sess, pledgeId) {
    for (const w of Object.values(data.wishes)) {
      const i = w.pledges.findIndex((p) => p.id === pledgeId);
      if (i === -1) continue;
      if (w.pledges[i].userId !== sess.user.id) {
        send(res, 403, views.errorPage('Du kan bare fjerne dine egne bidrag.'));
        return;
      }
      const owner = data.users[w.userId];
      w.pledges.splice(i, 1);
      save();
      redirect(res, owner ? `/u/${owner.username}` : '/');
      return;
    }
    send(res, 404, views.errorPage('404 – ikke funnet.'));
  }

  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'self'",
    );
    try {
      const url = new URL(req.url, 'http://localhost');
      const p = url.pathname;

      if (req.method === 'GET' && p === '/style.css') {
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end(fs.readFileSync(CSS_FILE));
        return;
      }
      if (req.method === 'GET' && p === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === 'POST') {
        const { body, tooLarge } = await readBody(req);
        if (tooLarge) {
          send(res, 413, views.errorPage('Forespørselen er for stor.'));
          return;
        }
        const f = formFields(body);
        if (p === '/register') return handleRegister(req, res, f);
        if (p === '/login') return handleLogin(req, res, f);

        const sess = requireSession(req, res);
        if (!sess) return;
        if (!csrfOk(sess, f)) {
          send(res, 403, views.errorPage('Ugyldig eller manglende sikkerhetstoken – prøv igjen.'));
          return;
        }
        let m;
        if (p === '/logout') return handleLogout(req, res, sess);
        if (p === '/wishes') return handleAddWish(req, res, sess, f);
        if ((m = p.match(/^\/wishes\/([a-f0-9-]{36})\/edit$/))) return handleEditWish(req, res, sess, f, m[1]);
        if ((m = p.match(/^\/wishes\/([a-f0-9-]{36})\/delete$/))) return handleDeleteWish(req, res, sess, m[1]);
        if ((m = p.match(/^\/wishes\/([a-f0-9-]{36})\/toggle-buy$/))) return handleToggleBuy(req, res, sess, m[1]);
        if ((m = p.match(/^\/wishes\/([a-f0-9-]{36})\/pledge$/))) return handlePledge(req, res, sess, f, m[1]);
        if ((m = p.match(/^\/pledges\/([a-f0-9-]{36})\/delete$/))) return handleDeletePledge(req, res, sess, m[1]);
        send(res, 404, views.errorPage('404 – ikke funnet.'));
        return;
      }

      if (req.method === 'GET') {
        if (p === '/') {
          const sess = requireSession(req, res);
          if (sess) handleDashboard(req, res, sess);
          return;
        }
        if (p === '/register') {
          send(res, 200, views.registerPage({}));
          return;
        }
        if (p === '/login') {
          send(res, 200, views.loginPage({}));
          return;
        }
        const m = p.match(/^\/u\/([A-Za-z0-9_-]{3,30})$/);
        if (m) {
          const sess = requireSession(req, res);
          if (!sess) return;
          return handleWishlist(req, res, sess, decodeURIComponent(m[1]), url);
        }
        send(res, 404, views.errorPage('404 – ikke funnet.'));
        return;
      }

      send(res, 405, views.errorPage('Metode ikke tillatt.'));
    } catch (err) {
      console.error(err);
      if (!res.headersSent) send(res, 500, views.errorPage('Noe gikk galt på serveren.'));
      else res.end();
    }
  });
}
