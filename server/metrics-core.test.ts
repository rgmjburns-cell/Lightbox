/**
 * Unit tests for the pure half of the first-party analytics
 * (`server/metrics-core.ts`): event validation, day bucketing, bounce rate and
 * duration averages. No database, no network.
 */
import { describe, expect, test } from "bun:test";
import {
  MAX_DURATION_SEC,
  averageDuration,
  bounceRate,
  coerceEvent,
  dayKey,
  fillDaily,
  identityKey,
  lastNDays,
  mergeDaily,
  perGameRounds,
  round1,
  roundsByDay,
  sortAverages,
  sortGamesChosen,
  summariseRounds,
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
      { day: "2026-09-21 02:00:00", visits: 4, sessions: 3, gameStarts: 2, completedRounds: 1 },
      { day: "2026-09-19", visits: 1, sessions: 1, gameStarts: 0, completedRounds: 0 },
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
      completedRounds: 0,
      activePlayers: 0,
      gamesPlayed: [],
    });
    expect(filled[2]).toEqual({
      day: "2026-09-21",
      visits: 4,
      sessions: 3,
      gameStarts: 2,
      completedRounds: 1,
      activePlayers: 0,
      gamesPlayed: [],
    });
  });

  test("fillDaily carries a day's games through and leaves empty days with []", () => {
    const filled = fillDaily(["2026-09-17", "2026-09-18"], [
      {
        day: "2026-09-17",
        completedRounds: 2,
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
        completedRounds: 0,
        activePlayers: 0,
        gamesPlayed: [],
      },
    ]);
  });
});

describe("the board side (scores rows)", () => {
  test("identityKey folds a row by player id, else by name, like the board does", () => {
    expect(identityKey({ name: "Dana", pid: "p-dana" })).toBe("p:p-dana");
    expect(identityKey({ name: "Guest 4821", pid: "" })).toBe("n:Guest 4821");
    expect(identityKey({ name: "Legacy" })).toBe("n:Legacy");
    expect(identityKey({ name: "Padded", pid: "  " })).toBe("n:Padded");
  });

  test("summariseRounds counts rows, distinct identities and games desc", () => {
    const totals = summariseRounds(SEEDS);
    expect(totals.completedRounds).toBe(10);
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
    expect(summariseRounds(sams).activePlayers).toBe(2);
    const guests = SEEDS.filter((row) => row.name === "Guest 4821");
    expect(summariseRounds(guests)).toEqual({
      completedRounds: 2,
      activePlayers: 1,
      gamesChosen: [
        { game: "ecg-rhythm", count: 1 },
        { game: "scan-rush", count: 1 },
      ],
    });
  });

  test("an empty window is zeros, not NaN", () => {
    expect(summariseRounds([])).toEqual({
      completedRounds: 0,
      activePlayers: 0,
      gamesChosen: [],
    });
  });

  test("roundsByDay buckets the September rows per UTC day", () => {
    expect(roundsByDay(SEEDS)).toEqual([
      {
        day: "2026-09-17",
        completedRounds: 6,
        activePlayers: 3,
        gamesPlayed: [
          { game: "scan-rush", rounds: 4 },
          { game: "bone-buster", rounds: 1 },
          { game: "ecg-rhythm", rounds: 1 },
        ],
      },
      {
        day: "2026-09-18",
        completedRounds: 2,
        activePlayers: 2,
        gamesPlayed: [{ game: "memory-scan", rounds: 2 }],
      },
      {
        day: "2026-09-21",
        completedRounds: 1,
        activePlayers: 1,
        gamesPlayed: [{ game: "scan-rush", rounds: 1 }],
      },
    ]);
  });

  test("every day's games add back up to that day's rounds", () => {
    for (const day of roundsByDay(SEEDS)) {
      const summed = day.gamesPlayed.reduce((total, entry) => total + entry.rounds, 0);
      expect(summed).toBe(day.completedRounds);
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
    // Same rows summariseRounds counts: the game breakdown never loses a round.
    expect(
      perGameRounds(SEEDS).reduce((total, entry) => total + entry.rounds, 0),
    ).toBe(summariseRounds(SEEDS).completedRounds);
  });

  test("roundsByDay drops rows with an unusable timestamp", () => {
    const days = roundsByDay(SEEDS);
    expect(days.some((row) => row.day === "not a date")).toBe(false);
    // The junk row's game is gone from that day's games too.
    const pitchDay = SEEDS.filter((row) => dayKey(row.created_at) === "2026-09-17");
    expect(summariseRounds(pitchDay).gamesChosen).toEqual([
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
    const merged = mergeDaily(events, roundsByDay(SEEDS));
    const byDay = new Map(merged.map((row) => [row.day, row]));
    // The day the event log exists for: both sources in one row.
    expect(byDay.get("2026-09-21")).toEqual({
      day: "2026-09-21",
      visits: 2,
      sessions: 1,
      gameStarts: 1,
      completedRounds: 1,
      activePlayers: 1,
      gamesPlayed: [{ game: "scan-rush", rounds: 1 }],
    });
    // A September day that predates the event log: board numbers only.
    expect(byDay.get("2026-09-17")).toEqual({
      day: "2026-09-17",
      completedRounds: 6,
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
      [{ day: "2026-09-17", visits: null as unknown as number, completedRounds: 6 }],
    );
    expect(merged).toEqual([{ day: "2026-09-17", visits: 3, completedRounds: 6 }]);
  });

  test("merged days zero-fill through fillDaily, so September history shows", () => {
    const days = lastNDays(30, new Date("2026-09-21T05:00:00Z"));
    const rows = fillDaily(
      days,
      mergeDaily([{ day: "2026-09-21", visits: 2, sessions: 1, gameStarts: 1 }], roundsByDay(SEEDS)),
    );
    expect(rows).toHaveLength(30);
    expect(rows[0]).toEqual({
      day: "2026-08-23",
      visits: 0,
      sessions: 0,
      gameStarts: 0,
      completedRounds: 0,
      activePlayers: 0,
      gamesPlayed: [],
    });
    const pitchDay = rows.find((row) => row.day === "2026-09-17");
    expect(pitchDay).toEqual({
      day: "2026-09-17",
      visits: 0,
      sessions: 0,
      gameStarts: 0,
      completedRounds: 6,
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
      completedRounds: 1,
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
