/**
 * Survivor progress (`player_progress`) — tests for the owner decision of
 * 2026-09-24, the follow-up to the monthly identity wipe.
 *
 * The rule under test: at the month boundary a player's NAME, SCORES and PROFILE
 * are still purged completely (no stale "is this you?" matches), but their badge
 * unlocks and per-game personal bests are theirs and survive — a returning player
 * sees the badges they earned and the bests they are chasing in the new month.
 *
 * `player_progress` is keyed by the hidden pid and stores no name at all, so
 * nothing in it can resurrect a nickname. These tests drive the REAL handler and
 * the REAL schema against a scratch SQLite file (`LEADERBOARD_DB_PATH` is set
 * before the module is imported), and inject the calendar so the boundary can be
 * crossed on demand.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRATCH_DIR = join(tmpdir(), `lightbox-progress-${String(process.pid)}`);
mkdirSync(SCRATCH_DIR, { recursive: true });
process.env.LEADERBOARD_DB_PATH = join(SCRATCH_DIR, "leaderboard.db");

const { getDb, handleLeaderboardApi, runMonthlyRollover } = await import("./leaderboard.ts");

/** The month the app itself believes it is in. */
const NOW_MONTH = new Date().toISOString().slice(0, 7);
const OLD_NAME = "ProgressPat";
const NEW_NAME = "PatAgain";
const UNLOCKED_AT = "2026-09-01T09:30:00.000Z";
const PAT_BADGES = { "first-scan": UNLOCKED_AT };
const PAT_BESTS = { scanRushHighScore: 4321, boneBuster_score: 900 };

function one(sql: string, ...params: (string | number)[]): number {
  const row = getDb()
    .query<{ n: number }, (string | number)[]>(sql)
    .get(...params);
  return Number(row?.n ?? 0);
}

function counts() {
  return {
    scores: one("SELECT COUNT(*) AS n FROM scores"),
    players: one("SELECT COUNT(*) AS n FROM players"),
    profiles: one("SELECT COUNT(*) AS n FROM player_profiles"),
    progress: one("SELECT COUNT(*) AS n FROM player_progress"),
    events: one("SELECT COUNT(*) AS n FROM events"),
  };
}

function progressRow(pid: string): {
  badges: Record<string, string>;
  bests: Record<string, number>;
} | null {
  const row = getDb()
    .query<{ badges_json: string; bests_json: string }, [string]>(
      "SELECT badges_json, bests_json FROM player_progress WHERE pid = ?",
    )
    .get(pid);
  if (!row) return null;
  return {
    badges: JSON.parse(row.badges_json) as Record<string, string>,
    bests: JSON.parse(row.bests_json) as Record<string, number>,
  };
}

function setMarker(value: string): void {
  getDb()
    .query(
      `INSERT INTO meta (key, value) VALUES ('active_month', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(value);
}

async function call(
  pathname: string,
  init: { method?: string; body?: Record<string, unknown> } = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const url = new URL(pathname, "http://localhost");
  const req = new Request(url, {
    method: init.method ?? "GET",
    ...(init.body
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(init.body),
        }
      : {}),
  });
  // The router keys off the pathname; the query string must survive in the URL.
  const res = await handleLeaderboardApi(req, url.pathname);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** Bank a round with a client snapshot, as every game does on completion. */
async function postRound(
  pid: string | null,
  body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  return call("/api/leaderboard", {
    method: "POST",
    body: {
      name: OLD_NAME,
      game: "scan-rush",
      score: 500,
      badges: PAT_BADGES,
      bests: PAT_BESTS,
      ...(pid ? { playerId: pid } : {}),
      ...body,
    },
  });
}

let pid = "";

beforeAll(() => {
  const db = getDb();
  for (const table of ["scores", "players", "player_profiles", "player_progress", "events", "meta"]) {
    db.query(`DELETE FROM ${table}`).run();
  }
});

describe("badge unlocks and personal bests reach player_progress", () => {
  test("a submit mirrors the snapshot into both the profile and the survivor row", async () => {
    setMarker(NOW_MONTH);
    const posted = await postRound(null, {});
    expect(posted.status).toBe(200);
    expect(posted.json.ok).toBe(true);
    pid = String(posted.json.playerId ?? "");
    expect(pid.length).toBeGreaterThan(0);

    // The mirrored profile (unchanged behaviour)…
    expect(
      one("SELECT COUNT(*) AS n FROM player_profiles WHERE player_id = ?", pid),
    ).toBe(1);
    // …and the survivor row that the monthly purge will leave alone.
    const progress = progressRow(pid);
    expect(progress?.badges).toEqual(PAT_BADGES);
    expect(progress?.bests).toEqual(PAT_BESTS);
  });

  test("a claim writes the survivor row too", async () => {
    const claimed = await call("/api/player/claim", {
      method: "POST",
      body: {
        name: "ProgressClaimer",
        badges: { "word-wizard": UNLOCKED_AT },
        bests: { scanSearchHighScore: 321 },
      },
    });
    expect(claimed.status).toBe(200);
    const claimPid = String(claimed.json.playerId ?? "");
    expect(claimPid.length).toBeGreaterThan(0);
    const progress = progressRow(claimPid);
    expect(progress?.badges).toEqual({ "word-wizard": UNLOCKED_AT });
    expect(progress?.bests).toEqual({ scanSearchHighScore: 321 });
    // The claim response carries it back in the client's restore shape.
    const carried = claimed.json.progress as { badges: { id: string }[] } | null;
    expect(carried?.badges.map((b) => b.id)).toEqual(["word-wizard"]);
  });

  test("a weaker later snapshot never lowers a stored best or drops a badge", async () => {
    await postRound(pid, {
      badges: {},
      bests: { scanRushHighScore: 10 },
      score: 5,
    });
    const progress = progressRow(pid);
    expect(progress?.badges).toEqual(PAT_BADGES);
    expect(progress?.bests.scanRushHighScore).toBe(4321);
    expect(progress?.bests.boneBuster_score).toBe(900);
  });

  test("the survivor row stores no name anywhere in it", () => {
    const row = getDb()
      .query<{ badges_json: string; bests_json: string }, [string]>(
        "SELECT badges_json, bests_json FROM player_progress WHERE pid = ?",
      )
      .get(pid);
    expect(JSON.stringify(row)).not.toContain(OLD_NAME);
  });
});

describe("month rollover keeps player_progress and purges everything else", () => {
  test("crossing the boundary wipes scores, players and profiles but not progress", () => {
    setMarker("2026-09");
    const before = counts();
    expect(before.scores).toBeGreaterThan(0);
    expect(before.players).toBeGreaterThan(0);
    expect(before.profiles).toBeGreaterThan(0);
    expect(before.progress).toBeGreaterThan(0);
    const progressBefore = progressRow(pid);

    const result = runMonthlyRollover("2026-10");
    expect(result).toEqual({
      from: "2026-09",
      to: "2026-10",
      rolled: true,
      deleted: { scores: before.scores, players: before.players, profiles: before.profiles },
    });
    expect(counts()).toEqual({
      scores: 0,
      players: 0,
      profiles: 0,
      progress: before.progress,
      events: before.events,
    });
    // Byte-identical progress: nothing was rewritten, removed or re-stamped.
    expect(progressRow(pid)).toEqual(progressBefore);
  });

  test("running the rollover again is a no-op for the survivor rows", () => {
    const before = progressRow(pid);
    expect(runMonthlyRollover("2026-10").rolled).toBe(false);
    expect(runMonthlyRollover("2026-11").rolled).toBe(true);
    expect(counts().progress).toBeGreaterThan(0);
    expect(progressRow(pid)).toEqual(before);
  });
});

describe("a purged player gets their progress back, never their name", () => {
  test("GET /api/player/profile?id= answers with progress and no profile", async () => {
    const read = await call(`/api/player/profile?id=${pid}`);
    expect(read.status).toBe(200);
    expect(read.json.ok).toBe(true);
    // The identity rows are gone, so there is no profile to hand back…
    expect(read.json.profile).toBeNull();
    expect(read.json.reason).toBe("unknown-id");
    // …but the badges and bests survived.
    const progress = read.json.progress as {
      badges: { id: string; unlockedAt: string }[];
      bests: Record<string, number>;
    } | null;
    expect(progress?.badges).toEqual([{ id: "first-scan", unlockedAt: UNLOCKED_AT }]);
    expect(progress?.bests.scanRushHighScore).toBe(4321);
    expect(progress?.bests.boneBuster_score).toBe(900);
  });

  test("an unknown pid with no progress is simply empty, never an error", async () => {
    const read = await call("/api/player/profile?id=pidNeverSeen00001");
    expect(read.status).toBe(200);
    expect(read.json.profile).toBeNull();
    expect(read.json.progress).toBeNull();
  });

  test("re-claiming in the new month keeps the progress under the new nickname", async () => {
    const claimed = await call("/api/player/claim", {
      method: "POST",
      body: { name: NEW_NAME, playerId: pid },
    });
    expect(claimed.status).toBe(200);
    expect(claimed.json.playerId).toBe(pid);
    // The name is the one just typed — never the purged one.
    expect(claimed.json.name).toBe(NEW_NAME);
    expect(one("SELECT COUNT(*) AS n FROM players WHERE name = ?", OLD_NAME)).toBe(0);

    const profile = claimed.json.profile as {
      name: string;
      badges: { id: string }[];
      bests: Record<string, number>;
      monthlyTotal: number;
    } | null;
    expect(profile?.name).toBe(NEW_NAME);
    expect(profile?.badges.map((b) => b.id)).toEqual(["first-scan"]);
    expect(profile?.bests.scanRushHighScore).toBe(4321);
    // The new month starts empty: progress survives, the board does not.
    expect(profile?.monthlyTotal).toBe(0);
    expect(claimed.json.progress).not.toBeNull();
  });

  test("a fresh identity with no cookie progress gets nothing from the wipe", async () => {
    const claimed = await call("/api/player/claim", {
      method: "POST",
      body: { name: "BrandNewPatient" },
    });
    expect(claimed.status).toBe(200);
    expect(claimed.json.progress).toBeNull();
    const profile = claimed.json.profile as { badges: unknown[] } | null;
    expect(profile?.badges).toEqual([]);
  });
});

describe("mid-month behaviour is unchanged", () => {
  test("requests inside the month never purge, and still bank progress", async () => {
    setMarker(NOW_MONTH);
    const claimed = await call("/api/player/claim", {
      method: "POST",
      body: { name: "MidMonthMia" },
    });
    const miaPid = String(claimed.json.playerId ?? "");
    const before = counts();
    for (let i = 0; i < 3; i++) {
      expect(runMonthlyRollover(NOW_MONTH).rolled).toBe(false);
    }
    expect(counts()).toEqual(before);

    await postRound(miaPid, { name: "MidMonthMia", score: 111 });
    // Same month: the round is banked, the identity is unchanged, and the
    // survivor row is UPDATED in place — one row per identity, never one per
    // round.
    expect(counts().scores).toBe(before.scores + 1);
    expect(counts().players).toBe(before.players);
    expect(counts().progress).toBe(before.progress);
    expect(progressRow(miaPid)?.badges).toEqual(PAT_BADGES);
    expect(progressRow(miaPid)?.bests).toEqual(PAT_BESTS);
  });

  test("the mid-month round lands on this month's board", async () => {
    const row = getDb()
      .query<{ month: string; score: number }, [string]>(
        "SELECT month, score FROM scores WHERE name = ? ORDER BY id DESC LIMIT 1",
      )
      .get("MidMonthMia");
    expect(row?.month).toBe(NOW_MONTH);
    expect(row?.score).toBe(111);
  });
});
