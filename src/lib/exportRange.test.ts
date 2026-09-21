import { describe, expect, test } from "bun:test";
import {
  defaultExportRange,
  exportRangeMax,
  last7DaysRange,
  lastMonthRange,
  presetRange,
  utcDateInput,
} from "./exportRange";

/** A UTC instant for a given day, so tests never depend on the machine's clock. */
function at(iso: string): number {
  return Date.parse(`${iso}T12:00:00Z`);
}

describe("last7DaysRange", () => {
  test("is today plus the six days before it, UTC", () => {
    expect(last7DaysRange(at("2026-09-21"))).toEqual({
      from: "2026-09-15",
      to: "2026-09-21",
    });
  });

  test("crosses a month boundary", () => {
    expect(last7DaysRange(at("2026-10-03"))).toEqual({
      from: "2026-09-27",
      to: "2026-10-03",
    });
  });

  test("is always seven inclusive days", () => {
    const { from, to } = last7DaysRange(at("2026-03-01"));
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
    expect(days).toBe(6);
  });
});

describe("lastMonthRange", () => {
  test("on 21 Sep 2026 is 1 Aug 2026 to 31 Aug 2026", () => {
    expect(lastMonthRange(at("2026-09-21"))).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });

  test("in October is the whole of September", () => {
    expect(lastMonthRange(at("2026-10-01"))).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
  });

  test("in January is the previous December (year rolls back)", () => {
    expect(lastMonthRange(at("2027-01-15"))).toEqual({
      from: "2026-12-01",
      to: "2026-12-31",
    });
  });

  test("handles February in a leap year", () => {
    expect(lastMonthRange(at("2028-03-05"))).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
  });

  test("handles February in a common year", () => {
    expect(lastMonthRange(at("2027-03-05"))).toEqual({
      from: "2027-02-01",
      to: "2027-02-28",
    });
  });

  test("covers every day of the previous month", () => {
    const { from, to } = lastMonthRange(at("2026-09-21"));
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
    expect(days).toBe(31);
  });
});

describe("presetRange", () => {
  test("last7 and lastMonth pick their own maths", () => {
    expect(presetRange("last7", at("2026-09-21"))).toEqual(last7DaysRange(at("2026-09-21")));
    expect(presetRange("lastMonth", at("2026-09-21"))).toEqual(lastMonthRange(at("2026-09-21")));
  });
});

describe("defaultExportRange", () => {
  test("stays the last 30 UTC days including today", () => {
    expect(defaultExportRange(at("2026-09-21"))).toEqual({
      from: "2026-08-23",
      to: "2026-09-21",
    });
  });
});

describe("exportRangeMax", () => {
  test("is tomorrow, UTC", () => {
    expect(exportRangeMax(at("2026-09-21"))).toBe("2026-09-22");
  });

  test("rolls the month over", () => {
    expect(exportRangeMax(at("2026-09-30"))).toBe("2026-10-01");
  });
});

describe("utcDateInput", () => {
  test("formats a UTC day, ignoring the local clock", () => {
    expect(utcDateInput(new Date(Date.UTC(2026, 0, 5, 23, 59)))).toBe("2026-01-05");
  });
});
