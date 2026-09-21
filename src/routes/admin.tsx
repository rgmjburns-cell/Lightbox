import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState, type ReactNode } from "react";
import { GAME_META } from "~/lib/leaderboard";
import type { MetricsStats, MetricsWindow } from "~/lib/metrics-types";

export const Route = createFileRoute("/admin")({
  component: Admin,
});

/**
 * Admin usage dashboard. Passcode-protected, read-only, and FIRST-PARTY: every
 * number comes from our own event log (see `src/lib/metrics.ts` and
 * `server/metrics.ts`) inside this brand's own SQLite database. There is no
 * third-party analytics service anywhere in the product, no cookie and no
 * cross-site anything, so the IT self-check's "no analytics service / no
 * third-party disclosure" claim stays true.
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

function WindowBlock({ window: stats, label }: { window: MetricsWindow; label: string }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <StatTile label="Visits" value={num(stats.visits)} />
        <StatTile label="Sessions" value={num(stats.sessions)} />
        <StatTile label="Games started" value={num(stats.gameStarts)} />
        <StatTile label="Rounds finished" value={num(stats.completedRounds)} />
        <StatTile
          label="Bounce rate"
          value={pct(stats.bounceRate)}
          hint="Sessions that opened a page but never started a game"
        />
        <StatTile
          label="Games per session"
          value={stats.sessions === 0 ? "0" : (stats.gameStarts / stats.sessions).toFixed(2)}
          hint={`Finished rounds per session: ${
            stats.sessions === 0 ? "0" : (stats.completedRounds / stats.sessions).toFixed(2)
          }`}
        />
      </div>
      <h3 className="text-sm font-semibold text-white/80 mb-2">Games chosen ({label})</h3>
      <GameCounts rows={stats.gamesChosen} emptyText="No games were started in this period." />
      <h3 className="text-sm font-semibold text-white/80 mt-4 mb-2">
        How long games are played ({label})
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
                Counting since {countingSince}
              </p>
              <p className="text-xs text-mutedText mt-0.5">
                Numbers built {stats.generatedAt}. Days are UTC. There is no history
                from before that date.
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

          <Section title="Today (UTC)" subtitle={stats.today.date}>
            <div className="grid grid-cols-2 gap-3">
              <StatTile label="Visits" value={num(stats.today.visits)} />
              <StatTile label="Sessions" value={num(stats.today.sessions)} />
              <StatTile label="Games started" value={num(stats.today.gameStarts)} />
              <StatTile label="Rounds finished" value={num(stats.today.completedRounds)} />
              <StatTile
                label="Players who banked a round"
                value={num(stats.today.activePlayers)}
                hint="Distinct names with a round added today"
              />
              <StatTile
                label="Bounce rate"
                value={pct(stats.today.bounceRate)}
                hint="Opened a page today but never started a game"
              />
            </div>
          </Section>

          <Section
            title="Last 7 days"
            subtitle="Page visits, bounce rate, games chosen and how long games are played"
          >
            <WindowBlock window={stats.last7} label="last 7 days" />
          </Section>

          <Section title="Last 30 days">
            <WindowBlock window={stats.last30} label="last 30 days" />
          </Section>

          <Section
            title="Visits per day"
            subtitle="Last 30 days, oldest first. A day with no rows shows 0."
          >
            <div className="card py-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-mutedText uppercase tracking-wide">
                    <th className="font-semibold pb-2">Day</th>
                    <th className="font-semibold pb-2 text-right">Visits</th>
                    <th className="font-semibold pb-2 text-right">Sessions</th>
                    <th className="font-semibold pb-2 text-right">Started</th>
                    <th className="font-semibold pb-2 text-right">Finished</th>
                  </tr>
                </thead>
                <tbody>
                  {[...stats.daily].reverse().map((row) => (
                    <tr key={row.day} className="border-t border-lightTeal">
                      <td className="py-1.5 text-darkText">{row.day}</td>
                      <td className="py-1.5 text-right">{num(row.visits)}</td>
                      <td className="py-1.5 text-right text-mutedText">
                        {num(row.sessions)}
                      </td>
                      <td className="py-1.5 text-right text-mutedText">
                        {num(row.gameStarts)}
                      </td>
                      <td className="py-1.5 text-right text-mutedText">
                        {num(row.completedRounds)}
                      </td>
                    </tr>
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
              <strong className="text-darkText">A session</strong> is one tab. Its id
              is thrown away when the tab closes, so the same phone tomorrow counts
              as a new session.
            </p>
            <p>
              <strong className="text-darkText">Bounce rate</strong> counts sessions
              that opened at least one page and never started a game.
            </p>
            <p>
              <strong className="text-darkText">Finished rounds</strong> come from
              the app telling us a result screen appeared, because the leaderboard
              keeps one running total per player, game and month and so cannot count
              rounds. Playing again from a result screen adds another finished round
              without opening the game again, so finished rounds can be higher than
              games started.
            </p>
            <p>
              <strong className="text-darkText">Time played</strong> is measured in
              the browser from the round starting to its result screen.
            </p>
            <p>This page is not counted as a visit.</p>
          </div>
        </>
      )}
    </div>
  );
}
