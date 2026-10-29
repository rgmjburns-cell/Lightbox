/**
 * Bone Buster: Rex fly-by gating, and the parity of the two match-clear mirrors.
 *
 * Why this file exists
 * ────────────────────
 * Bone Buster keeps TWO copies of its match-clear logic in one component:
 * `scoreSwap` (the hint predictor / battle simulator) and `runMatchCycle` (the
 * live engine). They drifted before, so the rules now live in
 * `src/lib/boneBusterRex.ts` and both mirrors call them. These tests pin
 *
 *   1. the rules themselves (score rates, striped spawns, Super Burst),
 *   2. the new fly-by gate — when Rex flies, when he is suppressed, and how
 *      often a real session shows him (the owner's actual ask: 28 Oct),
 *   3. that neither mirror has re-implemented the rules inline, and that both
 *      hand the shared function the same inputs.
 *
 * The fly-by carries no score and no board effect, so it cannot move the
 * leaderboard. That is asserted here too — a future change that gives the
 * flight points has to come through this file and say so.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  INITIAL_REX_FLIGHT_GATE,
  REX_BURST_MIN_STRAIGHT,
  REX_FLIGHT_COOLDOWN_MS,
  REX_FLIGHT_MIN_CHAIN,
  REX_FLIGHT_MIN_STRAIGHT,
  STRIPED_MIN_STRAIGHT,
  beginCascade,
  planCascadeRexFlight,
  planMatchOutcome,
  type RexFlightGate,
} from "./boneBusterRex";

const bb = readFileSync(
  fileURLToPath(new URL("../components/games/BoneBuster.tsx", import.meta.url)),
  "utf8"
);

// ── 1. Match outcomes: the rules both mirrors now share ──

describe("planMatchOutcome", () => {
  test("a plain 3-match scores 20 a tile and leaves nothing behind", () => {
    expect(planMatchOutcome({ maxStraightLength: 3, hasCenter: true })).toEqual({
      kind: "plain",
      basePerTile: 20,
    });
  });

  test("a 4-straight scores 40 a tile and spawns the striped tile", () => {
    expect(planMatchOutcome({ maxStraightLength: 4, hasCenter: true })).toEqual({
      kind: "striped",
      basePerTile: 40,
    });
  });

  test("a 5+ straight scores 60 a tile and is the Super Burst", () => {
    for (const len of [5, 6, 8]) {
      expect(planMatchOutcome({ maxStraightLength: len, hasCenter: true })).toEqual({
        kind: "rex-burst",
        basePerTile: 60,
      });
    }
  });

  test("a 5+ group with no known centre still spawns a striped tile at the 5+ rate", () => {
    // Preserved quirk of the original inline if/else: the per-tile rate and the
    // special-tile decision are independent, so this clears as a striped spawn
    // and still scores 60 a tile.
    expect(planMatchOutcome({ maxStraightLength: 5, hasCenter: false })).toEqual({
      kind: "striped",
      basePerTile: 60,
    });
  });

  test("an L/T-shaped group scores on its longest straight run, not its size", () => {
    // A 6-tile L whose longest straight is 3 keeps the plain 20 rate — the
    // board-size part of the score is applied by the caller (length * rate).
    expect(planMatchOutcome({ maxStraightLength: 3, hasCenter: true }).basePerTile).toBe(20);
  });

  test("the thresholds are the documented ones", () => {
    expect(REX_BURST_MIN_STRAIGHT).toBe(5);
    expect(STRIPED_MIN_STRAIGHT).toBe(4);
    expect(REX_FLIGHT_MIN_STRAIGHT).toBe(4);
  });
});

// ── 2. The fly-by gate ──

const wave = (maxStraightLength: number, hasCenter = true) => [
  { maxStraightLength, hasCenter },
];

/** Run one cascade of plain 3-matches at the given depth. */
function plainWave(chainCount: number, now: number, gate: RexFlightGate) {
  return planCascadeRexFlight(gate, { matches: wave(3), chainCount, now });
}

describe("planCascadeRexFlight — when Rex flies", () => {
  test("a plain 3-match on the first wave does not fly", () => {
    const gate = beginCascade(INITIAL_REX_FLIGHT_GATE);
    const d = plainWave(1, 1000, gate);
    expect(d.fly).toBe(false);
    expect(d.reason).toBe("no-match");
  });

  test("a 4-straight flies (the striped tile still spawns — planMatchOutcome says so)", () => {
    const gate = beginCascade(INITIAL_REX_FLIGHT_GATE);
    const d = planCascadeRexFlight(gate, { matches: wave(4), chainCount: 1, now: 1000 });
    expect(d.fly).toBe(true);
    expect(d.reason).toBe("straight");
    // The flight does not touch the striped mechanic:
    expect(planMatchOutcome({ maxStraightLength: 4, hasCenter: true }).kind).toBe("striped");
  });

  test("a cascade that reaches chain 3 flies", () => {
    let gate = beginCascade(INITIAL_REX_FLIGHT_GATE);
    expect(plainWave(1, 1000, gate).fly).toBe(false);
    expect(plainWave(2, 1400, gate).fly).toBe(false);
    const third = plainWave(REX_FLIGHT_MIN_CHAIN, 1800, gate);
    expect(third.fly).toBe(true);
    expect(third.reason).toBe("chain");
    gate = third.gate;
    expect(gate.flownCascadeId).toBe(gate.cascadeId);
  });

  test("the Super Burst is already a flight, so no second fly-by is stacked on it", () => {
    const gate = beginCascade(INITIAL_REX_FLIGHT_GATE);
    const d = planCascadeRexFlight(gate, { matches: wave(5), chainCount: 1, now: 1000 });
    expect(d.fly).toBe(false);
    expect(d.reason).toBe("rex-burst");
    // …but it still counts as "Rex flew", so the cooldown runs from it.
    expect(d.gate.lastFlightAt).toBe(1000);
    expect(d.gate.flownCascadeId).toBe(d.gate.cascadeId);
  });

  test("a wave with both a burst and a 4-straight does not fly (burst wins)", () => {
    const gate = beginCascade(INITIAL_REX_FLIGHT_GATE);
    const d = planCascadeRexFlight(gate, {
      matches: [...wave(4), ...wave(5)],
      chainCount: 1,
      now: 1000,
    });
    expect(d.fly).toBe(false);
    expect(d.reason).toBe("rex-burst");
  });

  test("a wave with several qualifying matches still shows one flight", () => {
    const gate = beginCascade(INITIAL_REX_FLIGHT_GATE);
    const d = planCascadeRexFlight(gate, {
      matches: [...wave(4), ...wave(4), ...wave(4)],
      chainCount: 1,
      now: 1000,
    });
    expect(d.fly).toBe(true);
    expect(d.reason).toBe("straight");
  });

  test("an empty wave never flies, however deep the cascade", () => {
    const gate = beginCascade(INITIAL_REX_FLIGHT_GATE);
    const d = planCascadeRexFlight(gate, { matches: [], chainCount: 9, now: 1000 });
    expect(d.fly).toBe(false);
    expect(d.reason).toBe("no-match");
  });
});

describe("planCascadeRexFlight — the brakes", () => {
  test("once per cascade: a long cascade flies on the first qualifying wave only", () => {
    let gate = beginCascade(INITIAL_REX_FLIGHT_GATE);
    const first = planCascadeRexFlight(gate, { matches: wave(4), chainCount: 1, now: 1000 });
    expect(first.fly).toBe(true);
    gate = first.gate;

    // Same cascade, deeper, and long past the cooldown: still suppressed.
    for (const chainCount of [2, 3, 4, 5, 6]) {
      const d = planCascadeRexFlight(gate, {
        matches: wave(4),
        chainCount,
        now: 1000 + chainCount * 5000,
      });
      expect(d.fly).toBe(false);
      expect(d.reason).toBe("already-flew");
    }
  });

  test("a new cascade may fly again immediately once the cooldown has passed", () => {
    let gate = beginCascade(INITIAL_REX_FLIGHT_GATE);
    const first = planCascadeRexFlight(gate, { matches: wave(4), chainCount: 1, now: 1000 });
    gate = beginCascade(first.gate);
    const later = planCascadeRexFlight(gate, {
      matches: wave(4),
      chainCount: 1,
      now: 1000 + REX_FLIGHT_COOLDOWN_MS,
    });
    expect(later.fly).toBe(true);
  });

  test("the cooldown swallows a qualifying match that comes too soon", () => {
    let gate = beginCascade(INITIAL_REX_FLIGHT_GATE);
    const first = planCascadeRexFlight(gate, { matches: wave(4), chainCount: 1, now: 1000 });
    expect(first.fly).toBe(true);

    gate = beginCascade(first.gate);
    const tooSoon = planCascadeRexFlight(gate, {
      matches: wave(4),
      chainCount: 1,
      now: 1000 + REX_FLIGHT_COOLDOWN_MS - 1,
    });
    expect(tooSoon.fly).toBe(false);
    expect(tooSoon.reason).toBe("cooldown");
    // A suppressed flight does not consume the cascade, and does not reset the
    // clock — a later wave of the same cascade may still fly.
    expect(tooSoon.gate.flownCascadeId).toBe(first.gate.flownCascadeId);
    expect(tooSoon.gate.flownCascadeId).not.toBe(tooSoon.gate.cascadeId);
    expect(tooSoon.gate.lastFlightAt).toBe(1000);
    const later = planCascadeRexFlight(tooSoon.gate, {
      matches: wave(3),
      chainCount: 4,
      now: 1000 + REX_FLIGHT_COOLDOWN_MS,
    });
    expect(later.fly).toBe(true);
  });

  test("a burst also starts the cooldown", () => {
    const gate = beginCascade(INITIAL_REX_FLIGHT_GATE);
    const burst = planCascadeRexFlight(gate, { matches: wave(5), chainCount: 1, now: 1000 });
    const next = beginCascade(burst.gate);
    const tooSoon = planCascadeRexFlight(next, { matches: wave(4), chainCount: 1, now: 2000 });
    expect(tooSoon.reason).toBe("cooldown");
  });

  test("beginCascade never changes the last flight time", () => {
    const gate: RexFlightGate = { cascadeId: 7, flownCascadeId: 7, lastFlightAt: 500 };
    expect(beginCascade(gate)).toEqual({ cascadeId: 8, flownCascadeId: 7, lastFlightAt: 500 });
  });

  test("the gate is immutable — the caller's object is never mutated", () => {
    const gate = beginCascade(INITIAL_REX_FLIGHT_GATE);
    const before = { ...gate };
    planCascadeRexFlight(gate, { matches: wave(4), chainCount: 1, now: 1000 });
    expect(gate).toEqual(before);
  });
});

// ── 3. How often Rex actually flies (the owner's ask) ──

/**
 * A plausible level: 38 moves (level 1's allowance), each 1-4 cascade waves
 * deep, spaced a few seconds apart, with the match mix a real board produces —
 * mostly 3s, occasionally a 4-straight, rarely a 5.
 */
function simulateSession(seed: number) {
  let state = seed >>> 0;
  const rand = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };

  let gate = INITIAL_REX_FLIGHT_GATE;
  let flights = 0;
  let bursts = 0;
  let now = 0;

  for (let move = 0; move < 38; move++) {
    now += 6000 + Math.floor(rand() * 6000); // player thinking time
    gate = beginCascade(gate);

    // How many waves this swap runs, then the straight length of each match.
    const waves = rand() < 0.55 ? 1 : rand() < 0.7 ? 2 : rand() < 0.8 ? 3 : 4;
    for (let w = 0; w < waves; w++) {
      // Rates measured on the game's real board logic (see the PR): ~1.4% of
      // matched groups are a 5+, ~14% are a 4, the rest are plain 3s.
      const roll = rand();
      const matches =
        roll < 0.014
          ? wave(5) // Super Burst territory
          : roll < 0.145
            ? wave(4) // striped tile
            : wave(3);
      const d = planCascadeRexFlight(gate, { matches, chainCount: w + 1, now });
      gate = d.gate;
      if (d.reason === "rex-burst") bursts++;
      if (d.fly) flights++;
      now += 900; // wave animation
    }
  }

  return { flights, bursts };
}

describe("how often a patient sees Rex", () => {
  test("the old rule (5+ straight only) shows him roughly never", () => {
    // This is the situation the owner played through and reported: across 20
    // simulated levels, Rex's flight almost never happens.
    const totals = Array.from({ length: 20 }, (_, i) => simulateSession(i + 1));
    const perLevel = totals.reduce((n, s) => n + s.bursts, 0) / totals.length;
    // Measured on the real board: ~1 Super Burst a level at best, so a patient
    // who plays one level usually sees nothing at all — the owner's report.
    expect(perLevel).toBeLessThan(2);
  });

  test("the new rule shows him at least a couple of times a level, and never spams", () => {
    const totals = Array.from({ length: 20 }, (_, i) => simulateSession(i + 1));
    const perLevel = totals.reduce((n, s) => n + s.flights, 0) / totals.length;
    // The owner's ask is "patients actually see it": a flight or more in a
    // typical level. The cap keeps it a moment, not wallpaper.
    expect(perLevel).toBeGreaterThanOrEqual(3);
    expect(perLevel).toBeLessThanOrEqual(12);
    // Every simulated level shows at least one flight.
    expect(Math.min(...totals.map((t) => t.flights))).toBeGreaterThan(0);
  });

  test("a pathological cascade cannot loop Rex", () => {
    // 20 waves deep, all 4-straights, no time passing.
    let gate = beginCascade(INITIAL_REX_FLIGHT_GATE);
    let flights = 0;
    for (let chainCount = 1; chainCount <= 20; chainCount++) {
      const d = planCascadeRexFlight(gate, { matches: wave(4), chainCount, now: 1000 });
      gate = d.gate;
      if (d.fly) flights++;
    }
    expect(flights).toBe(1);
  });
});

// ── 4. Mirror parity ──

describe("the two match-clear mirrors", () => {
  test("both mirrors get their match rules from planMatchOutcome", () => {
    const calls = bb.match(/planMatchOutcome\(/g) ?? [];
    expect(calls.length).toBe(2);
    expect(bb).toContain("// Base score + special/burst gating — shared with runMatchCycle");
    expect(bb).toContain("// Score + special-tile / Rex-burst gating. The rules live in");
  });

  test("neither mirror still carries the old inline gating", () => {
    // The pre-change formulas, which must not come back in either copy.
    expect(bb).not.toContain("maxStraightLength >= 5 ? 60");
    expect(bb).not.toContain("match.maxStraightLength === 4 ? 40");
    expect(bb).not.toMatch(/maxStraightLength\s*>=\s*5\s*&&\s*match\.centerPosition/);
    expect(bb).not.toMatch(/maxStraightLength\s*>=\s*4\s*\)\s*\{/);
  });

  test("both mirrors feed the same two inputs to the shared rule", () => {
    // maxStraightLength + hasCenter (from centerPosition), in both copies.
    const inputs = bb.match(
      /maxStraightLength: match\.maxStraightLength,\s*\n\s*hasCenter: match\.centerPosition !== null,/g
    );
    expect(inputs?.length).toBe(3); // two planMatchOutcome calls + the fly-by summary
  });

  test("the live engine decides the fly-by once per wave, on the HUD's 1-based chain", () => {
    expect(bb).toContain("const flight = planCascadeRexFlight(rexFlightGateRef.current, {");
    expect(bb).toContain("chainCount: chain + 1,");
    // Decided after the per-match loop, so a burst in the same wave wins.
    const loopEnd = bb.indexOf("// ── Rex fly-by (decorative only) ──");
    const decision = bb.indexOf("const flight = planCascadeRexFlight(");
    expect(loopEnd).toBeGreaterThan(0);
    expect(decision).toBeGreaterThan(loopEnd);
  });

  test("a cascade is opened on each valid swap, and only there", () => {
    expect(bb.match(/beginCascade\(rexFlightGateRef\.current\)/g)?.length).toBe(1);
    const swap = bb.indexOf("rexFlightGateRef.current = beginCascade(");
    const valid = bb.indexOf("if (matches.length > 0) {", swap - 400);
    expect(valid).toBeGreaterThan(0);
    expect(swap).toBeGreaterThan(valid);
  });

  test("the fly-by is decorative: it scores nothing and clears nothing", () => {
    // The overlay's own block must not touch score, grid or phase.
    const start = bb.indexOf("const showRexFlyBy = useCallback(");
    const end = bb.indexOf("// Cleanup fly-by timer on unmount", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const body = bb.slice(start, end);
    expect(body).not.toContain("setScore");
    expect(body).not.toContain("setGrid");
    expect(body).not.toContain("setPhase");
    expect(body).not.toContain("addPoints");
    expect(body).not.toContain("submitScore");
  });

  test("the Super Burst keeps its scoring formula and its own flight", () => {
    // triggerRexBurst is untouched: clearedCount * 50 * (chain + 1).
    expect(bb).toContain("const burstScore = clearedPositions.length * 50 * (chain + 1);");
    expect(bb).toContain("const duration = decorativeDuration(1200);");
  });
});
