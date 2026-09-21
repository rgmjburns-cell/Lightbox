/**
 * Unit tests for the dashboard export's pure half (`server/metrics-export.ts`):
 * CSV escaping, the games-played text, the zero-filled day rows, the per-day
 * telemetry folding and the attachment filename. No database, no network.
 */
import { describe, expect, test } from "bun:test";
import {
  CSV_COLUMNS,
  csvCell,
  exportFilename,
  gamesPlayedText,
  statsCsv,
  telemetryByDay,
} from "./metrics-export.ts";
import type { MetricsDailyRow } from "../src/lib/metrics-types.ts";

const HEADER = CSV_COLUMNS.join(",");

function day(overrides: Partial<MetricsDailyRow> & { day: string }): MetricsDailyRow {
  return {
    visits: 0,
    sessions: 0,
    gameStarts: 0,
    roundsPlayed: 0,
    completedRounds: 0,
    activePlayers: 0,
    gamesPlayed: [],
    ...overrides,
  };
}

/**
 * A quiet day and the real 2026-09-17 shape (25 rounds banked, 20 players, 4
 * games, 31 finished rounds logged — banked is lower because replays grow a
 * player's existing board row instead of adding one).
 */
const QUIET = day({ day: "2026-09-16" });
const BUSY = day({
  day: "2026-09-17",
  visits: 41,
  sessions: 12,
  gameStarts: 30,
  completedRounds: 25,
  roundsPlayed: 31,
  activePlayers: 20,
  gamesPlayed: [
    { game: "scan-rush", rounds: 19 },
    { game: "ecg-rhythm", rounds: 3 },
    { game: "memory-scan", rounds: 2 },
    { game: "bone-buster", rounds: 1 },
  ],
});

describe("csvCell", () => {
  test("numbers and plain text are written bare", () => {
    expect(csvCell(0)).toBe("0");
    expect(csvCell(12.5)).toBe("12.5");
    expect(csvCell("scan-rush 19")).toBe("scan-rush 19");
  });
  test("null and undefined become an empty field", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
  test("a comma, quote or newline is quoted, inner quotes doubled", () => {
    expect(csvCell("scan-rush, ecg-rhythm")).toBe('"scan-rush, ecg-rhythm"');
    expect(csvCell('he said "play"')).toBe('"he said ""play"""');
    expect(csvCell("two\r\nlines")).toBe('"two\r\nlines"');
  });
});

describe("gamesPlayedText", () => {
  test("joins with a semicolon and a space, never a dash", () => {
    const text = gamesPlayedText(BUSY.gamesPlayed);
    expect(text).toBe("scan-rush 19; ecg-rhythm 3; memory-scan 2; bone-buster 1");
    expect(text).not.toContain("—");
  });
  test("a day with nothing played is empty", () => {
    expect(gamesPlayedText([])).toBe("");
    expect(csvCell(gamesPlayedText([]))).toBe("");
  });
});

describe("statsCsv", () => {
  const telemetry = new Map([
    ["2026-09-17", { bounceRate: 33.3, avgDurationSec: 88.4 }],
  ]);

  test("header row then one row per day, oldest first", () => {
    const rows = statsCsv([QUIET, BUSY], telemetry).split("\r\n");
    expect(rows[0]).toBe(HEADER);
    expect(rows[1]).toBe("2026-09-16,0,0,0,0,0,0,0,,");
    expect(rows[2]).toBe(
      "2026-09-17,41,12,30,25,31,20,33.3,88.4,scan-rush 19; ecg-rhythm 3; memory-scan 2; bone-buster 1",
    );
    // Trailing newline, so the file ends with a complete line.
    expect(rows[3]).toBe("");
  });

  test("roundsPlayed is its own column, next to roundsBanked", () => {
    // Header first: the two round columns sit together, banked then played, so a
    // reader cannot mistake one for the other.
    expect(CSV_COLUMNS.indexOf("roundsPlayed")).toBe(
      CSV_COLUMNS.indexOf("roundsBanked") + 1,
    );
    expect(HEADER).toContain("roundsBanked,roundsPlayed");
    const cells = (statsCsv([QUIET, BUSY], telemetry).split("\r\n")[2] ?? "").split(",");
    const at = (name: (typeof CSV_COLUMNS)[number]) => cells[CSV_COLUMNS.indexOf(name)];
    // The day with events: banked (board rows) and played (event log) differ, and
    // both are printed, exactly as the dashboard shows them.
    expect(at("roundsBanked")).toBe("25");
    expect(at("roundsPlayed")).toBe("31");
    // A day with nothing recorded from the event log reads 0, never blank.
    const quietCells = (statsCsv([QUIET], telemetry).split("\r\n")[1] ?? "").split(",");
    expect(quietCells[CSV_COLUMNS.indexOf("roundsPlayed")]).toBe("0");
    expect(quietCells).toHaveLength(CSV_COLUMNS.length);
  });

  test("a day with no finished rounds leaves avgDurationSec empty", () => {
    const csv = statsCsv([QUIET], new Map([["2026-09-16", { bounceRate: 0, avgDurationSec: null }]]));
    expect(csv).toContain("2026-09-16,0,0,0,0,0,0,0,,");
  });

  test("no telemetry at all still writes a full, valid row", () => {
    const csv = statsCsv([QUIET], new Map());
    expect(csv.split("\r\n")[1]).toBe("2026-09-16,0,0,0,0,0,0,0,,");
  });

  test("a game id holding a comma or a quote is escaped, row stays 10 fields", () => {
    const odd = day({
      day: "2026-09-18",
      completedRounds: 2,
      gamesPlayed: [
        { game: 'word "search", 2', rounds: 1 },
        { game: "bone-buster", rounds: 1 },
      ],
    });
    const row = statsCsv([odd], new Map()).split("\r\n")[1] ?? "";
    // The nine numeric/date fields stay bare and in order; only the games field
    // is quoted (it holds a comma and a quote), with its inner quotes doubled.
    expect(row).toBe('2026-09-18,0,0,0,2,0,0,0,,"word ""search"", 2 1; bone-buster 1"');
  });

  test("an empty table is a header row and nothing else", () => {
    expect(statsCsv([], new Map())).toBe(`${HEADER}\r\n`);
  });
});

describe("telemetryByDay", () => {
  test("bounce rate and average duration are folded per UTC day", () => {
    const map = telemetryByDay(
      [
        { day: "2026-09-17", session: "a", visits: 1, gameStarts: 1 },
        { day: "2026-09-17", session: "b", visits: 1, gameStarts: 0 },
        { day: "2026-09-17", session: "c", visits: 0, gameStarts: 0 },
        { day: "2026-09-18", session: "d", visits: 1, gameStarts: 1 },
      ],
      [
        { day: "2026-09-17", duration_sec: 82 },
        { day: "2026-09-17", duration_sec: 94 },
        { day: "2026-09-18", duration_sec: null },
      ],
    );
    // A stray session with no visit cannot move the rate (2 eligible, 1 bounced).
    expect(map.get("2026-09-17")).toEqual({ bounceRate: 50, avgDurationSec: 88 });
    // Only a null duration that day: no average, no crash.
    expect(map.get("2026-09-18")).toEqual({ bounceRate: 0, avgDurationSec: null });
    expect(map.get("2026-09-15")).toBeUndefined();
  });

  test("an empty event log yields an empty map", () => {
    expect(telemetryByDay([], []).size).toBe(0);
  });
});

describe("exportFilename", () => {
  test("carries the UTC day and the format", () => {
    expect(exportFilename("csv", new Date("2026-09-21T23:10:00Z"))).toBe("stats-2026-09-21.csv");
    expect(exportFilename("json", new Date("2026-09-21T23:10:00Z"))).toBe("stats-2026-09-21.json");
  });
});
