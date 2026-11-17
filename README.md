# 🎄 Julegaver

En enkel julegaveliste-app for familien. Hver person lager sin egen ønskeliste, og resten av familien kan se hva som allerede er reservert eller kjøpt — slik at ingen kjøper samme gave to ganger. Store gaver kan **spleises** (flere går sammen om ett spleisebidrag).

Appen er selvstendig uten eksterne avhengigheter: kun Node.js (>= 22.5) trengs.

## Funksjoner

- **Kontoer** med brukernavn/passord (passord lagres hashet med scrypt, økter via httpOnly-cookie)
- **Familiegrupper** — opprett en familie og del invitasjonskoden (8 tegn) med alle i familien. Koden kan byttes av admin når som helst
- **Ønskelister** — hver medlem kan legge til ønsker med tittel, beskrivelse, lenke, pris og prioritet, og redigere/slette egne ønsker
- **Reserver / marker kjøpt** — andre i familien kan reservere eller markere et ønske som kjøpt, og alle ser hvem som har gjort hva
- **Overraskelsen bevares** — eieren av en liste ser *ikke* hvem som har reservert/kjøpt/spleiset på egne ønsker
- **Spleis** — start en spleis på et ønske med målbeløp (f.eks. prisen), andre bidrar med beløp, og når målet er nådd kan spleisen markeres som «kjøpt sammen». Bidragsytere ser fremdrift og hvem som har bidratt
- **Flere familier** — samme konto kan være med i flere familiegrupper

## Kjøring

```bash
npm start          # starter på http://127.0.0.1:3000
```

Valgfrie miljøvariabler:

| Variabel | Standard | Beskrivelse |
|---|---|---|
| `PORT` | `3000` | Port å lytte på |
| `HOST` | `127.0.0.1` | Adresse å binde til (sett `0.0.0.0` på PaaS eller i lukket nettverk; bruk standard bak reverse proxy) |
| `DB_PATH` | `data/julegaver.db` | hvor SQLite-databasen lagres (`:memory:` for tester) |
| `COOKIE_SECURE` | av | Sett til `1` når appen nås over HTTPS, slik at sesjons-cookien får `Secure`-flagg |

Deretter åpner du `http://127.0.0.1:3000` i nettleseren, oppretter en konto, lager en familie og deler invitasjonskoden med familien.

## Testing

```bash
npm test
```

Kjører integrasjonstester mot API-et (registrering, familier, lister, reservasjon/kjøp, spleis, tilgangskontroll og hemmelighold) med Node sin innebygde testrunner.

## Struktur

```
server.js          # inngangspunkt: HTTP-server + ruting + statiske filer
src/db.js          # SQLite-skjema og åpning av database
src/auth.js        # passordhashing, økter, invitasjonskoder, cookies
src/http.js        # router, JSON-håndtering, statiske filer
src/api.js         # alle API-endepunkter og forretningsregler
public/            # frontend (vanilla JS SPA, norsk)
test/api.test.js   # integrasjonstester
```

## API-oversikt

| Metode | Endepunkt | Beskrivelse |
|---|---|---|
| POST | `/api/auth/register` `/api/auth/login` `/api/auth/logout` | Autentisering |
| GET | `/api/me` | Innlogget bruker + familier |
| POST | `/api/families` | Opprett familie (du blir admin) |
| POST | `/api/families/join` | Bli med via invitasjonskode |
| GET | `/api/families/:id` | Familie + medlemmer + kode |
| POST | `/api/families/:id/rotate-code` | Ny invitasjonskode (admin) |
| POST | `/api/families/:id/leave` | Forlat familie |
| DELETE | `/api/families/:id/members/:userId` | Fjern medlem (admin) |
| GET | `/api/families/:id/lists` | Alle medlemmers lister (egne kjøp skjult for eier) |
| POST | `/api/families/:id/items` | Nytt ønske på egen liste |
| PUT/DELETE | `/api/items/:id` | Rediger/slett eget ønske |
| POST/DELETE | `/api/items/:id/claim` | Reserver/kjøp eller angre (ikke eget ønske) |
| POST | `/api/items/:id/spleise` | Start spleis (én åpen om gangen) |
| POST | `/api/spleises/:id/contribute` | Bidra med beløp |
| DELETE | `/api/spleises/:id/contributions/:cid` | Fjern eget bidrag |
| POST | `/api/spleises/:id/close` / `reopen` | Lukk (evt. «kjøpt sammen») / åpne igjen |

## Notater

- Data lagres i én SQLite-fil (`data/julegaver.db`), som er tatt med i `.gitignore`
- Når et medlem forlater eller fjernes fra en familie, slettes vedkommendes ønsker, reservasjoner og spleisebidrag i den familien
- Appen er laget for bruk i lukket familie-nettverk. Sett `HOST=0.0.0.0` kun på ditt eget nettverk, og legg gjerne en autentiserende reverse proxy foran ved fjerntilgang

## Vertsdeployment (hosting) og test fra telefonen

Appen kan deployes hos en skytilbyder slik at familien kan bruke den fra hvor som helst - også fra mobiltelefonen på reise. Velg ett av alternativene:

### Alternativ 1: PaaS - enklest (Railway, Render eller Fly.io)

1. Koble GitHub-repoet til tjenesten og velg grenen `vibe/julegaveliste-4014db`.
2. Sett miljøvariabler: `HOST=0.0.0.0`, `DB_PATH=/data/julegaver.db`, `COOKIE_SECURE=1` (`PORT` settes automatisk av plattformen). Se `deploy/PAAS.md` for steg per plattform.
3. Fest en vedvarende disk/volume på `/data`, ellers mister du databasen ved hver restart.
4. Etter deploy får du en HTTPS-URL (f.eks. `https://<app>.up.railway.app`). Åpne den i nettleseren på telefonen.

### Alternativ 2: egen VPS med Caddy (f.eks. Hetzner, ca. 4 EUR/mnd)

1. Opprett en liten VPS (Debian/Ubuntu) og pek et domene/subdomene på serverens IP.
2. Installer Node.js >= 22.5, Caddy og git; klon repoet til `/opt/julegaver` og sjekk ut grenen.
3. Kopier `deploy/julegaver.service` til `/etc/systemd/system/`, opprett en dedikert bruker, og aktiver med `systemctl enable --now julegaver`.
4. Kopier `deploy/Caddyfile` til `/etc/caddy/Caddyfile` (bytt ut eksempeldomenet) og kjør `systemctl reload caddy` - Caddy skaffer HTTPS-sertifikat automatisk.
5. Appen lytter da på `127.0.0.1:3000`, og Caddy står for TLS utad.

### Sikkerhet ved hosting

- Sett alltid `COOKIE_SECURE=1` når appen nås over HTTPS (cookien får `Secure`-flagg; ellers aksepteres den kun over sikker tilkobling av nettleseren likevel ikke)
- Bak en reverse proxy (VPS) skal `HOST` være `127.0.0.1` (standard); bruk `HOST=0.0.0.0` kun på PaaS eller i lukket nettverk
- Innlogging er rate-limitet: maks 10 feilede forsøk per 10 minutter per IP
- Sesjonstokens lagres kun hashet (SHA-256) i databasen
- Sikkerhetskopiering: hele tilstanden ligger i én SQLite-fil (`DB_PATH`) - kopier den filen regelmessig

### Slik tester du fra telefonen

1. Åpne HTTPS-URLen til den deployede appen i Safari/Chrome på telefonen.
2. Registrer en konto, opprett en familie - du får en 8-tegns invitasjonskode.
3. Del koden med familien; de registrerer egne kontoer og blir med i familien via koden.
4. Legg til ønsker på egen liste. Fra en annen konto (annen telefon/nettleser): marker kjøp eller bidra i spleis - og sjekk at eieren fortsatt ikke ser noe av det på sin egen liste.
