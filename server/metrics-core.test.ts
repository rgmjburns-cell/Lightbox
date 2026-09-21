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
  lastNDays,
  round1,
  sortAverages,
  sortGamesChosen,
  utcDayKey,
} from "./metrics-core.ts";

const SESSION = "3f2a91c4-77de-4a1b-9f0e-2c5b8d6a1e4f";

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
    });
    expect(filled[2]).toEqual({
      day: "2026-09-21",
      visits: 4,
      sessions: 3,
      gameStarts: 2,
      completedRounds: 1,
    });
  });

  test("fillDaily ignores rows outside the requested days and null counts", () => {
    const filled = fillDaily(["2026-09-21"], [
      { day: "2026-09-01", visits: 99 },
      { day: "2026-09-21", visits: null as unknown as number },
    ]);
    expect(filled).toEqual([
      { day: "2026-09-21", visits: 0, sessions: 0, gameStarts: 0, completedRounds: 0 },
    ]);
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
