# Rad Games — Retention & Deletion Policy

**Document version:** 1.0 (working draft for IDX review)
**Written:** 30 September 2026
**Applies to:** all three live Rad Games instances — Rad Games (master), Imaging Queensland, The Xray Group
**Owner:** Rad Games pilot owner (Integral Diagnostics)
**Status:** every retention and deletion claim below was verified against the code at `main` @ `5410f03`. Claims that are **not** implemented are listed in plain language in [§10 Gaps found](#10-gaps-found--things-that-are-not-implemented-today). Nothing here is aspirational.

---

## 1. Plain-language summary (for clinic staff)

Rad Games is the free games screen patients reach by scanning a QR code in the waiting room. Nobody makes an account, and we never ask for a real name, phone number, email address, location or medical information.

**What we keep, in plain words:**

| Kept | For how long |
| --- | --- |
| The nickname the patient chose | Until the 1st of the next month, then deleted automatically |
| Their game scores for the month | Until the 1st of the next month, then deleted automatically |
| Their badges and personal best scores | Kept so a returning player still sees their progress. No name is stored with them |
| Anonymous counts of how many games were played and how long the session lasted | Kept for reporting. No name, no player number, nothing that points at a person |

**How a patient deletes their own data:** they open **Settings → Clear All Data** on their own phone. That removes their scores, their nickname record and their badges from our server and wipes the data saved on the device. It takes effect immediately.

**How a patient can ask us to delete their data instead:** they tell a staff member at the practice. The staff member does not need any passcode or login, and cannot delete anything themselves. They pass the request to the Rad Games operator, who either tells the patient about the Settings button or removes the record directly (see [§6](#6-clinic-facing-deletion-request-process)).

**The most important thing to know:** because the whole board is deleted automatically on the 1st of each month (UTC), a nickname and its scores are gone within a month even if nobody asks. There is one honest caveat: our automatic daily backups on the server keep up to the 10 most recent copies, and those copies are not individually edited when a player deletes their data. A copy can therefore outlive a deletion by up to about 10 days, or much less if the service has restarted recently (see [Gap 4](#10-gaps-found--things-that-are-not-implemented-today)). Nobody has access to those copies except the Rad Games operator.

**If the pilot ends:** the whole database on all three instances (scores, nicknames, badges, anonymous counts and every backup copy) is destroyed and the instances are retired. The step-by-step procedure and the signed confirmation report are in [§8](#8-discontinuation-contract-termination-secure-wipe).

---

## 2. Scope, instances and where the data lives

| Instance | Public URL | Data store |
| --- | --- | --- |
| Rad Games (neutral master) | `https://play-production-3271.up.railway.app` | own SQLite DB on its own Railway volume |
| Imaging Queensland | `https://imaging-queensland-production.up.railway.app` | own SQLite DB on its own Railway volume |
| The Xray Group | `https://the-xray-group-production.up.railway.app` | own SQLite DB on its own Railway volume |

- **One file per instance.** Each instance runs one Bun server which opens exactly one SQLite database: `data/leaderboard.db` on the instance's mounted volume (`LEADERBOARD_DB_PATH`, default `<repo>/data/leaderboard.db` — `server/leaderboard.ts:74-77`; on Railway the volume is mounted at `/app/data`, seeded once by `entrypoint.sh`).
- **No cross-brand sharing.** There is no shared database, no central aggregation, and no third-party service. `server/metrics.ts` writes into the same per-instance file (`server/metrics.ts:16-20`).
- **First-party only.** There is no third-party analytics SDK, no external API call that carries player data, and no other data store anywhere in the codebase (no IndexedDB, no second database — verified by search).
- **Nothing about a scan.** Rad Games is not connected to any patient record system, appointment system or imaging system. Nothing a patient does in the games is linked to their scan, their results or their care.

---

## 3. Data inventory and retention periods

Schema: `server/leaderboard.ts` → `migrate()` (line 147). Table definitions: `scores` (126), `players` (179), `player_profiles` (191), `player_progress` (216), `events` (230), `meta` (252).

### 3.1 Server-side stores

| # | Store | What it holds | Retention period | Removed by |
| --- | --- | --- | --- | --- |
| 1 | `scores` | Nickname (display text), game id, running point total for the month, month (`YYYY-MM`), hidden player id (`pid`), created_at | **Current month only.** Purged by the monthly rollover at the first request after 00:00 UTC on the 1st | rollover; player's own delete; admin board clear (all rows) |
| 2 | `players` | `id` (hidden random 32-hex player id), `name` (the nickname), `name_key` (lower-cased name for lookup), timestamps | **Current month only.** Purged by the monthly rollover | rollover; player's own delete. **Not** removed by the admin board clear — see [Gap 1](#10-gaps-found--things-that-are-not-implemented-today) |
| 3 | `player_profiles` | `player_id`, per-game personal bests, achievement counters, badges earned (with unlock time) | **Current month only.** Purged by the monthly rollover | rollover; player's own delete. **Not** removed by the admin board clear — see [Gap 1](#10-gaps-found--things-that-are-not-implemented-today) |
| 4 | `player_progress` | `pid`, `badges_json`, `bests_json`, updated_at. **Deliberately holds no name at all** | **Indefinite** — survives every monthly purge by owner decision (2026-09-24). No expiry date is implemented | player's own delete ("Clear All Data"); a manual purge on discontinuation |
| 5 | `events` | One row per visit / game start / completed round: random per-tab `session` token, event type, page path, game id, duration in seconds, created_at. **No name, no player id, no cookie, no device data** | **Indefinite** — there is no purge path in the code at all ([Gap 2](#10-gaps-found--things-that-are-not-implemented-today)). Owner decision: anonymous aggregates are retained for pilot reporting. Counting starts 21 Sep 2026 (the dashboard publishes its own `countingSince`) | nothing today; manual purge on discontinuation |
| 6 | `meta` | Server bookkeeping only: one row, `active_month` | Indefinite (a single date string) | manual purge |
| 7 | **Daily snapshots** — `data/backups/leaderboard-<UTC stamp>.db` | A full byte copy of the database (tables 1-6) made with SQLite `VACUUM INTO` | **Newest 10 files only** (`SNAPSHOT_KEEP = 10`, `server/leaderboard.ts:80`; pruned by `pruneSnapshots()`, line 1435). A restart takes a fresh snapshot, so 10 files can span far less than 10 days | count-based pruning only. **A player delete or the monthly rollover does not touch existing snapshots** — see [Gap 4](#10-gaps-found--things-that-are-not-implemented-today) |

Notes on the numbers above, all verified in code:

- The snapshot cadence is **at boot plus every 24 hours** (`takeSnapshot()` line 1459, `startLeaderboardBackups()` line 1479, called once from `serve.ts` at startup). Pruning keeps the 10 newest files and nothing else.
- Snapshots and the live DB are **unencrypted at rest** and sit on the instance's volume alongside the live database.
- A snapshot can also be pulled off the platform by an operator using the passcode-protected export (see [§7](#7-operator-tools-admin-clear-export-snapshots)). Any exported file held outside the platform is outside this policy's automatic controls — the handling rule is in [§7.3](#73-exported-database-files-operator-rule) and the destruction step in [§8](#8-discontinuation-contract-termination-secure-wipe).

### 3.2 Device-side stores (on the patient's own phone)

| Store | What it holds | Lifetime | Removed by |
| --- | --- | --- | --- |
| `localStorage` keys (nickname, per-game bests, badges, points history, level/moves, PWA install flag, terms acceptance) | The patient's own game progress, kept so the app works offline | Until the player clears data or the browser drops it | Settings → Clear All Data (`localStorage.clear()`, `src/routes/settings.tsx:58`); browser "clear site data" |
| `lightboxPlayerId` cookie | The same hidden random player id as `players.id`, mirrored into a first-party cookie so an installed PWA (which starts with empty local storage) is recognised again | **365 days** (`PLAYER_ID_COOKIE_MAX_AGE`, `src/lib/playerIdentity.ts:34`), refreshed on use | Clear All Data expires it (`setPlayerId(null)`, `src/routes/settings.tsx:56`); the browser's own cookie expiry/clearing |
| `sessionStorage` session token | Anonymous per-tab id used only to count visits/sessions | Until the tab closes | closing the tab |

There is **no IndexedDB**, no service-worker data cache of player data, and no device fingerprinting anywhere (verified by search of `src/` and `server/`).

### 3.3 What is deliberately never collected

Confirmed by code inspection (and re-confirmed 22 Sep for the IDX IT self-check): no real name, no email, no phone number, no address, no location, no movement data, no IP address is stored, no device identifier, no advertising identifier, no patient/medical data, no appointment or scan information, no password, no account. The only identifier a person supplies is the nickname they type, and the only identifier the system generates is a random player id that is never displayed on the board.

---

## 4. The monthly rollover purge (1st of the month, UTC)

**What happens.** The board is a monthly board. At the first request after midnight UTC on the 1st, the server purges the previous month's identity data before serving anything else, so a new month's player can never be offered a stale name.

**Code path.** `runMonthlyRollover()` — `server/leaderboard.ts:337`. Called at the top of every API request by `handleLeaderboardApi()` — `server/leaderboard.ts:1647-1651` ("The month boundary is checked before any route is served"). The month comes from `currentMonthUtc()` (line 259). The boundary marker is `meta.active_month` (lines 314-331).

**Exactly what is erased** (one transaction, `server/leaderboard.ts:348-358`):

```sql
DELETE FROM scores;          -- every nickname, score row and pid for the month
DELETE FROM players;         -- every nickname identity row
DELETE FROM player_profiles; -- every mirrored profile (bests / stats / badges) + the hidden pid mapping
UPDATE meta SET active_month = <new month>;
```

**Exactly what survives, and why:**

- `player_progress` is **deliberately not deleted** (comment at `server/leaderboard.ts:352-355`; enforced by the test "crossing the boundary wipes scores, players and profiles but not progress" in `server/monthly-rollover.test.ts`). It holds the player's badge unlocks and personal bests, keyed by the hidden pid, and **stores no name**, so nothing in it can resurrect a stale "is this you?" nickname. Owner decision, 2026-09-24.
- `events` is deliberately not deleted (comment at `server/leaderboard.ts:301-303`). It contains no name, no player id and no persistent identifier, and it is the pilot's reporting history.
- `meta.active_month` moves forward.

**Four cases, only one of which deletes anything** (documented at `server/leaderboard.ts:284-299`, all four covered by tests):

1. No marker yet (fresh DB or one restored from a snapshot) → marker written, **nothing deleted** — a deployment must never mistake itself for a month boundary.
2. Marker = current month → nothing to do (every normal request).
3. Marker < current month → the purge above runs, once, atomically.
4. Marker > current month (clock went backwards / restore) → nothing deleted.

**Timing nuance.** The purge is driven by requests, not a cron job: if the server is idle over midnight on the 1st, the purge happens at the next request instead. Practically this is invisible (nobody is reading the board in that window), and it means the previous month's rows can sit in the file for a short idle period — but any viewing request purges before it answers, so old names are never shown.

**Snapshots are not purged by this** — a snapshot taken on the last day of the month still contains that month's rows until it ages out of the newest 10 ([Gap 4](#10-gaps-found--things-that-are-not-implemented-today)).

---

## 5. Player self-service deletion ("Clear All Data")

**Where the player finds it.** Settings → Data → **Clear All Data** (`src/routes/settings.tsx`). Confirmation dialog first; the copy reads "Removes your scores from the leaderboard and all saved data on this device. This cannot be undone."

**Code path.**

1. Client: `handleClearData()` — `src/routes/settings.tsx:38-62` → `deletePlayerData()` — `src/lib/leaderboard.ts:388` → `POST /api/player/delete`.
2. Server: route at `server/leaderboard.ts:1670`; handler `handlePlayerDelete()` — `server/leaderboard.ts:1607`.

**Exactly which server rows are deleted.** With a player id (the `lightboxPlayerId` cookie, falling back to `playerId` in the body), all four in **one transaction** (`server/leaderboard.ts:1625-1638`):

```sql
DELETE FROM scores          WHERE pid = ?;   -- their board rows, all games
DELETE FROM players         WHERE id  = ?;   -- their nickname identity row
DELETE FROM player_profiles WHERE player_id = ?;  -- their mirrored profile
DELETE FROM player_progress WHERE pid = ?;   -- their badges and personal bests (survivor store)
```

**The one-transaction guarantee:** the four deletes run inside `database.transaction(...)` (`server/leaderboard.ts:1625`), so a crash or error can never leave a player half-erased — either all four go or none do. Verified by `server/player-delete.test.ts`.

**Without any id** (a guest "Guest NNNN" player, or a pre-identity row): only the anonymous name-pool row for exactly the name supplied is removed — `DELETE FROM scores WHERE name = ? AND pid = ''` (`server/leaderboard.ts:1617-1622`). A name alone can never widen the delete to rows that belong to a real player id, so typing somebody else's nickname deletes nothing of theirs beyond the shared anonymous pool.

**A `name` sent alongside a valid player id is ignored** (comment at `server/leaderboard.ts:1539-1542`) — the id is the only proof of ownership, and a name is not proof of anything.

**Device side, after the server confirms** (`src/routes/settings.tsx:54-62`): the id cookie is expired (`setPlayerId(null)`), `localStorage.clear()` runs, then the page reloads. If the server call fails, **the device is not wiped** and the player is told the erase failed (`src/routes/settings.tsx:47-53`) — so the player is never shown a "cleared" state that is not true.

**What is not touched:** `events` (it holds nothing belonging to that player — no name, no id, only a per-tab random token) and the daily snapshots.

---

## 6. Clinic-facing deletion-request process

**Purpose.** A patient who does not want to use the Settings button, or who is no longer holding the device they played on, asks practice staff to have their data removed. Staff need no passcode, no login and no access to Rad Games; they only pass the request on.

### 6.1 What the staff member does

1. **Take the request in person.** The patient asks at the practice (the Terms of Use point them there: "ask a member of staff at the practice where you are waiting").
2. **Record, on the deletion-request form or email, only these four things:**
   - the **nickname exactly as it appeared** on the leaderboard (spelling and any symbols matter);
   - the **month they played** (e.g. "September 2026") — because everything is wiped monthly, the month is what makes the request findable;
   - the **practice and the game screen/QR page** they used (which brand instance: Imaging Queensland, The Xray Group, or Rad Games);
   - the **date of the request** and the staff member's name.
   - **Do not collect** the patient's date of birth, address, Medicare number, scan details or anything else. The nickname and month are enough, and collecting more would create the very data we are trying to avoid.
3. **Send it to the Rad Games operator.** Channel: *to be confirmed by the owner* — see [Gap 3](#10-gaps-found--things-that-are-not-implemented-today); there is currently no published Rad Games contact address. Until one exists, requests go to the Rad Games pilot owner at IDX.
4. **Tell the patient what happens next** (see 6.3).

### 6.2 What the Rad Games operator does

| Step | Action | Target |
| --- | --- | --- |
| 1 | Acknowledge the request to the staff member | 2 business days |
| 2 | Decide which route applies (below) and act | 5 business days |
| 3 | Confirm in writing back to the staff member what was erased and when, and how many rows | with the completion note |
| 4 | Record the request in the deletion register ([§6.4](#64-deletion-register)) | same day |

**Route A — the patient still has their device (the normal case, and immediate).** The operator tells the staff member to ask the patient to open **Settings → Clear All Data**. That erases scores, nickname identity, profile and badges on the server in one transaction and wipes the device. No operator tooling needed.

**Route B — the patient no longer has the device.** The operator cannot do this today with any existing tool.
- **What exists:** the admin **board clear** (`POST /api/leaderboard/clear`, `handleClear`, `server/leaderboard.ts:1399`) deletes **every** `scores` row on the instance and **nothing else** — it does not remove the `players` row (the nickname) or the profile ([Gap 1](#10-gaps-found--things-that-are-not-implemented-today)). It is a presentation tool, not a privacy tool, and using it on a live pilot board would also erase every other patient's scores.
- **What is therefore done in practice:**
  - **Preferred, zero-tooling option:** tell the patient (via the staff member) that the data is deleted by the automatic monthly purge on the 1st (UTC), and confirm when that has happened. Because no name or score survives the boundary, this is a genuine, complete erasure of all player-level data.
  - **If the owner wants it gone sooner:** a deliberate manual deletion by the operator, using shell access to that instance's database (Railway shell / `sqlite3 data/leaderboard.db`), running the same four deletes scoped to the nickname, e.g.:
    ```sql
    BEGIN;
    DELETE FROM scores          WHERE name = '<nickname>' OR pid IN (SELECT id FROM players WHERE name_key = lower('<nickname>'));
    DELETE FROM player_progress WHERE pid IN (SELECT id FROM players WHERE name_key = lower('<nickname>'));
    DELETE FROM player_profiles WHERE player_id IN (SELECT id FROM players WHERE name_key = lower('<nickname>'));
    DELETE FROM players         WHERE name_key = lower('<nickname>');
    COMMIT;
    ```
    This is **manual, unaudited and not exposed by any endpoint** — it must be recorded in the deletion register with the operator's name, and it should be replaced by a proper passcode-protected endpoint in a future build ([Gap 3](#10-gaps-found--things-that-are-not-implemented-today)).
  - **Either route:** the same caveat applies and must be repeated to the patient — the automatic daily snapshots may still hold a copy for up to about 10 days (or less), and none is individually edited ([Gap 4](#10-gaps-found--things-that-are-not-implemented-today)).

**Identity check.** The service has no accounts, so there is no way to prove that the person asking owns the nickname. Because a nickname is not PII and the data is only game scores, the policy is: **honour the request**, and note in the register that the request was unverified. A name-only erasure can only ever remove the anonymous pool row (`pid = ''`); rows attached to a real player id can only be removed by someone who physically holds that device (then Route A applies) or by the operator's manual step above.

### 6.3 What the staff member reports back to the patient

> "Your Rad Games scores and nickname have been removed. Rad Games does not keep your name, contact details or any medical information, and the whole leaderboard is cleared automatically at the start of each month. Our automatic daily backup copies may still hold a copy for up to about ten days, after which nothing is left. If you play again you will start fresh, and you can remove your data yourself at any time from Settings → Clear All Data."

### 6.4 Deletion register

Every clinic-initiated request is logged in one place (a tab in the pilot's operations sheet, or a file kept with this policy). Columns:

`Request date | Instance (Rad Games / Imaging Queensland / The Xray Group) | Nickname | Month played | Requested by (staff) | Route (A self-service / B manual / C monthly purge) | Action date | Rows erased (scores / players / profiles / progress) | Operator | Notes (e.g. unverified identity, snapshot caveat given)`

The register deliberately holds the nickname (needed to find the rows) and no other personal information about the patient.

---

## 7. Operator tools: admin clear, export, snapshots

All three are passcode-protected with the same secret (`LEADERBOARD_ADMIN_PASSCODE`, default `clear2026` — `server/leaderboard.ts:110`, `server/metrics.ts:76`). The passcode is held by the Rad Games owner/operator only; it is not shared with clinic staff, and any staff-facing instructions must not contain it.

### 7.1 Admin board clear — `POST /api/leaderboard/clear`

- UI: the discreet admin control on the leaderboard page (`src/routes/leaderboard.tsx:174-203`); API: `handleClear`, `server/leaderboard.ts:1399-1412`.
- Behaviour: `DELETE FROM scores` — **and nothing else**. 403 on a wrong passcode.
- Intended use: clearing a presentation board. **It is not a privacy deletion** — nickname rows in `players`, profiles and the survivor store remain ([Gap 1](#10-gaps-found--things-that-are-not-implemented-today)). It also clears every player's scores on that instance, so it must not be used to answer one patient's request.

### 7.2 Export and snapshots

- **Automatic snapshots:** a full `VACUUM INTO` copy at boot and every 24h into `data/backups/leaderboard-<YYYYMMDD-HHMMSS>.db`, keeping the newest 10 (`takeSnapshot()` line 1459, `pruneSnapshots()` line 1435, `startLeaderboardBackups()` line 1479 called from `serve.ts`). Purpose: recovery of the board after container loss.
- **Admin export:** `GET /api/leaderboard/export` (`handleExport`, `server/leaderboard.ts:1498`) streams a fresh full-database copy to the caller; the temporary copy on the server is deleted immediately after in a `finally` block (line 1525). This is the only way an operator can take the data off the platform.

### 7.3 Exported database files (operator rule)

An exported `.db` is a full copy of player-level data and is not covered by any automatic control once it leaves the instance. Rule: an export is taken only for a stated purpose (pilot reporting, recovery, a discontinuation record of counts), stored on the owner's own controlled machine, and **deleted as soon as that purpose is served**. Exports are never emailed, never put in a shared drive, and never committed to the repository (`/data/` is git-ignored — `.gitignore`). The discontinuation procedure enumerates and destroys every exported copy known to the team ([§8](#8-discontinuation-contract-termination-secure-wipe)).

---

## 8. Discontinuation (contract-termination) secure wipe

**Trigger:** the owner or IDX decides the pilot ends (or a practice withdraws and its instance is retired).
**Rule in force:** at most one deploy pass per calendar day, and never a second deploy mutation for the same service in the same pass (`WORKFLOW.md`). A wipe is not a deploy, but the same restraint applies: one pass per instance, then stop.

### 8.1 What exists today and what must be done by hand — stated plainly

- **There is no full-purge endpoint and no "terminate" code path.** The only deletes in the whole codebase are: the player's own four-table delete (`handlePlayerDelete`), the admin clear (`DELETE FROM scores` only), and the count-based snapshot pruning. Nothing clears `events`, `meta`, `player_progress` in bulk, and **nothing deletes snapshot files other than age-based pruning** — verified by searching every `DELETE`/`rmSync` in `server/`.
- The discontinuation wipe is therefore a **manual, documented operation** (SQL plus storage removal) until someone builds a purge endpoint plus snapshot destruction. The steps below are written so it can be executed and evidenced as it stands.

### 8.2 Pre-wipe (per instance, read-only)

1. **Freeze:** stop accepting new play (stop the deployment, or take the QR page down at the practice). No writes after this point.
2. **Record the final counts** — this becomes the evidence in the confirmation report:
   ```sql
   SELECT 'scores', COUNT(*) FROM scores
   UNION ALL SELECT 'players', COUNT(*) FROM players
   UNION ALL SELECT 'player_profiles', COUNT(*) FROM player_profiles
   UNION ALL SELECT 'player_progress', COUNT(*) FROM player_progress
   UNION ALL SELECT 'events', COUNT(*) FROM events
   UNION ALL SELECT 'meta', COUNT(*) FROM meta;
   ```
3. **Record the snapshot inventory:** `ls -l data/backups/` (and any other copy of the DB, see step 5 below).
4. **Decide about the anonymous aggregates.** If IDX wants the pilot's aggregate numbers preserved as a report, export them **before** the wipe (`GET /api/admin/stats/export`, which contains counts only — no names, no pids) and treat that file as the only survivor. Nothing else is retained.

### 8.3 The wipe

5. **Destroy the live data.** Two options:
   - **Recommended — destroy the volume.** Delete the Railway volume attached to the service. This removes `leaderboard.db` (plus its `-wal` and `-shm` sidecar files) and the whole `data/backups/` directory in one act, at the storage layer, so no SQLite pages are left to recover. Do this only after the deployment is stopped.
   - **SQL-level purge (if the volume must be kept, e.g. to reuse the instance):**
     ```sql
     BEGIN;
     DELETE FROM scores;
     DELETE FROM players;
     DELETE FROM player_profiles;
     DELETE FROM player_progress;
     DELETE FROM events;
     DELETE FROM meta;
     COMMIT;
     PRAGMA wal_checkpoint(TRUNCATE);
     VACUUM;
     ```
     then **delete the snapshot directory by hand** (the SQL above does not touch it):
     ```sh
     rm -f data/backups/*.db data/backups/*.db-wal data/backups/*.db-shm
     ```
     Caveat to record: `VACUUM` rewrites the file but is not guaranteed to overwrite every previously-used page on the underlying storage. Volume deletion is the stronger option; if a volume is kept, record that residual-recovery risk as accepted.
6. **Delete every copy held elsewhere by the team, on every machine.** As at 30 Sep 2026 the shared workspace contains **25 SQLite database copies** of real board data outside the repository (13 under `usage-dashboard/`, 6 under `site/data*`, 2 under `player-profile/`, 2 under `.local/`, 1 `railway-deploy/seed/leaderboard.db` — the image seed used to initialise volumes, 1 under `leaderboard-cumulative/restore-snapshots/`). All of them, plus any export taken under [§7.3](#73-exported-database-files-operator-rule), must be deleted, and the deletion listed in the confirmation report by path. This is the step most likely to be forgotten: the seed file in particular ships real rows into a container image.
7. **Retire the instances.** For each of the three (master, Imaging Queensland, The Xray Group): delete the Railway service/environment, then the project if it holds nothing else. The public URLs stop resolving.
8. **Retire the marketing/entry surface (IDX-controlled).** Remove the QR landing pages hosted on IDX's own website, remove or destroy printed QR signage at the participating practices, and confirm with IDX that no clinic copy of the QR remains in circulation.
9. **Retire the stale copy.** A legacy `cto.new` app copy of the product exists and was never used as the live product; it must be unpublished as part of the retirement so no second copy of the app outlives the pilot (owner/platform action).
10. **Logs and any provider-held data.** Application logs are written to stdout and collected by the hosting provider; deployment/build logs are held by that provider under its own policy, and this policy does not (and cannot) verify what it retains. Ask the provider to confirm deletion of the project's logs as part of retiring the project, and record the answer. *(Not verifiable from the codebase — flagged as an open item.)*
11. **Source code.** The code contains no player data (the database is git-ignored), so the repository needs no purge. Confirm by checking that no `.db` file is tracked (`git ls-files | grep -i '\.db$'` returns nothing).

### 8.4 Confirmation report (what a completed wipe looks like)

One page per instance, signed by the operator and counter-signed by the owner, containing:

| Field | Value to record |
| --- | --- |
| Instance + URL | e.g. Imaging Queensland — `https://imaging-queensland-production.up.railway.app` |
| Freeze time (UTC) | when writes stopped |
| Pre-wipe counts | scores / players / player_profiles / player_progress / events / meta (from 8.2 step 2) |
| Snapshot files present pre-wipe | count and file names |
| Volume action | deleted / kept (with SQL purge + residual-recovery note) |
| Post-wipe verification | counts for all six tables = 0, **or** volume reported destroyed by the host; `data/backups` listing empty; `leaderboard.db`, `-wal` and `-shm` absent |
| Local copies destroyed | every path deleted (including the 25 workspace copies and all exports), with count |
| Destination destroyed | `VACUUM` / storage volume removal, stated explicitly |
| Instance retirement | service/environment/project deleted; URL no longer resolves (checked, with timestamp) |
| Entry surface | QR landing page removed, signage withdrawn, confirmed by (name) |
| Aggregate report retained | file name + what it contains (counts only), if any |
| Provider log confirmation | answer received from the host, date |
| Signatures | operator + owner, date |

A wipe is **not** complete until every row of that table is filled and every post-wipe count is zero. If any count is non-zero, or any snapshot survives, the report says so and the wipe is repeated rather than signed off.

---

## 9. Does this satisfy the 90-day rule?

The IT self-check's rule was: granular player-level data is deleted automatically and only anonymised aggregates are retained.

- **Player-level data (nicknames, scores, profiles) is deleted monthly** — a 1-month maximum, not 90 days. **The monthly purge supersedes the 90-day rule**: nothing player-identifying is ever held for 90 days. Note the honest detail that player-level data can persist in the 10 rotating snapshots beyond the month boundary ([Gap 4](#10-gaps-found--things-that-are-not-implemented-today)); the maximum practical life of a nickname is therefore one month plus the age of the oldest surviving snapshot (days, not months).
- **Anonymous events and aggregates are retained by design** (owner decision), with no expiry implemented. They contain no name, no player id and no persistent identifier, so they sit outside the "player data" limb of the rule; the dashboard states its own `countingSince` (events start 21 Sep 2026) and publishes that limitation.
- **The deliberate exception the owner chose:** badge unlocks and per-game personal bests are kept **across** months in `player_progress`, keyed by a hidden pid that is never displayed. The business plan records this as the one point IDX may push back on. If IDX does push back, the remedy is a single change (delete `player_progress` in the rollover transaction at `server/leaderboard.ts:348-358`) at the cost of returning players losing their badges every month — an owner decision, not an engineering one.
- **The 90-day rule is satisfied in spirit and exceeded in practice for player data**, and the residual exposures are named rather than hidden: snapshots (Gap 4), indefinite anonymous events (Gap 2, owner-decided), and indefinite badge/best retention (owner-decided).

---

## 10. Gaps found — things that are not implemented today

These were found by reading the code, not by assuming the plan was right. Each is stated with the file/line so a follow-up can act on it. **No fix has been made: this task is documentation only.**

**Gap 1 — The admin board clear does not remove nicknames, profiles or badges.**
`handleClear()` (`server/leaderboard.ts:1399-1412`) runs only `DELETE FROM scores`. The `players` row holding the nickname, the `player_profiles` row and the `player_progress` row all stay until the monthly rollover (or a targeted delete). So after an operator "clear the board", nicknames are still in the database. Any procedure that claims a board clear wipes a name is wrong today. Options for a future delegation: extend `handleClear` to clear all four tables, or add a separate "privacy purge" endpoint, keeping the presentation clear as-is.

**Gap 2 — The anonymous `events` table has no purge path at all.**
Searching every `DELETE`/`DELETE FROM` in `server/` returns nothing for `events`. Rows accumulate indefinitely. This is an owner decision (reporting history), but it means the discontinuation wipe cannot rely on any code: it must delete `events` by hand, and the 90-day story must name this table as deliberately retained.

**Gap 3 — There is no clinic/staff-facing or operator-facing targeted erasure tool, and no published contact channel.**
- There is no endpoint to erase one named player. The only erasures are the player's own device (`POST /api/player/delete`) and the all-players admin clear (scores only). A deletion request from a patient without their device therefore needs manual database surgery ([§6.2](#62-what-the-rad-games-operator-does) Route B), which is unaudited and needs shell access.
- The Terms of Use draft points patients to "the contact details published by `<brandName>` on their website", and the clinic-facing process needs a real destination for requests. Neither exists yet. A future build should add: (a) a passcode-protected `POST /api/admin/player/erase` keyed by nickname + month, logging what it deleted, and (b) a published Rad Games contact address, consistent across both documents.

**Gap 4 — Snapshots are not redacted or deleted when data is deleted.**
`pruneSnapshots()` (`server/leaderboard.ts:1435`) is purely count-based (keep the newest 10) and `takeSnapshot()` (line 1459) runs at boot and every 24h. Consequences, none of which are currently documented anywhere outside this policy:
- "Clear All Data" does **not** remove the player's rows from snapshots that already exist. A deleted player's nickname and scores can survive in up to 10 snapshot files.
- The same is true of the monthly rollover.
- The 10-file window is **not** a fixed 10 days: every restart takes a fresh snapshot, so a burst of restarts can prune a given snapshot within hours. The practical exposure is "days, and less if the service is restarted often".
- Snapshots are unencrypted and live on the same volume as the live DB.
A future fix would be: on player delete, and/or on rollover, delete or rewrite the snapshots that contain the purged rows (or encrypt snapshots and destroy the key on wipe), plus an admin endpoint to destroy all snapshots for a discontinuation. Until then, the caveat must be given to any patient who asks for deletion.

**Gap 5 — The Terms of Use are drafted but not merged, so the live apps do not currently show the retention wording.**
`src/lib/tou.ts` (and the gate/route that use it) exist only on the `feat/terms-of-use` branch, **not on `main`**. The shared draft `/home/team/shared/terms-of-use-draft-v1.md` is reproduced from that branch. Consequence: the patient-facing statement of "how long we keep it" is not live on any of the three instances yet. The wording itself is consistent with this policy (see [Appendix B](#appendix-b--consistency-with-the-terms-of-use-draft)); merging it is a separate, owner-approved task.

**Gap 6 — Snapshot/backup files copy real rows into the container image context.**
`railway-deploy/seed/leaderboard.db` is a full copy of a live board used to initialise volumes, and 24 further copies of real board data sit loose in the shared workspace. Nothing in the code or process prevents a copy of real data reaching a build context or a teammate's directory. This is a process gap with a concrete remedy: the discontinuation checklist enumerates them ([§8.3](#83-the-wipe) step 6), and a follow-up should replace the frozen seed with an empty (schema-only) database and forbid committing/keeping exports.

**Non-gap, checked and confirmed:** the four-table delete really is one transaction; the rollover really does leave `player_progress` alone; `player_progress` really holds no name; the guest/name-only delete really cannot touch rows owned by a real player id; the export's temporary file really is removed; the app really collects no PII; and there is really no second data store.

---

## 11. How this document was verified

- **Code read:** `server/leaderboard.ts` in full for the schema, rollover, player claim/profile/delete, admin clear, export and snapshot code; `server/metrics.ts` for the event ingest and its reads; `serve.ts` for wiring; `src/lib/leaderboard.ts`, `src/lib/playerIdentity.ts`, `src/routes/settings.tsx`, `src/routes/leaderboard.tsx` for the client behaviour.
- **Automated evidence:** `bun test server/monthly-rollover.test.ts server/player-delete.test.ts server/player-progress.test.ts` → **35 pass, 0 fail, 149 assertions** (run 30 Sep 2026 against `main` @ `5410f03`). These tests assert exactly the behaviour in [§4](#4-the-monthly-rollover-purge-1st-of-the-month-utc) and [§5](#5-player-self-service-deletion-clear-all-data), including "crossing the boundary wipes scores, players and profiles but not progress" and "the survivor row stores no name anywhere in it".
- **Negative search:** every `DELETE`/`rmSync` in `server/` enumerated to establish what is *not* deleted (this is the basis of Gaps 1, 2 and 4). Every file writer enumerated to confirm the only artefacts are `leaderboard.db` and its snapshots/exports.
- **No deploy, no Railway mutation, no code change** was made in producing this document.

---

## Appendix A — code path index

| Claim | Path |
| --- | --- |
| Schema, all six tables | `server/leaderboard.ts:147` (`migrate`), tables at 126 / 179 / 191 / 216 / 230 / 252 |
| DB path / one file per instance | `server/leaderboard.ts:74-77`; volume seed `railway-deploy/entrypoint.sh` |
| Monthly rollover purge | `server/leaderboard.ts:337` (`runMonthlyRollover`), deletes at 348-358 |
| Rollover runs before any route | `server/leaderboard.ts:1647-1651` |
| Current UTC month | `server/leaderboard.ts:259` (`currentMonthUtc`) |
| Player delete (four tables, one transaction) | `server/leaderboard.ts:1607` (`handlePlayerDelete`), transaction 1625-1638 |
| Guest / name-pool delete | `server/leaderboard.ts:1617-1622` |
| Player delete route | `server/leaderboard.ts:1670` |
| Guest name format (`Guest NNNN`, never gets an id) | `server/leaderboard.ts:511`, `resolveIdentity` 667-669 |
| Admin board clear (scores only) | `server/leaderboard.ts:1399` (`handleClear`), `DELETE FROM scores` 1410 |
| Admin clear UI | `src/routes/leaderboard.tsx:174-203` |
| Export (full DB, passcode) | `server/leaderboard.ts:1498` (`handleExport`), temp cleanup 1525 |
| Snapshot take / prune / schedule | `server/leaderboard.ts:1459` / `1435` / `1479`; `SNAPSHOT_KEEP` 80; called from `serve.ts` |
| Event ingest (anonymous, only writer) | `server/metrics.ts:124` (`handleIngest`) |
| Dashboard stats + export | `server/metrics.ts:387-410` (passcode check), `425` (`handleExport`) |
| No purge of events | negative search of `server/` |
| Settings → Clear All Data | `src/routes/settings.tsx:38-62` |
| Client delete call | `src/lib/leaderboard.ts:388` (`deletePlayerData`) |
| Player id in localStorage + cookie (365d) | `src/lib/playerIdentity.ts:27`, `34`, `61` |
| Passcode (both APIs) | `server/leaderboard.ts:110`, `server/metrics.ts:76` |
| Terms of Use draft (branch only) | `origin/feat/terms-of-use:src/lib/tou.ts` |

## Appendix B — consistency with the Terms of Use draft

The drafted Terms of Use (`src/lib/tou.ts` on `origin/feat/terms-of-use`; copy at `/home/team/shared/terms-of-use-draft-v1.md`) says, in section 3, that it keeps "the nickname you choose, your game scores, and anonymous statistics"; in section 4, that "Leaderboard scores and nicknames are cleared automatically at the start of each month. Your badges and your personal best scores are kept against an anonymous internal player ID" and that "You can erase everything at any time in Settings, under Clear All Data"; and in section 5, that nothing is sold or shared.

This policy is consistent with all of that, with two additions the Terms do not state and that the owner may want reflected there:

1. the **daily server backups** may retain a deleted player's rows for a period after "Clear All Data" or the monthly clear ([Gap 4](#10-gaps-found--things-that-are-not-implemented-today)) — the Terms' "you can erase everything" is true of the live system, not of existing backup copies;
2. the **anonymous usage statistics are kept indefinitely**, not only for the month.

The Terms' "no device identifiers" sentence is also worth a second look: the app stores a random player id in localStorage and in a first-party cookie for up to 365 days. It is not a device identifier in the fingerprinting sense (opaque random value, no device attributes), but the draft already flags this as a wording point for IDX legal.

---

*End of policy. This is a working document written by the team for review; it is not owner-ratified and not legal advice.*
