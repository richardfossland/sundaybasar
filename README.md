# SundayBasar

Digital bedehus-basar for menigheten — kjøp årer, vinn premier. Bor på
[basar.sundaysuite.app](https://basar.sundaysuite.app).

**Appen rører aldri penger.** I kjøp-modus viser den menighetens Vippsnummer
(og evt. QR fra en Vipps-lenke); den som styrer basaren ser betalingen på sin
egen telefon og deler ut årer med ett trykk.

## Moduser (velges i veiviser)

- **Tildeling:** `kjop` (Vipps + manuell tildeling) eller `gratis` (alle får
  likt antall lodd automatisk).
- **Trekning:** `klassisk` (årer gjelder hele kvelden, kan vinne flere ganger),
  `vinner_ut` (vinneråre tas ut av potten), `runder` (eget åresalg per premie).

## Arkitektur

Samme mønster som søsterappene (SundayHarvest/Market/Quiz): Next.js 16 +
React 19 + Tailwind v4, deployet som Cloudflare Worker via OpenNext. Eget
`basar`-schema i det delte Supabase-prosjektet.

Strengere trust-modell enn søsknene (penger er involvert):

- Offentlige tabeller er SELECT-only for anon — **alle skriv går via
  SECURITY DEFINER RPCs**.
- Verten har en per-session `host_secret` (returneres én gang fra
  `create_session`) som kreves av alle vert-RPCer.
- Årenummerering er atomisk (radlåst upsert på `lot_counters`) — samtidige
  tildelinger kan aldri gi duplikatnumre. Numre gjenbrukes aldri etter angring.
- Trekning skjer server-side (`order by gen_random_uuid()`), logges i en låst
  append-only `draws`-tabell, og vinneren er usynlig for klienter til
  `reveal_draw` publiserer den. Annullering («ikke til stede») beholder raden
  i loggen.

## Utvikling

```bash
npm install
npm run dev          # lokal utvikling
npm run typecheck
npm run test:db      # ~100 assertions mot ekte Postgres i Docker (krever Docker)
npm run cf:deploy    # bygg + deploy til Cloudflare
```

## Førstegangsoppsett i Supabase (manuelt)

1. Kjør `supabase/migrations/0001_basar_schema.sql` i SQL-editoren, deretter
   `supabase/migrations/0002_prize_images.sql` (valgfri premiebilder; trygg å
   kjøre, additiv).
2. **Dashboard → Settings → API → Exposed schemas → legg til `basar` → Save.**
   Uten dette feiler alle kall med 404/406.
3. *(Valgfritt — kun for premiebilder)* Lag en **offentlig** Storage-bøtte
   `basar-prizes` (Dashboard → Storage → New bucket → Public). Verten kan da
   laste opp et bilde per premie; uten bøtta fungerer alt annet som før og
   opplasting feiler pent med en melding. Man kan også bare lime inn en bilde-URL.

## Auksjon: stille auksjon med frist

Et objekt i format **stille** får fristen sin når verten **aktiverer** det
(«Aktiver (10 min)» i vertspanelet — minuttene velges der), ikke når det ble
lagt inn dagen før. Nedtellingen vises hos byderne og på storskjermen; et bud
i de siste sekundene forlenger fristen automatisk (anti-snik). Når fristen er
ute avviser serveren nye bud, og verten avslutter med «Marker solgt» eller
«Pass» — eller gir «+2 min». Krever migrasjon `0012_stille_frist.sql`
(`activate_item` får valgfri `p_duration_seconds`); uten den feiler
aktivering med frist med en «Could not find the function»-melding fra
PostgREST, mens aktivering uten frist virker som før.

## Trekning som show (storskjerm)

Selve trekningen er en spektakkel-animasjon på storskjermen (og hos spillerne):
et hjul/rulle av loddnumre som *bremser ned og lander* på vinneren, med Web
Audio-lyd, konfetti og et stort vinnerkort. **Utfallet er 100 %
server-autoritativt** — `start_draw` velger vinneren server-side og låser den i
`draws` til `reveal_draw` publiserer den; animasjonen teatraliserer kun det
allerede besluttede `lot_number`. Reel-matematikken (`src/lib/drawReel.ts`) er
ren og enhetstestet (`src/lib/drawReel.test.ts`); lyden ligger i
`src/lib/drawSound.ts`. Verten skrur på lyd med «Lyd på» på storskjermen (kreves
av nettleserens autoplay-regler). Honorerer `prefers-reduced-motion` (hopper
rett til resultatet, ingen lyd-spam).

## Helse og oppetid

`GET /api/health` er en enkel livstegn-probe — svarer `{ ok: true, app:
"sundaybasar", ts }` uten å røre databasen. Lagt til `?db=1` gjør i tillegg det
letteste mulige Supabase-kallet (én rad, én indeksert kolonne fra
`basar.sessions`); feiler det, svarer endepunktet `503` med
`{ ok: false, app, ts, db: "error", ms }` i stedet for å kaste — en
overvåker skal alltid se en statuskode, aldri en Worker-krasjside.
`db`-grenen er rate-limitet til 60 kall/min per IP (endepunktet er
uautentisert). `HEAD /api/health` speiler samme status uten body.

Alle uante `/api/*`-stier (skrivefeil, gamle klienter, skannere) svarer med
JSON `{ ok: false, error: "not_found" }` og status 404 i stedet for å falle
gjennom til den rendrede not-found-siden — billigere for Workeren, og holder
klientkoden som leser feilkoder fra JSON-kroppen i live.

Et GitHub Actions-workflow (`.github/workflows/uptime.yml`, `npm run uptime`
lokalt) prober `basar.sundaysuite.app` utenfra hvert ~10. minutt (`/`,
`/host/new`, `/api/health?db=1`), og filer/oppdaterer et issue merket
`uptime` ved feil — lukker det automatisk ved neste grønne kjøring. **NB:**
GitHub deaktiverer planlagte workflows automatisk etter 60 dager uten
repo-aktivitet (commits, PR-er) — går probene stille, sjekk Actions → uptime →
re-aktiver, ikke bare Cloudflare-status.
