import { describe, expect, it } from "vitest";
import { findKnownMerchant, knownMerchantNamed, knownMerchants, learnMerchant, significantWords } from "../lib/merchants";
import { applyMerchantRule, parseReceiptText } from "../lib/receipt-ocr";
import { emptyState } from "../lib/config";
import type { AppState, Expense, MerchantRule } from "../lib/types";

const expense = (id: string, merchant: string, date = "2026-10-01", extra: Partial<Expense> = {}): Expense => ({
  id, date, category: "Tanken", description: "", gross: 50, net: 42.02, vatRate: 19, vat: 7.98, currency: "EUR", exchangeRate: 1,
  paymentType: "privat vorgestreckt", paidBy: "", reimbursementStatus: "offen", businessShare: 100, notes: "", status: "vollständig",
  warnings: [], merchant, ...extra,
});
const rule = (merchantPattern: string, category = "Tanken", uses = 1): MerchantRule => ({ id: `rule-${merchantPattern}`, merchantPattern, category, paymentType: "privat vorgestreckt", vatRate: 19, uses, updatedAt: "2026-09-01T10:00:00Z" });
const state = (expenses: Expense[], merchantRules: MerchantRule[] = []): AppState => ({ ...structuredClone(emptyState), expenses, merchantRules });

describe("bekannte Händler (Auswahlliste)", () => {
  it("häufigste zuerst, gleiche Namen einmal in der häufigsten Schreibweise, stornierte nicht, Regeln ohne Kosten dabei", () => {
    const known = knownMerchants(state([
      expense("1", "Aral"), expense("2", "ARAL"), expense("3", "Aral", "2026-10-05"), expense("4", "Shell Würselen", "2026-10-09"),
      expense("5", "Rewe", "2026-10-02", { status: "storniert" }), expense("6", "  "),
    ], [rule("aral", "Tanken", 3), rule("cafe lindenhof", "Bewirtung", 2)]));
    expect(known.map((m) => [m.name, m.uses])).toEqual([["Aral", 3], ["cafe lindenhof", 2], ["Shell Würselen", 1]]);
    expect(known[0].rule?.category).toBe("Tanken");
    expect(known[1].fromRuleOnly).toBe(true);
    expect(knownMerchantNamed("aral ", known)?.name).toBe("Aral");
    expect(knownMerchantNamed("Ara", known)).toBeUndefined();
  });

  it("kennzeichnende Wörter ohne Rechtsform, Allgemeines und Zahlen", () => {
    expect(significantWords("ARAL AG Tankstelle 4711")).toEqual(["aral"]);
    expect(significantWords("Bäckerei Müller GmbH & Co. KG")).toEqual(["backerei", "muller"]);
    expect(significantWords("DB")).toEqual(["db"]);
  });
});

describe("Händler im Belegtext wiederfinden", () => {
  const known = knownMerchants(state([expense("1", "Aral"), expense("2", "Shell"), expense("3", "Shell Würselen"), expense("4", "Bäckerei Müller"), expense("5", "Star")]));
  it("trotz Lesefehlern und anderer Schreibweise", () => {
    expect(findKnownMerchant("ARAL AG\nTankstelle 4711\nSuper E10 45,20", known)?.name).toBe("Aral");
    expect(findKnownMerchant("SHEL1 Deutschland GmbH\nStation Aachen", known)?.name).toBe("Shell");
    expect(findKnownMerchant("Backerei Muller\nBrötchen 3,40", known)?.name).toBe("Bäckerei Müller");
  });
  it("genauer Treffer vor allgemeinem: Shell Würselen nur in Würselen", () => {
    expect(findKnownMerchant("Shell Station\nWürselen, Aachener Str. 1", known)?.name).toBe("Shell Würselen");
    expect(findKnownMerchant("Shell Station\nAachen, Trierer Str. 9", known)?.name).toBe("Shell");
  });
  it("kurze Namen nur als ganzes Wort, keine Zufallstreffer", () => {
    expect(findKnownMerchant("Start 10:42\nParkhaus Mitte 6,00", known)).toBeUndefined();
    expect(findKnownMerchant("STAR Tankstelle\nDiesel 60,00", known)?.name).toBe("Star");
    expect(findKnownMerchant("Hotel Lindenhof\nÜbernachtung 89,00", known)).toBeUndefined();
  });
  it("Händler, deren Name ein übliches Belegwort ist („Netto“, „Total“), nur in einer Kopfzeile ohne Betrag", () => {
    const words = knownMerchants(state([expense("n", "Netto"), expense("t", "Total")]));
    expect(findKnownMerchant("Kaufhaus Beispiel\nArtikel 10,00\nNetto 8,40\nMwSt 1,60\nTotal 10,00", words)).toBeUndefined();
    expect(findKnownMerchant("Rewe Markt\nSumme netto 12,10", words)).toBeUndefined();
    expect(findKnownMerchant("NETTO Marken-Discount\nFiliale 1234\nBananen 1,99\nNetto 1,86", words)?.name).toBe("Netto");
    expect(findKnownMerchant("TOTAL Tankstelle\nDiesel 55,00", words)?.name).toBe("Total");
  });
  it("nur Kopfzeilen, wenn verlangt", () => {
    const text = ["Hotel Ibis", ...Array.from({ length: 10 }, (_, i) => `Position ${i} 1,00`), "Tankquittung Aral"].join("\n");
    expect(findKnownMerchant(text, known, 8)).toBeUndefined();
    expect(findKnownMerchant(text, known)?.name).toBe("Aral");
  });
});

describe("Belegvorschlag mit bekannten Händlern", () => {
  const s = state([expense("1", "Aral"), expense("2", "Aral")], [rule("aral", "Tanken", 2)]);
  it("ersetzt die rohe Kopfzeile durch den gewohnten Namen und übernimmt die Regel", () => {
    const parsed = parseReceiptText("ARAL AG\nStation 4711 Würselen\nSuper E10 45,20 EUR\nSumme 45,20\n26.10.2026");
    const { suggestion, rule: applied } = applyMerchantRule(parsed, s.merchantRules, knownMerchants(s));
    expect(suggestion.merchant).toBe("Aral");
    expect(applied?.merchantPattern).toBe("aral");
    expect(suggestion.category).toBe("Tanken");
  });
  it("lässt einen erkannten fremden Händler stehen, wenn der bekannte nur weit unten vorkommt", () => {
    const text = ["Hotel Ibis Aachen", "Zimmer 1 Nacht 89,00", ...Array.from({ length: 8 }, () => "-"), "Parkhaus Aral Center"].join("\n");
    const parsed = parseReceiptText(text);
    expect(applyMerchantRule(parsed, s.merchantRules, knownMerchants(s)).suggestion.merchant).toBe(parsed.merchant);
  });
  it("mehrteiliger Name zählt auch weiter unten, z. B. „… dankt“ unter unleserlicher Kopfzeile", () => {
    const text = ["Wilkommen Kunde", "Kasse 3", ...Array.from({ length: 8 }, () => "Kaffee 2,90"), "Cafe Lindenhof dankt"].join("\n");
    const rules = [rule("cafe lindenhof", "Bewirtung")];
    const result = applyMerchantRule({ merchant: "Wilkommen Kunde", rawText: text, confidence: 50 }, rules);
    expect(result.suggestion.merchant).toBe("Cafe Lindenhof");
    expect(result.suggestion.category).toBe("Bewirtung");
  });
});

describe("Händler lernen beim Speichern", () => {
  it("legt eine Regel an, zählt hoch und übernimmt die letzte Kategorie; stornierte und leere nicht", () => {
    const s = state([]);
    let n = 0; const id = () => `id${++n}`;
    learnMerchant(s, expense("1", "  Aral  "), id);
    learnMerchant(s, { ...expense("2", "ARAL"), category: "Sonstige", vatRate: 7 }, id);
    learnMerchant(s, expense("3", "Rewe", "2026-10-01", { status: "storniert" }), id);
    learnMerchant(s, expense("4", ""), id);
    expect(s.merchantRules).toHaveLength(1);
    expect(s.merchantRules[0]).toMatchObject({ merchantPattern: "aral", category: "Sonstige", vatRate: 7, uses: 2 });
  });
});
