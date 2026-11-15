'use strict';

/* ---------- Hjelpefunksjoner ---------- */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtMoney(n) {
  if (n === null || n === undefined || n === '') return '';
  return new Intl.NumberFormat('nb-NO', {
    style: 'currency',
    currency: 'NOK',
    maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
  }).format(n);
}

const PRIO = { 3: '⭐ Vil helst ha', 2: '⭐ Kjekt å ha', 1: 'Hvis du vil' };

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { /* tom */ }
  if (!res.ok) throw new Error((data && data.error) || `Feil (${res.status})`);
  return data;
}

let toastTimer = null;
function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

async function run(fn) {
  try { await fn(); } catch (err) { toast(err.message, true); }
}

/* ---------- State ---------- */

const state = {
  me: null,
  families: [],
  activeFamilyId: null,
  lists: null,
  tab: 'family',
  authMode: 'login',
  inviteVisible: false,
};

const app = document.getElementById('app');

function activeFamily() {
  return state.families.find((f) => f.id === state.activeFamilyId) || null;
}

/* ---------- Init ---------- */

async function init() {
  try {
    const data = await api('/api/me');
    state.me = data.user;
    state.families = data.families;
    if (state.families.length > 0) {
      state.activeFamilyId = state.families[0].id;
      await loadLists();
      renderMain();
    } else {
      renderOnboarding();
    }
  } catch {
    renderAuth();
  }
}

async function loadLists() {
  const data = await api(`/api/families/${state.activeFamilyId}/lists`);
  state.lists = data;
}

async function refresh() {
  const me = await api('/api/me');
  state.me = me.user;
  state.families = me.families;
  if (!state.families.find((f) => f.id === state.activeFamilyId)) {
    state.activeFamilyId = state.families[0] ? state.families[0].id : null;
  }
  if (state.activeFamilyId) {
    await loadLists();
    renderMain();
  } else {
    renderOnboarding();
  }
}

/* ---------- Auth ---------- */

function renderAuth() {
  app.innerHTML = `
    <div class="auth-wrap">
      <div class="card">
        <h2>🎄 Julegaver</h2>
        <p class="hint">Ønskelister for familien - så kjøper ingen samme gave to ganger, og store gaver kan spleises.</p>
        <div class="auth-tabs">
          <button class="${state.authMode === 'login' ? 'active' : ''}" onclick="setAuthMode('login')">Logg inn</button>
          <button class="${state.authMode === 'register' ? 'active' : ''}" onclick="setAuthMode('register')">Opprett konto</button>
        </div>
        <form onsubmit="return submitAuth(event)">
          <label for="auth-username">Brukernavn</label>
          <input id="auth-username" required autocomplete="username">
          <label for="auth-password">Passord (min. 6 tegn)</label>
          <input id="auth-password" type="password" required minlength="6" autocomplete="${state.authMode === 'login' ? 'current-password' : 'new-password'}">
          <div class="mt"><button class="primary" type="submit">${state.authMode === 'login' ? 'Logg inn' : 'Opprett konto'}</button></div>
        </form>
      </div>
    </div>`;
}

function setAuthMode(mode) {
  state.authMode = mode;
  renderAuth();
}

async function submitAuth(event) {
  event.preventDefault();
  const username = document.getElementById('auth-username').value;
  const password = document.getElementById('auth-password').value;
  await run(async () => {
    await api(`/api/auth/${state.authMode}`, { method: 'POST', body: { username, password } });
    await refresh();
  });
  return false;
}

/* ---------- Onboarding (ingen familie ennå) ---------- */

function renderOnboarding() {
  app.innerHTML = `
    <div class="auth-wrap">
      <div class="card">
        <h2>Velkommen, ${esc(state.me.username)}! 🎁</h2>
        <p class="hint">Opprett en familiegruppe og del invitasjonskoden med resten av familien, eller bli med i en eksisterende gruppe med en kode du har fått.</p>
      </div>
      <div class="card">
        <h2>Opprett ny familie</h2>
        <form onsubmit="return createFamily(event)">
          <label for="fam-name">Familiens navn (f.eks. "Familien Hansen")</label>
          <input id="fam-name" required maxlength="60" placeholder="Familien Hansen">
          <div class="mt"><button class="primary" type="submit">Opprett familie</button></div>
        </form>
      </div>
      <div class="card">
        <h2>Bli med i en familie</h2>
        <form onsubmit="return joinFamily(event)">
          <label for="invite-code">Invitasjonskode</label>
          <input id="invite-code" required maxlength="20" placeholder="F.eks. K7XQ2M9P" style="text-transform:uppercase">
          <div class="mt"><button class="green" type="submit">Bli med</button></div>
        </form>
      </div>
      <div class="card">
        <button onclick="logout()">Logg ut</button>
      </div>
    </div>`;
}

async function createFamily(event) {
  event.preventDefault();
  const name = document.getElementById('fam-name').value;
  await run(async () => {
    await api('/api/families', { method: 'POST', body: { name } });
    toast('Familie opprettet! Del koden med familien 🎄');
    await refresh();
  });
  return false;
}

async function joinFamily(event) {
  event.preventDefault();
  const inviteCode = document.getElementById('invite-code').value;
  await run(async () => {
    await api('/api/families/join', { method: 'POST', body: { inviteCode } });
    toast('Du er nå med i familien! 🎉');
    await refresh();
  });
  return false;
}

async function logout() {
  await run(async () => {
    await api('/api/auth/logout', { method: 'POST' });
    state.me = null;
    state.families = [];
    state.lists = null;
    renderAuth();
  });
}

/* ---------- Hovedvisning ---------- */

function renderMain() {
  const fam = activeFamily();
  const familySelect = state.families.length > 1
    ? `<select onchange="switchFamily(this.value)">${state.families.map((f) =>
        `<option value="${f.id}" ${f.id === state.activeFamilyId ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select>`
    : '';
  app.innerHTML = `
    <div class="header">
      <h1>🎄 Julegaver</h1>
      ${familySelect}
      <div class="spacer"></div>
      <button onclick="toggleInvite()">${state.inviteVisible ? 'Skjul kode' : '👨‍👩‍👧 Invitasjonskode'}</button>
      <button onclick="renderOnboarding()">+ Familie</button>
      <button onclick="logout()">Logg ut (${esc(state.me.username)})</button>
    </div>
    ${state.inviteVisible ? inviteBox() : ''}
    <div class="tabs">
      <button class="${state.tab === 'family' ? 'active' : ''}" onclick="setTab('family')">🎁 Familiens lister</button>
      <button class="${state.tab === 'mine' ? 'active' : ''}" onclick="setTab('mine')">✏️ Min ønskeliste</button>
    </div>
    <div id="content"></div>`;
  if (state.tab === 'family') renderFamilyLists();
  else renderMyList();
}

function inviteBoxHtml(code) {
  return `
    <div class="invite-box">
      <span>Del denne koden med familien:</span>
      <span class="invite-code">${esc(code)}</span>
      <button class="small" onclick="copyInvite('${esc(code)}')">Kopier</button>
      <button class="small" onclick="rotateCode()">Ny kode</button>
    </div>`;
}

async function toggleInvite() {
  state.inviteVisible = !state.inviteVisible;
  if (state.inviteVisible) {
    const { family } = await api(`/api/families/${state.activeFamilyId}`);
    const header = document.querySelector('.header');
    const old = document.querySelector('.invite-box');
    if (old) old.remove();
    header.insertAdjacentHTML('afterend', inviteBoxHtml(family.inviteCode));
  } else {
    renderMain();
  }
}

async function copyInvite(code) {
  try {
    await navigator.clipboard.writeText(code);
    toast('Invitasjonskode kopiert! 📋');
  } catch {
    toast(`Koden er: ${code}`);
  }
}

async function rotateCode() {
  await run(async () => {
    const { family } = await api(`/api/families/${state.activeFamilyId}/rotate-code`, { method: 'POST' });
    const box = document.querySelector('.invite-box');
    if (box) box.outerHTML = inviteBoxHtml(family.inviteCode);
    toast('Ny invitasjonskode generert');
  });
}

function switchFamily(id) {
  state.activeFamilyId = id;
  state.inviteVisible = false;
  run(async () => { await loadLists(); renderMain(); });
}

function setTab(tab) {
  state.tab = tab;
  renderMain();
}

/* ---------- Familiens lister ---------- */

function renderFamilyLists() {
  const content = document.getElementById('content');
  if (!state.lists) { content.innerHTML = '<div class="loading">Laster…</div>'; return; }
  const meId = state.me.id;
  content.innerHTML = state.lists.members.map((m) => {
    const isMe = m.id === meId;
    const items = m.items.length
      ? m.items.map((item) => itemCard(item, isMe)).join('')
      : '<div class="empty">Ingen ønsker ennå.</div>';
    return `
      <div class="card member-card">
        <div class="member-head">
          <h2>${esc(m.username)}${isMe ? ' (deg)' : ''}</h2>
          <span class="count">${m.items.length} ønske${m.items.length === 1 ? '' : 'r'}</span>
        </div>
        ${items}
      </div>`;
  }).join('');
}

function itemCard(item, isMine) {
  const bought = !isMine && (item.claims || []).some((c) => c.status === 'bought');
  const reserved = !isMine && (item.claims || []).some((c) => c.status === 'reserved');
  const spleisBought = !isMine && item.spleise && item.spleise.status === 'closed' && item.spleise.boughtTogether;
  return `
    <div class="item ${bought || spleisBought ? 'taken' : ''}">
      <div class="item-top">
        <span class="item-title">${esc(item.title)}</span>
        <span class="item-prio">${esc(PRIO[item.priority] || '')}</span>
      </div>
      ${item.description ? `<div class="item-desc">${esc(item.description)}</div>` : ''}
      <div class="item-meta">
        ${item.price !== null ? `<span class="price">${esc(fmtMoney(item.price))}</span>` : ''}
        ${item.url ? `<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">🔗 Lenke</a>` : ''}
      </div>
      ${isMine ? ownerActions(item) : viewerContent(item, reserved, bought, spleisBought)}
    </div>`;
}

function ownerActions(item) {
  return `
    <div class="actions">
      <button class="small" onclick="editItem('${item.id}')">✏️ Rediger</button>
      <button class="small" onclick="deleteItem('${item.id}')">🗑️ Slett</button>
    </div>
    <div id="edit-${item.id}" class="hidden" style="margin-top:10px"></div>`;
}

function viewerContent(item, reserved, bought, spleisBought) {
  const badges = [];
  if (bought || spleisBought) badges.push('<span class="badge bought">✅ Kjøpt</span>');
  else if (reserved) badges.push('<span class="badge reserved">📌 Reservert</span>');
  (item.claims || []).forEach((c) => {
    badges.push(`<span class="badge ${c.status}">${c.status === 'bought' ? '✅' : '📌'} ${esc(c.username)}: ${c.status === 'bought' ? 'kjøpt' : 'reservert'}</span>`);
  });
  if (item.spleise) badges.push(`<span class="badge spleis">🤝 Spleis${item.spleise.status === 'closed' ? ' (lukket)' : ''}</span>`);

  let myClaim = '';
  if (item.myClaim) {
    myClaim = `<span class="badge ${item.myClaim}">Du har ${item.myClaim === 'bought' ? 'kjøpt' : 'reservert'} denne</span>`;
  }

  const claimButtons = `
    <div class="actions">
      ${item.myClaim !== 'reserved' ? `<button class="small" onclick="claim('${item.id}', 'reserved')">📌 Reserver</button>` : ''}
      ${item.myClaim !== 'bought' ? `<button class="small green" onclick="claim('${item.id}', 'bought')">✅ Marker som kjøpt</button>` : ''}
      ${item.myClaim ? `<button class="small" onclick="unclaim('${item.id}')">↩️ Angre</button>` : ''}
    </div>`;

  return `
    <div class="badges">${badges.join('')}${myClaim}</div>
    ${claimButtons}
    ${spleiseHtml(item)}`;
}

/* ---------- Spleis ---------- */

function spleiseHtml(item) {
  const sp = item.spleise;
  if (!sp) {
    const defaultTarget = item.price ? Math.round(item.price) : '';
    return `
      <div class="spleis">
        <div class="spleis-row">
          <strong>🤝 Spleis på denne gaven?</strong>
        </div>
        <div class="spleis-row mt">
          <input id="spleis-target-${item.id}" type="number" min="1" step="1" placeholder="Målbeløp (kr)" value="${esc(defaultTarget)}" style="width:140px">
          <button class="small green" onclick="createSpleise('${item.id}')">Start spleis</button>
        </div>
      </div>`;
  }
  const pct = Math.min(100, Math.round((sp.contributed / sp.target) * 100));
  const open = sp.status === 'open';
  const contribs = sp.contributors.length
    ? `<ul class="contribs">${sp.contributors.map((c) =>
        `<li class="${c.mine ? 'mine' : ''}">${esc(c.username)}: ${esc(fmtMoney(c.amount))}${c.mine ? ' (deg)' : ''}</li>`).join('')}</ul>`
    : '<div class="empty">Ingen bidrag ennå.</div>';
  return `
    <div class="spleis">
      <div class="spleis-row">
        <strong>🤝 Spleis</strong>
        <span>${esc(fmtMoney(sp.contributed))} / ${esc(fmtMoney(sp.target))} (${pct}%)${sp.isFull && open ? ' — målet er nådd! 🎉' : ''}</span>
        ${sp.status === 'closed' ? `<span class="badge ${sp.boughtTogether ? 'bought' : ''}">${sp.boughtTogether ? '✅ Kjøpt sammen' : 'Lukket'}</span>` : ''}
      </div>
      <div class="progress"><div style="width:${pct}%"></div></div>
      ${contribs}
      ${open ? `
        <div class="spleis-row mt">
          <input id="contrib-${sp.id}" type="number" min="1" step="1" placeholder="Beløp (kr)" style="width:120px">
          <button class="small green" onclick="contribute('${sp.id}')">Bidra</button>
          ${sp.myContributionId ? `<button class="small" onclick="removeContribution('${sp.id}', '${sp.myContributionId}')">Fjern mitt bidrag</button>` : ''}
        </div>
        <div class="spleis-row mt">
          ${(sp.isCreator || sp.contributors.some((c) => c.mine)) ? `
            <button class="small" onclick="closeSpleise('${sp.id}', true)">✅ Marker kjøpt sammen</button>
            <button class="small" onclick="closeSpleise('${sp.id}', false)">Lukk spleis</button>` : ''}
        </div>` : `
        ${sp.isCreator ? `<div class="spleis-row mt"><button class="small" onclick="reopenSpleise('${sp.id}')">Åpne igjen</button></div>` : ''}
      `}
    </div>`;
}

async function createSpleise(itemId) {
  await run(async () => {
    const input = document.getElementById(`spleis-target-${itemId}`);
    const target = Number(input.value);
    await api(`/api/items/${itemId}/spleise`, { method: 'POST', body: { target } });
    toast('Spleis opprettet! 🤝');
    await loadLists();
    renderMain();
  });
}

async function contribute(spleiseId) {
  await run(async () => {
    const input = document.getElementById(`contrib-${spleiseId}`);
    const amount = Number(input.value);
    await api(`/api/spleises/${spleiseId}/contribute`, { method: 'POST', body: { amount } });
    toast('Takk for bidraget! 🎁');
    await loadLists();
    renderMain();
  });
}

async function removeContribution(spleiseId, contributionId) {
  await run(async () => {
    await api(`/api/spleises/${spleiseId}/contributions/${contributionId}`, { method: 'DELETE' });
    toast('Bidrag fjernet');
    await loadLists();
    renderMain();
  });
}

async function closeSpleise(spleiseId, boughtTogether) {
  await run(async () => {
    await api(`/api/spleises/${spleiseId}/close`, { method: 'POST', body: { boughtTogether } });
    toast(boughtTogether ? 'Markert som kjøpt sammen ✅' : 'Spleis lukket');
    await loadLists();
    renderMain();
  });
}

async function reopenSpleise(spleiseId) {
  await run(async () => {
    await api(`/api/spleises/${spleiseId}/reopen`, { method: 'POST' });
    await loadLists();
    renderMain();
  });
}

/* ---------- Reservasjon/kjøp ---------- */

async function claim(itemId, status) {
  await run(async () => {
    await api(`/api/items/${itemId}/claim`, { method: 'POST', body: { status } });
    await loadLists();
    renderMain();
  });
}

async function unclaim(itemId) {
  await run(async () => {
    await api(`/api/items/${itemId}/claim`, { method: 'DELETE' });
    await loadLists();
    renderMain();
  });
}

/* ---------- Min ønskeliste ---------- */

function myItems() {
  const meId = state.me.id;
  const m = state.lists.members.find((x) => x.id === meId);
  return m ? m.items : [];
}

function renderMyList() {
  const content = document.getElementById('content');
  if (!state.lists) { content.innerHTML = '<div class="loading">Laster…</div>'; return; }
  const items = myItems();
  content.innerHTML = `
    <div class="card">
      <h2>Legg til nytt ønske</h2>
      <form onsubmit="return addItem(event)">
        <div class="form-grid">
          <div class="full">
            <label for="new-title">Hva ønsker du deg? *</label>
            <input id="new-title" required maxlength="120" placeholder="F.eks. Ny genser fra Ulvang">
          </div>
          <div class="full">
            <label for="new-desc">Beskrivelse (valgfritt)</label>
            <textarea id="new-desc" rows="2" maxlength="1000" placeholder="Størrelse, farge, modell…"></textarea>
          </div>
          <div>
            <label for="new-url">Lenke (valgfritt)</label>
            <input id="new-url" type="url" maxlength="500" placeholder="https://…">
          </div>
          <div>
            <label for="new-price">Pris i kr (valgfritt)</label>
            <input id="new-price" type="number" min="0" step="1" placeholder="f.eks. 499">
          </div>
          <div>
            <label for="new-prio">Prioritet</label>
            <select id="new-prio">
              <option value="3">⭐ Vil helst ha</option>
              <option value="2" selected>⭐ Kjekt å ha</option>
              <option value="1">Hvis du vil</option>
            </select>
          </div>
        </div>
        <div class="mt"><button class="primary" type="submit">🎁 Legg til</button></div>
      </form>
    </div>
    <div class="card member-card">
      <div class="member-head"><h2>Mine ønsker (${items.length})</h2></div>
      <p class="hint">Andre i familien ser ikke hvem som har reservert eller kjøpt noe på listen din - det forblir en overraskelse! 🎅</p>
      ${items.length ? items.map((item) => itemCard(item, true)).join('') : '<div class="empty">Listen din er tom - legg til det første ønsket over.</div>'}
    </div>`;
}

async function addItem(event) {
  event.preventDefault();
  const body = {
    title: document.getElementById('new-title').value,
    description: document.getElementById('new-desc').value,
    url: document.getElementById('new-url').value,
    price: document.getElementById('new-price').value,
    priority: Number(document.getElementById('new-prio').value),
  };
  await run(async () => {
    await api(`/api/families/${state.activeFamilyId}/items`, { method: 'POST', body });
    toast('Ønske lagt til! 🎁');
    await loadLists();
    renderMain();
  });
  return false;
}

function editItem(itemId) {
  const item = myItems().find((i) => i.id === itemId);
  if (!item) return;
  const box = document.getElementById(`edit-${itemId}`);
  box.classList.remove('hidden');
  box.innerHTML = `
    <form onsubmit="return saveItem(event, '${itemId}')">
      <div class="form-grid">
        <div class="full">
          <label>Tittel</label>
          <input id="edit-title-${itemId}" required maxlength="120" value="${esc(item.title)}">
        </div>
        <div class="full">
          <label>Beskrivelse</label>
          <textarea id="edit-desc-${itemId}" rows="2" maxlength="1000">${esc(item.description)}</textarea>
        </div>
        <div>
          <label>Lenke</label>
          <input id="edit-url-${itemId}" type="url" maxlength="500" value="${esc(item.url)}">
        </div>
        <div>
          <label>Pris (kr)</label>
          <input id="edit-price-${itemId}" type="number" min="0" step="1" value="${item.price ?? ''}">
        </div>
        <div>
          <label>Prioritet</label>
          <select id="edit-prio-${itemId}">
            <option value="3" ${item.priority === 3 ? 'selected' : ''}>⭐ Vil helst ha</option>
            <option value="2" ${item.priority === 2 ? 'selected' : ''}>⭐ Kjekt å ha</option>
            <option value="1" ${item.priority === 1 ? 'selected' : ''}>Hvis du vil</option>
          </select>
        </div>
      </div>
      <div class="actions mt">
        <button class="small primary" type="submit">Lagre</button>
        <button class="small" type="button" onclick="renderMain()">Avbryt</button>
      </div>
    </form>`;
}

async function saveItem(event, itemId) {
  event.preventDefault();
  const body = {
    title: document.getElementById(`edit-title-${itemId}`).value,
    description: document.getElementById(`edit-desc-${itemId}`).value,
    url: document.getElementById(`edit-url-${itemId}`).value,
    price: document.getElementById(`edit-price-${itemId}`).value,
    priority: Number(document.getElementById(`edit-prio-${itemId}`).value),
  };
  await run(async () => {
    await api(`/api/items/${itemId}`, { method: 'PUT', body });
    toast('Ønske oppdatert');
    await loadLists();
    renderMain();
  });
  return false;
}

async function deleteItem(itemId) {
  if (!confirm('Slette dette ønsket?')) return;
  await run(async () => {
    await api(`/api/items/${itemId}`, { method: 'DELETE' });
    toast('Ønske slettet');
    await loadLists();
    renderMain();
  });
}

/* ---------- Eksponer for inline-hendelser ---------- */

Object.assign(window, {
  setAuthMode, submitAuth, createFamily, joinFamily, logout,
  toggleInvite, copyInvite, rotateCode, switchFamily, setTab,
  claim, unclaim, createSpleise, contribute, removeContribution, closeSpleise, reopenSpleise,
  addItem, editItem, saveItem, deleteItem,
});

init();
