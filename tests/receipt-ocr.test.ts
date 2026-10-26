import { describe, expect, it } from "vitest";
import { applyMerchantRule, parseReceiptText } from "../lib/receipt-ocr";
import type { MerchantRule } from "../lib/types";

describe("lokale Belegerkennung", () => {
  it("liest typische deutsche Belegdaten als Vorschlag", () => {
    const result = parseReceiptText(`
      Parkhaus Zentrum GmbH
      Belegnummer P-2026-4711
      Datum 14.07.2026
      MwSt. 19 %
      Gesamt EUR 18,50
    `);

    expect(result.merchant).toBe("Parkhaus Zentrum GmbH");
    expect(result.date).toBe("2026-07-14");
    expect(result.gross).toBe(18.5);
    expect(result.category).toBe("Parken");
    expect(result.vatRate).toBe(19);
    expect(result.invoiceNumber).toBe("P-2026-4711");
    expect(result.confidence).toBeGreaterThanOrEqual(80);
  });

  it("übernimmt eine lokal gelernte Händlerregel", () => {
    const rules: MerchantRule[] = [
      {
        id: "rule-1",
        merchantPattern: "Musterhotel",
        category: "Hotel",
        paymentType: "privat vorgestreckt",
        vatRate: 7,
        uses: 3,
        updatedAt: "2026-07-14T12:00:00.000Z",
      },
    ];

    const result = applyMerchantRule(
      {
        merchant: "Musterhotel Köln",
        category: "sonstige Nebenkosten",
        vatRate: 19,
        confidence: 60,
      },
      rules,
    );

    expect(result.rule?.id).toBe("rule-1");
    expect(result.suggestion.category).toBe("Hotel");
    expect(result.suggestion.vatRate).toBe(7);
  });
});

describe("Händler und Beträge robuster (Rückmeldung aus dem Einsatz)", () => {
  const rule = (merchantPattern: string): MerchantRule => ({ id: "r", merchantPattern, category: "sonstige Nebenkosten", paymentType: "privat vorgestreckt", vatRate: 7, uses: 1, updatedAt: "2026-10-26T00:00:00Z" });
  it("überspringt Logo-Zeichensalat, Adresse, Telefon, Kasse", () => {
    expect(parseReceiptText("~~ HH ~~\nBäckerei Schmitz GmbH\nKaiserstr. 4, 52062 Aachen\nKasse 2 Bon 4711\nGesamt EUR 4,50").merchant).toBe("Bäckerei Schmitz GmbH");
    expect(parseReceiptText("|| ii ||\nTel. 02405 123456\nwww.beispiel.de\nCafé Lindenhof\nSumme 9,80").merchant).toBe("Café Lindenhof");
    expect(parseReceiptText("Musterstraße 12\n52146 Würselen\nARAL Tankstelle\nSUMME 78,50").merchant).toBe("ARAL Tankstelle");
  });
  it("Rechtsform zählt auch weiter unten, Marken werden erkannt", () => {
    expect(parseReceiptText("Willkommen\nFiliale 12\n\n\n\n\n\n\n\n\n\nHolzbau Meier GmbH & Co. KG\nSumme 12,00").merchant).toBe("Holzbau Meier GmbH & Co. KG");
    expect(parseReceiptText("Quittung\nStarbucks Aachen\nSumme 4,20").merchant).toBe("Starbucks Aachen");
  });
  it("Datum und Uhrzeit sind keine Beträge", () => {
    expect(parseReceiptText("Parkhaus\nAusfahrt 26.10.2026 11:30\nBetrag 6,00").gross).toBe(6);
    expect(parseReceiptText("Einfahrt 26.10.26 09:00\n6,00 EUR").gross).toBe(6);
  });
  it("findet einen gelernten Händler im Text, wenn die Kopfzeile unleserlich war", () => {
    const parsed = parseReceiptText("~~ ## ~~\nI1 ;\nKaffee 2,90\nCafe Lindenhof dankt\nSumme 2,90");
    const result = applyMerchantRule({ ...parsed, merchant: undefined }, [rule("cafe lindenhof")]);
    expect(result.suggestion.merchant).toBe("Cafe Lindenhof");
    expect(result.rule?.id).toBe("r");
  });
});
