/**
 * Unit tests for where Rex is drawn inside the eight games.
 *
 * Owner direction, 2 Oct: the SMALL Rex that sat under every game's play area
 * (centred below the board, `w-10 h-10` — `w-12 h-12` in MRI Mix-Up) is removed.
 * The mascot in the speech bubble at the top of each game is KEPT, and so is the
 * end-of-game / result-modal Rex, which is a different, larger mascot inside the
 * modal card.
 *
 * Those two mascots matter for different reasons, so the blocks removed and the
 * blocks kept look almost identical in the source: the only thing separating the
 * cheer Rex from the modal Rex is the size class (`w-10`/`w-12` vs `w-16`/`w-20`/
 * `w-24`) and whether it sits inside the modal. That makes this exactly the sort
 * of change that silently takes one Rex too many, so the shape is pinned here:
 * every `<Rex>` a game still draws must be a modal-sized one, and every game must
 * still carry the top-of-screen speech bubble.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const srcFile = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

interface GameShape {
  /** The component file, relative to this test's own directory. */
  file: string;
  /** How many result-modal / end-of-game Rexes the game still draws. */
  modalRexes: number;
  /** The size classes those mascots use. */
  modalSizes: string[];
}

/**
 * Every game that had a cheer Rex under the board, with the modal mascots it
 * keeps. BoneBuster draws three (level complete, victory, out of moves), FilmStack
 * and PulsePop two each, and MRI Mix-Up none at all — its win screen has never
 * drawn one, so removing the cheer Rex leaves that game with its speech bubble as
 * the only mascot.
 */
const GAMES: GameShape[] = [
  { file: "../components/games/BoneBuster.tsx", modalRexes: 3, modalSizes: ["w-20 h-20", "w-24 h-24"] },
  { file: "../components/games/ColourRex.tsx", modalRexes: 1, modalSizes: ["w-20 h-20"] },
  { file: "../components/games/FilmStack.tsx", modalRexes: 2, modalSizes: ["w-16 h-16"] },
  { file: "../components/games/MemoryScan.tsx", modalRexes: 1, modalSizes: ["w-20 h-20"] },
  { file: "../components/games/MriMixup.tsx", modalRexes: 0, modalSizes: [] },
  { file: "../components/games/PulsePop.tsx", modalRexes: 2, modalSizes: ["w-20 h-20"] },
  { file: "../components/games/ScanRush.tsx", modalRexes: 1, modalSizes: ["w-20 h-20"] },
  { file: "../components/games/ScanSearch.tsx", modalRexes: 1, modalSizes: ["w-20 h-20"] },
];

/** The size class of every `<Rex>` a file draws, in source order. */
function rexSizes(src: string): string[] {
  return [...src.matchAll(/<Rex\s+className="([^"]*)"/g)].map((m) => {
    const size = (m[1] ?? "").match(/\bw-\d+ h-\d+\b/);
    return size ? size[0] : "";
  });
}

describe("the cheer Rex under the board", () => {
  test("no game draws a small Rex in the play area any more", () => {
    // The removed block was a bare `<Rex className="w-10 h-10" …>` (w-12 in MRI
    // Mix-Up) on its own under the board, outside any modal. Nothing that size is
    // drawn by any game now.
    for (const game of GAMES) {
      const src = srcFile(game.file);
      expect(src).not.toMatch(/<Rex\s+className="w-(10|12) h-(10|12)"/);
      for (const size of rexSizes(src)) {
        expect(size).toMatch(/^w-(16|20|24) h-(16|20|24)$/);
      }
    }
  });

  test("every game keeps its end-of-game mascots and loses only the cheer Rex", () => {
    // The count is the point: it catches both a block that came back (too many) and
    // a removal that took a modal mascot with it (too few). The sizes pin which
    // mascot survived — the modal ones, not the small one.
    for (const game of GAMES) {
      const sizes = rexSizes(srcFile(game.file));
      expect(sizes).toHaveLength(game.modalRexes);
      for (const size of sizes) expect(game.modalSizes).toContain(size);
    }
  });

  test("every game keeps the mascot in the speech bubble at the top", () => {
    // Owner direction: "keep the top one". The bubble owns Rex (it renders the
    // shared component itself), so a game that still uses the bubble still has its
    // top-of-screen mascot — and the cheer removal must not have deleted it.
    for (const game of GAMES) {
      const src = srcFile(game.file);
      expect(src).toContain("import RexSpeechBubble from \"~/components/RexSpeechBubble\"");
      expect(src).toMatch(/<RexSpeechBubble[^>]*mood=/);
    }
    // The bubble draws its own Rex at w-14, one per game, from one place.
    const bubble = srcFile("../components/RexSpeechBubble.tsx");
    expect(bubble).toMatch(/<Rex className="w-14 h-14 flex-shrink-0" mood=\{mood\} \/>/);
  });

  test("BoneBuster's Super Burst fly-by is not the Rex that was removed", () => {
    // The one Rex-ish overlay the owner did NOT ask to remove: a separate effect
    // that draws the brand's mascot PNG flying across the board. It is an <img>
    // reading `brand.rexImageUrl`, not a <Rex>, so it must still be here.
    const bb = srcFile("../components/games/BoneBuster.tsx");
    expect(bb).toContain("alt={`${brand.mascotName} Super Burst`}");
    expect(bb).toMatch(/src=\{brand\.rexImageUrl\}/);
    expect(bb).toContain("rexBurst");
  });
});
