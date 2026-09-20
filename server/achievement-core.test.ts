import { describe, expect, test } from "bun:test";
import {
  ACHIEVEMENTS,
  EMPTY_ACHIEVEMENT_STATS,
  badgesNotJustifiedByStats,
  coerceAchievementStats,
  evaluateUnlockedBadgeIds,
  mergeAchievementStats,
  type AchievementStats,
} from "./achievement-core.ts";

const stats = (over: Partial<AchievementStats> = {}): AchievementStats => ({
  ...EMPTY_ACHIEVEMENT_STATS,
  ...over,
});

describe("achievement thresholds (shared by the browser and the server)", () => {
  test("a blank player has no badges", () => {
    expect(evaluateUnlockedBadgeIds(stats())).toEqual([]);
  });

  test("each threshold unlocks exactly its badge", () => {
    expect(evaluateUnlockedBadgeIds(stats({ gamesPlayed: ["bone-buster"] }))).toEqual([
      "first-scan",
    ]);
    expect(evaluateUnlockedBadgeIds(stats({ boneBusterLevel: 7 }))).toEqual([
      "bone-buster-champion",
    ]);
    // 6 is not enough — the UI level 8 is level index 7.
    expect(evaluateUnlockedBadgeIds(stats({ boneBusterLevel: 6 }))).toEqual([]);
    expect(evaluateUnlockedBadgeIds(stats({ scanSearchCompletions: 3 }))).toEqual([
      "word-wizard",
    ]);
    expect(evaluateUnlockedBadgeIds(stats({ memoryScanHardBest: 1 }))).toEqual([
      "puzzle-master",
    ]);
    expect(
      evaluateUnlockedBadgeIds(
        stats({ gamesPlayed: ["bone-buster", "scan-search", "memory-scan"] }),
      ),
    ).toEqual(["first-scan", "scan-explorer"]);
    expect(evaluateUnlockedBadgeIds(stats({ accumulatedPoints: 25000 }))).toEqual([
      "waiting-time-hero",
    ]);
    // Strictly under 20 moves / 60 seconds.
    expect(evaluateUnlockedBadgeIds(stats({ memoryScanBestMoves: 19 }))).toEqual([
      "perfect-match",
    ]);
    expect(evaluateUnlockedBadgeIds(stats({ memoryScanBestMoves: 20 }))).toEqual([]);
    expect(evaluateUnlockedBadgeIds(stats({ scanSearchBestTime: 59 }))).toEqual([
      "speed-reader",
    ]);
    expect(evaluateUnlockedBadgeIds(stats({ scanSearchBestTime: 60 }))).toEqual([]);
    expect(
      evaluateUnlockedBadgeIds(stats({ playDays: ["a", "b", "c", "d", "e"] })),
    ).toEqual(["rexs-best-friend"]);
  });

  test("Level Up is evaluated last, over the badges earned in the same pass", () => {
    const seven: Partial<AchievementStats> = {
      gamesPlayed: ["bone-buster", "scan-search", "memory-scan"],
      boneBusterLevel: 7,
      scanSearchCompletions: 3,
      memoryScanHardBest: 5,
      accumulatedPoints: 25000,
      memoryScanBestMoves: 12,
    };
    // first-scan, bone-buster-champion, word-wizard, puzzle-master,
    // scan-explorer, waiting-time-hero, perfect-match = 7 -> Level Up qualifies.
    const ids = evaluateUnlockedBadgeIds(stats(seven));
    expect(ids).toContain("level-up");
    expect(ids).toHaveLength(8);
    // One badge short of seven: Level Up stays locked.
    const six = evaluateUnlockedBadgeIds(
      stats({ ...seven, memoryScanBestMoves: 99 }),
    );
    expect(six).not.toContain("level-up");
  });

  test("every badge id is defined once and in a stable order", () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    expect(ACHIEVEMENTS[ACHIEVEMENTS.length - 1].id).toBe("rexs-best-friend");
  });
});

describe("merging snapshots is monotone (a badge can never be lost)", () => {
  const strong = stats({
    gamesPlayed: ["bone-buster", "scan-search"],
    playDays: ["2026-09-01", "2026-09-02"],
    scanSearchCompletions: 3,
    accumulatedPoints: 30000,
    boneBusterLevel: 7,
    memoryScanHardBest: 900,
    scanSearchBestTime: 42,
    memoryScanBestMoves: 12,
  });

  test("merging a weaker snapshot keeps every value that could unlock something", () => {
    const merged = mergeAchievementStats(strong, stats({ accumulatedPoints: 5 }));
    expect(merged).toEqual(strong);
  });

  test("sets union, maxima win, minima win", () => {
    const merged = mergeAchievementStats(
      stats({ gamesPlayed: ["colour-rex"], playDays: ["2026-01-01"], boneBusterLevel: 3 }),
      stats({
        gamesPlayed: ["bone-buster"],
        playDays: ["2026-01-01", "2026-01-02"],
        boneBusterLevel: 7,
        scanSearchBestTime: 30,
        memoryScanBestMoves: 15,
      }),
    );
    expect(merged.gamesPlayed.sort()).toEqual(["bone-buster", "colour-rex"]);
    expect(merged.playDays.sort()).toEqual(["2026-01-01", "2026-01-02"]);
    expect(merged.boneBusterLevel).toBe(7);
    expect(merged.scanSearchBestTime).toBe(30);
    expect(merged.memoryScanBestMoves).toBe(15);
  });

  test("merge is idempotent and commutative on the badge outcome", () => {
    const a = stats({ boneBusterLevel: 7, scanSearchCompletions: 1 });
    const b = stats({ scanSearchCompletions: 3 });
    const ab = evaluateUnlockedBadgeIds(mergeAchievementStats(a, b));
    const ba = evaluateUnlockedBadgeIds(mergeAchievementStats(b, a));
    expect(ab).toEqual(ba);
    expect(ab).toContain("word-wizard");
    expect(ab).toContain("bone-buster-champion");
  });

  test("stored unlocks are always justified by the merged stats", () => {
    // The server recomputes badges from stats, so anything it has recorded must
    // still be provable from the merged snapshot.
    const merged = mergeAchievementStats(strong, stats());
    const already = Object.fromEntries(
      evaluateUnlockedBadgeIds(merged).map((id) => [id, { unlocked: true }]),
    );
    expect(badgesNotJustifiedByStats(merged, already)).toEqual([]);
  });
});

describe("coercing untrusted stats", () => {
  test("junk becomes an empty snapshot", () => {
    expect(coerceAchievementStats(null)).toEqual(EMPTY_ACHIEVEMENT_STATS);
    expect(coerceAchievementStats("nope")).toEqual(EMPTY_ACHIEVEMENT_STATS);
    expect(coerceAchievementStats({ gamesPlayed: "x" })).toEqual(EMPTY_ACHIEVEMENT_STATS);
  });

  test("non-numbers, negatives and Infinity are neutralised", () => {
    const coerced = coerceAchievementStats({
      gamesPlayed: ["bone-buster", 7, null],
      playDays: ["2026-09-01"],
      scanSearchCompletions: -3,
      accumulatedPoints: Number.POSITIVE_INFINITY,
      boneBusterLevel: 7.9,
      memoryScanHardBest: "900",
      scanSearchBestTime: -1,
      memoryScanBestMoves: 12,
    });
    expect(coerced.gamesPlayed).toEqual(["bone-buster"]);
    expect(coerced.playDays).toEqual(["2026-09-01"]);
    expect(coerced.scanSearchCompletions).toBe(0);
    expect(coerced.accumulatedPoints).toBe(0);
    expect(coerced.boneBusterLevel).toBe(7);
    expect(coerced.memoryScanHardBest).toBe(0);
    expect(coerced.scanSearchBestTime).toBe(0);
    expect(coerced.memoryScanBestMoves).toBe(12);
  });
});
