/**
 * Unit tests for POST /api/player/delete — the player's own "Clear All Data".
 *
 * These run against the REAL handler (`handleLeaderboardApi`) and the REAL
 * schema: `LEADERBOARD_DB_PATH` points `server/leaderboard.ts` at a scratch
 * SQLite file in the temp dir before it is imported, so nothing here can touch a
 * deployment's board (or the dev server's own `data/leaderboard.db`).
 *
 * The rules under test:
 *   * a caller with a player id deletes exactly that id's scores, its `players`
 *     row and its `player_profiles` row, and nothing else on the board;
 *   * a caller with no id deletes only the anonymous name-pool row (`pid = ''`)
 *     for the name it supplied — never a row another identity owns, even when it
 *     supplies that identity's name;
 *   * no identity at all is a success with zero counts, never an error: there is
 *     simply nothing of theirs to erase, and the device must still be able to
 *     finish clearing itself.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the server module at a scratch database BEFORE importing it (the path is
// read at import time). The directory is left in place: other test files in the
// same process share the env var and must not find a dangling path.
const SCRATCH_DIR = join(tmpdir(), `lightbox-player-delete-${String(process.pid)}`);
mkdirSync(SCRATCH_DIR, { recursive: true });
process.env.LEADERBOARD_DB_PATH = join(SCRATCH_DIR, "leaderboard.db");

const { getDb, handleLeaderboardApi } = await import("./leaderboard.ts");

const MONTH = "2026-09";
/** The cookie the client mirrors its server-issued id into. */
const ID_COOKIE = "lightboxPlayerId";

interface DeleteResponse {
  ok: boolean;
  deleted: { scores: number; players: number; profiles: number; progress: number };
}

/** One request through the real router, exactly as serve.ts calls it. */
async function del(opts: {
  cookieId?: string | null;
  body?: Record<string, unknown> | string | null;
}): Promise<DeleteResponse> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.cookieId) headers.cookie = `${ID_COOKIE}=${encodeURIComponent(opts.cookieId)}`;
  const body =
    typeof opts.body === "string"
      ? opts.body
      : opts.body === null || opts.body === undefined
        ? ""
        : JSON.stringify(opts.body);
  const req = new Request("http://localhost/api/player/delete", {
    method: "POST",
    headers,
    body,
  });
  const res = await handleLeaderboardApi(req, "/api/player/delete");
  expect(res.status).toBe(200);
  return (await res.json()) as DeleteResponse;
}

function seedScore(name: string, pid: string, game: string, score: number): void {
  getDb()
    .query("INSERT INTO scores (name, game, score, month, pid) VALUES (?, ?, ?, ?, ?)")
    .run(name, game, score, MONTH, pid);
}
function seedPlayer(id: string, name: string): void {
  const now = new Date().toISOString();
  getDb()
    .query(
      "INSERT INTO players (id, name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(id, name, name.trim().toLowerCase(), now, now);
}
function seedProfile(id: string): void {
  getDb()
    .query(
      "INSERT INTO player_profiles (player_id, bests, stats, badges, updated_at) VALUES (?, '{}', '{}', '{}', ?)",
    )
    .run(id, new Date().toISOString());
}
/**
 * The survivor row (`player_progress`): badge unlocks + personal bests, the one
 * table the monthly purge leaves alone. "Clear All Data" must NOT leave it
 * behind — the player is asking for all of their data to go.
 */
function seedProgress(id: string): void {
  getDb()
    .query(
      `INSERT INTO player_progress (pid, badges_json, bests_json, updated_at)
       VALUES (?, '{"first-scan":"2026-09-01T00:00:00.000Z"}', '{"scanRushHighScore":700}', ?)`,
    )
    .run(id, new Date().toISOString());
}
function rows<T>(sql: string, ...params: (string | number)[]): T[] {
  return getDb()
    .query(sql)
    .all(...(params as never[])) as T[];
}
/** The whole board, as a stable string, for "nothing else moved" assertions. */
function boardDump(): string {
  const scores = rows<{ name: string; game: string; score: number; pid: string }>(
    "SELECT name, game, score, pid FROM scores ORDER BY name, game, pid, score",
  );
  const players = rows<{ id: string; name: string }>(
    "SELECT id, name FROM players ORDER BY id",
  );
  const profiles = rows<{ player_id: string }>(
    "SELECT player_id FROM player_profiles ORDER BY player_id",
  );
  const progress = rows<{ pid: string }>(
    "SELECT pid FROM player_progress ORDER BY pid",
  );
  return JSON.stringify({ scores, players, profiles, progress });
}

beforeAll(() => {
  // The board this player shares with everybody else: two real identities that
  // happen to share a display name, one guest pool row, and a legacy row.
  seedScore("Dana", "pidDana00000001", "scan-rush", 1200);
  seedPlayer("pidDana00000001", "Dana");
  seedProfile("pidDana00000001");
  seedProgress("pidDana00000001");
  seedScore("Sam", "pidSamA00000001", "memory-scan", 300);
  seedScore("Sam", "pidSamB00000001", "memory-scan", 500);
  seedPlayer("pidSamA00000001", "Sam");
  seedProfile("pidSamA00000001");
  seedPlayer("pidSamB00000001", "Sam");
  seedScore("Guest 1234", "", "bone-buster", 90);
  seedScore("Megan", "", "scan-rush", 4000);

  // The identity under test: a real name with a hidden id on two games, plus a
  // second identity with no rows at all (a device that only claimed a name).
  seedScore("EraseMeTest", "pidErase00000001", "scan-rush", 700);
  seedScore("EraseMeTest", "pidErase00000001", "bone-buster", 40);
  seedPlayer("pidErase00000001", "EraseMeTest");
  seedProfile("pidErase00000001");
  seedProgress("pidErase00000001");
  seedPlayer("pidEmpty00000001", "EraseEmpty");
});

describe("POST /api/player/delete — caller with a player id cookie", () => {
  test("removes exactly that id's scores, player row, profile and survivor progress", async () => {
    const before = boardDump();
    const result = await del({ cookieId: "pidErase00000001" });
    expect(result.ok).toBe(true);
    expect(result.deleted).toEqual({ scores: 2, players: 1, profiles: 1, progress: 1 });
    expect(boardDump()).not.toBe(before);
    // Its own rows are gone...
    expect(rows("SELECT id FROM scores WHERE pid = ?", "pidErase00000001")).toEqual([]);
    expect(rows("SELECT id FROM players WHERE id = ?", "pidErase00000001")).toEqual([]);
    expect(rows("SELECT player_id FROM player_profiles WHERE player_id = ?", "pidErase00000001")).toEqual(
      [],
    );
    // ...including the badge/personal-best survivor row: "Clear All Data" wipes
    // everything of theirs, unlike the monthly rollover which keeps it.
    expect(rows("SELECT pid FROM player_progress WHERE pid = ?", "pidErase00000001")).toEqual([]);
    expect(rows("SELECT pid FROM player_progress WHERE pid = ?", "pidDana00000001")).toEqual([
      { pid: "pidDana00000001" },
    ]);
    // ...and nobody else's moved.
    expect(rows("SELECT score FROM scores WHERE pid = ?", "pidDana00000001")).toEqual([{ score: 1200 }]);
    expect(rows("SELECT score FROM scores WHERE pid = ?", "pidSamA00000001")).toEqual([{ score: 300 }]);
    expect(rows("SELECT score FROM scores WHERE pid = ?", "pidSamB00000001")).toEqual([{ score: 500 }]);
    expect(rows("SELECT player_id FROM player_profiles WHERE player_id = ?", "pidDana00000001")).toHaveLength(
      1,
    );
    // The anonymous pool rows are untouched: a name is not an id.
    expect(rows("SELECT score FROM scores WHERE pid = '' ORDER BY name")).toEqual([
      { score: 90 },
      { score: 4000 },
    ]);
  });

  test("a second call for the same id is a clean no-op", async () => {
    const result = await del({ cookieId: "pidErase00000001" });
    expect(result).toEqual({ ok: true, deleted: { scores: 0, players: 0, profiles: 0, progress: 0 } });
  });

  test("the id in the body works when the cookie is missing", async () => {
    const result = await del({ body: { playerId: "pidEmpty00000001" } });
    expect(result.deleted).toEqual({ scores: 0, players: 1, profiles: 0, progress: 0 });
    expect(rows("SELECT id FROM players WHERE id = ?", "pidEmpty00000001")).toEqual([]);
  });

  test("someone else's name alongside my own id deletes nothing of theirs", async () => {
    const before = boardDump();
    const result = await del({ cookieId: "pidDana00000001", body: { name: "Megan" } });
    // p-dana's own rows go (it is the caller's id), but "Megan" is ignored...
    expect(result.deleted).toEqual({ scores: 1, players: 1, profiles: 1, progress: 1 });
    expect(rows("SELECT score FROM scores WHERE pid = '' ORDER BY name")).toEqual([
      { score: 90 },
      { score: 4000 },
    ]);
    // ...so every pool row that was there before is still there.
    expect(boardDump()).not.toBe(before);
    const megan = rows<{ score: number }>("SELECT score FROM scores WHERE name = 'Megan'");
    expect(megan).toEqual([{ score: 4000 }]);
  });

  test("a cookie id that owns nothing deletes nothing", async () => {
    const before = boardDump();
    const result = await del({ cookieId: "pidUnknown000001", body: { name: "Sam" } });
    expect(result).toEqual({ ok: true, deleted: { scores: 0, players: 0, profiles: 0, progress: 0 } });
    expect(boardDump()).toBe(before);
  });
});

describe("POST /api/player/delete — caller with no id (guest / legacy pool row)", () => {
  test("removes only the pid='' row for exactly that name", async () => {
    const result = await del({ body: { name: "Guest 1234" } });
    expect(result).toEqual({ ok: true, deleted: { scores: 1, players: 0, profiles: 0, progress: 0 } });
    expect(rows("SELECT id FROM scores WHERE name = ? AND pid = ''", "Guest 1234")).toEqual([]);
    // The other identities' rows are all still there.
    expect(rows("SELECT score FROM scores WHERE pid = ?", "pidSamA00000001")).toHaveLength(1);
    expect(rows("SELECT score FROM scores WHERE pid = ?", "pidSamB00000001")).toHaveLength(1);
  });

  test("a legacy pool row can be cleared by its name too", async () => {
    const result = await del({ body: { name: "Megan" } });
    expect(result).toEqual({ ok: true, deleted: { scores: 1, players: 0, profiles: 0, progress: 0 } });
    expect(rows("SELECT id FROM scores WHERE name = 'Megan'")).toEqual([]);
  });

  test("naming a real identity deletes none of its id-owned rows", async () => {
    const before = boardDump();
    const result = await del({ body: { name: "Sam" } });
    // Sam's rows are pid-owned, so a name-only request matches no pool row.
    expect(result).toEqual({ ok: true, deleted: { scores: 0, players: 0, profiles: 0, progress: 0 } });
    expect(boardDump()).toBe(before);
  });

  test("an unencodable cookie value falls back to the name-only path", async () => {
    // A cookie the server never issued is not an identity; the guest name is.
    seedScore("Guest 9999", "", "ecg-rhythm", 5);
    const result = await del({ cookieId: "not a valid id", body: { name: "Guest 9999" } });
    expect(result).toEqual({ ok: true, deleted: { scores: 1, players: 0, profiles: 0, progress: 0 } });
  });
});

describe("POST /api/player/delete — nothing to erase", () => {
  test("an empty body is ok with zero counts", async () => {
    const before = boardDump();
    expect(await del({ body: null })).toEqual({
      ok: true,
      deleted: { scores: 0, players: 0, profiles: 0, progress: 0 },
    });
    expect(boardDump()).toBe(before);
  });

  test("a malformed JSON body is ok with zero counts", async () => {
    expect(await del({ body: "{not json" })).toEqual({
      ok: true,
      deleted: { scores: 0, players: 0, profiles: 0, progress: 0 },
    });
  });

  test("an invalid name is ok with zero counts", async () => {
    const before = boardDump();
    expect(await del({ body: { name: "x".repeat(40) } })).toEqual({
      ok: true,
      deleted: { scores: 0, players: 0, profiles: 0, progress: 0 },
    });
    expect(await del({ body: { name: "Megan!!" } })).toEqual({
      ok: true,
      deleted: { scores: 0, players: 0, profiles: 0, progress: 0 },
    });
    expect(boardDump()).toBe(before);
  });
});

describe("POST /api/player/delete — routing", () => {
  test("GET is refused", async () => {
    const req = new Request("http://localhost/api/player/delete", { method: "GET" });
    const res = await handleLeaderboardApi(req, "/api/player/delete");
    expect(res.status).toBe(405);
  });

  test("the admin whole-board wipe is untouched by a player delete", async () => {
    // A player delete must not behave like the passcode-protected board clear:
    // everybody else's rows survive it (proved above), and the admin route still
    // demands its passcode.
    const req = new Request("http://localhost/api/leaderboard/clear", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const res = await handleLeaderboardApi(req, "/api/leaderboard/clear");
    expect(res.status).toBe(403);
  });
});
