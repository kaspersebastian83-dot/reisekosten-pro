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

describe("Bruttobetrag statt Netto (Rückmeldung 1.12)", () => {
  const brutto = (text: string) => parseReceiptText(text).gross;
  it("Supermarkt: Zwischensumme, Rabatt, gegeben und Rückgeld zählen nicht", () => {
    expect(brutto("REWE Markt GmbH\nKaffee 8,99\nMilch 1,19\nZwischensumme 10,18\nRabatt -1,00\nSUMME EUR 9,18\nGegeben BAR 20,00\nRückgeld 10,82\nMwSt 7% 0,60 Netto 8,58")).toBe(9.18);
  });
  it("Hotelrechnung: Gesamtbetrag netto ist nicht der Betrag", () => {
    expect(brutto("Motel One\nÜbernachtung 89,00\nGesamtbetrag netto 83,18\nMwSt 7% 5,82\nGesamtbetrag brutto 89,00")).toBe(89);
    expect(brutto("Hotel\nNettosumme 100,00\nUSt 19 % 19,00\nRechnungsbetrag 119,00")).toBe(119);
  });
  it("Tankstelle mit Steuertabelle: Netto größer als einzelne Zeilen, trotzdem Brutto", () => {
    expect(brutto("ARAL\nSuper E10 45,32 l 78,50\nNetto 65,97\nMwSt 19,00 % 12,53\nSumme EUR 78,50\nKartenzahlung 78,50")).toBe(78.5);
  });
  it("Summe inkl. MwSt und zu zahlen werden bevorzugt", () => {
    expect(brutto("Deutsche Post\nBriefmarken 3,40\nSumme inkl. MwSt 3,40\nNetto 2,86")).toBe(3.4);
    expect(brutto("Restaurant\nSumme 42,00\nTrinkgeld 4,00\nZu zahlen 46,00")).toBe(46);
  });
  it("nur Netto und Steuer lesbar: wird zusammengezählt", () => {
    expect(brutto("Rechnung\nNetto 50,00\nMwSt 19% 9,50")).toBe(59.5);
  });
  it("erkennt Dollar, Pfund und Franken; ohne Hinweis Euro", () => {
    expect(parseReceiptText("Starbucks Seattle\nTotal $ 12.40\nVisa").currency).toBe("USD");
    expect(parseReceiptText("Hotel\nTOTAL USD 245.00").gross).toBe(245);
    expect(parseReceiptText("Pret\nTotal £8.50").currency).toBe("GBP");
    expect(parseReceiptText("SBB\nTotal CHF 64.00").currency).toBe("CHF");
    expect(parseReceiptText("Bäckerei\nSumme 4,50").currency).toBeUndefined();
    expect(parseReceiptText("Shop\nSumme EUR 4,50\nVisa USD").currency).toBeUndefined();
  });
});
