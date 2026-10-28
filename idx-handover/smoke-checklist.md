# Self-host post-deploy smoke checklist - Imaging Queensland & The Xray Group

Run this after `docker compose up -d` (before DNS), then again once the public URLs exist.
Tick each line and record the output where shown. If a line fails, stop and read
`runbook.md` §10 before changing anything.

> **Do not test against the live master board.** Score submissions made against
> `play-production-3271.up.railway.app` (or any existing Railway instance) land on a real,
> in-use leaderboard, so leave those systems alone during this deployment. All testing below
> targets the new server only. On the new instances a couple of guest rounds are fine: the
> boards are fresh and throwaway.

Date: ____________  Operator: ____________  Bundle version: digest-pinned (see compose)

---

## A. Before starting the stack

- [ ] `docker --version` and `docker compose version` both work; compose is **v2.x**, not v1.
- [ ] `/opt/radgames/docker-compose.yml` present; both `image:` lines are `…@sha256:…` digests
      (`53d5317d…` for Imaging Queensland, `6e188530…` for The Xray Group).
- [ ] `.env` exists, is `chmod 600`, contains a generated `LEADERBOARD_ADMIN_PASSCODE`
      (not `clear2026`, not the template placeholder).
- [ ] `sudo docker compose config >/dev/null && echo OK` prints `OK`.
- [ ] `sudo docker compose pull` completed for both images (~1.1 GB total).

## B. Containers are up and healthy

```bash
cd /opt/radgames
sudo docker compose ps
sudo docker inspect --format '{{.Name}} {{.State.Health.Status}}' radgames-imaging-queensland radgames-the-xray-group
```

- [ ] Both containers `running`.
- [ ] Both health states `healthy` (allow up to ~90 s after start; the first check has a 60 s
      grace period).
- [ ] Neither container is restarting (`docker compose ps` shows no `Restarting`).
- [ ] `journalctl`/`docker compose logs` show no repeating crash loop.

## C. First-boot seed purge (do this before the board checks)

The image copies a bundled August-2026 starter database into `/app/data` on **first boot only**
(no database on the volume yet, so the seed is copied in). That seed carries **nine old
nickname/score rows**. The board API hides them (it only ever shows the current UTC month), but
the rows physically sit on the new volume until the next 1st-of-month rollover. Purge them now,
before the board checks, so the boards you sign off on are genuinely pristine. Full rationale and
the canonical command: **`runbook.md` §12** (reproduced here only so this list stands alone).

> **Scope caveat: read this first.** This applies to **fresh volumes only**, i.e. this server's
> first boot. The live Railway instances are **not** affected: their starter rows were cleared by
> the **1 Oct 2026 rollover** and their boards hold real current-month rows. Never run this purge
> against Railway.

```bash
cd /opt/radgames
sudo docker compose stop            # app stopped, volumes intact
# §12 purge - run the same block once per service (each brand has its own volume/DB)
sudo docker compose run --rm --no-deps imaging-queensland bun -e '
  import { Database } from "bun:sqlite";
  const db = new Database("/app/data/leaderboard.db");
  const n = db.query("DELETE FROM scores").run().changes;
  console.log("cleared", n, "inherited rows");
  db.close();'
sudo docker compose run --rm --no-deps the-xray-group bun -e '
  import { Database } from "bun:sqlite";
  const db = new Database("/app/data/leaderboard.db");
  const n = db.query("DELETE FROM scores").run().changes;
  console.log("cleared", n, "inherited rows");
  db.close();'
sudo docker compose up -d
```

- [ ] Both purges print `cleared 9 inherited rows` (`cleared 0` on a re-run is fine, already clean).
- [ ] Both containers are `healthy` again afterwards (repeat the §B check).
- [ ] `curl -sS http://127.0.0.1:3001/api/leaderboard | head -c 300` and the `:3002` equivalent
      return `"ok":true` with an **empty `entries` array** and no current-month rows on either board.
- [ ] (Optional) Row-level proof, using the same `docker compose run … bun -e` pattern as §12 so
      `sqlite3` is **not** required on the host: `scores`, `players` and `player_profiles` all
      read `0` (the August seed carried score rows only; the app creates the other two empty):

      ```bash
      sudo docker compose run --rm --no-deps imaging-queensland bun -e '
        import { Database } from "bun:sqlite";
        const db = new Database("/app/data/leaderboard.db");
        for (const t of ["scores", "players", "player_profiles"]) {
          try { console.log(t, db.query(`SELECT COUNT(*) AS n FROM ${t}`).get().n); }
          catch { console.log(t, "no table (clean)"); }
        }
        db.close();'
      ```

## D. Health and API on the server (loopback)

```bash
curl -sS -o /dev/null -w 'IQ  / -> %{http_code}\n' http://127.0.0.1:3001/
curl -sS -o /dev/null -w 'TXG / -> %{http_code}\n' http://127.0.0.1:3002/
```

- [ ] IQ `/` → `200`
- [ ] TXG `/` → `200`

```bash
curl -sS http://127.0.0.1:3001/api/leaderboard | head -c 300; echo
curl -sS http://127.0.0.1:3002/api/leaderboard | head -c 300; echo
```

- [ ] Both return JSON containing `"ok":true` (a `month` field and an `entries` array).
      **An empty `entries` list is correct on a fresh instance.**
- [ ] Not an HTML error page, not a 500.

```bash
# Admin page is served (passcode-protected: 200 with a login gate, or 401/403, both fine)
curl -sS -o /dev/null -w 'IQ  /admin -> %{http_code}\n' http://127.0.0.1:3001/admin
curl -sS -o /dev/null -w 'TXG /admin -> %{http_code}\n' http://127.0.0.1:3002/admin
```

- [ ] Both `/admin` return a non-5xx status.
- [ ] Opening `/admin` in a browser with the passcode from `.env` shows the dashboard;
      a wrong passcode is rejected. (Do this once, on one instance, from the server's own
      network or through the proxy once it exists.)

## E. Brand identity (the two instances must not be swapped)

Open each instance in a browser (`http://127.0.0.1:3001/` from the server, or the public URL
once DNS/TLS exist).

**Imaging Queensland (`:3001`)**
- [ ] Mascot is **Stu** (not Rex).
- [ ] Top bar shows the Imaging Queensland logo. The asset URL contains `home-logo.png?v=4`.
- [ ] Brand/copy text says Imaging Queensland; leaderboard is that brand's own.

**The Xray Group (`:3002`)**
- [ ] Mascot is **Rex** (cape colour is a placeholder crimson until final artwork lands, so
      a colour mismatch is not a failure).
- [ ] Top bar shows The Xray Group logo.
- [ ] Brand/copy text says The Xray Group; leaderboard is that brand's own.

Both:
- [ ] Dark navy theme, the eight games listed (Bone Buster, Scan Rush, Scan Search, Memory
      Scan, MRI Mix-Up, Pulse Pop, Colour Stu/Rex, Film Stack).
- [ ] No cross-brand content: a score submitted on IQ never appears on TXG.

## F. End-to-end gameplay (new instances only)

Pick one easy game per instance (Scan Rush or Bone Buster) and play a short round.

- [ ] Game loads and is playable on a phone-sized viewport.
- [ ] Completing a round submits a score: the leaderboard page then shows the guest/nickname
      entry with a "You" marker.
- [ ] Play one round on the **other** instance too, and confirm the two boards stay separate.
- [ ] (Optional) `curl -sS http://127.0.0.1:3001/api/leaderboard` now shows the new entry in
      `entries`.

## G. Persistence across a restart

```bash
cd /opt/radgames
sudo docker compose restart
sleep 20
curl -sS http://127.0.0.1:3001/api/leaderboard | head -c 200; echo
```

- [ ] Containers come back `healthy`.
- [ ] The score added in section F is still on the board (the volume, not the container,
      holds the data).
- [ ] `sudo docker volume ls | grep radgames` lists `radgames_iq_data` and
      `radgames_txg_data`.

## H. After DNS + TLS (public)

```bash
curl -sS -o /dev/null -w 'IQ  public / -> %{http_code}\n' https://games.imagingqueensland.com.au/
curl -sS -o /dev/null -w 'TXG public / -> %{http_code}\n' https://games.thexraygroup.com.au/
curl -sS https://games.thexraygroup.com.au/api/leaderboard | head -c 200; echo
```

- [ ] Both public URLs return `200` over HTTPS.
- [ ] Certificate is valid, issued to the right hostname, and not expired
      (`curl -vI https://games.imagingqueensland.com.au/ 2>&1 | grep -E 'issuer|expire'`).
- [ ] API over HTTPS returns JSON (proves the proxy forwards the whole request, not just `/`).
- [ ] Browser brand check (§E) repeated over the public URLs.
- [ ] A real phone on mobile data loads the page and starts a game (the intended patient path).

## I. Housekeeping

- [ ] The admin passcode is held by me in my password manager, and `.env` is not readable by
      other users (`ls -l /opt/radgames/.env` → `-rw-------`).
- [ ] Backup approach for the volumes is agreed and scheduled (see `runbook.md` §9, open
      question for IDX IT).
- [ ] Decision recorded for `migration-notes.md` (fresh start vs carry-over).
- [ ] No test data left where it should not be: any guest rounds played here belong to the new
      instance only. Nothing was submitted to Railway.

## Sign-off

- [ ] Pristine board, no seeded data (purged at first boot)

| Item | Result | Notes |
|---|---|---|
| A to C bring-up, seed purge, pristine boards | | |
| D local health + API | | |
| E brand identity | | |
| F gameplay + board submission | | |
| G persistence after restart | | |
| H public HTTPS end-to-end | | |

Operator: ____________________  Date: ____________
