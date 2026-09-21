/**
 * LightBox PLAY — the admin usage dashboard's export date range.
 *
 * Pure date maths (UTC, both ends inclusive) shared by the Export card's preset
 * buttons and its From/To date pickers. Kept out of the route so the preset
 * arithmetic can be unit-tested without a browser, and so every range the card
 * can produce is described in one place.
 */

export const DAY_MS = 86_400_000;
export const RANGE_DEFAULT_DAYS = 30;

/** A `YYYY-MM-DD` UTC day string, the shape the date inputs and the API use. */
export function utcDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface ExportRange {
  from: string;
  to: string;
}

/** Which preset produced the current From/To dates. */
export type ExportPreset = "last7" | "lastMonth" | "custom";

/**
 * The default range: the last 30 UTC days including today. This is the window
 * the export has always built, so leaving the presets alone still downloads the
 * same file as before.
 */
export function defaultExportRange(now: number = Date.now()): ExportRange {
  return {
    from: utcDateInput(new Date(now - (RANGE_DEFAULT_DAYS - 1) * DAY_MS)),
    to: utcDateInput(new Date(now)),
  };
}

/** Today and the six days before it, UTC. */
export function last7DaysRange(now: number = Date.now()): ExportRange {
  return {
    from: utcDateInput(new Date(now - 6 * DAY_MS)),
    to: utcDateInput(new Date(now)),
  };
}

/**
 * The previous CALENDAR month, UTC: every day of the month before today's, from
 * its 1st to its last day. On 21 Sep 2026 that is 1 Aug 2026 to 31 Aug 2026
 * (not a rolling 30 days). `Date.UTC` normalises the month index, so January
 * and December roll over into the previous year correctly, and month day 0 is
 * the last day of the previous month (leap years included).
 */
export function lastMonthRange(now: number = Date.now()): ExportRange {
  const today = new Date(now);
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  return {
    from: utcDateInput(new Date(Date.UTC(year, month - 1, 1))),
    to: utcDateInput(new Date(Date.UTC(year, month, 0))),
  };
}

/** The From/To dates a preset fills the pickers with. */
export function presetRange(preset: ExportPreset, now: number = Date.now()): ExportRange {
  return preset === "lastMonth" ? lastMonthRange(now) : last7DaysRange(now);
}

/**
 * Tomorrow, UTC: the latest To date the export accepts (the server refuses an
 * end beyond it rather than hand back a run of zero rows for days that have not
 * happened), so the date picker says so up front instead of failing on the click.
 */
export function exportRangeMax(now: number = Date.now()): string {
  return utcDateInput(new Date(now + DAY_MS));
}
