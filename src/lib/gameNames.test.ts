/**
 * Unit tests for the games' DISPLAY names.
 *
 * The owner renamed "Scan Rush" to "Scan Quest" (display name only). The route,
 * the gameId, the analytics ids and every database key keep the old name on
 * purpose: renaming them would orphan scores that already exist on a live board,
 * so this file pins both halves of that decision — what a player reads, and what
 * the app submits under.
 *
 * The source sweep at the bottom is the safety net: a display name lives in a
 * surprising number of places (the home screen's card list, the game page's
 * title tile, the leaderboard's filter labels and the game's own start panel),
 * and one missed copy is the whole rename undone.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GAME_META } from "./leaderboard";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const read = (rel: string) => readFileSync(here(rel), "utf8");

/** Every shipped `.ts`/`.tsx` file under `src/`, as [path, contents] pairs. */
function sourceFiles(dir = here("../")): [string, string][] {
  const out: [string, string][] = [];
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    // Test files are deliberately skipped: their own descriptions name the old
    // name, and a player never reads them.
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry))
      out.push([full, readFileSync(full, "utf8")]);
  }
  return out;
}

describe("Scan Quest (renamed from Scan Rush)", () => {
  test("the leaderboard label is the new name, the id is the old one", () => {
    const meta = GAME_META.find((game) => game.id === "scan-rush");
    expect(meta?.label).toBe("Scan Quest");
  });

  test("the home screen's card shows the new name", () => {
    const home = read("../routes/index.tsx");
    expect(home).toContain('id: "scan-rush"');
    expect(home).toMatch(/id: "scan-rush",\s*\n\s*title: "Scan Quest"/);
  });

  test("the game page's title tile shows the new name", () => {
    const route = read("../routes/play.$gameId.tsx");
    expect(route).toMatch(
      /"scan-rush": \{ title: "Scan Quest", icon: "\/icons\/icon-scan-rush\.png" \}/,
    );
  });

  test("the game's own panel shows the new name", () => {
    expect(read("../components/games/ScanRush.tsx")).toContain("Scan Quest");
  });

  test("no user-visible copy still reads \"Scan Rush\"", () => {
    const offenders = sourceFiles()
      .filter(([, contents]) => contents.includes("Scan Rush"))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});
