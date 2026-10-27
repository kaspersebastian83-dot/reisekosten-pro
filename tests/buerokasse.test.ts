import { describe, expect, it } from "vitest";
import {
  abschluss, anfang, belegeFuerSicherung, centAusEingabe, datensatzLesen, differenzBuchung, kassenbuch, kassenbuchCsv, kassenstand,
  kassensturz, monatGeschlossen, monatsblatt, naechsterAbschluss, neueBuchung, sicherungLesen, sicherungText, storno, ungesichert,
  zusammenfuehren, type KasseRecord, type Kontext,
} from "../lib/buerokasse";
import { kasseOrdner, ordnerLesen, ordnerSchreiben } from "../lib/buerokasse-ordner";
import { FakeDir } from "./helpers/fake-dir";

let n = 0;
const k = (heute = "2026-11-20"): Kontext => ({ id: `test-${String(++n).padStart(4, "0")}`, jetzt: `${heute}T10:00:${String(n % 60).padStart(2, "0")}.000Z`, heute });
const beleg = (i: number) => ({ fileId: `${String(i).padStart(64, "a")}.jpg`, name: `Beleg${i}.jpg`, type: "image/jpeg", size: 1000 });
function kasse() {
  let r: KasseRecord[] = [];
  const add = (x: KasseRecord) => { r = [...r, x]; return x; };
  add(neueBuchung(r, { art: "anfangsbestand", datum: "2026-11-02", cent: 20000, text: "Anfangsbestand (gezählt)" }, k()));
  add(neueBuchung(r, { art: "ausgabe", datum: "2026-11-03", cent: 1250, kategorie: "Porto / Versand", haendler: "Deutsche Post", beleg: beleg(1) }, k()));
  add(neueBuchung(r, { art: "einnahme", datum: "2026-11-05", cent: 10000, kategorie: "Bankabhebung" }, k()));
  return { get r() { return r; }, add };
}

describe("Bürokasse – Kassenbuch", () => {
  it("nummeriert fortlaufend je Jahr und führt den Bestand", () => {
    const { r } = kasse();
    expect(r.map((x) => x.nr)).toEqual(["2026-0001", "2026-0002", "2026-0003"]);
    expect(kassenstand(r)).toBe(28750);
    expect(kassenbuch(r).map((z) => z.bestand)).toEqual([20000, 18750, 28750]);
    expect(anfang(r)?.cent).toBe(20000);
    expect(centAusEingabe("12,50")).toBe(1250);
    expect(centAusEingabe("1.234,56")).toBe(123456);
    expect(centAusEingabe("7.5")).toBe(750);
    expect(centAusEingabe("abc")).toBeNull();
  });

  it("lässt den Bestand nie negativ werden und verlangt Beleg oder Begründung", () => {
    const { r } = kasse();
    expect(() => neueBuchung(r, { art: "ausgabe", datum: "2026-11-04", cent: 25000, kategorie: "Sonstiges", beleg: beleg(2) }, k())).toThrow(/nicht in der Kasse/);
    // rückdatiert vor die Bankabhebung: am 04.11. sind nur 187,50 € da
    expect(() => neueBuchung(r, { art: "ausgabe", datum: "2026-11-04", cent: 19000, kategorie: "Sonstiges", beleg: beleg(2) }, k())).toThrow(/negativ/);
    expect(() => neueBuchung(r, { art: "ausgabe", datum: "2026-11-06", cent: 500, kategorie: "Sonstiges" }, k())).toThrow(/Beleg/);
    expect(() => neueBuchung(r, { art: "ausgabe", datum: "2026-11-06", cent: 500, kategorie: "Sonstiges", eigenbeleg: true }, k())).toThrow(/beschreiben/);
    expect(neueBuchung(r, { art: "ausgabe", datum: "2026-11-06", cent: 500, kategorie: "Sonstiges", eigenbeleg: true, text: "Trinkgeld Bote" }, k()).eigenbeleg).toBe(true);
    expect(() => neueBuchung(r, { art: "ausgabe", datum: "2026-11-01", cent: 100, kategorie: "Sonstiges", beleg: beleg(3) }, k())).toThrow(/beginnt am 02\.11\.2026/);
    expect(() => neueBuchung(r, { art: "ausgabe", datum: "2026-11-21", cent: 100, kategorie: "Sonstiges", beleg: beleg(3) }, k())).toThrow(/Zukunft/);
    expect(() => neueBuchung(r, { art: "anfangsbestand", datum: "2026-11-06", cent: 100 }, k())).toThrow(/schon gebucht/);
  });

  it("korrigiert nur per Storno – beide Buchungen bleiben sichtbar", () => {
    const kb = kasse();
    const ausgabe = kb.r[1];
    const s = kb.add(storno(kb.r, ausgabe.id, "Betrag falsch", k()));
    expect(s).toMatchObject({ art: "storno", nr: "2026-0004", bezug: ausgabe.id, cent: 1250, datum: "2026-11-20" });
    expect(kassenstand(kb.r)).toBe(30000);
    expect(kassenbuch(kb.r).find((z) => z.record.id === ausgabe.id)?.storniert).toBe(true);
    expect(() => storno(kb.r, ausgabe.id, "nochmal", k())).toThrow(/schon storniert/);
    expect(() => storno(kb.r, kb.r[0].id, "x", k())).toThrow(/Nur Einnahmen und Ausgaben/);
    // Storno einer Einnahme, deren Geld schon ausgegeben ist: Bestand würde negativ
    const viel = kb.add(neueBuchung(kb.r, { art: "ausgabe", datum: "2026-11-10", cent: 28000, kategorie: "Sonstiges", beleg: beleg(4) }, k()));
    expect(viel.nr).toBe("2026-0005");
    expect(() => storno(kb.r, kb.r[2].id, "falsch", k())).toThrow(/negativ/);
  });

  it("Kassensturz, Differenz und Monatsabschluss", () => {
    const kb = kasse();
    const sturz = kassensturz(kb.r, 28700, k(), { "2000": 14, "50": 14 });
    expect(sturz).toMatchObject({ art: "kassensturz", soll: 28750, ist: 28700 });
    expect(sturz.nr).toBeUndefined();
    kb.add(sturz);
    expect(kassenstand(kb.r)).toBe(28750);
    expect(() => abschluss(kb.r, "2026-11", 28700, k("2026-12-01"))).toThrow(/Differenz buchen/);
    const diff = kb.add(differenzBuchung(kb.r, 28700, k("2026-12-01"))!);
    expect(diff).toMatchObject({ art: "ausgabe", cent: 50, kategorie: "Kassendifferenz", eigenbeleg: true, datum: "2026-12-01" });
    expect(naechsterAbschluss(kb.r, "2026-12-01")).toBe("2026-11");
    expect(() => abschluss(kb.r, "2026-12", 28700, k("2026-12-01"))).toThrow(/zuerst November/);
    const [z, schluss] = abschluss(kb.r, "2026-11", 28700, k("2026-12-01"));
    kb.add(z); kb.add(schluss);
    expect(schluss).toMatchObject({ art: "abschluss", monat: "2026-11", endbestand: 28750 });
    expect(monatGeschlossen(kb.r, "2026-11")).toBe(true);
    expect(monatGeschlossen(kb.r, "2026-10")).toBe(true);
    expect(monatGeschlossen(kb.r, "2026-12")).toBe(false);
    expect(naechsterAbschluss(kb.r, "2026-12-01")).toBe("2026-12");
    expect(() => neueBuchung(kb.r, { art: "einnahme", datum: "2026-11-30", cent: 100, kategorie: "Einlage" }, k("2026-12-01"))).toThrow(/abgeschlossen/);
    expect(() => storno(kb.r, kb.r[1].id, "x", k("2026-12-01"))).toThrow(/abgeschlossen/);
    const blatt = monatsblatt(kb.r, "2026-11");
    expect(blatt).toMatchObject({ anfangsbestand: 20000, einnahmen: 10000, ausgaben: 1250, endbestand: 28750 });
    expect(monatsblatt(kb.r, "2026-12")).toMatchObject({ anfangsbestand: 28750, ausgaben: 50, endbestand: 28700 });
    const csv = kassenbuchCsv(kb.r, "2026-11");
    expect(csv.startsWith("﻿Nr;Datum;Art")).toBe(true);
    expect(csv).toContain("2026-0002;03.11.2026;ausgabe;Porto / Versand;;Deutsche Post;;19;;12,50;187,50");
    expect(csv).toContain("abgeschlossen am 01.12.2026");
  });

  it("Sicherung: Hin und zurück, doppelt übernehmen schadet nicht, Konflikte werden gemeldet", () => {
    const kb = kasse();
    const text = sicherungText(kb.r, { [beleg(1).fileId]: "data:image/jpeg;base64,AAAA" }, "2026-11-20T12:00:00.000Z", "1.11.0");
    const s = sicherungLesen(text);
    expect(s.records).toHaveLength(3);
    expect(Object.keys(s.belege)).toEqual([beleg(1).fileId]);
    expect(zusammenfuehren([], s.records)).toMatchObject({ vorhanden: 0, konflikte: [] });
    expect(zusammenfuehren(kb.r, s.records)).toMatchObject({ neu: [], vorhanden: 3, konflikte: [] });
    const fremd = { ...kb.r[2], id: "anderes-geraet-1" };
    expect(zusammenfuehren(kb.r, [fremd]).konflikte[0]).toMatch(/2026-0003 gibt es zweimal/);
    const geaendert = { ...kb.r[1], cent: 999 };
    expect(zusammenfuehren(kb.r, [geaendert]).konflikte[0]).toMatch(/weicht/);
    expect(() => sicherungLesen("{}")).toThrow(/keine Bürokasse-Sicherung/);
    expect(() => sicherungLesen(JSON.stringify({ format: "spesenkit-buerokasse-sicherung", version: 1, records: [{ ...kb.r[1], cent: -5 }] }))).toThrow(/ungültigen Eintrag/);
    expect(datensatzLesen({ ...kb.r[1], nr: "2025-0001" })).toBeNull();
    expect(datensatzLesen({ ...kb.r[1], extra: "x" })).not.toHaveProperty("extra");
    expect(ungesichert(kb.r, "2026-11-20T23:59:59.000Z")).toEqual([]);
    expect(ungesichert(kb.r, "2026-11-19T00:00:00.000Z")).toHaveLength(3);
    expect(ungesichert(kb.r).length).toBe(3);
  });

  it("Belegbilder in der Sicherung: offene Monate und der zuletzt abgeschlossene", () => {
    const kb = kasse();
    kb.add(neueBuchung(kb.r, { art: "ausgabe", datum: "2026-11-10", cent: 100, kategorie: "Sonstiges", beleg: beleg(5) }, k("2026-12-15")));
    const [z, s] = abschluss(kb.r, "2026-11", kassenstand(kb.r), k("2026-12-15"));
    kb.add(z); kb.add(s);
    kb.add(neueBuchung(kb.r, { art: "ausgabe", datum: "2026-12-10", cent: 100, kategorie: "Sonstiges", beleg: beleg(6) }, k("2026-12-15")));
    expect(belegeFuerSicherung(kb.r).sort()).toEqual([beleg(1).fileId, beleg(5).fileId, beleg(6).fileId].sort());
    const [z2, s2] = abschluss(kb.r, "2026-12", kassenstand(kb.r), k("2027-01-02"));
    kb.add(z2); kb.add(s2);
    expect(belegeFuerSicherung(kb.r)).toEqual([beleg(6).fileId]);
    expect(belegeFuerSicherung(kb.r, true)).toHaveLength(3);
  });
});

describe("Bürokasse-Ordner", () => {
  it("legt jeden Eintrag einmal ab, überschreibt nichts und liest alles wieder", async () => {
    const kb = kasse();
    const [z, s] = abschluss(kb.r, "2026-11", kassenstand(kb.r), k("2026-12-01"));
    kb.add(z); kb.add(s);
    const root = new FakeDir("Laufwerk");
    const ordner = await kasseOrdner(root as never);
    expect(ordner.name).toBe("Bürokasse");
    const bild = "data:image/jpeg;base64," + Buffer.from("bild-1").toString("base64");
    const pdfs: string[] = [];
    const erst = await ordnerSchreiben(ordner, kb.r, async () => bild, async (m) => { pdfs.push(m); return new Blob(["%PDF"]); });
    expect(erst).toMatchObject({ buchungen: 5, belege: 1, fehlendeBelege: 0 });
    expect(erst.ablage.sort()).toEqual(["Kassenbuch_2026-11.csv", "Kassenbuch_2026-11.pdf"]);
    const zweit = await ordnerSchreiben(ordner, kb.r, async () => bild, async () => new Blob(["%PDF"]));
    expect(zweit).toMatchObject({ buchungen: 0, belege: 0, ablage: [] });
    expect(pdfs).toEqual(["2026-11"]);
    const gelesen = await ordnerLesen(ordner);
    expect(gelesen.ungueltig).toBe(0);
    expect(gelesen.records.map((r) => r.id).sort()).toEqual(kb.r.map((r) => r.id).sort());
  });
});
