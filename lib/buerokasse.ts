/*
 * Bürokasse – Kassenbuch der Büro-Barkasse (SpesenKit, Modus „Bürokasse“).
 *
 * Jede Buchung ist ein eigener, unveränderlicher Datensatz. Nichts wird nachträglich geändert oder gelöscht:
 * Ein Fehler wird mit einer Stornobuchung korrigiert, die auf die ursprüngliche Buchung verweist – beide bleiben sichtbar.
 *   anfangsbestand  Bestand beim Start des Kassenbuchs (einmal)
 *   einnahme        Geld in die Kasse (z. B. Bankabhebung)
 *   ausgabe         Geld aus der Kasse, mit Belegfoto oder als Eigenbeleg mit Begründung
 *   storno          hebt eine Einnahme oder Ausgabe auf (Gegenbuchung)
 *   kassensturz     gezählter Bestand gegen den Bestand laut Kassenbuch (ohne Wirkung auf den Bestand)
 *   abschluss       Monat abgeschlossen – danach keine Buchungen mit Datum in diesem oder einem früheren Monat
 *
 * Buchungen (anfangsbestand, einnahme, ausgabe, storno) bekommen eine fortlaufende Nummer je Jahr („2026-0001“).
 * Der Bestand darf zu keinem Zeitpunkt negativ werden. Beträge in Cent (ganze Zahlen).
 *
 * Gebucht wird auf einem Gerät (dem Handy). Die Sicherung („Sicherung senden“) enthält alle Datensätze und die
 * Belegbilder der noch offenen Monate; „Vom Handy übernehmen“ legt sie auf dem PC im Bürokasse-Ordner ab.
 * Gleiche Datensätze (gleiche id) werden beim Übernehmen übersprungen – doppelt senden schadet nicht.
 */

export const KASSE_FORMAT = "spesenkit-buerokasse";
export const KASSE_VERSION = 1;
export const SICHERUNG_FORMAT = "spesenkit-buerokasse-sicherung";

export type KasseArt = "anfangsbestand" | "einnahme" | "ausgabe" | "storno" | "kassensturz" | "abschluss";
const ARTEN: KasseArt[] = ["anfangsbestand", "einnahme", "ausgabe", "storno", "kassensturz", "abschluss"];
const BUCHUNGSARTEN: KasseArt[] = ["anfangsbestand", "einnahme", "ausgabe", "storno"];

export interface KasseBeleg { fileId: string; name: string; type: string; size: number }

export interface KasseRecord {
  format: typeof KASSE_FORMAT;
  version: 1;
  id: string;
  art: KasseArt;
  /** Zeitpunkt der Erfassung (ISO). */
  erfasst: string;
  /** Buchungsdatum (Beleg-/Zähldatum), JJJJ-MM-TT. */
  datum: string;
  /** Fortlaufende Belegnummer je Jahr, nur bei Buchungen. */
  nr?: string;
  /** Betrag in Cent, immer positiv. Beim Storno der Betrag der aufgehobenen Buchung. */
  cent?: number;
  kategorie?: string;
  /** Wofür / Buchungstext. */
  text?: string;
  haendler?: string;
  /** Umsatzsteuersatz in Prozent (Ausgaben; für die DATEV-Übergabe). */
  mwst?: number;
  rechnungsnr?: string;
  beleg?: KasseBeleg;
  /** Ausgabe ohne Belegfoto (Eigenbeleg); Begründung steht in text. */
  eigenbeleg?: boolean;
  /** Storno: id der aufgehobenen Buchung. */
  bezug?: string;
  /** Storno: Grund. */
  grund?: string;
  /** Kassensturz: Bestand laut Kassenbuch und gezählter Bestand (Cent), optional die Zählliste (Wert in Cent → Anzahl). */
  soll?: number;
  ist?: number;
  zaehlung?: Record<string, number>;
  /** Abschluss: Monat JJJJ-MM und Endbestand (Cent). */
  monat?: string;
  endbestand?: number;
  /** Aus einer SpesenKit-Kostenposition übernommen (deren id). */
  quelle?: string;
}

export const AUSGABE_KATEGORIEN = [
  "Büromaterial", "Porto / Versand", "Getränke / Bewirtung", "Lebensmittel / Küche", "Reinigung / Haushalt",
  "Fahrtkosten / Parken", "Kleinanschaffung / Reparatur", "Geschenke", "Kassendifferenz", "Sonstiges",
];
export const EINNAHME_KATEGORIEN = ["Bankabhebung", "Einlage", "Rückgabe / Erstattung", "Kassendifferenz", "Sonstige Einnahme"];
export const MWST_SAETZE = [19, 7, 0];
/** Scheine und Münzen für die Zählhilfe, in Cent. */
export const STUECKELUNG = [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1];

const DATUM = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONAT = /^\d{4}-(0[1-9]|1[0-2])$/;
const NR = /^\d{4}-\d{4,6}$/;
const ID = /^[0-9A-Za-z_-]{6,80}$/;
const FILE_ID = /^[0-9a-f]{64}\.[a-z0-9]{1,5}$/;
const MAX_CENT = 100_000_000; // 1 Mio. €

export const istBuchung = (r: KasseRecord) => BUCHUNGSARTEN.includes(r.art);
export const euroAusCent = (cent: number) => (cent / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
/** Eingabe „12,50“ / „12.5“ / „1.234,56“ → Cent; null bei ungültiger Eingabe. */
export function centAusEingabe(text: string): number | null {
  const raw = String(text ?? "").trim().replace(/\s|€/g, "");
  if (!raw) return null;
  let normal = raw;
  if (/,/.test(raw)) normal = raw.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normal)) return null;
  const cent = Math.round(Number(normal) * 100);
  return Number.isFinite(cent) ? cent : null;
}
export const datumDe = (d: string) => (d ? d.split("-").reverse().join(".") : "–");
const gueltigesDatum = (d: unknown): d is string => {
  if (typeof d !== "string" || !DATUM.test(d)) return false;
  const [y, m, t] = d.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, t));
  return probe.getUTCMonth() === m - 1 && probe.getUTCDate() === t;
};
const monatsende = (monat: string) => {
  const [y, m] = monat.split("-").map(Number);
  return `${monat}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};
export const naechsterMonat = (monat: string) => {
  const [y, m] = monat.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};
export const vorigerMonat = (monat: string) => {
  const [y, m] = monat.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

/* ---------- Prüfen eingelesener Datensätze ---------- */

const text = (v: unknown, max = 500) => v === undefined || (typeof v === "string" && v.length <= max);
const cent = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_CENT;

/** Datensatz aus einer Sicherung oder dem Ordner – nur vollständig gültige Datensätze werden übernommen. */
export function datensatzLesen(value: unknown): KasseRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (r.format !== KASSE_FORMAT || r.version !== KASSE_VERSION) return null;
  if (typeof r.id !== "string" || !ID.test(r.id) || !ARTEN.includes(r.art as KasseArt)) return null;
  if (typeof r.erfasst !== "string" || Number.isNaN(Date.parse(r.erfasst)) || !gueltigesDatum(r.datum)) return null;
  if (!text(r.kategorie, 80) || !text(r.text) || !text(r.haendler, 120) || !text(r.rechnungsnr, 80) || !text(r.grund) || !text(r.quelle, 80) || !text(r.bezug, 80)) return null;
  if (r.mwst !== undefined && !(typeof r.mwst === "number" && r.mwst >= 0 && r.mwst <= 100)) return null;
  if (r.eigenbeleg !== undefined && typeof r.eigenbeleg !== "boolean") return null;
  if (r.beleg !== undefined) {
    const b = r.beleg as Record<string, unknown>;
    if (!b || typeof b !== "object" || typeof b.fileId !== "string" || !FILE_ID.test(b.fileId) || typeof b.name !== "string" || typeof b.type !== "string" || typeof b.size !== "number") return null;
  }
  const art = r.art as KasseArt;
  if (BUCHUNGSARTEN.includes(art)) {
    if (typeof r.nr !== "string" || !NR.test(r.nr) || r.nr.slice(0, 4) !== (r.datum as string).slice(0, 4) || !cent(r.cent) || (r.cent as number) <= 0 && art !== "anfangsbestand") return null;
  } else if (r.nr !== undefined) return null;
  if (art === "storno" && (typeof r.bezug !== "string" || !ID.test(r.bezug))) return null;
  if (art === "kassensturz") {
    if (!cent(r.soll) || !cent(r.ist)) return null;
    if (r.zaehlung !== undefined) {
      const z = r.zaehlung as Record<string, unknown>;
      if (!z || typeof z !== "object" || Array.isArray(z) || !Object.entries(z).every(([k, n]) => /^\d{1,6}$/.test(k) && Number.isInteger(n) && (n as number) >= 0 && (n as number) < 100000)) return null;
    }
  }
  if (art === "abschluss" && (typeof r.monat !== "string" || !MONAT.test(r.monat) || !cent(r.endbestand))) return null;
  // Nur bekannte Felder übernehmen.
  const keys: (keyof KasseRecord)[] = ["format", "version", "id", "art", "erfasst", "datum", "nr", "cent", "kategorie", "text", "haendler", "mwst", "rechnungsnr", "beleg", "eigenbeleg", "bezug", "grund", "soll", "ist", "zaehlung", "monat", "endbestand", "quelle"];
  const out: Record<string, unknown> = {};
  for (const key of keys) if (r[key] !== undefined) out[key] = key === "beleg" ? { fileId: (r.beleg as KasseBeleg).fileId, name: (r.beleg as KasseBeleg).name, type: (r.beleg as KasseBeleg).type, size: (r.beleg as KasseBeleg).size } : r[key];
  return out as unknown as KasseRecord;
}

/* ---------- Auswerten ---------- */

const vergleich = (a: KasseRecord, b: KasseRecord) =>
  a.datum.localeCompare(b.datum) || (a.art === "anfangsbestand" ? -1 : b.art === "anfangsbestand" ? 1 : 0) || (a.nr || "").localeCompare(b.nr || "") || a.erfasst.localeCompare(b.erfasst) || a.id.localeCompare(b.id);

/** Buchungen in Kassenbuch-Reihenfolge (Datum, Nummer). */
export const buchungen = (records: KasseRecord[]) => records.filter(istBuchung).sort(vergleich);
export const anfang = (records: KasseRecord[]) => buchungen(records).find((r) => r.art === "anfangsbestand");
export const stornierteIds = (records: KasseRecord[]) => new Set(records.filter((r) => r.art === "storno" && r.bezug).map((r) => r.bezug!));

/** Wirkung einer Buchung auf den Bestand (Cent, mit Vorzeichen). */
export function wirkung(r: KasseRecord, byId: Map<string, KasseRecord>): number {
  if (r.art === "anfangsbestand" || r.art === "einnahme") return r.cent || 0;
  if (r.art === "ausgabe") return -(r.cent || 0);
  if (r.art === "storno") { const ziel = r.bezug ? byId.get(r.bezug) : undefined; return ziel && ziel.art !== "storno" ? -wirkung(ziel, byId) : 0; }
  return 0;
}

export interface KassenZeile { record: KasseRecord; wirkung: number; bestand: number; storniert: boolean }
/** Alle Buchungen mit laufendem Bestand. */
export function kassenbuch(records: KasseRecord[]): KassenZeile[] {
  const byId = new Map(records.map((r) => [r.id, r]));
  const storniert = stornierteIds(records);
  let bestand = 0;
  return buchungen(records).map((record) => {
    const w = wirkung(record, byId);
    bestand += w;
    return { record, wirkung: w, bestand, storniert: storniert.has(record.id) };
  });
}
export const kassenstand = (records: KasseRecord[], bis?: string) =>
  kassenbuch(records).filter((z) => !bis || z.record.datum <= bis).reduce((s, z) => s + z.wirkung, 0);

export const abgeschlosseneMonate = (records: KasseRecord[]) => new Set(records.filter((r) => r.art === "abschluss").map((r) => r.monat!));
/** Gilt als geschlossen, wenn dieser oder ein späterer Monat abgeschlossen ist. */
export function monatGeschlossen(records: KasseRecord[], monat: string) {
  for (const m of abgeschlosseneMonate(records)) if (m >= monat) return true;
  return false;
}
/** Der Monat, der als nächstes abgeschlossen werden kann (nie später als der aktuelle Monat); null ohne Kassenbuch. */
export function naechsterAbschluss(records: KasseRecord[], heute: string): string | null {
  const start = anfang(records);
  if (!start) return null;
  const closed = abgeschlosseneMonate(records);
  let monat = closed.size ? naechsterMonat([...closed].sort().at(-1)!) : start.datum.slice(0, 7);
  if (monat < start.datum.slice(0, 7)) monat = start.datum.slice(0, 7);
  return monat <= heute.slice(0, 7) ? monat : null;
}

export function naechsteNummer(records: KasseRecord[], jahr: string) {
  let max = 0;
  for (const r of records) if (r.nr?.startsWith(`${jahr}-`)) max = Math.max(max, Number(r.nr.slice(5)));
  return `${jahr}-${String(max + 1).padStart(4, "0")}`;
}

/** Gesamtbestand nie negativ (Kassenbuch-Reihenfolge). Liefert das erste Datum, an dem er negativ würde. */
export function negativAb(records: KasseRecord[]) {
  for (const z of kassenbuch(records)) if (z.bestand < 0) return z.record.datum;
  return null;
}

/* ---------- Neue Datensätze ---------- */

export interface NeuEingabe {
  art: "anfangsbestand" | "einnahme" | "ausgabe";
  datum: string;
  cent: number;
  kategorie?: string;
  text?: string;
  haendler?: string;
  mwst?: number;
  rechnungsnr?: string;
  beleg?: KasseBeleg;
  eigenbeleg?: boolean;
  quelle?: string;
}
export interface Kontext { id: string; jetzt: string; heute: string }

export class KassenFehler extends Error {}
const fehler = (message: string): never => { throw new KassenFehler(message); };

function datumPruefen(records: KasseRecord[], datum: string, heute: string, art: KasseArt) {
  if (!gueltigesDatum(datum)) fehler("Bitte ein gültiges Datum eingeben.");
  if (datum > heute) fehler("Das Datum liegt in der Zukunft.");
  const start = anfang(records);
  if (art !== "anfangsbestand" && !start) fehler("Zuerst das Kassenbuch mit dem Anfangsbestand beginnen.");
  if (start && datum < start.datum) fehler(`Das Kassenbuch beginnt am ${datumDe(start.datum)} – früher kann nicht gebucht werden.`);
  if (monatGeschlossen(records, datum.slice(0, 7))) fehler(`Der Monat ${monatName(datum.slice(0, 7))} ist abgeschlossen. Bitte mit heutigem Datum buchen.`);
}

export function neueBuchung(records: KasseRecord[], e: NeuEingabe, k: Kontext): KasseRecord {
  if (e.art === "anfangsbestand" && anfang(records)) fehler("Der Anfangsbestand ist schon gebucht.");
  datumPruefen(records, e.datum, k.heute, e.art);
  if (!Number.isInteger(e.cent) || e.cent < 0 || e.cent > MAX_CENT || (e.cent === 0 && e.art !== "anfangsbestand")) fehler("Bitte einen Betrag eingeben.");
  const kategorie = e.kategorie?.trim(), beschreibung = e.text?.trim();
  if (e.art !== "anfangsbestand" && !kategorie) fehler("Bitte auswählen, wofür das Geld war.");
  if (e.art === "ausgabe" && !e.beleg && !e.eigenbeleg) fehler("Bitte den Beleg fotografieren – oder „Kein Beleg vorhanden“ ankreuzen und begründen.");
  if (e.art === "ausgabe" && e.eigenbeleg && !e.beleg && !beschreibung) fehler("Ohne Beleg bitte kurz beschreiben, wofür das Geld ausgegeben wurde.");
  const record: KasseRecord = {
    format: KASSE_FORMAT, version: 1, id: k.id, art: e.art, erfasst: k.jetzt, datum: e.datum,
    nr: naechsteNummer(records, e.datum.slice(0, 4)), cent: e.cent,
    ...(kategorie ? { kategorie } : {}), ...(beschreibung ? { text: beschreibung } : {}),
    ...(e.haendler?.trim() ? { haendler: e.haendler.trim().slice(0, 120) } : {}),
    ...(e.art === "ausgabe" ? { mwst: e.mwst ?? 19 } : {}),
    ...(e.rechnungsnr?.trim() ? { rechnungsnr: e.rechnungsnr.trim().slice(0, 80) } : {}),
    ...(e.beleg ? { beleg: e.beleg } : {}), ...(e.eigenbeleg && !e.beleg ? { eigenbeleg: true } : {}),
    ...(e.quelle ? { quelle: e.quelle } : {}),
  };
  const ab = negativAb([...records, record]);
  if (ab) fehler(`So viel Geld ist am ${datumDe(ab)} nicht in der Kasse (Bestand würde negativ). Bitte Betrag prüfen oder zuerst die Einnahme buchen.`);
  return record;
}

export function storno(records: KasseRecord[], zielId: string, grund: string, k: Kontext): KasseRecord {
  const ziel = records.find((r) => r.id === zielId);
  if (!ziel || (ziel.art !== "einnahme" && ziel.art !== "ausgabe")) fehler("Nur Einnahmen und Ausgaben können storniert werden.");
  if (stornierteIds(records).has(zielId)) fehler("Diese Buchung ist schon storniert.");
  if (monatGeschlossen(records, ziel!.datum.slice(0, 7))) fehler("Der Monat dieser Buchung ist abgeschlossen. Bitte eine neue Gegenbuchung mit heutigem Datum erfassen.");
  if (!grund.trim()) fehler("Bitte kurz den Grund für das Storno angeben.");
  datumPruefen(records, k.heute, k.heute, "storno");
  const record: KasseRecord = {
    format: KASSE_FORMAT, version: 1, id: k.id, art: "storno", erfasst: k.jetzt, datum: k.heute,
    nr: naechsteNummer(records, k.heute.slice(0, 4)), cent: ziel!.cent, bezug: ziel!.id, grund: grund.trim().slice(0, 500),
    kategorie: ziel!.kategorie, text: `Storno ${ziel!.nr}${ziel!.text ? ` (${ziel!.text})` : ""}`.slice(0, 500),
  };
  const ab = negativAb([...records, record]);
  if (ab) fehler(`Nach dem Storno wäre der Bestand am ${datumDe(ab)} negativ. Bitte zuerst die fehlende Einnahme buchen.`);
  return record;
}

/** Kassensturz: gezählter Bestand gegen den aktuellen Bestand laut Kassenbuch. */
export function kassensturz(records: KasseRecord[], ist: number, k: Kontext, zaehlung?: Record<string, number>): KasseRecord {
  if (!anfang(records)) fehler("Zuerst das Kassenbuch mit dem Anfangsbestand beginnen.");
  if (!Number.isInteger(ist) || ist < 0 || ist > MAX_CENT) fehler("Bitte den gezählten Betrag eingeben.");
  const z = zaehlung && Object.fromEntries(Object.entries(zaehlung).filter(([, n]) => n > 0));
  return { format: KASSE_FORMAT, version: 1, id: k.id, art: "kassensturz", erfasst: k.jetzt, datum: k.heute, soll: kassenstand(records), ist, ...(z && Object.keys(z).length ? { zaehlung: z } : {}) };
}

/** Differenz nach einer Zählung als Einnahme bzw. Ausgabe „Kassendifferenz“ (Eigenbeleg). */
export function differenzBuchung(records: KasseRecord[], ist: number, k: Kontext): KasseRecord | null {
  const diff = ist - kassenstand(records);
  if (!diff) return null;
  return neueBuchung(records, {
    art: diff > 0 ? "einnahme" : "ausgabe", datum: k.heute, cent: Math.abs(diff), kategorie: "Kassendifferenz", mwst: 0, eigenbeleg: true,
    text: `Kassendifferenz laut Zählung vom ${datumDe(k.heute)} (gezählt ${euroAusCent(ist)})`,
  }, k);
}

/** Monatsabschluss: nur der nächste offene Monat, und nur, wenn die Zählung zum Bestand passt. */
export function abschluss(records: KasseRecord[], monat: string, ist: number, k: Kontext): KasseRecord[] {
  const naechster = naechsterAbschluss(records, k.heute);
  if (!naechster) fehler("Es gibt gerade keinen Monat zum Abschließen.");
  if (monat !== naechster) fehler(`Bitte zuerst ${monatName(naechster!)} abschließen.`);
  const stand = kassenstand(records);
  if (ist !== stand) fehler(`Gezählt ${euroAusCent(ist)}, laut Kassenbuch ${euroAusCent(stand)}. Bitte nachzählen oder die Differenz buchen.`);
  const sturz = kassensturz(records, ist, k);
  return [sturz, {
    format: KASSE_FORMAT, version: 1, id: `${k.id}-abschluss`, art: "abschluss", erfasst: k.jetzt, datum: k.heute,
    monat, endbestand: kassenstand(records, monatsende(monat)),
  }];
}

/* ---------- Monatsansicht und Export ---------- */

export const monatName = (monat: string) => new Date(`${monat}-01T12:00:00`).toLocaleDateString("de-DE", { month: "long", year: "numeric" });

export interface Monatsblatt {
  monat: string;
  anfangsbestand: number;
  zeilen: KassenZeile[];
  einnahmen: number;
  ausgaben: number;
  endbestand: number;
  abschluss?: KasseRecord;
  zaehlungen: KasseRecord[];
}
export function monatsblatt(records: KasseRecord[], monat: string): Monatsblatt {
  const alle = kassenbuch(records);
  // Der Anfangsbestand des Kassenbuchs zählt zum Anfangsbestand seines Monats, nicht zu den Einnahmen.
  const vorher = alle.filter((z) => z.record.datum < `${monat}-01` || (z.record.art === "anfangsbestand" && z.record.datum.startsWith(monat))).reduce((s, z) => s + z.wirkung, 0);
  const zeilen = alle.filter((z) => z.record.datum.startsWith(monat));
  const bewegung = zeilen.filter((z) => z.record.art !== "anfangsbestand");
  const einnahmen = bewegung.filter((z) => z.wirkung > 0).reduce((s, z) => s + z.wirkung, 0);
  const ausgaben = -bewegung.filter((z) => z.wirkung < 0).reduce((s, z) => s + z.wirkung, 0);
  return {
    monat, anfangsbestand: vorher, zeilen, einnahmen, ausgaben, endbestand: vorher + einnahmen - ausgaben,
    abschluss: records.find((r) => r.art === "abschluss" && r.monat === monat),
    zaehlungen: records.filter((r) => r.art === "kassensturz" && r.datum.startsWith(monat)).sort(vergleich),
  };
}

const csvFeld = (v: unknown) => { const s = String(v ?? ""); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const betrag = (c: number) => (c / 100).toFixed(2).replace(".", ",");
/** Kassenbuch eines Monats als CSV (Excel, Semikolon, mit BOM). */
export function kassenbuchCsv(records: KasseRecord[], monat: string) {
  const blatt = monatsblatt(records, monat);
  const byId = new Map(records.map((r) => [r.id, r]));
  const kopf = ["Nr", "Datum", "Art", "Kategorie", "Text", "Händler", "Rechnungsnr", "MwSt %", "Einnahme", "Ausgabe", "Bestand", "Beleg", "Hinweis"];
  const zeilen = blatt.zeilen.map(({ record: r, wirkung: w, bestand, storniert }) => [
    r.nr, datumDe(r.datum), r.art, r.kategorie, r.text, r.haendler, r.rechnungsnr, r.art === "ausgabe" ? r.mwst : "",
    w > 0 && r.art !== "anfangsbestand" ? betrag(w) : "", w < 0 ? betrag(-w) : "", betrag(bestand),
    r.beleg ? r.beleg.fileId : r.eigenbeleg ? "Eigenbeleg" : "",
    [storniert ? "storniert" : "", r.art === "storno" ? `hebt ${byId.get(r.bezug!)?.nr || "?"} auf: ${r.grund}` : ""].filter(Boolean).join(" · "),
  ]);
  const rows = [
    kopf,
    ["", `01.${monat.slice(5)}.${monat.slice(0, 4)}`, "Bestand", "", "Anfangsbestand des Monats", "", "", "", "", "", betrag(blatt.anfangsbestand), "", ""],
    ...zeilen,
    ["", "", "Summe", "", "", "", "", "", betrag(blatt.einnahmen), betrag(blatt.ausgaben), betrag(blatt.endbestand), "", blatt.abschluss ? `abgeschlossen am ${datumDe(blatt.abschluss.datum)}` : "nicht abgeschlossen"],
  ];
  return "﻿" + rows.map((row) => row.map(csvFeld).join(";")).join("\r\n") + "\r\n";
}

/* ---------- Sicherung (Handy → OneDrive → PC) ---------- */

export interface Sicherung { erstellt: string; app?: string; records: KasseRecord[]; belege: Record<string, string> }

/** Belegbilder, die in die Sicherung gehören: offene Monate und der zuletzt abgeschlossene Monat (alle: vollständig). */
export function belegeFuerSicherung(records: KasseRecord[], alle = false) {
  const closed = [...abgeschlosseneMonate(records)].sort();
  const ab = alle || !closed.length ? "" : closed.at(-1)!;
  return [...new Set(records.filter((r) => r.beleg && (alle || r.datum.slice(0, 7) >= ab)).map((r) => r.beleg!.fileId))];
}

export function sicherungText(records: KasseRecord[], belege: Record<string, string>, erstellt: string, app?: string) {
  return JSON.stringify({ format: SICHERUNG_FORMAT, version: 1, erstellt, ...(app ? { app } : {}), records: [...records].sort(vergleich), belege });
}

export function sicherungLesen(textInhalt: string): Sicherung {
  let value: unknown;
  try { value = JSON.parse(textInhalt.replace(/^﻿/, "")); } catch { throw new KassenFehler("Die Datei ist keine Bürokasse-Sicherung (kein lesbarer Inhalt)."); }
  const v = value as Record<string, unknown>;
  if (!v || v.format !== SICHERUNG_FORMAT || v.version !== 1 || !Array.isArray(v.records)) throw new KassenFehler("Die Datei ist keine Bürokasse-Sicherung von SpesenKit.");
  const records: KasseRecord[] = [];
  for (const item of v.records) {
    const record = datensatzLesen(item);
    if (!record) throw new KassenFehler("Die Sicherung enthält einen ungültigen Eintrag und wurde nicht übernommen.");
    records.push(record);
  }
  const belege: Record<string, string> = {};
  if (v.belege && typeof v.belege === "object" && !Array.isArray(v.belege))
    for (const [id, url] of Object.entries(v.belege as Record<string, unknown>)) if (FILE_ID.test(id) && typeof url === "string" && url.startsWith("data:")) belege[id] = url;
  return { erstellt: typeof v.erstellt === "string" ? v.erstellt : "", app: typeof v.app === "string" ? v.app : undefined, records, belege };
}

const vergleichbar = (r: KasseRecord) => JSON.stringify(Object.keys(r).sort().map((k) => [k, (r as unknown as Record<string, unknown>)[k]]));
export interface Zusammenfuehrung { neu: KasseRecord[]; vorhanden: number; konflikte: string[] }
/** Neue Datensätze aus einer Sicherung; vorhandene (gleiche id) werden übersprungen, Abweichungen gemeldet. */
export function zusammenfuehren(lokal: KasseRecord[], eingang: KasseRecord[]): Zusammenfuehrung {
  const byId = new Map(lokal.map((r) => [r.id, r]));
  const byNr = new Map(lokal.filter((r) => r.nr).map((r) => [r.nr!, r]));
  const neu: KasseRecord[] = [], konflikte: string[] = [];
  let vorhanden = 0;
  for (const r of eingang) {
    const da = byId.get(r.id);
    if (da) { vorhanden++; if (vergleichbar(da) !== vergleichbar(r)) konflikte.push(`Eintrag ${r.nr || r.id} weicht vom vorhandenen ab – der vorhandene bleibt.`); continue; }
    const gleicheNr = r.nr ? byNr.get(r.nr) : undefined;
    if (gleicheNr) konflikte.push(`Belegnummer ${r.nr} gibt es zweimal (auf zwei Geräten gebucht?). Bitte prüfen.`);
    neu.push(r); byId.set(r.id, r); if (r.nr) byNr.set(r.nr, r);
  }
  return { neu, vorhanden, konflikte };
}

/** Buchungen, die nach der letzten gesendeten Sicherung erfasst wurden. */
export const ungesichert = (records: KasseRecord[], gesendet?: string) => records.filter((r) => !gesendet || r.erfasst > gesendet);

/** Dateiname im Bürokasse-Ordner. */
export const datensatzDatei = (r: KasseRecord) => `${r.nr || r.datum}_${r.art}_${r.id}.json`;
