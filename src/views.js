import { escapeHtml as esc, fmtNok } from './security.js';

export function layout({ title, user, csrf, body }) {
  const nav = user
    ? `<nav>
        <a href="/">Oversikt</a>
        <a href="/u/${esc(user.username)}">Min ønskeliste</a>
        <form method="post" action="/logout" class="inline">
          <input type="hidden" name="csrf" value="${esc(csrf)}">
          <button type="submit" class="ghost">Logg ut</button>
        </form>
      </nav>`
    : `<nav><a href="/login">Logg inn</a><a href="/register">Registrer</a></nav>`;
  return `<!doctype html>
<html lang="nb">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Julegaver</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="top">
  <a class="brand" href="/">🎄 Julegaver</a>
  ${nav}
</header>
<main>
${body}
</main>
<footer class="foot">Laget med ❤️ for familien · Kun familiemedlemmer ser hverandres lister</footer>
</body>
</html>`;
}

export function errorPage(message) {
  return layout({
    title: 'Feil',
    user: null,
    csrf: '',
    body: `<section class="card narrow"><h1>Oisann…</h1><p>${esc(message)}</p><p><a href="/">Tilbake til forsiden</a></p></section>`,
  });
}

const nameFields = (values) => `
      <label>Ditt navn
        <input name="name" required maxlength="60" value="${esc(values.name || '')}">
      </label>
      <label>Brukernavn
        <input name="username" required maxlength="30" pattern="[A-Za-z0-9_\\-]{3,30}" value="${esc(values.username || '')}">
      </label>
      <label>Passord (minst 8 tegn)
        <input type="password" name="password" required minlength="8">
      </label>`;

export function registerPage({ errors = [], values = {} }) {
  const alert = errors.length ? `<div class="alert">${errors.map(esc).join('<br>')}</div>` : '';
  return layout({
    title: 'Registrer',
    user: null,
    csrf: '',
    body: `<section class="card narrow">
  <h1>🎁 Bli med i Julegaver</h1>
  ${alert}
  <h2>Opprett ny familie</h2>
  <p class="muted">Du får en familiekode du kan dele med resten av familien.</p>
  <form method="post" action="/register" class="stack">
    <input type="hidden" name="mode" value="create">
    <label>Familienavn
      <input name="familyName" required maxlength="60" value="${esc(values.familyName || '')}" placeholder="f.eks. Familien Hansen">
    </label>
    ${nameFields(values)}
    <button type="submit">Opprett familie</button>
  </form>
  <h2>Eller bli med i en eksisterende familie</h2>
  <form method="post" action="/register" class="stack">
    <input type="hidden" name="mode" value="join">
    <label>Familiekode
      <input name="familyCode" required maxlength="8" value="${esc(values.familyCode || '')}" placeholder="8 tegn, f.eks. ABC123XY">
    </label>
    ${nameFields(values)}
    <button type="submit">Bli med i familien</button>
  </form>
  <p class="muted">Har du allerede konto? <a href="/login">Logg inn her</a></p>
</section>`,
  });
}

export function loginPage({ error = '', values = {} }) {
  const alert = error ? `<div class="alert">${esc(error)}</div>` : '';
  return layout({
    title: 'Logg inn',
    user: null,
    csrf: '',
    body: `<section class="card narrow">
  <h1>🎄 Logg inn</h1>
  ${alert}
  <form method="post" action="/login" class="stack">
    <label>Brukernavn
      <input name="username" required maxlength="30" value="${esc(values.username || '')}">
    </label>
    <label>Passord
      <input type="password" name="password" required>
    </label>
    <button type="submit">Logg inn</button>
  </form>
  <p class="muted">Ny familie? <a href="/register">Registrer deg her</a></p>
</section>`,
  });
}

export function dashboard({ user, family, members, stats, myPurchases, myPledges, csrf }) {
  const memberItems = members
    .map((m) => {
      const s = stats[m.id];
      const isMe = m.id === user.id;
      return `<li class="member">
        <a class="member-link" href="/u/${esc(m.username)}"><strong>${esc(m.name)}</strong> <span class="muted">@${esc(m.username)}</span></a>
        ${
          isMe
            ? '<span class="muted">Din liste – kjøp og spleis på ønskene dine holdes hemmelig for deg 🤫</span>'
            : `<span class="muted">${s.bought} av ${s.total} kjøpt</span>`
        }
      </li>`;
    })
    .join('');

  const purchaseItems = myPurchases.length
    ? myPurchases
        .map(
          ({ wish, owner }) =>
            `<li><a href="/u/${esc(owner.username)}">${esc(owner.name)}</a>: ${esc(wish.title)} <span class="badge bought">kjøpt av deg</span></li>`,
        )
        .join('')
    : '<li class="muted">Du har ikke markert noen kjøp ennå.</li>';

  const pledgeItems = myPledges.length
    ? myPledges
        .map(
          ({ wish, owner, pledge }) =>
            `<li><a href="/u/${esc(owner.username)}">${esc(owner.name)}</a>: ${esc(wish.title)} — ${fmtNok(pledge.amount)}</li>`,
        )
        .join('')
    : '<li class="muted">Du har ikke spleiset på noe ennå.</li>';

  return layout({
    title: 'Oversikt',
    user,
    csrf,
    body: `<section class="card">
  <h1>Hei, ${esc(user.name)}! 👋</h1>
  <p>Familie: <strong>${esc(family.name)}</strong></p>
  <p>Familiekode: <code class="code">${esc(family.code)}</code> <span class="muted">– del denne med familiemedlemmer som skal bli med</span></p>
</section>
<section class="card">
  <h2>Familiemedlemmer</h2>
  <ul class="members">${memberItems}</ul>
</section>
<section class="card">
  <h2>Mine kjøp 🎁</h2>
  <ul>${purchaseItems}</ul>
  <h2>Mine spleisebidrag 💰</h2>
  <ul>${pledgeItems}</ul>
</section>`,
  });
}

function wishInfo(w) {
  return `<h3>${esc(w.title)}</h3>
    ${w.description ? `<p>${esc(w.description)}</p>` : ''}
    ${w.url ? `<p><a href="${esc(w.url)}" target="_blank" rel="noopener noreferrer">🔗 ${esc(w.url)}</a></p>` : ''}
    ${w.priceOre ? `<p class="price">Pris: ${fmtNok(w.priceOre)}</p>` : ''}`;
}

function wishFormFields(w) {
  return `
    <label>Tittel
      <input name="title" required maxlength="200" value="${esc(w.title)}">
    </label>
    <label>Beskrivelse
      <textarea name="description" maxlength="2000" rows="2">${esc(w.description)}</textarea>
    </label>
    <label>Lenke (valgfritt)
      <input name="url" maxlength="500" value="${esc(w.url || '')}" placeholder="https://…">
    </label>
    <label>Pris i kr (valgfritt)
      <input name="price" inputmode="decimal" value="${w.priceOre ? (w.priceOre / 100).toFixed(2).replace('.', ',') : ''}" placeholder="f.eks. 499,50">
    </label>`;
}

function ownerWishCard(w, csrf) {
  return `<article class="wish" data-wish="${w.id}">
  ${wishInfo(w)}
  <div class="row">
    <details>
      <summary>Rediger</summary>
      <form method="post" action="/wishes/${w.id}/edit" class="stack">
        <input type="hidden" name="csrf" value="${esc(csrf)}">
        ${wishFormFields(w)}
        <button type="submit">Lagre endringer</button>
      </form>
    </details>
    <form method="post" action="/wishes/${w.id}/delete" class="inline">
      <input type="hidden" name="csrf" value="${esc(csrf)}">
      <button type="submit" class="ghost danger">Slett</button>
    </form>
  </div>
</article>`;
}

function viewerWishCard(w, viewer, csrf, users) {
  const buyers = w.boughtBy.map((id) => users[id]?.name || 'Ukjent');
  const boughtByMe = w.boughtBy.includes(viewer.id);
  const total = w.pledges.reduce((sum, p) => sum + p.amount, 0);
  const full = w.priceOre !== null && total >= w.priceOre;
  const pct = w.priceOre ? Math.min(100, Math.round((total * 100) / w.priceOre)) : 0;

  let buyArea;
  if (boughtByMe) {
    buyArea = `<span class="badge bought">✅ Kjøpt av deg</span>
      <form method="post" action="/wishes/${w.id}/toggle-buy" class="inline">
        <input type="hidden" name="csrf" value="${esc(csrf)}">
        <button type="submit" class="ghost">Angre</button>
      </form>`;
  } else if (buyers.length) {
    buyArea = `<span class="badge bought">✅ Kjøpt av ${esc(buyers.join(', '))}</span>`;
  } else {
    buyArea = `<form method="post" action="/wishes/${w.id}/toggle-buy" class="inline">
        <input type="hidden" name="csrf" value="${esc(csrf)}">
        <button type="submit">Marker som kjøpt</button>
      </form>`;
  }

  const pledgeItems = w.pledges.length
    ? `<ul class="pledges">${w.pledges
        .map(
          (p) => `<li>${esc(users[p.userId]?.name || 'Ukjent')} — ${fmtNok(p.amount)}
            ${
              p.userId === viewer.id
                ? `<form method="post" action="/pledges/${p.id}/delete" class="inline">
                     <input type="hidden" name="csrf" value="${esc(csrf)}">
                     <button type="submit" class="ghost small">fjern</button>
                   </form>`
                : ''
            }</li>`,
        )
        .join('')}</ul>`
    : '<p class="muted">Ingen har spleiset ennå.</p>';

  const progress = w.priceOre
    ? `<div class="progress"><div style="width:${pct}%"></div></div>
       <p>${fmtNok(total)} av ${fmtNok(w.priceOre)} spleiset${full ? ' — <strong class="full">fullfinansiert! 🎉</strong>' : ''}</p>`
    : `<p>Spleiset så langt: <strong>${fmtNok(total)}</strong></p>`;

  return `<article class="wish" data-wish="${w.id}">
  ${wishInfo(w)}
  <div class="row">${buyArea}</div>
  <div class="spleis">
    <h4>🎁 Spleis på denne gaven</h4>
    ${progress}
    ${pledgeItems}
    <form method="post" action="/wishes/${w.id}/pledge" class="pledge-form">
      <input type="hidden" name="csrf" value="${esc(csrf)}">
      <input name="amount" inputmode="decimal" placeholder="Beløp i kr, f.eks. 200" required>
      <button type="submit">Jeg spleiser</button>
    </form>
  </div>
</article>`;
}

export function wishlistPage({ viewer, target, wishes, isOwner, csrf, users, error }) {
  const boughtCount = wishes.filter((w) => w.boughtBy.length > 0).length;
  const header = isOwner ? 'Min ønskeliste 🤫' : `Ønskelisten til ${esc(target.name)} 🎄`;
  const sub = isOwner
    ? '<p class="muted">Her ligger ønskene dine. Hvem som har kjøpt eller spleiset på dem, holdes hemmelig for deg.</p>'
    : `<p class="muted">${boughtCount} av ${wishes.length} ønsker er kjøpt.</p>`;

  const addForm = isOwner
    ? `<form method="post" action="/wishes" class="stack wish-form">
        <input type="hidden" name="csrf" value="${esc(csrf)}">
        <h2>Legg til nytt ønske</h2>
        ${wishFormFields({ title: '', description: '', url: '', priceOre: null })}
        <button type="submit">Legg til ønske</button>
      </form>`
    : '';

  const cards = wishes.length
    ? wishes.map((w) => (isOwner ? ownerWishCard(w, csrf) : viewerWishCard(w, viewer, csrf, users))).join('')
    : '<p class="muted">Ingen ønsker ennå.</p>';

  return layout({
    title: target.name,
    user: viewer,
    csrf,
    body: `<section class="card">
  <h1>${header}</h1>
  ${sub}
  ${error ? `<div class="alert">${esc(error)}</div>` : ''}
  ${addForm}
</section>
<section class="wishes">${cards}</section>`,
  });
}
