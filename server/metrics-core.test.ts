/**
 * Unit tests for the pure half of the first-party analytics
 * (`server/metrics-core.ts`): event validation, day bucketing, bounce rate and
 * duration averages. No database, no network.
 */
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_RANGE_DAYS,
  MAX_DURATION_SEC,
  MAX_RANGE_DAYS,
  averageDuration,
  boardByDay,
  bounceRate,
  coerceEvent,
  dayKey,
  dayKeysBetween,
  fillDaily,
  identityKey,
  isDayKey,
  lastNDays,
  mergeDaily,
  perGameRounds,
  resolveDayRange,
  round1,
  sortAverages,
  sortGamesChosen,
  summariseBoard,
  utcDayKey,
  type ScoreRow,
} from "./metrics-core.ts";

const SESSION = "3f2a91c4-77de-4a1b-9f0e-2c5b8d6a1e4f";

/**
 * Scoring rows shaped like the live board's: `created_at` is a SQLite UTC
 * timestamp, `pid` is '' for the name pool (legacy and guest rows) and a
 * server-issued id for a real name.
 */
const SEEDS: ScoreRow[] = [
  { name: "Dana", pid: "p-dana", game: "scan-rush", created_at: "2026-09-17 03:50:57" },
  { name: "Dana", pid: "p-dana", game: "bone-buster", created_at: "2026-09-17 03:55:00" },
  { name: "Harrison", pid: "p-harrison", game: "scan-rush", created_at: "2026-09-17 04:10:00" },
  { name: "Harrison", pid: "p-harrison", game: "scan-rush", created_at: "2026-09-17 04:20:00" },
  { name: "Guest 4821", pid: "", game: "scan-rush", created_at: "2026-09-17 04:30:00" },
  { name: "Guest 4821", pid: "", game: "ecg-rhythm", created_at: "2026-09-17 04:35:00" },
  // Two different people who share a first name: two ids, so two players.
  { name: "Sam", pid: "p-sam-a", game: "memory-scan", created_at: "2026-09-18 22:00:00" },
  { name: "Sam", pid: "p-sam-b", game: "memory-scan", created_at: "2026-09-18 23:30:00" },
  // The deliberate 0-point test row the live verification left behind.
  { name: "Guest 8143", pid: "", game: "scan-rush", created_at: "2026-09-21 03:07:46" },
  // Junk timestamp: never counts anywhere.
  { name: "Nobody", pid: "", game: "scan-rush", created_at: "not a date" },
];

describe("coerceEvent", () => {
  test("accepts a well-formed visit", () => {
    expect(coerceEvent({ session: SESSION, type: "visit", page: "/" })).toEqual({
      session: SESSION,
      type: "visit",
      page: "/",
      game: null,
      duration_sec: null,
    });
  });

  test("accepts a game_start and lowercases / trims the game id", () => {
    const event = coerceEvent({
      session: SESSION,
      type: "game_start",
      page: "/play/scan-rush",
      game: "  SCAN-RUSH ",
    });
    expect(event?.game).toBe("scan-rush");
    expect(event?.page).toBe("/play/scan-rush");
  });

  test("keeps a game_end duration in whole seconds", () => {
    const event = coerceEvent({
      session: SESSION,
      type: "game_end",
      game: "bone-buster",
      duration_sec: 138.6,
    });
    expect(event?.duration_sec).toBe(139);
  });

  test("rejects a missing, short or non-url-safe session", () => {
    expect(coerceEvent({ type: "visit" })).toBeNull();
    expect(coerceEvent({ session: "short", type: "visit" })).toBeNull();
    expect(coerceEvent({ session: "has spaces in it!!", type: "visit" })).toBeNull();
  });

  test("rejects an unknown type and non-object bodies", () => {
    expect(coerceEvent({ session: SESSION, type: "purchase" })).toBeNull();
    expect(coerceEvent(null)).toBeNull();
    expect(coerceEvent([{ session: SESSION, type: "visit" }])).toBeNull();
    expect(coerceEvent("visit")).toBeNull();
  });

  test("drops an unusable page but keeps the event", () => {
    expect(coerceEvent({ session: SESSION, type: "visit", page: "no-slash" }))
      .toEqual({ session: SESSION, type: "visit", page: null, game: null, duration_sec: null });
    expect(coerceEvent({ session: SESSION, type: "visit", page: "javascript:alert(1)" }))
      .toEqual({ session: SESSION, type: "visit", page: null, game: null, duration_sec: null });
    expect(
      coerceEvent({ session: SESSION, type: "visit", page: "/" + "x".repeat(80) }),
    ).toEqual({ session: SESSION, type: "visit", page: null, game: null, duration_sec: null });
  });

  test("drops an out-of-range or non-numeric duration but keeps the event", () => {
    for (const duration of [-1, MAX_DURATION_SEC + 1, Number.NaN, "120", Infinity]) {
      expect(
        coerceEvent({ session: SESSION, type: "game_end", duration_sec: duration })
          ?.duration_sec,
      ).toBeNull();
    }
  });

  test("trims a padded session id", () => {
    expect(coerceEvent({ session: ` ${SESSION} `, type: "visit" })?.session).toBe(SESSION);
  });
});

describe("day bucketing", () => {
  test("dayKey reads a Date and a SQLite timestamp, and rejects junk", () => {
    expect(utcDayKey(new Date("2026-09-21T23:59:59Z"))).toBe("2026-09-21");
    expect(dayKey(new Date("2026-09-21T00:00:01Z"))).toBe("2026-09-21");
    expect(dayKey("2026-09-21 04:05:06")).toBe("2026-09-21");
    expect(dayKey("not a date")).toBe("");
    expect(dayKey(undefined as unknown as string)).toBe("");
  });

  test("lastNDays returns complete, oldest-first UTC keys", () => {
    const days = lastNDays(3, new Date("2026-09-21T05:00:00Z"));
    expect(days).toEqual(["2026-09-19", "2026-09-20", "2026-09-21"]);
  });

  test("lastNDays rolls across a month and a year boundary", () => {
    expect(lastNDays(2, new Date("2026-03-01T00:30:00Z"))).toEqual([
      "2026-02-28",
      "2026-03-01",
    ]);
    expect(lastNDays(2, new Date("2027-01-01T00:30:00Z"))).toEqual([
      "2026-12-31",
      "2027-01-01",
    ]);
  });

  test("lastNDays(0) is empty and a fractional n floors", () => {
    expect(lastNDays(0, new Date("2026-09-21T05:00:00Z"))).toEqual([]);
    expect(lastNDays(2.9, new Date("2026-09-21T05:00:00Z"))).toHaveLength(2);
  });

  test("fillDaily zero-fills gaps in the requested order", () => {
    const filled = fillDaily(["2026-09-19", "2026-09-20", "2026-09-21"], [
      {
        day: "2026-09-21 02:00:00",
        visits: 4,
        sessions: 3,
        gameStarts: 2,
        roundsPlayed: 5,
      },
      { day: "2026-09-19", visits: 1, sessions: 1, gameStarts: 0 },
    ]);
    expect(filled.map((row) => row.day)).toEqual([
      "2026-09-19",
      "2026-09-20",
      "2026-09-21",
    ]);
    expect(filled[1]).toEqual({
      day: "2026-09-20",
      visits: 0,
      sessions: 0,
      gameStarts: 0,
      roundsPlayed: 0,
      activePlayers: 0,
      gamesPlayed: [],
    });
    expect(filled[2]).toEqual({
      day: "2026-09-21",
      visits: 4,
      sessions: 3,
      gameStarts: 2,
      roundsPlayed: 5,
      activePlayers: 0,
      gamesPlayed: [],
    });
  });

  test("fillDaily carries a day's games through and leaves empty days with []", () => {
    const filled = fillDaily(["2026-09-17", "2026-09-18"], [
      {
        day: "2026-09-17",
        gamesPlayed: [
          { game: "scan-rush", rounds: 1 },
          { game: "ecg-rhythm", rounds: 1 },
        ],
      },
    ]);
    expect(filled[0].gamesPlayed).toEqual([
      { game: "scan-rush", rounds: 1 },
      { game: "ecg-rhythm", rounds: 1 },
    ]);
    // A day with no score rows is [], not undefined, so the UI can always map it.
    expect(filled[1].gamesPlayed).toEqual([]);
  });

  test("fillDaily ignores rows outside the requested days and null counts", () => {
    const filled = fillDaily(["2026-09-21"], [
      { day: "2026-09-01", visits: 99 },
      { day: "2026-09-21", visits: null as unknown as number },
    ]);
    expect(filled).toEqual([
      {
        day: "2026-09-21",
        visits: 0,
        sessions: 0,
        gameStarts: 0,
        roundsPlayed: 0,
        activePlayers: 0,
        gamesPlayed: [],
      },
    ]);
  });
});

describe("rounds played (the event log's own per-round count)", () => {
  test("a day with events carries its count, a day without reads 0", () => {
    const rows = fillDaily(
      ["2026-09-20", "2026-09-21", "2026-09-22"],
      [{ day: "2026-09-21", visits: 3, sessions: 2, gameStarts: 2, roundsPlayed: 4 }],
    );
    // The day the log recorded four finished rounds.
    expect(rows[1].roundsPlayed).toBe(4);
    // A day before the log was switched on and a day with nothing played: 0, never
    // a missing field (the CSV prints the same number the page shows).
    expect(rows[0].roundsPlayed).toBe(0);
    expect(rows[2].roundsPlayed).toBe(0);
  });

  test("a window's count is the sum of its days, and shares its row with the board's players", () => {
    // What the server's two per-day queries answer: the event log counts finished
    // rounds per day, the board says who played and which games. Rounds come from
    // the log ALONE (the board cannot count individual rounds: a replay grows an
    // existing row instead of adding one).
    const logged = [
      { day: "2026-09-21", visits: 9, sessions: 4, gameStarts: 8, roundsPlayed: 12 },
      { day: "2026-09-22", visits: 5, sessions: 3, gameStarts: 3, roundsPlayed: 3 },
    ];
    const board = [
      {
        day: "2026-09-21",
        activePlayers: 4,
        gamesPlayed: [{ game: "scan-rush", rounds: 7 }],
      },
      {
        day: "2026-09-22",
        activePlayers: 3,
        gamesPlayed: [{ game: "bone-buster", rounds: 3 }],
      },
    ];
    const rows = fillDaily(["2026-09-21", "2026-09-22"], mergeDaily(logged, board));
    const sum = (pick: (row: (typeof rows)[number]) => number) =>
      rows.reduce((total, row) => total + pick(row), 0);
    // One row per day, both sources' numbers in it.
    expect(rows[0]).toEqual({
      day: "2026-09-21",
      visits: 9,
      sessions: 4,
      gameStarts: 8,
      roundsPlayed: 12,
      activePlayers: 4,
      gamesPlayed: [{ game: "scan-rush", rounds: 7 }],
    });
    expect(sum((row) => row.roundsPlayed)).toBe(15);
    expect(sum((row) => row.activePlayers)).toBe(7);
    // No rounds figure comes from the board side at all.
    expect(Object.keys(rows[0])).not.toContain("completedRounds");
  });
});

describe("the board side (scores rows)", () => {
  test("identityKey folds a row by player id, else by name, like the board does", () => {
    expect(identityKey({ name: "Dana", pid: "p-dana" })).toBe("p:p-dana");
    expect(identityKey({ name: "Guest 4821", pid: "" })).toBe("n:Guest 4821");
    expect(identityKey({ name: "Legacy" })).toBe("n:Legacy");
    expect(identityKey({ name: "Padded", pid: "  " })).toBe("n:Padded");
  });

  test("summariseBoard counts distinct identities and games, never rounds", () => {
    const totals = summariseBoard(SEEDS);
    // Dana, Harrison, Guest 4821, Sam (two ids), Guest 8143, Nobody.
    expect(totals.activePlayers).toBe(7);
    expect(totals.gamesChosen).toEqual([
      { game: "scan-rush", count: 6 },
      { game: "memory-scan", count: 2 },
      { game: "bone-buster", count: 1 },
      { game: "ecg-rhythm", count: 1 },
    ]);
  });

  test("two players sharing a first name count as two, the name pool counts as one", () => {
    const sams = SEEDS.filter((row) => row.name === "Sam");
    expect(summariseBoard(sams).activePlayers).toBe(2);
    const guests = SEEDS.filter((row) => row.name === "Guest 4821");
    expect(summariseBoard(guests)).toEqual({
      activePlayers: 1,
      gamesChosen: [
        { game: "ecg-rhythm", count: 1 },
        { game: "scan-rush", count: 1 },
      ],
    });
  });

  test("an empty window is zeros, not NaN", () => {
    expect(summariseBoard([])).toEqual({
      activePlayers: 0,
      gamesChosen: [],
    });
  });

  test("boardByDay buckets the September rows per UTC day", () => {
    expect(boardByDay(SEEDS)).toEqual([
      {
        day: "2026-09-17",
        activePlayers: 3,
        gamesPlayed: [
          { game: "scan-rush", rounds: 4 },
          { game: "bone-buster", rounds: 1 },
          { game: "ecg-rhythm", rounds: 1 },
        ],
      },
      {
        day: "2026-09-18",
        activePlayers: 2,
        gamesPlayed: [{ game: "memory-scan", rounds: 2 }],
      },
      {
        day: "2026-09-21",
        activePlayers: 1,
        gamesPlayed: [{ game: "scan-rush", rounds: 1 }],
      },
    ]);
  });

  test("every day's game rows add back up to that day's scoring rows", () => {
    for (const day of boardByDay(SEEDS)) {
      const summed = day.gamesPlayed.reduce((total, entry) => total + entry.rounds, 0);
      // The rows the board holds for that day: the junk-timestamp row is the only
      // one that can never appear in a day's games.
      const rows = SEEDS.filter(
        (row) => dayKey(row.created_at) === day.day && String(row.game ?? "").trim() !== "",
      );
      expect(summed).toBe(rows.length);
    }
  });

  test("perGameRounds is rounds per game, most played first, and empty when none", () => {
    expect(perGameRounds(SEEDS)).toEqual([
      { game: "scan-rush", rounds: 6 },
      { game: "memory-scan", rounds: 2 },
      { game: "bone-buster", rounds: 1 },
      { game: "ecg-rhythm", rounds: 1 },
    ]);
    expect(perGameRounds([])).toEqual([]);
    // Every scoring row lands in exactly one game's count (none is lost).
    expect(
      perGameRounds(SEEDS).reduce((total, entry) => total + entry.rounds, 0),
    ).toBe(SEEDS.length);
  });

  test("boardByDay drops rows with an unusable timestamp", () => {
    const days = boardByDay(SEEDS);
    expect(days.some((row) => row.day === "not a date")).toBe(false);
    // The junk row's game is gone from that day's games too.
    const pitchDay = SEEDS.filter((row) => dayKey(row.created_at) === "2026-09-17");
    expect(summariseBoard(pitchDay).gamesChosen).toEqual([
      { game: "scan-rush", count: 4 },
      { game: "bone-buster", count: 1 },
      { game: "ecg-rhythm", count: 1 },
    ]);
  });

  test("mergeDaily keeps one row per day with both sources' numbers", () => {
    const events = [
      { day: "2026-09-21", visits: 2, sessions: 1, gameStarts: 1 },
      { day: "2026-09-20", visits: 1, sessions: 1, gameStarts: 0 },
    ];
    const merged = mergeDaily(events, boardByDay(SEEDS));
    const byDay = new Map(merged.map((row) => [row.day, row]));
    // The day the event log exists for: both sources in one row.
    expect(byDay.get("2026-09-21")).toEqual({
      day: "2026-09-21",
      visits: 2,
      sessions: 1,
      gameStarts: 1,
      activePlayers: 1,
      gamesPlayed: [{ game: "scan-rush", rounds: 1 }],
    });
    // A September day that predates the event log: board numbers only.
    expect(byDay.get("2026-09-17")).toEqual({
      day: "2026-09-17",
      activePlayers: 3,
      gamesPlayed: [
        { game: "scan-rush", rounds: 4 },
        { game: "bone-buster", rounds: 1 },
        { game: "ecg-rhythm", rounds: 1 },
      ],
    });
  });

  test("mergeDaily never lets a missing value overwrite a real one", () => {
    const merged = mergeDaily(
      [{ day: "2026-09-17", visits: 3 }],
      [{ day: "2026-09-17", visits: null as unknown as number, activePlayers: 6 }],
    );
    expect(merged).toEqual([{ day: "2026-09-17", visits: 3, activePlayers: 6 }]);
  });

  test("merged days zero-fill through fillDaily, so September history shows", () => {
    const days = lastNDays(30, new Date("2026-09-21T05:00:00Z"));
    const rows = fillDaily(
      days,
      mergeDaily(
        [{ day: "2026-09-21", visits: 2, sessions: 1, gameStarts: 1, roundsPlayed: 3 }],
        boardByDay(SEEDS),
      ),
    );
    expect(rows).toHaveLength(30);
    expect(rows[0]).toEqual({
      day: "2026-08-23",
      visits: 0,
      sessions: 0,
      gameStarts: 0,
      roundsPlayed: 0,
      activePlayers: 0,
      gamesPlayed: [],
    });
    const pitchDay = rows.find((row) => row.day === "2026-09-17");
    expect(pitchDay).toEqual({
      day: "2026-09-17",
      visits: 0,
      sessions: 0,
      gameStarts: 0,
      roundsPlayed: 0,
      activePlayers: 3,
      gamesPlayed: [
        { game: "scan-rush", rounds: 4 },
        { game: "bone-buster", rounds: 1 },
        { game: "ecg-rhythm", rounds: 1 },
      ],
    });
    const today = rows.find((row) => row.day === "2026-09-21");
    expect(today).toEqual({
      day: "2026-09-21",
      visits: 2,
      sessions: 1,
      gameStarts: 1,
      // Three finished rounds logged; the board holds one row for that player, game
      // and month, which is why nothing on this page counts rounds from the board.
      roundsPlayed: 3,
      activePlayers: 1,
      gamesPlayed: [{ game: "scan-rush", rounds: 1 }],
    });
  });
});

describe("bounceRate", () => {
  test("no eligible sessions reads as 0, not NaN", () => {
    expect(bounceRate([])).toBe(0);
    expect(bounceRate([{ visits: 0, gameStarts: 0 }])).toBe(0);
  });

  test("half the sessions bounced is 50", () => {
    expect(
      bounceRate([
        { visits: 2, gameStarts: 0 },
        { visits: 1, gameStarts: 1 },
      ]),
    ).toBe(50);
  });

  test("every session bounced is 100, none is 0", () => {
    expect(
      bounceRate([
        { visits: 1, gameStarts: 0 },
        { visits: 5, gameStarts: 0 },
      ]),
    ).toBe(100);
    expect(
      bounceRate([
        { visits: 1, gameStarts: 1 },
        { visits: 5, gameStarts: 2 },
      ]),
    ).toBe(0);
  });

  test("rounds to one decimal", () => {
    expect(
      bounceRate([
        { visits: 1, gameStarts: 0 },
        { visits: 1, gameStarts: 1 },
        { visits: 1, gameStarts: 1 },
      ]),
    ).toBe(33.3);
  });
});

describe("averages and ordering", () => {
  test("averageDuration is null when empty and rounded otherwise", () => {
    expect(averageDuration([])).toBeNull();
    expect(averageDuration([10, 15])).toBe(12.5);
    expect(averageDuration([7, 8, 8])).toBe(7.7);
    expect(averageDuration([0])).toBe(0);
  });

  test("round1 keeps one decimal", () => {
    expect(round1(12.34)).toBe(12.3);
    expect(round1(12.35)).toBe(12.4);
    expect(round1(0)).toBe(0);
  });

  test("sortGamesChosen is count desc then alphabetical", () => {
    expect(
      sortGamesChosen([
        { game: "scan-rush", count: 2 },
        { game: "bone-buster", count: 7 },
        { game: "film-stack", count: 2 },
      ]),
    ).toEqual([
      { game: "bone-buster", count: 7 },
      { game: "film-stack", count: 2 },
      { game: "scan-rush", count: 2 },
    ]);
  });

  test("sortAverages rounds and orders by sample size", () => {
    expect(
      sortAverages([
        { game: "scan-rush", rounds: 1, avgSec: 120.44 },
        { game: "bone-buster", rounds: 4, avgSec: 89.94 },
      ]),
    ).toEqual([
      { game: "bone-buster", rounds: 4, avgSec: 89.9 },
      { game: "scan-rush", rounds: 1, avgSec: 120.4 },
    ]);
  });
});

/**
 * The export's date range (owner request, 21 Sep 2026): `GET
 * /api/admin/stats/export?from=&to=` narrows the day-by-day table to a window so a
 * pilot (21 Sep to 21 Oct) can be pulled as one file. The rules live here, so they
 * are tested without a database: defaults, inclusive days, zero-fill, and every
 * rejection the endpoint turns into a 400.
 */
describe("resolveDayRange", () => {
  const NOW = new Date("2026-09-21T05:00:00Z");
  const MS_DAY = 86_400_000;
  const shift = (days: number): string =>
    new Date(Date.parse("2026-09-21T00:00:00Z") + days * MS_DAY).toISOString().slice(0, 10);

  test("no parameters is exactly the last 30 UTC days", () => {
    const result = resolveDayRange(null, null, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.range.days).toEqual(lastNDays(DEFAULT_RANGE_DAYS, NOW));
    expect(result.range.days).toHaveLength(30);
    expect(result.range.from).toBe("2026-08-23");
    expect(result.range.to).toBe("2026-09-21");
  });

  test("empty parameters count as absent, so ?from=&to= stays the default", () => {
    const result = resolveDayRange("", "", NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.range.from).toBe("2026-08-23");
    expect(result.range.to).toBe("2026-09-21");
  });

  test("a requested window is inclusive at both ends", () => {
    const result = resolveDayRange("2026-09-01", "2026-09-21", NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.range.days).toHaveLength(21);
    expect(result.range.days[0]).toBe("2026-09-01");
    expect(result.range.days[20]).toBe("2026-09-21");
    expect(result.range.from).toBe("2026-09-01");
    expect(result.range.to).toBe("2026-09-21");
  });

  test("a window reaching past tomorrow UTC is refused while it is still ahead", () => {
    // The pilot shape (21 Sep to 21 Oct) is a future window while the pilot runs.
    // It is refused rather than served as a month of zero rows, and the very same
    // range is accepted once its end date has arrived (see the note in the PR).
    const ahead = resolveDayRange("2026-09-21", "2026-10-21", NOW);
    expect(ahead.ok).toBe(false);
    if (!ahead.ok) expect(ahead.error).toContain("not be later than tomorrow");
    const arrived = resolveDayRange("2026-09-21", "2026-10-21", new Date("2026-10-21T09:00:00Z"));
    expect(arrived.ok).toBe(true);
    if (arrived.ok) {
      expect(arrived.range.days).toHaveLength(31);
      expect(arrived.range.days[0]).toBe("2026-09-21");
      expect(arrived.range.days[30]).toBe("2026-10-21");
    }
  });

  test("a single day is a legal one-row range", () => {
    const result = resolveDayRange("2026-09-17", "2026-09-17", NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.range.days).toEqual(["2026-09-17"]);
  });

  test("from alone runs up to today, to alone is the 30 days ending there", () => {
    const openEnded = resolveDayRange("2026-09-15", null, NOW);
    expect(openEnded.ok).toBe(true);
    if (openEnded.ok) {
      expect(openEnded.range.from).toBe("2026-09-15");
      expect(openEnded.range.to).toBe("2026-09-21");
      expect(openEnded.range.days).toHaveLength(7);
    }
    const endingAt = resolveDayRange(null, "2026-09-20", NOW);
    expect(endingAt.ok).toBe(true);
    if (endingAt.ok) {
      expect(endingAt.range.to).toBe("2026-09-20");
      expect(endingAt.range.from).toBe("2026-08-22");
      expect(endingAt.range.days).toHaveLength(DEFAULT_RANGE_DAYS);
    }
  });

  test("a range is zero-filled within the window, quiet days included", () => {
    const result = resolveDayRange("2026-09-15", "2026-09-18", NOW);
    if (!result.ok) throw new Error("expected a valid range");
    const rows = fillDaily(result.range.days, mergeDaily([{ day: "2026-09-17", visits: 41 }]));
    expect(rows.map((row) => row.day)).toEqual([
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
    ]);
    expect(rows.map((row) => row.visits)).toEqual([0, 0, 41, 0]);
    // Nothing is invented for a pre-tracker day: rounds played reads 0.
    expect(rows.every((row) => row.roundsPlayed === 0)).toBe(true);
  });

  test("from after to is refused", () => {
    const result = resolveDayRange("2026-10-21", "2026-09-21", NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("from must not be after to");
  });

  test("a value that is not a real YYYY-MM-DD UTC day is refused", () => {
    for (const bad of ["21-09-2026", "2026-9-1", "yesterday", "2026-13-01", "2026-02-30", "2026-09-21T00:00:00Z"]) {
      const asFrom = resolveDayRange(bad, "2026-09-21", NOW);
      expect(asFrom.ok).toBe(false);
      if (!asFrom.ok) expect(asFrom.error).toBe("Invalid from date: use YYYY-MM-DD (UTC)");
      const asTo = resolveDayRange("2026-09-01", bad, NOW);
      expect(asTo.ok).toBe(false);
      if (!asTo.ok) expect(asTo.error).toBe("Invalid to date: use YYYY-MM-DD (UTC)");
    }
  });

  test("an absurdly wide window is refused, and the maximum is allowed", () => {
    const widest = resolveDayRange(shift(-365), "2026-09-21", NOW);
    expect(widest.ok).toBe(true);
    if (widest.ok) expect(widest.range.days).toHaveLength(MAX_RANGE_DAYS);
    const tooWide = resolveDayRange(shift(-366), "2026-09-21", NOW);
    expect(tooWide.ok).toBe(false);
    if (!tooWide.ok) expect(tooWide.error).toContain(`the maximum is ${String(MAX_RANGE_DAYS)}`);
  });

  test("an end date beyond tomorrow UTC is refused, tomorrow itself is fine", () => {
    const tomorrow = resolveDayRange("2026-09-21", shift(1), NOW);
    expect(tomorrow.ok).toBe(true);
    if (tomorrow.ok) expect(tomorrow.range.to).toBe("2026-09-22");
    const later = resolveDayRange("2026-09-21", shift(2), NOW);
    expect(later.ok).toBe(false);
    if (!later.ok) expect(later.error).toContain("not be later than tomorrow");
  });
});

describe("isDayKey and dayKeysBetween", () => {
  test("isDayKey accepts only real UTC calendar days", () => {
    expect(isDayKey("2026-09-21")).toBe(true);
    expect(isDayKey("2026-02-28")).toBe(true);
    expect(isDayKey("2026-2-8")).toBe(false);
    expect(isDayKey("2026-02-30")).toBe(false);
    expect(isDayKey("2026-09-21 ")).toBe(false);
    expect(isDayKey("")).toBe(false);
    expect(isDayKey(null)).toBe(false);
    expect(isDayKey(20260921)).toBe(false);
  });

  test("dayKeysBetween is inclusive and walks month and year ends", () => {
    expect(dayKeysBetween("2026-09-20", "2026-09-21")).toEqual(["2026-09-20", "2026-09-21"]);
    expect(dayKeysBetween("2026-02-27", "2026-03-02")).toEqual([
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
    expect(dayKeysBetween("2026-12-31", "2027-01-01")).toEqual(["2026-12-31", "2027-01-01"]);
  });

  test("a reversed or unusable pair yields no days rather than a crash", () => {
    expect(dayKeysBetween("2026-09-21", "2026-09-20")).toEqual([]);
    expect(dayKeysBetween("nonsense", "2026-09-21")).toEqual([]);
  });
});
