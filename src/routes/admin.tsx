import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useCallback, useState, type ReactNode } from "react";
import { GAME_META } from "~/lib/leaderboard";
import type { MetricsStats, MetricsWindow } from "~/lib/metrics-types";

export const Route = createFileRoute("/admin")({
  component: Admin,
});

/**
 * Admin usage dashboard. Passcode-protected, read-only, and FIRST-PARTY: every
 * number comes from this app's own SQLite database (see `src/lib/metrics.ts`,
 * `server/metrics.ts`) — the leaderboard's own table for rounds, players and
 * games chosen, our event log for visits, sessions, bounce rate and time played.
 * There is no third-party analytics service anywhere in the product, no cookie and
 * no cross-site anything, so the IT self-check's "no analytics service /
 * third-party disclosure" claim stays true. Every section says which source it
 * used, because the two cover different periods.
 *
 * This page deliberately does NOT report a visit of its own: the dashboard is not
 * player traffic.
 *
 * Auth is the same passcode as the leaderboard's admin clear/export
 * (LEADERBOARD_ADMIN_PASSCODE, default clear2026), sent as an `x-admin-passcode`
 * header so it never lands in a URL or a log.
 */

const GAME_LABELS: Record<string, string> = Object.fromEntries(
  GAME_META.map((entry) => [entry.id, entry.label]),
);

function gameLabel(id: string): string {
  return GAME_LABELS[id] ?? id;
}

function num(value: number): string {
  return value.toLocaleString();
}

function pct(value: number): string {
  return `${value.toLocaleString()}%`;
}

function seconds(value: number): string {
  const total = Math.round(value);
  if (total < 60) return `${String(total)}s`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${String(minutes)}m` : `${String(minutes)}m ${String(rest)}s`;
}

/* ── Small presentational pieces (white cards on the app's dark background) ── */

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card py-3 px-4">
      <p className="text-xs font-semibold text-mutedText uppercase tracking-wide">
        {label}
      </p>
      <p className="text-2xl font-bold text-darkText leading-tight mt-1">{value}</p>
      {hint && <p className="text-[11px] text-mutedText mt-0.5">{hint}</p>}
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-6">
      <h2 className="text-base font-bold text-white mt-4 mb-1">{title}</h2>
      {subtitle && <p className="text-xs text-white/60 mb-3">{subtitle}</p>}
      {children}
    </section>
  );
}

function GameCounts({
  rows,
  emptyText,
}: {
  rows: { game: string; count: number }[];
  emptyText: string;
}) {
  if (rows.length === 0) {
    return <p className="card text-sm text-mutedText py-3">{emptyText}</p>;
  }
  const top = Math.max(...rows.map((row) => row.count), 1);
  return (
    <div className="card py-3 space-y-2">
      {rows.map((row) => (
        <div key={row.game} className="flex items-center gap-3">
          <span className="text-sm font-medium text-darkText w-28 shrink-0 truncate">
            {gameLabel(row.game)}
          </span>
          <span className="flex-1 h-2 bg-lightTeal rounded-full overflow-hidden">
            <span
              className="block h-full bg-secondary rounded-full"
              style={{ width: `${String(Math.max(4, Math.round((row.count / top) * 100)))}%` }}
            />
          </span>
          <span className="text-sm font-bold text-secondary w-10 text-right">
            {num(row.count)}
          </span>
        </div>
      ))}
    </div>
  );
}

function DurationTable({ rows }: { rows: { game: string; rounds: number; avgSec: number }[] }) {
  if (rows.length === 0) {
    return (
      <p className="card text-sm text-mutedText py-3">
        No finished rounds recorded in this period.
      </p>
    );
  }
  return (
    <div className="card py-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-mutedText uppercase tracking-wide">
            <th className="font-semibold pb-2">Game</th>
            <th className="font-semibold pb-2 text-right">Rounds</th>
            <th className="font-semibold pb-2 text-right">Time played (avg)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.game} className="border-t border-lightTeal">
              <td className="py-2 text-darkText">{gameLabel(row.game)}</td>
              <td className="py-2 text-right text-mutedText">{num(row.rounds)}</td>
              <td className="py-2 text-right font-semibold text-secondary">
                {seconds(row.avgSec)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One day's games, from the board's own rows: a chip per game with the rounds it
 * banked, most played first. Nothing renders on a day with no score rows (the
 * Rounds column next to it already reads 0 for that day).
 */
function DayGames({ games }: { games: { game: string; rounds: number }[] }) {
  if (games.length === 0) return null;
  return (
    <tr>
      <td colSpan={6} className="pt-0 pb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-mutedText mr-1.5">
          Games
        </span>
        {games.map((entry) => (
          <span
            key={entry.game}
            className="inline-flex items-baseline gap-1 rounded-full bg-lightTeal px-2 py-0.5 mr-1 text-xs whitespace-nowrap"
            title={`${entry.game}: ${String(entry.rounds)} rounds from the board`}
          >
            <span className="font-medium text-darkText">{entry.game}</span>
            <span className="font-semibold text-secondary">{num(entry.rounds)}</span>
          </span>
        ))}
      </td>
    </tr>
  );
}

function WindowBlock({ window: stats, label }: { window: MetricsWindow; label: string }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <StatTile
          label="Rounds banked"
          value={num(stats.completedRounds)}
          hint="From the board, all September"
        />
        <StatTile
          label="Players"
          value={num(stats.activePlayers)}
          hint="From the board, all September"
        />
        <StatTile
          label="Visits"
          value={num(stats.visits)}
          hint="Counted since 21 Sep"
        />
        <StatTile
          label="Sessions"
          value={num(stats.sessions)}
          hint="Counted since 21 Sep"
        />
        <StatTile
          label="Games started"
          value={num(stats.gameStarts)}
          hint="Counted since 21 Sep"
        />
        <StatTile
          label="Bounce rate"
          value={pct(stats.bounceRate)}
          hint="Opened a page but never started a game (since 21 Sep)"
        />
        <StatTile
          label="Games per session"
          value={stats.sessions === 0 ? "0" : (stats.gameStarts / stats.sessions).toFixed(2)}
          hint="Counted since 21 Sep"
        />
      </div>
      <h3 className="text-sm font-semibold text-white/80 mb-2">
        Games chosen ({label}, from the board)
      </h3>
      <GameCounts rows={stats.gamesChosen} emptyText="No rounds banked on the board in this period." />
      <h3 className="text-sm font-semibold text-white/80 mt-4 mb-2">
        How long games are played ({label}, counted since 21 Sep)
      </h3>
      <DurationTable rows={stats.avgDuration} />
    </>
  );
}

/* ── The page ─────────────────────────────────────────────────────────────── */

function Admin() {
  const [passcode, setPasscode] = useState("");
  const [stats, setStats] = useState<MetricsStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/stats", {
        headers: { "x-admin-passcode": passcode },
      });
      if (!res.ok) {
        setError(
          res.status === 403
            ? "Wrong passcode"
            : res.status === 401
              ? "Enter a passcode"
              : "Couldn't load the stats. Try again.",
        );
        if (res.status === 403 || res.status === 401) setStats(null);
        setLoading(false);
        return;
      }
      setStats((await res.json()) as MetricsStats);
    } catch {
      setError("Couldn't load the stats. Try again.");
    }
    setLoading(false);
  }, [loading, passcode]);

  const countingSince = stats?.countingSince
    ? `${stats.countingSince.slice(0, 10)} (UTC)`
    : "nothing recorded yet";

  return (
    <div className="page-container">
      <h1 className="text-xl font-bold text-white mb-1 mt-2">Usage dashboard</h1>
      <p className="text-sm text-white/70 mb-6">
        First-party only: measured by this app, stored in this brand&apos;s own
        database. No third-party analytics, no cookies, no personal data.
      </p>

      {!stats && (
        <div className="card mb-6">
          <h2 className="text-lg font-bold text-darkText mb-2">Passcode required</h2>
          <p className="text-sm text-mutedText mb-4">
            Same passcode as the leaderboard admin tools.
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              value={passcode}
              onChange={(e) => {
                setPasscode(e.target.value);
                setError(null);
              }}
              placeholder="Passcode"
              onKeyDown={(e) => {
                if (e.key === "Enter") void load();
              }}
              className="flex-1 min-w-0 rounded-lg border border-lightTeal px-3 py-2 text-sm text-darkText
                         outline-none focus:border-secondary"
              autoFocus
            />
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading || passcode.length === 0}
              className="btn-primary text-sm py-2 px-4 disabled:opacity-50"
            >
              {loading ? "Loading..." : "Unlock"}
            </button>
          </div>
          {error && <p className="text-sm text-red-500 font-medium mt-3">{error}</p>}
        </div>
      )}

      {stats && (
        <>
          <div className="card mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-darkText">
                Page counting since {countingSince}
              </p>
              <p className="text-xs text-mutedText mt-0.5">
                Numbers built {stats.generatedAt}. Days are UTC. Visits, sessions,
                bounce rate and time played are counted from that date. Rounds,
                players and games chosen come from the leaderboard&apos;s own
                records, so they cover all of September.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="btn-secondary text-sm py-2 px-3 shrink-0 disabled:opacity-50"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>

          <Section
            title="Today (UTC)"
            subtitle={`${stats.today.date}. Rounds and players: from the board, all September. Visits, sessions, bounce rate: since 21 Sep.`}
          >
            <div className="grid grid-cols-2 gap-3">
              <StatTile
                label="Rounds banked"
                value={num(stats.today.completedRounds)}
                hint="From the board, all September"
              />
              <StatTile
                label="Players"
                value={num(stats.today.activePlayers)}
                hint="Banked a round today, from the board"
              />
              <StatTile
                label="Visits"
                value={num(stats.today.visits)}
                hint="Counted since 21 Sep"
              />
              <StatTile
                label="Sessions"
                value={num(stats.today.sessions)}
                hint="Counted since 21 Sep"
              />
              <StatTile
                label="Games started"
                value={num(stats.today.gameStarts)}
                hint="Counted since 21 Sep"
              />
              <StatTile
                label="Bounce rate"
                value={pct(stats.today.bounceRate)}
                hint="Opened a page today but never started a game (since 21 Sep)"
              />
            </div>
          </Section>

          <Section
            title="Last 7 days"
            subtitle="Rounds, players and games chosen come from the board (all September). Visits, sessions, bounce rate and time played are counted since 21 Sep."
          >
            <WindowBlock window={stats.last7} label="last 7 days" />
          </Section>

          <Section
            title="Last 30 days"
            subtitle="Rounds, players and games chosen come from the board (all September). Visits, sessions, bounce rate and time played are counted since 21 Sep."
          >
            <WindowBlock window={stats.last30} label="last 30 days" />
          </Section>

          <Section
            title="Per day"
            subtitle="Last 30 days, oldest first. Rounds, players and each day's games come from the board and cover all of September. Visits, sessions and started count from 21 Sep, so earlier days show 0 there. Games are rounds banked per game that day, most played first."
          >
            <div className="card py-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-mutedText uppercase tracking-wide">
                    <th className="font-semibold pb-2">Day</th>
                    <th className="font-semibold pb-2 text-right">Rounds</th>
                    <th className="font-semibold pb-2 text-right">Players</th>
                    <th className="font-semibold pb-2 text-right">Visits</th>
                    <th className="font-semibold pb-2 text-right">Sessions</th>
                    <th className="font-semibold pb-2 text-right">Started</th>
                  </tr>
                </thead>
                <tbody>
                  {[...stats.daily].reverse().map((row) => (
                    <Fragment key={row.day}>
                      <tr className="border-t border-lightTeal">
                        <td className="py-1.5 text-darkText">{row.day}</td>
                        <td className="py-1.5 text-right font-semibold text-secondary">
                          {num(row.completedRounds)}
                        </td>
                        <td className="py-1.5 text-right text-darkText">
                          {num(row.activePlayers)}
                        </td>
                        <td className="py-1.5 text-right text-mutedText">
                          {num(row.visits)}
                        </td>
                        <td className="py-1.5 text-right text-mutedText">
                          {num(row.sessions)}
                        </td>
                        <td className="py-1.5 text-right text-mutedText">
                          {num(row.gameStarts)}
                        </td>
                      </tr>
                      <DayGames games={row.gamesPlayed} />
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section
            title="Leaderboard context"
            subtitle={`Month ${stats.board.month}: ${num(
              stats.board.monthlyActivePlayers,
            )} players on the board. Board totals are untouched by this page.`}
          >
            <div className="card py-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-mutedText uppercase tracking-wide">
                    <th className="font-semibold pb-2">Game</th>
                    <th className="font-semibold pb-2 text-right">Scoring rows</th>
                    <th className="font-semibold pb-2 text-right">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.board.games.length === 0 && (
                    <tr>
                      <td className="py-2 text-mutedText" colSpan={3}>
                        No scores banked this month.
                      </td>
                    </tr>
                  )}
                  {stats.board.games.map((row) => (
                    <tr key={row.game} className="border-t border-lightTeal">
                      <td className="py-2 text-darkText">{gameLabel(row.game)}</td>
                      <td className="py-2 text-right text-mutedText">
                        {num(row.players)}
                      </td>
                      <td className="py-2 text-right font-semibold text-secondary">
                        {num(row.points)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <div className="card text-xs text-mutedText space-y-2 mb-4">
            <p>
              <strong className="text-darkText">How these numbers are made.</strong>{" "}
              The app sends one tiny event to our own server when a page is opened,
              when a game is chosen and when a round finishes. Events are stored in
              this instance&apos;s own database. The only identifier is a random
              session id kept in the tab&apos;s sessionStorage: no cookie, no
              personal data, nothing shared with anybody outside this server.
            </p>
            <p>
              <strong className="text-darkText">Two sources, labelled.</strong> Rounds,
              players and games chosen come from the leaderboard&apos;s own table,
              which has recorded every round banked since the board went live, so
              those numbers cover all of September. Page visits, sessions, bounce
              rate and time played come from the app&apos;s own event log, which was
              switched on partway through September: they say &quot;counted since
              21 Sep&quot; because nothing earlier exists. Older days read 0 for
              visits, not because nothing happened, but because nothing was counted.
            </p>
            <p>
              <strong className="text-darkText">Rounds banked</strong> counts board
              rows: the leaderboard keeps one running total per player, game and
              month, so a player who plays the same game three times in a month has
              one row, not three. It is still the board&apos;s own honest record of
              real play.
            </p>
            <p>
              <strong className="text-darkText">A session</strong> is one tab. Its id
              is thrown away when the tab closes, so the same phone tomorrow counts
              as a new session.
            </p>
            <p>
              <strong className="text-darkText">Bounce rate</strong> counts sessions
              that opened at least one page and never started a game.
            </p>
            <p>
              <strong className="text-darkText">Time played</strong> is measured in
              the browser from the first tap inside a game until its result screen,
              so time spent sitting on a start screen is not counted. Playing again
              from a result screen starts a fresh measurement at that next tap.
            </p>
            <p>This page is not counted as a visit.</p>
          </div>
        </>
      )}
    </div>
  );
}
