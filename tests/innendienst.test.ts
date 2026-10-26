import { describe, expect, it } from "vitest";
import { defaultSettings, emptyState } from "../lib/config";
import { demoState } from "../lib/demo";
import { cleanContext, withoutTripNeeded } from "../lib/receipt-linking";
import { closingPreview } from "../lib/statement-closing";
import { normalizeState } from "../lib/storage";
import type { AppState, Expense } from "../lib/types";

const month = "2026-06";
function state(extra: Partial<Expense> = {}, staffRole: AppState["settings"]["staffRole"] = "aussendienst"): AppState {
  const s = structuredClone(emptyState);
  s.settings = { ...s.settings, staffRole };
  s.expenses.push({ ...demoState().expenses[0], id: "e1", date: "2026-06-10", category: "sonstige Nebenkosten", description: "Büromaterial", gross: 25, net: 21.01, vat: 3.99, vatRate: 19, exchangeRate: 1, businessShare: 100, tripId: undefined, projectNumber: undefined, warnings: [], status: "vollständig", ...extra });
  return s;
}
const codes = (s: AppState) => closingPreview(s, month).warnings.map((issue) => issue.code);

describe("Kosten ohne Reise und Projekt (Rückmeldung 1)", () => {
  it("ohne Haken: Hinweise auf fehlende Reise und Projekt wie bisher", () => {
    expect(codes(state())).toEqual(expect.arrayContaining(["trip-link", "project"]));
  });
  it("mit Haken „Gehört zu keiner Reise und keinem Projekt“: keine Zuordnungshinweise", () => {
    const found = codes(state({ noTrip: true }));
    expect(found).not.toContain("trip-link");
    expect(found).not.toContain("project");
  });
  it("Haken, aber doch eine Reise gesetzt: die Reise wird weiter geprüft", () => {
    expect(codes(state({ noTrip: true, tripId: "gibt-es-nicht" }))).toContain("trip-link");
  });
  it("Haken bleibt beim Übernehmen aus dem Beleg-Eingang erhalten", () => {
    expect(cleanContext({ noTrip: true, projectNumber: "" })).toMatchObject({ noTrip: true, projectNumber: undefined });
    expect(cleanContext({}).noTrip).toBeUndefined();
  });
});

describe("Innendienst (Rückmeldung 2)", () => {
  it("Standard ist Außendienst; ältere Daten ohne Angabe ebenso", () => {
    expect(defaultSettings.staffRole).toBe("aussendienst");
    const old = structuredClone(demoState());
    const { staffRole: _removed, ...settings } = old.settings;
    old.settings = settings as AppState["settings"];
    expect(normalizeState(old).settings.staffRole).toBe("aussendienst");
  });
  it("Innendienst: Kosten ohne Reise und Projekt ohne Hinweise", () => {
    const found = codes(state({}, "innendienst"));
    expect(found).not.toContain("trip-link");
    expect(found).not.toContain("project");
    expect(withoutTripNeeded({}, { staffRole: "innendienst" })).toBe(true);
    expect(withoutTripNeeded({}, { staffRole: "aussendienst" })).toBe(false);
  });
  it("Speicherprüfung: Haken nur als Ja/Nein, Tätigkeit als Text", () => {
    const ok = state({ noTrip: true }, "innendienst");
    expect(() => normalizeState(ok)).not.toThrow();
    const bad = state({ noTrip: "ja" as unknown as boolean });
    expect(() => normalizeState(bad)).toThrow();
  });
});
