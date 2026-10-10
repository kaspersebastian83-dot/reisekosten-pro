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
