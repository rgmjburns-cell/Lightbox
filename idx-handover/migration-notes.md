# Migration notes — do the self-host instances start fresh, or carry the pilot boards over?

**STATUS: OPEN — owner decision required. Nothing here is decided.**
Both paths are written up and both are executable by IT/owner without us. Until a decision is
recorded, the bundle deploys **fresh** (it is the default behaviour of `docker-compose.yml`).

Owner decision point: Megan (product owner). Input needed from IDX only on retention/policy
wording, not on the mechanics.

---

## Which data are we talking about?

| Thing | Where it lives today (Railway) | Behaviour on rollover |
|---|---|---|
| Monthly leaderboard rows (nickname + game + score, cumulative per month) | `scores` table | Purged on the 1st of each month (UTC) |
| Player identities and profiles | `players`, `player_profiles` | Purged on the 1st of each month (UTC) |
| Badges + per-game personal bests | `player_progress` (keyed by a hidden player id) | **Survive** the monthly rollover |
| Anonymous events / aggregates (visits, sessions, rounds) | `events` | Retained (first-party reporting) |
| Daily database snapshots | `/app/data/backups/` (newest 10 kept) | Rotating, inside the same volume |

Important consequence: **the monthly leaderboard itself cannot be "carried over" past a month
boundary.** Scores are month-scoped, so a board copied today is irrelevant after the next 1st.
What a carry-over actually preserves is the current month's rows (until the next rollover) and
the personal-progress rows (badges/bests), which survive by design.

Also relevant: the **1 Nov UTC monthly wipe** is imminent. If the self-host instances go live
after that boundary, a carry-over of the October board would be purged within days anyway,
which is the main argument for the fresh start.

---

## Option A — FRESH START (recommended)

Pilot boards were born fresh; the new instances are new deployments on new infrastructure, and
the monthly wipe makes any carried-over ranking moot within weeks. Nothing to migrate means
nothing to verify, and no patient nickname from a previous month gets a second life on a new
server.

**Steps**

1. Deploy as documented in `runbook.md` §1–§6. Nothing else.
2. First boot creates each brand's empty board automatically.
3. Optional but recommended if IDX wants a genuinely pristine database (the image ships an old
   August seed, invisible on the board but physically present on the new volume) — run the
   one-off cleanup in `runbook.md` §12.
4. Verify with `smoke-checklist.md`.

**Edge cases**

- Players who were on the Railway boards keep nothing on the new instances except their own
  badge/best progress **if** their hidden player id was also carried over — with a fresh start,
  it is not, so everyone begins at zero. This is expected and consistent with the monthly wipe.
- Nothing on Railway is deleted by this option. The Railway instances keep running (master
  stays there permanently); the IQ/TXG Railway instances can be retired later or kept as a
  fallback — that is a separate decision, not part of this migration.

---

## Option B — CARRY-OVER (copy the current month's board into the new instance)

Choose this only if the owner wants the pilot's existing players to see their scores on the new
server on day one.

The app has a passcode-protected full-database export, so the mechanics are simple:

```bash
# 1. From the EXISTING instance (Railway), download the whole SQLite database.
#    Replace <passcode> with that instance's current admin passcode.
curl -sS -o iq-export.db \
  "https://imaging-queensland-production.up.railway.app/api/leaderboard/export?passcode=<passcode>"
# repeat for The Xray Group:
curl -sS -o txg-export.db \
  "https://the-xray-group-production.up.railway.app/api/leaderboard/export?passcode=<passcode>"
```

Sanity-check the download before touching the server (a JSON error page means a wrong passcode):

```bash
file iq-export.db            # expect: SQLite 3.x database
sqlite3 iq-export.db "select month, count(*) from scores group by month;"
```

```bash
# 2. On the IDX server: seed each volume BEFORE the first start that patients will see.
cd /opt/radgames
sudo docker compose up -d          # creates the volumes (fresh)
sudo docker compose stop           # stop the app so the file is not open
sudo docker compose run --rm --no-deps -v /root/iq-export.db:/seed-import.db:ro \
  imaging-queensland bun -e '
    import { Database } from "bun:sqlite";
    const src = new Database("/seed-import.db", { readonly: true });
    const db = new Database("/app/data/leaderboard.db");
    const rows = src.query("SELECT name, game, score, month, created_at FROM scores").all();
    const ins = db.query("INSERT OR REPLACE INTO scores (name, game, score, month, created_at) VALUES (?,?,?,?,?)");
    db.transaction(() => { for (const r of rows) ins.run(r.name, r.game, r.score, r.month, r.created_at); })();
    console.log("imported", rows.length, "score rows");
    db.close();'
# repeat the run step for the-xray-group with /root/txg-export.db
sudo docker compose up -d
```

**Caveats you must accept with Option B**

- Only rows whose `month` matches the current UTC month are visible on the board; older rows
  sit in the table and are purged at the next rollover (harmless, but it means an October
  import is worthless in November).
- The player-progress rows (badges/bests) reference hidden player ids that only exist inside
  that database; importing them is possible but this bundle does not do it (the board nodes
  above are what players see). If badges on day one matter, ask for the progress rows to be
  imported too and we extend this procedure.
- Copying a production database is itself a data-handling step: the file contains nicknames.
  It must be transferred and deleted securely, and the export should not be left on disk.
- Requires the existing instance's passcode, i.e. the owner doing the export step.

---

## What "done" looks like

- [ ] Owner records the decision (A or B) in the team's plan and tells IT/owner which to run.
- [ ] If B: export downloaded, sanity-checked, imported, and the temporary `.db` files deleted.
- [ ] Either way: `smoke-checklist.md` signed off on both instances.
