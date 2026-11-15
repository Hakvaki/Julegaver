# 🎄 Julegaver

En liten julegave-nettside for familien. Ingen eksterne pakker – kun Node.js innebygde moduler.

## Funksjoner

- **Familier med hemmelig kode** – én i familien oppretter familien og får en 8-tegns kode som deles med resten.
- **Ønskelister** – hvert familiemedlem legger inn ønsker med tittel, beskrivelse, lenke og pris.
- **Hemmelig avkryssing** – andre familiemedlemmer kan markere ønsker som «kjøpt». **Eieren av ønskelisten ser aldri hvilke gaver som er kjøpt eller hvem som kjøpte dem.**
- **Spleising** – flere kan spleise på samme gave ved å legge inn et beløp i kr. Bidragsytere ser hvem som har bidratt med hva og hvor mye som er samlet inn (og når gaven er fullfinansiert). Også dette er **helt skjult for eieren**.
- **Oversikt** – hver ser hvor mange av andres ønsker som er kjøpt, egne kjøp og egne spleisebidrag.

## Kjøring

```bash
npm start          # starter på http://localhost:3000
PORT=8080 npm start
DATA_FILE=/tmp/db.json npm start
```

Åpne siden i nettleseren, opprett en familie, og del familiekoden med resten av familien.

## Tester

```bash
npm test
```

Testene dekker registrering/innlogging, hemmelighold av kjøp og spleis for eieren,
tilgangskontroll mellom familier, CSRF-beskyttelse og escaping av brukerinnhold.

## Struktur

```
server.js          # oppstart
src/app.js         # ruter og forretningslogikk
src/views.js       # HTML-visninger (norsk)
src/store.js       # JSON-basert datalagring (atomiske skrivinger)
src/security.js    # scrypt-passord, sesjonstokens, escaping, kronebeløp
src/httphelp.js    # cookies, skjema-parsing, svar
hjelpere
public/style.css   # juletema
tests/app.test.js  # ende-til-ende-tester (node:test)
data/db.json       # opprettes ved kjøring (gitignorert)
```

## Sikkerhet

- Passord lagres med saltet scrypt-hash, aldri i klartekst.
- Sesjoner er tilfeldige tokens i HttpOnly/SameSite=Lax-cookie; tokenet lagres kun hashet.
- Alle POST-forespørsler krever CSRF-token; all brukerinput escapes før rendering.
- Data er begrenset til egen familie – det er ikke mulig å se andre familiers brukere eller ønsker.
- Kjør helst bak HTTPS (f.eks. via en lokal reverse proxy) hvis flere skal bruke den utenfor hjemmenettet;
  sett da også `Secure` på cookie-en i `src/app.js`.
