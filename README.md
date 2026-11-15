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
| `HOST` | `127.0.0.1` | Adresse å binde til (sett f.eks. `0.0.0.0` for å nå appen fra andre enheter på samme nettverk) |
| `DB_PATH` | `data/julegaver.db` | hvor SQLite-databasen lagres (`:memory:` for tester) |

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
