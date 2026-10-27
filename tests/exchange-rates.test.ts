import { describe, expect, it } from "vitest";
import { ecbRate, euroAmount, parseEcbCsv } from "../lib/exchange-rates";
import { readReceiptRotated, TURNED_ONLY, UPRIGHT_ONLY } from "../lib/receipt-ocr";

const csv = `KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-10-08,1.0850
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-10-09,1.0900`;
const response = (body: string | object, ok = true) => ({ ok, text: async () => typeof body === "string" ? body : JSON.stringify(body), json: async () => body });

describe("Umrechnungskurs (EZB)", () => {
  it("liest den letzten Kurs am oder vor dem Datum (Wochenende → Freitag)", () => {
    expect(parseEcbCsv(csv, "2026-10-11")).toEqual({ value: 1.09, date: "2026-10-09" });
    expect(parseEcbCsv(csv, "2026-10-08")).toEqual({ value: 1.085, date: "2026-10-08" });
    expect(parseEcbCsv("KEY,TIME_PERIOD,OBS_VALUE", "2026-10-08")).toBeNull();
  });
  it("EUR je Dollar mit Quelle; zweiter Weg, wenn die EZB nicht antwortet", async () => {
    const urls: string[] = [];
    const ecb = await ecbRate("USD", "2026-10-11", async (url) => { urls.push(url); return response(csv); });
    expect(ecb).toEqual({ rate: 0.917431, date: "2026-10-09", source: "EZB-Referenzkurs 09.10.2026" });
    expect(urls[0]).toMatch(/data-api\.ecb\.europa\.eu\/service\/data\/EXR\/D\.USD\.EUR\.SP00\.A\?startPeriod=2026-10-01&endPeriod=2026-10-11/);
    const fallback = await ecbRate("GBP", "2026-10-09", async (url) => url.includes("ecb.europa.eu") ? Promise.reject(new TypeError("CORS")) : response({ date: "2026-10-09", rates: { EUR: 1.153 } }));
    expect(fallback).toEqual({ rate: 1.153, date: "2026-10-09", source: "EZB-Referenzkurs 09.10.2026" });
    await expect(ecbRate("CHF", "2026-10-09", async () => response("", false))).rejects.toThrow(/Kartenabrechnung/);
    expect(await ecbRate("EUR", "2026-10-09", async () => { throw Error("kein Abruf"); })).toMatchObject({ rate: 1 });
    expect(euroAmount(45, 0.917431)).toBe(41.28);
  });
});

describe("Belegfoto: Richtungen", () => {
  const worker = (texts: Record<number, string>) => {
    const calls: number[] = [];
    return { calls, recognize: async (_: unknown, options: { rotateRadians?: number } = {}) => {
      const deg = Math.round(((options.rotateRadians || 0) * 180) / Math.PI);
      calls.push(deg);
      return { data: { text: texts[deg] || "~~ ## ~~", confidence: texts[deg] ? 90 : 20 } };
    } } as unknown as { calls: number[]; recognize: never };
  };
  it("liest standardmäßig nur einmal aufrecht", async () => {
    const w = worker({ 90: "Shop\n12.10.2026\nSumme 9,90" });
    const result = await readReceiptRotated(w, "bild", undefined, UPRIGHT_ONLY);
    expect(w.calls).toEqual([0]);
    expect(result.gross).toBeUndefined();
  });
  it("„gedreht lesen“ probiert nur die anderen Richtungen", async () => {
    const w = worker({ 90: "Shop\n12.10.2026\nSumme 9,90" });
    const result = await readReceiptRotated(w, "bild", undefined, TURNED_ONLY);
    expect(w.calls).toEqual([90]);
    expect(result).toMatchObject({ gross: 9.9, rotation: 90 });
  });
});
