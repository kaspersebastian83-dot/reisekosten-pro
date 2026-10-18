import { describe, expect, it } from "vitest";
import { demoState } from "../lib/demo";
import { checkStatementForClosing, closingPreview, groupClosingIssues } from "../lib/statement-closing";

describe("Gruppierte Abschlussprüfung", () => {
  it("fasst gleiche Hinweise zusammen und verliert keinen Eintrag", () => {
    const issues = [
      { code: "project", message: "Reise 2026-07-01 · Bonn: Projektzuordnung ist unklar.", target: { kind: "trip" as const, id: "a" } },
      { code: "project", message: "Reise 2026-07-02 · Köln: Projektzuordnung ist unklar.", target: { kind: "trip" as const, id: "b" } },
      { code: "expense-warning", message: "Kosten 2026-07-02 · Parken: Beleg fehlt", target: { kind: "expense" as const, id: "c" } },
      { code: "settings", message: "Die gespeicherten Einstellungen enthalten ungültige Zahlen." },
    ];
    const groups = groupClosingIssues(issues);
    expect(groups.map((g) => [g.title, g.items.length])).toEqual([["Projektzuordnung ist unklar.", 2], ["Beleg fehlt", 1], ["Die gespeicherten Einstellungen enthalten ungültige Zahlen.", 1]]);
    expect(groups[0].items.map((i) => i.label)).toEqual(["Reise 2026-07-01 · Bonn", "Reise 2026-07-02 · Köln"]);
    expect(groups.flatMap((g) => g.items.map((i) => i.issue))).toHaveLength(issues.length);
  });

  it("Vorschau zeigt dieselben Inhaltsprobleme wie der spätere Abschluss, ohne Entwurfsfehler", () => {
    const state = demoState();
    const preview = closingPreview(state, "2026-07");
    const full = checkStatementForClosing(state, "2026-07", undefined);
    expect(full.errors.some((e) => e.code === "draft")).toBe(true);
    expect(preview.errors.some((e) => e.code === "draft")).toBe(false);
    expect(preview.warnings).toEqual(full.warnings);
    expect(preview.errors).toEqual(full.errors.filter((e) => e.code !== "draft"));
    expect(groupClosingIssues(preview.warnings).length).toBeLessThan(preview.warnings.length);
  });
});
