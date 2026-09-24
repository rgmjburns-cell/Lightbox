/**
 * Unit tests for the month-boundary purge (`runMonthlyRollover` in
 * `server/leaderboard.ts`).
 *
 * The rule under test, from the owner's decision at IDX's request: on the 1st of
 * the month (UTC) nothing crosses the boundary. Scores, player identities and
 * profiles go; the first-party `events` log stays (it carries no name and no
 * persistent identifier, and it is the pilot's reporting history).
 *
 * Everything runs against the REAL handler and the REAL schema:
 * `LEADERBOARD_DB_PATH` points the module at a scratch SQLite file before it is
 * imported, so no deployment's board can be touched. The calendar is injected
 * (`runMonthlyRollover(month)`), so the boundary can be crossed on demand instead
 * of waiting for the 1st.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRATCH_DIR = join(tmpdir(), `lightbox-rollover-${String(process.pid)}`);
mkdirSync(SCRATCH_DIR, { recursive: true });
process.env.LEADERBOARD_DB_PATH = join(SCRATCH_DIR, "leaderboard.db");

const { getDb, handleLeaderboardApi, runMonthlyRollover } = await import("./leaderboard.ts");

/** The month the app itself believes it is in. */
const NOW_MONTH = new Date().toISOString().slice(0, 7);

interface Counts {
  scores: number;
  players: number;
  profiles: number;
  events: number;
}

function counts(): Counts {
  const one = (sql: string) =>
    Number((getDb().query(sql).get() as { n: number } | null)?.n ?? 0);
  return {
    scores: one("SELECT COUNT(*) AS n FROM scores"),
    players: one("SELECT COUNT(*) AS n FROM players"),
    profiles: one("SELECT COUNT(*) AS n FROM player_profiles"),
    events: one("SELECT COUNT(*) AS n FROM events"),
  };
}

function currentMarker(): string | null {
  const row = getDb()
    .query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'active_month'")
    .get();
  return row?.value ?? null;
}

function setMarker(value: string): void {
  getDb()
    .query(
      `INSERT INTO meta (key, value) VALUES ('active_month', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(value);
}

/** One month's worth of board state: two players, a guest, and two events. */
function seedMonth(month: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.query(
    "INSERT INTO scores (name, game, score, month, pid) VALUES (?, ?, ?, ?, ?)",
  ).run("RolloverDana", "scan-rush", 900, month, "pidRollover000001");
  db.query(
    "INSERT INTO scores (name, game, score, month, pid) VALUES (?, ?, ?, ?, ?)",
  ).run("RolloverDana", "memory-scan", 40, month, "pidRollover000001");
  db.query(
    "INSERT INTO scores (name, game, score, month, pid) VALUES (?, ?, ?, ?, ?)",
  ).run("Guest 4242", "bone-buster", 12, month, "");
  db.query(
    `INSERT INTO players (id, name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, name_key = excluded.name_key`,
  ).run("pidRollover000001", "RolloverDana", "rolloverdana", now, now);
  db.query(
    `INSERT INTO player_profiles (player_id, bests, stats, badges, updated_at)
     SELECT ?, '{}', '{}', '{"first-scan":"2026-09-01T00:00:00.000Z"}', ?
     WHERE NOT EXISTS (SELECT 1 FROM player_profiles WHERE player_id = ?)`,
  ).run("pidRollover000001", now, "pidRollover000001");
  db.query("INSERT INTO events (session, type, page) VALUES ('s1', 'visit', '/')").run();
  db.query(
    "INSERT INTO events (session, type, page, game) VALUES ('s1', 'round_end', '/play/scan-rush', 'scan-rush')",
  ).run();
}

async function postScore(body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const req = new Request("http://localhost/api/leaderboard", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await handleLeaderboardApi(req, "/api/leaderboard");
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeAll(() => {
  const db = getDb();
  for (const table of ["scores", "players", "player_profiles", "events", "meta"]) {
    db.query(`DELETE FROM ${table}`).run();
  }
});

describe("month rollover", () => {
  test("a database with no marker records the month and deletes nothing", () => {
    const result = runMonthlyRollover("2026-09");
    expect(result).toEqual({
      from: null,
      to: "2026-09",
      rolled: false,
      deleted: { scores: 0, players: 0, profiles: 0 },
    });
    expect(currentMarker()).toBe("2026-09");
    expect(counts()).toEqual({ scores: 0, players: 0, profiles: 0, events: 0 });
  });

  test("requests inside the same month never purge anything", () => {
    seedMonth("2026-09");
    expect(counts()).toMatchObject({ scores: 3, players: 1, profiles: 1, events: 2 });
    for (let i = 0; i < 3; i++) {
      expect(runMonthlyRollover("2026-09").rolled).toBe(false);
    }
    expect(counts()).toMatchObject({ scores: 3, players: 1, profiles: 1 });
    expect(currentMarker()).toBe("2026-09");
  });

  test("a clock that moves backwards is not a rollover", () => {
    const result = runMonthlyRollover("2026-08");
    expect(result.rolled).toBe(false);
    expect(result.from).toBe("2026-09");
    expect(counts()).toMatchObject({ scores: 3, players: 1, profiles: 1 });
    expect(currentMarker()).toBe("2026-09");
  });

  test("an unreadable marker is treated as no marker, not as a rollover", () => {
    setMarker("not-a-month");
    const result = runMonthlyRollover("2026-09");
    expect(result).toEqual({
      from: null,
      to: "2026-09",
      rolled: false,
      deleted: { scores: 0, players: 0, profiles: 0 },
    });
    expect(counts()).toMatchObject({ scores: 3, players: 1, profiles: 1 });
    expect(currentMarker()).toBe("2026-09");
  });

  test("crossing the boundary purges scores, identities and profiles in one go", () => {
    const result = runMonthlyRollover("2026-10");
    expect(result).toEqual({
      from: "2026-09",
      to: "2026-10",
      rolled: true,
      deleted: { scores: 3, players: 1, profiles: 1 },
    });
    expect(counts()).toEqual({ scores: 0, players: 0, profiles: 0, events: 2 });
    expect(currentMarker()).toBe("2026-10");
  });

  test("the purge is idempotent and every later boundary is a clean no-op", () => {
    expect(runMonthlyRollover("2026-10").rolled).toBe(false);
    const next = runMonthlyRollover("2026-11");
    expect(next.rolled).toBe(true);
    expect(next.deleted).toEqual({ scores: 0, players: 0, profiles: 0 });
    expect(runMonthlyRollover("2026-11").rolled).toBe(false);
    // The September events have survived every boundary.
    expect(counts().events).toBe(2);
  });
});

describe("month rollover on live requests", () => {
  test("a mid-month submission is unaffected, and the marker does not move", async () => {
    setMarker(NOW_MONTH);
    const posted = await postScore({
      name: "RolloverSam",
      game: "scan-rush",
      score: 250,
    });
    expect(posted.status).toBe(200);
    expect(posted.json.ok).toBe(true);
    expect(currentMarker()).toBe(NOW_MONTH);
    const rows = getDb()
      .query<{ score: number }, [string]>("SELECT score FROM scores WHERE name = ?")
      .all("RolloverSam");
    expect(rows).toEqual([{ score: 250 }]);
  });

  test("the next request after the boundary performs the purge, before the round is banked", async () => {
    seedMonth("2020-01"); // a stale month, as if the server had been idle
    setMarker("2020-01");
    const before = counts();
    expect(before.scores).toBeGreaterThan(1);

    const posted = await postScore({ name: "RolloverSam", game: "scan-rush", score: 300 });
    expect(posted.status).toBe(200);
    expect(currentMarker()).toBe(NOW_MONTH);

    // Everything the stale month held is gone...
    expect(
      getDb()
        .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM scores WHERE month = '2020-01'")
        .get()?.n,
    ).toBe(0);
    expect(counts().players).toBe(1); // only RolloverSam's fresh identity
    // ...the anonymous analytics are not...
    expect(counts().events).toBe(before.events);
    // ...and the round that triggered it was banked normally.
    expect(
      getDb()
        .query<{ score: number }, []>(
          "SELECT score FROM scores WHERE name = 'RolloverSam' AND month = ?",
        )
        .all(NOW_MONTH)
        .length,
    ).toBe(1);
  });

  test("a request that hits no route still checks the boundary", async () => {
    seedMonth("2018-12");
    setMarker("2018-12");
    const req = new Request("http://localhost/api/nothing-here", { method: "GET" });
    const res = await handleLeaderboardApi(req, "/api/nothing-here");
    expect(res.status).toBe(404);
    expect(currentMarker()).toBe(NOW_MONTH);
    expect(
      getDb().query<{ n: number }, []>("SELECT COUNT(*) AS n FROM scores").get()?.n,
    ).toBe(0);
  });
});
