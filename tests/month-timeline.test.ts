import { describe, expect, it } from "vitest";
import { buildStatement } from "../lib/calculations";
import { demoState } from "../lib/demo";
import { monthTimeline } from "../lib/month-timeline";
import type { AppState } from "../lib/types";

const month = "2026-07";
const timeline = (state: AppState, m = month) => monthTimeline(state, m, buildStatement(state, m));

describe("Monats-Zeitleiste", () => {
  it("zeigt jeden Tag mit Reisen oder Kosten genau einmal, chronologisch", () => {
    const days = timeline(demoState());
    const dates = days.map((d) => d.date);
    expect(dates).toEqual([...new Set(dates)].sort());
    expect(dates.every((d) => d.startsWith(month))).toBe(true);
  });

  it("übernimmt die Verpflegung je Tag aus der Monatsberechnung und summiert nicht doppelt", () => {
    const state = demoState();
    const statement = buildStatement(state, month);
    const days = monthTimeline(state, month, statement);
    const sum = days.reduce((s, d) => s + (d.allowance || 0), 0);
    expect(Math.round(sum * 100) / 100).toBe(statement.totals.allowance);
  });

  it("enthält alle Reisen und Kosten des Monats, Kosten nach Rechnungsdatum, ohne stornierte", () => {
    const state = demoState();
    state.expenses[0].status = "storniert";
    const entries = timeline(state).flatMap((d) => d.entries);
    const tripIds = new Set(entries.filter((e) => e.kind === "trip" && !e.continued).map((e) => e.kind === "trip" ? e.trip.id : ""));
    const statementTrips = new Set(buildStatement(state, month).rows.flatMap((r) => r.trips.filter((t) => t.date.startsWith(month)).map((t) => t.id)));
    expect(tripIds).toEqual(statementTrips);
    const expenseIds = entries.flatMap((e) => e.kind === "expense" ? [e.expense.id] : []);
    expect(expenseIds.sort()).toEqual(state.expenses.filter((e) => e.status !== "storniert" && e.date.startsWith(month)).map((e) => e.id).sort());
  });

  it("zeigt mehrtägige Reisen an den Folgetagen als Fortsetzung, auch über den Monatswechsel", () => {
    const state = demoState();
    const base = state.trips[0];
    state.trips = [{ ...base, id: "lang", date: "2026-06-29", endDate: "2026-07-02", tripType: "dienstlich", status: "geprüft" }];
    state.expenses = [];
    const days = timeline(state);
    expect(days.map((d) => d.date)).toEqual(["2026-07-01", "2026-07-02"]);
    expect(days[0].entries[0]).toMatchObject({ kind: "trip", continued: true, dayOfTrip: 3, days: 4 });
  });

  it("listet Kosten an Tagen ohne Reise ohne Pauschale", () => {
    const state = demoState();
    state.trips = [];
    state.expenses = [{ ...state.expenses[0], id: "nur-kosten", date: "2026-07-15", status: "geprüft" }];
    const [only] = timeline(state);
    expect(only).toMatchObject({ date: "2026-07-15", allowance: null });
    expect(only.entries.map((e) => e.kind)).toEqual(["expense"]);
  });
});
