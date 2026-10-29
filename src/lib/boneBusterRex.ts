/**
 * Bone Buster: match-outcome rules and the Rex fly-by gate.
 *
 * Bone Buster has TWO copies of its match-clear logic that must agree:
 *
 *   1. the hint predictor / battle simulator in `scoreSwap`
 *      (src/components/games/BoneBuster.tsx), which plays a swap out on a copy
 *      of the board to score every candidate move, and
 *   2. the live game engine in `runMatchCycle` (same file).
 *
 * Every scoring and special-tile rule that lives inline in both copies is a
 * rule that can drift, so the rules themselves live HERE and both mirrors call
 * them. Nothing in this module touches React, the DOM or localStorage: it is
 * pure, so the tests in `boneBusterRex.test.ts` can pin the behaviour both
 * mirrors inherit.
 *
 * ── What Rex does, and when (owner decision, 28 Oct) ──
 *
 * The Super Burst (straight match of 5+): Rex flies across the board, the 3×3
 * block around the match is cleared and scored. Unchanged.
 *
 * The fly-by (NEW): a purely decorative flight with NO board effect and NO
 * points. The owner's note was that a straight five is so rare a patient can
 * play a whole session and never see the mascot, so the fly-by also plays on
 *   • any straight match of 4+ (the match that earns a striped tile), and
 *   • a cascade that reaches chain 3 (the third wave of the same swap, the
 *     depth the HUD already celebrates with "3x Combo!").
 * Two brakes keep it a moment rather than wallpaper: at most ONE fly-by per
 * cascade, and a cooldown between fly-bys across moves.
 *
 * Because the fly-by carries no score, the predictor has nothing to model for
 * it — score parity is unaffected by construction. If the fly-by ever gains a
 * scoring or board effect, `scoreSwap` must call `planCascadeRexFlight` too.
 */

// ── Match outcomes (shared by both mirrors) ──

/** A straight run of this length earns the Super Burst. */
export const REX_BURST_MIN_STRAIGHT = 5;
/** A straight run of this length earns a striped tile. */
export const STRIPED_MIN_STRAIGHT = 4;

/** What a single matched group does on the board. */
export type MatchKind =
  /** Plain 3-match: tiles clear, nothing is left behind. */
  | "plain"
  /** 4-straight: one tile survives as a striped special. */
  | "striped"
  /** 5+-straight: Rex bursts the 3×3 block around the match centre. */
  | "rex-burst";

export interface MatchSummary {
  /** Longest straight-line run (3+) inside the matched group. */
  maxStraightLength: number;
  /** Whether the group has a straight run whose centre tile is known. */
  hasCenter: boolean;
}

export interface MatchOutcome {
  kind: MatchKind;
  /** Points per cleared tile, before the chain multiplier. */
  basePerTile: number;
}

/**
 * Decide what one matched group does, and what it scores per tile.
 *
 * Order matters and mirrors the original inline `if / else if` chain exactly:
 * a 5+ straight WITH a known centre is a burst; anything else at 4+ is a
 * striped spawn (a 5+ group whose centre is unknown falls here, and still
 * scores at the 5+ rate — the two rules are independent).
 */
export function planMatchOutcome(match: MatchSummary): MatchOutcome {
  const basePerTile =
    match.maxStraightLength >= REX_BURST_MIN_STRAIGHT
      ? 60
      : match.maxStraightLength === STRIPED_MIN_STRAIGHT
        ? 40
        : 20;

  const kind: MatchKind =
    match.maxStraightLength >= REX_BURST_MIN_STRAIGHT && match.hasCenter
      ? "rex-burst"
      : match.maxStraightLength >= STRIPED_MIN_STRAIGHT
        ? "striped"
        : "plain";

  return { kind, basePerTile };
}

// ── Rex fly-by gate ──

/** A straight run of this length also sends Rex across the board. */
export const REX_FLIGHT_MIN_STRAIGHT = STRIPED_MIN_STRAIGHT;
/** A cascade this deep also sends Rex across the board (the HUD's 1-based chain). */
export const REX_FLIGHT_MIN_CHAIN = 3;
/**
 * Minimum gap between fly-bys, measured from the start of the last one.
 *
 * This is the frequency brake, and it is deliberately longer than the
 * once-per-cascade cap: measured on the game's own board logic (8x8, five tile
 * types, random valid play) a 4-straight lands about 12 times per 38-move
 * level, so with a few-second cooldown Rex would fly ~14 times a level — one
 * every 25 seconds, which is wallpaper. 30s puts it at roughly 5-8 flights a
 * level, about one a minute: a patient who plays for two minutes sees him two
 * or three times, which is what the owner asked for.
 */
export const REX_FLIGHT_COOLDOWN_MS = 30000;

/**
 * Why Rex did or did not fly. Returned so the tests (and anyone reading a log)
 * can tell "not a big enough match" from "the cooldown swallowed it".
 */
export type RexFlightReason =
  /** Rex already flies for the Super Burst — never stack a second flight. */
  | "rex-burst"
  /** A 4+ straight match. */
  | "straight"
  /** A cascade reached the chain threshold. */
  | "chain"
  /** This cascade already showed one. */
  | "already-flew"
  /** Too soon after the last one. */
  | "cooldown"
  /** Nothing this cascade earned a flight. */
  | "no-match";

/**
 * Fly-by bookkeeping. One swap = one cascade, so `cascadeId` is bumped by
 * `beginCascade` when a valid swap starts, and `flownCascadeId` caps the
 * cascade to a single flight however many waves it runs.
 */
export interface RexFlightGate {
  cascadeId: number;
  flownCascadeId: number | null;
  lastFlightAt: number | null;
}

export const INITIAL_REX_FLIGHT_GATE: RexFlightGate = {
  cascadeId: 0,
  flownCascadeId: null,
  lastFlightAt: null,
};

/** Start a new cascade (call once per valid swap, before the first wave). */
export function beginCascade(gate: RexFlightGate): RexFlightGate {
  return { ...gate, cascadeId: gate.cascadeId + 1 };
}

export interface RexFlightDecision {
  fly: boolean;
  reason: RexFlightReason;
  gate: RexFlightGate;
}

/**
 * Decide whether this cascade wave shows a fly-by. Call once per wave (per
 * `runMatchCycle` pass), not once per matched group, so a wave with several
 * matches still produces at most one flight.
 *
 * @param matches every matched group cleared in this wave
 * @param chainCount 1-based cascade depth — the number the HUD shows
 * @param now millisecond clock (injected so tests need no timers)
 */
export function planCascadeRexFlight(
  gate: RexFlightGate,
  input: { matches: MatchSummary[]; chainCount: number; now: number },
): RexFlightDecision {
  if (input.matches.length === 0) {
    return { fly: false, reason: "no-match", gate };
  }

  const outcomes = input.matches.map(planMatchOutcome);

  // The Super Burst is itself a Rex flight (triggerRexBurst). It still counts
  // as "Rex flew just now", so the cooldown applies to it and a burst cascade
  // cannot also show a fly-by.
  if (outcomes.some((o) => o.kind === "rex-burst")) {
    return {
      fly: false,
      reason: "rex-burst",
      gate: {
        ...gate,
        flownCascadeId: gate.cascadeId,
        lastFlightAt: input.now,
      },
    };
  }

  const maxStraight = input.matches.reduce(
    (best, m) => Math.max(best, m.maxStraightLength),
    0,
  );
  const earned: RexFlightReason | null =
    maxStraight >= REX_FLIGHT_MIN_STRAIGHT
      ? "straight"
      : input.chainCount >= REX_FLIGHT_MIN_CHAIN
        ? "chain"
        : null;

  if (!earned) return { fly: false, reason: "no-match", gate };

  if (gate.flownCascadeId === gate.cascadeId) {
    return { fly: false, reason: "already-flew", gate };
  }
  if (
    gate.lastFlightAt !== null &&
    input.now - gate.lastFlightAt < REX_FLIGHT_COOLDOWN_MS
  ) {
    return { fly: false, reason: "cooldown", gate };
  }

  return {
    fly: true,
    reason: earned,
    gate: { ...gate, flownCascadeId: gate.cascadeId, lastFlightAt: input.now },
  };
}

/** How long the fly-by overlay stays mounted (ms). */
export const REX_FLY_BY_MS = 1200;
/** The first fly-by a device ever sees runs longer, with a caption. */
export const REX_FLY_BY_FIRST_MS = 2200;
