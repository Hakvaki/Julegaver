# Deploy på PaaS (Railway, Render eller Fly.io)

Appen har ingen eksterne avhengigheter og leser all konfigurasjon fra miljøvariabler,
så den fungerer rett fra repoet. Bruk grenen `vibe/julegaveliste-4014db`.

## Felles krav

- Node.js >= 22.5 (plattformene leser `engines` i `package.json`)
- Startkommando: `npm start`
- Miljøvariabler:
  - `HOST=0.0.0.0` (plattformen må kunne nå appen utenfra)
  - `DB_PATH=/data/julegaver.db` (på vedvarende volum, ellers mister du data ved restart)
  - `COOKIE_SECURE=1` (plattformen terminerer HTTPS, så cookien må ha `Secure`-flagg)
  - `PORT` settes automatisk av plattformen
- Fest en vedvarende disk/volume på mount-punktet `/data` (1 GB holder i massevis)

## Railway

1. Logg inn med GitHub → **New Project** → **Deploy from GitHub repo** → velg `Hakvaki/Julegaver` og grenen `vibe/julegaveliste-4014db`.
2. Innstillinger → **Variables**: legg til `HOST`, `DB_PATH`, `COOKIE_SECURE` som over.
3. **Volumes**: legg til et volum og monter det på `/data`.
4. Deploy skjer automatisk; URL-en (HTTPS) står under **Settings** → **Domains**.

## Render

1. **New** → **Blueprint** (bruk `render.yaml` i repoet) eller **Web Service** → koble til repoet, velg grenen.
2. Runtime: Node. Start command: `npm start`. Region: Frankfurt (nærmest Norge).
3. **Environment**: legg til `HOST=0.0.0.0`, `DB_PATH=/data/julegaver.db`, `COOKIE_SECURE=1`.
4. **Disk**: legg til en disk på 1 GB montert på `/data`.
5. Gratis-planen sovner etter 15 min uten trafikk (data beholdes) - fint for testing.

## Fly.io

1. Installer `flyctl`, logg inn, og kjør `fly launch --no-deploy` i repoet (velg region `osl` = Oslo).
2. Sett miljøvariabler: `fly secrets set HOST=0.0.0.0 DB_PATH=/data/julegaver.db COOKIE_SECURE=1`
3. Opprett volum: `fly volumes create data --size 1 --region osl`, monter på `/data` i `fly.toml`.
4. `fly deploy` gir deg `https://<app>.fly.dev`.

## Test fra telefonen

1. Åpne HTTPS-URLen i Safari/Chrome på telefonen.
2. Registrer konto → opprett familie → du får en 8-tegns invitasjonskode.
3. Del koden med familien; de registrerer egne kontoer og blir med via koden.
4. Sjekk at eieren av en liste ikke ser hvem som har reservert/kjøpt/spleiset.
