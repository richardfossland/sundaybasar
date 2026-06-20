# Auksjonsmodul i SundayBasar — implementeringsplan

> Status: **PLAN — ikke implementert.** Skrevet 2026-06-20. Klar til å hand-es til en
> implementerende agent. Ingen kode/migrasjoner er rørt ennå.

Auksjon legges inn som en **modul i basar-appen** (ikke en egen app). Den gjenbruker
basars sesjon/kode, deltaker-innlogging, SSO, Supabase Realtime og projektor-show, og
legger til nye tabeller + `SECURITY DEFINER`-RPC-er i `basar`-skjemaet.

> ⚠️ **Next.js 16 (ikke-standard)** — se `AGENTS.md`. Les `node_modules/next/dist/docs/`
> før du skriver frontend-kode i dette repoet.

---

## Designvalg (besluttet med eier)

| Tema | Valg |
|------|------|
| Arkitektur | Modul **inne i basar** — gjenbruker sesjon, `join_session`, SSO, realtime, projektor, `VippsCard` |
| Format | **Per objekt** (ikke per sesjon): `live` / `stille` / `hollandsk` — kan blandes i samme auksjon |
| Innhold | 4 kategorier: `tjeneste` · `gjenstand` · `opplevelse` · `mystery` |
| Betaling | **Forhåndsfylt Vipps-lenke + manuell bekreftelse** (beholder basars «rører aldri penger»-modell — ingen Vipps-API/webhooks/secrets) |
| Innsamling | **Nytt** `goal_amount`-felt + termometer (total = sum av tilslag; trivielt for auksjon, i motsetning til basar) |

**Nøkkelinnsikt fra basar-koden vi bygger på:**
- Trekningen er *server-autoritativ*: serveren bestemmer resultatet, klienten teatraliserer
  det allerede avgjorte. **Samme mønster** gir et juks-sikkert auksjons-«SOLGT!».
- Hemmelige data (vinner før avsløring, `host_secrets`) holdes **utenfor realtime-publikasjonen**.
  Vi gjør det samme med **proxy-maksbud** (`auction_proxy_maxes`) så ingen ser maksgrensen din.
- Atomisk, ikke-gjenbrukbar nummerering via radlås (`lot_counters` `for update`). **Samme triks**
  avgjør budkriger og hollandsk «første-klikk-vinner» korrekt.
- `join_session` er allerede enhets-deduplisert → hindrer juks ved re-join. Gjenbrukes som den er.

---

## Fase 1 — Datamodell (migrasjoner i `basar`-skjemaet)

Fortsett nummereringen etter `0005_host_owner.sql`. Alle migrasjoner idempotente
(`if not exists` / `create or replace`), med forklarende topp-kommentar (som `0004`).

### `0006_auction_kind.sql`
```sql
alter table basar.sessions add column if not exists kind text not null default 'basar';
alter table basar.sessions drop constraint if exists sessions_kind_chk;
alter table basar.sessions add constraint sessions_kind_chk check (kind in ('basar','auksjon'));
-- Innsamlingsmål for termometeret (feltet basar mangler bevisst). Null = ingen måler.
alter table basar.sessions add column if not exists goal_amount numeric;
```

### `0007_auction_items.sql` — `basar.auction_items`
| kolonne | type | merknad |
|---------|------|---------|
| `id` | uuid pk | |
| `session_id` | uuid → sessions | |
| `position` | int | sortering |
| `title, description, image_url` | text | |
| `category` | text | `check in ('tjeneste','gjenstand','opplevelse','mystery')` |
| `format` | text | `check in ('live','stille','hollandsk')` |
| `donor_name` | text null | «Donert av» — driver tjenesteauksjon-merket |
| `start_price, min_increment` | numeric | |
| `reserve_price` | numeric null | **skjult for deltakere** |
| `buy_now_price` | numeric null | valgfri «kjøp nå» |
| `deadline` | timestamptz null | stille-modus |
| `antisnipe_seconds` | int default 10 | auto-forleng ved bud i sluttspurt |
| `dutch_start, dutch_floor, dutch_step` | numeric null | hollandsk |
| `dutch_interval_seconds` | int null | hvor ofte prisen synker |
| `dutch_started_at` | timestamptz null | stemples av `start_dutch` |
| `status` | text | `check in ('draft','active','sold','passed') default 'draft'` |
| `current_amount` | numeric null | denormalisert ledende bud (for skjerm) |
| `current_leader_player_id` | uuid null | denormalisert leder |
| `winner_player_id, winning_amount` | | settes ved `mark_sold` |

### `0008_auction_bids.sql`
**`basar.auction_bids`** (append-only, **publisert i realtime**):
`id, item_id, player_id, amount numeric, kind text check in ('manual','auto','buynow','dutch_take'), voided bool default false, created_at`

**`basar.auction_proxy_maxes`** (**IKKE publisert** — samme leak-disiplin som `draws`/`host_secrets`):
`item_id, player_id, max_amount numeric`, PK `(item_id, player_id)`.

### `0009_auction_settlements.sql` — `basar.auction_settlements`
`id, item_id, player_id, amount numeric, method text check in ('vipps','manual') default 'vipps', paid bool default false, paid_at timestamptz, created_at`

Termometer-total: `select coalesce(sum(amount),0) from basar.auction_settlements where ... [and paid]`.

### `0010_auction_paddles_realtime_grants.sql`
```sql
alter table basar.players add column if not exists paddle_number int; -- budnummer, tildeles ved join

-- Realtime: legg til de PUBLISERBARE auksjonstabellene (proxy_maxes holdes UTENFOR).
alter publication supabase_realtime add table basar.auction_items;
alter publication supabase_realtime add table basar.auction_bids;
alter publication supabase_realtime add table basar.auction_settlements;

-- GRANTs: rå-SQL-skjema trenger BÅDE Dashboard-eksponering OG eksplisitt GRANT (basar-gotcha).
grant select on basar.auction_items, basar.auction_bids, basar.auction_settlements to anon, authenticated;
revoke select on basar.auction_proxy_maxes from anon, authenticated;  -- aldri eksponert
-- All skriv går via RPC-ene under (ingen direkte insert/update/delete-grants til anon).
```

---

## Fase 2 — RPC-er (`SECURITY DEFINER`, basar-stil)

Alle returnerer `jsonb {ok, ...}` / `{ok:false, error}`, med
`set search_path = basar, public, extensions`, og `grant execute ... to anon, authenticated, service_role`.

**Deltaker** (tar `p_player_secret`, verifiseres mot `player_secrets`):
- `place_bid(p_item_id, p_amount, p_player_secret)`
- `set_max_bid(p_item_id, p_max, p_player_secret)` — proxy/auto-bud
- `dutch_take(p_item_id, p_player_secret)` — første-klikk-vinner
- `buy_now(p_item_id, p_player_secret)`

**Vert** (tar `p_session_id, p_host_secret`, verifiseres mot `host_secrets`):
- `create_auction_item / update_auction_item / delete_auction_item / reorder_items`
- `activate_item(p_item_id)` — «på scenen nå» (live)
- `call_stage(p_item_id, p_stage)` — `'first' | 'second'` (Første/Andre gang)
- `mark_sold(p_item_id)` — finaliser, sjekk reserve, opprett settlement
- `pass_item(p_item_id, p_reason)`
- `start_dutch(p_item_id)`
- `set_settlement_paid(p_settlement_id, p_paid)`
- `void_bid(p_bid_id, p_reason)`

**Aggregat-lesing:** `get_auction_state(p_session_id)` → objekter + effektive bud + termometer-total,
**uten** proxy-maks. Brukes ved (re)subscribe og `visibilitychange`.

### Den subtile biten: `place_bid` + proxy-oppløsning

Kjernen er en `for update`-radlås på objektet (som `lot_counters`), pluss en proxy-runde
mot konkurrentens skjulte maks. Skisse i repoets dialekt:

```sql
create or replace function basar.place_bid(p_item_id uuid, p_amount numeric, p_player_secret text)
returns jsonb language plpgsql security definer
set search_path = basar, public, extensions as $$
declare it record; pid uuid; rival_max numeric; new_amount numeric;
begin
  -- 1) Autentiser spiller via secret → player_id (hører til samme sesjon).
  select player_id into pid from basar.player_secrets where secret = p_player_secret;
  if pid is null then return jsonb_build_object('ok', false, 'error', 'Ukjent deltaker'); end if;

  -- 2) Lås objektet (serialiserer budkriger).
  select * into it from basar.auction_items where id = p_item_id for update;
  if it is null or it.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'Objektet tar ikke imot bud'); end if;
  if it.format = 'hollandsk' then
    return jsonb_build_object('ok', false, 'error', 'Bruk «Kjøp nå» på hollandsk'); end if;
  if it.deadline is not null and now() > it.deadline then
    return jsonb_build_object('ok', false, 'error', 'Fristen er ute'); end if;

  -- 3) Minste lovlige bud.
  if p_amount < coalesce(it.current_amount, it.start_price) + it.min_increment then
    return jsonb_build_object('ok', false, 'error', 'For lavt bud'); end if;

  -- 4) Proxy: hvis en RIVAL har høyere maks, byr de automatisk tilbake til
  --    min(rival_max, p_amount) + increment, og leder fortsatt.
  select max(max_amount) into rival_max from basar.auction_proxy_maxes
    where item_id = p_item_id and player_id <> pid;

  if rival_max is not null and rival_max >= p_amount then
    new_amount := least(rival_max, p_amount + it.min_increment);
    insert into basar.auction_bids(item_id, player_id, amount, kind)
      values (p_item_id, (select player_id from basar.auction_proxy_maxes
                          where item_id = p_item_id and max_amount = rival_max limit 1),
              new_amount, 'auto');
    update basar.auction_items
      set current_amount = new_amount,
          current_leader_player_id = (select player_id from basar.auction_proxy_maxes
                                      where item_id = p_item_id and max_amount = rival_max limit 1)
      where id = p_item_id;
  else
    insert into basar.auction_bids(item_id, player_id, amount, kind)
      values (p_item_id, pid, p_amount, 'manual');
    update basar.auction_items
      set current_amount = p_amount, current_leader_player_id = pid
      where id = p_item_id;
  end if;

  -- 5) Anti-snik: bud i sluttspurt forlenger fristen.
  if it.deadline is not null and it.deadline - now() < (it.antisnipe_seconds || ' seconds')::interval then
    update basar.auction_items
      set deadline = now() + (it.antisnipe_seconds || ' seconds')::interval
      where id = p_item_id;
  end if;

  return jsonb_build_object('ok', true);
end; $$;

grant execute on function basar.place_bid(uuid, numeric, text) to anon, authenticated, service_role;
```

> Merk: `set_max_bid` deler logikken — lagre maks i `auction_proxy_maxes`, og kjør samme
> proxy-runde for å fastsette nytt effektivt bud. `dutch_take` regner gjeldende sunket pris
> fra `dutch_started_at + step*interval` under radlås og setter `status='sold'` atomisk.
> Reservepris sjekkes i `mark_sold` (aldri eksponert i lesing).

---

## Fase 3 — Frontend (forgren basars ruter på `kind`)

| Rute | Endring |
|------|---------|
| `/host/new` | Wizard: velg `kind='auksjon'`, sett `goal_amount` + Vipps |
| `/host/[sessionId]` | Faner `Objekter \| Live-styring \| Oppgjør \| Innstillinger` ved `kind='auksjon'`. Live-styring: Aktiver / Første gang / Andre gang / SOLGT / Pass |
| `/host/[sessionId]/projector` | Auksjons-skjerm: aktivt objekt, ledende bud + budnummer/navn, varmemåler, klubbe-stadier, termometer, QR |
| `/` + `/game/[sessionId]` | Deltaker: objektliste (stille) + «på scenen nå» (live) + «synker nå» (hollandsk); `BidPanel` (by / sett-maks / KJØP NÅ); Vipps-oppgjørskort ved gevinst |

**Nye komponenter:** `BidPanel`, `AuctionItemCard`, `HeatMeter`, `Thermometer`, `GavelStage`,
`VippsSettleCard` (utvider `VippsCard` med beløp + objektreferanse).

---

## Fase 4 — Realtime

Ny hook `useAuction.ts` (parallell til `useSession.ts`): kanal `auction-<sessionId>`,
abonner på `auction_items` + `auction_bids` + `auction_settlements`; full refetch via
`get_auction_state` ved (re)subscribe, endring og `visibilitychange` (samme robusthet som basar).
Anti-snik-forlengelse flyter automatisk via `auction_items`-endring. Hollandsk pris
animeres klientside fra `dutch_started_at` (server er fasit ved `dutch_take`).

## Fase 5 — Gøy-laget (show)

Klubbe-lyd (utvid `drawSound.ts`) + «Første … andre … SOLGT!»-overlay (gjenbruk
`DrawDisplay`-mønster) · konfetti ved tilslag (gjenbruk) · varmemåler fra budtempo (klientside) ·
mystery: skjul bilde/tittel til `sold`, så konfetti-reveal · respekter `prefers-reduced-motion`.

## Fase 6 — Vipps-oppgjør (forhåndsfylt lenke + manuell bekreftelse)

`mark_sold` → settlement-rad m/ beløp + objektreferanse. Vinner ser Vipps-deeplink/QR med
forhåndsfylt beløp + melding=objekttittel (utvid `VippsCard`; bekreft eksakt deeplink-format
mot Vipps-dok — fallback: nummer + beløp + «merk betalingen: \<objekt\>»). Vert «Oppgjør»-fane:
solgte objekter + vinner + beløp + **betalt-bryter** → driver termometeret. **Ingen nye secrets.**

## Fase 7 — Sikkerhet (basar-paritet)

Radlås på objekt for budkrig/hollandsk · append-only bud m/ void-audit · `auction_proxy_maxes`
aldri eksponert · reservepris skjult · valider spiller↔sesjon · `host_secret` på vert-RPC ·
enhets-dedup hindrer juks (allerede i `join_session`).

## Fase 8 — Tester

- **DB-tester** (`scripts/test-db.sh`, pg-i-Docker): budøkning-validering, proxy-oppløsning,
  **hollandsk samtidighets-race** (to `dutch_take` → én vinner), anti-snik-forlengelse,
  reserve, sold→settlement, void.
- **Unit (vitest):** budøkning-helper, varmemåler-matte, termometer, Vipps-lenkebygger
  (rene funksjoner i `drawReel.ts`-stil).

## Fase 9 — Konfig & deploy

Ingen nye runtime-secrets. **Eier kjører** migrasjonene + Supabase-eksponering/GRANTs
(agent kan ikke kjøre prod-DDL headless). Deploy: `npx opennextjs-cloudflare build && deploy`
fra klon. Modulen lever på `basar.sundaysuite.app`; `auction.sundaysuite.app` kan evt. legges
til som ekstra custom domain på samme Worker (valgfritt).

---

## Foreslått rekkefølge (PR-er)

1. Migrasjoner `0006`–`0010` + GRANTs
2. RPC-er + DB-tester
3. `get_auction_state` + `useAuction` + deltaker-by-UI, **stille-modus først** (lettest å verifisere)
4. Live-modus + projektor-show + lyd/konfetti
5. Hollandsk-modus + race-tester
6. Vipps-oppgjør + termometer
7. Polish: varmemåler, mystery-reveal, donert-av, anti-snik-finpuss

**Minste demobare milepæl:** Fase 1–3 + stille-modus = fungerende stille auksjon med
auto-bud, ende-til-ende.
