"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Camera, ChevronLeft, ChevronRight, Coins, FileDown, FolderOpen, Lock, Plus, Send, Upload, X } from "lucide-react";
import {
  AUSGABE_KATEGORIEN, EINNAHME_KATEGORIEN, KassenFehler, MWST_SAETZE, STUECKELUNG, abschluss, anfang, belegeFuerSicherung,
  centAusEingabe, datumDe, differenzBuchung, euroAusCent, kassenbuchCsv, kassenstand, kassensturz, monatGeschlossen, monatName,
  monatsblatt, naechsterAbschluss, naechsterMonat, neueBuchung, sicherungLesen, sicherungText, storno, ungesichert, vorigerMonat,
  zusammenfuehren, type KasseBeleg, type KasseRecord, type Kontext, type NeuEingabe,
} from "../lib/buerokasse";
import { belegLaden, belegSpeichern, dauerhaftSpeichern, kasseHinzufuegen, kasseLaden, metaLaden, metaSetzen, type KasseMeta } from "../lib/buerokasse-store";
import { kasseOrdner, ordnerBeleg, ordnerLesen, ordnerSchreiben, ordnerZugriff } from "../lib/buerokasse-ordner";
import { readReceiptFile, rotateReceiptImage } from "../lib/receipt-file";
import { receiptDataUrl, receiptFileId } from "../lib/receipt-images";
import { recognizeReceiptLocally } from "../lib/receipt-ocr";
import { today } from "../lib/config";
import type { DirHandleLike } from "../lib/folder-store";
import type { Expense, Settings } from "../lib/types";

/* ---------- Modus: Außendienst · Innendienst · Bürokasse ---------- */

export type Modus = "spesen" | "buerokasse";
const MODUS_KEY = "spesenkit-modus", SICHTBAR_KEY = "spesenkit-buerokasse";
const lesen = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const schreiben = (key: string, value: string | null) => { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* nur Bequemlichkeit */ } };
/** Gibt es auf diesem Gerät schon eine Bürokasse? (ohne die Datenbank dafür anzulegen) */
async function kasseVorhanden() {
  const list = (indexedDB as IDBFactory & { databases?: () => Promise<{ name?: string }[]> }).databases;
  if (!list) return false;
  try { return (await list.call(indexedDB)).some((db) => db.name === "spesenkit-buerokasse"); } catch { return false; }
}

/** Modus und Sichtbarkeit der Bürokasse gelten je Gerät (Browser) – der persönliche SpesenKit-Bestand bleibt unberührt. */
export function useKasseModus() {
  const [sichtbar, setSichtbarState] = useState(() => lesen(SICHTBAR_KEY) === "1");
  const [modus, setModusState] = useState<Modus>(() => lesen(SICHTBAR_KEY) === "1" && lesen(MODUS_KEY) === "buerokasse" ? "buerokasse" : "spesen");
  useEffect(() => {
    if (sichtbar) return;
    void kasseVorhanden().then((da) => { if (da) { setSichtbarState(true); if (lesen(MODUS_KEY) === "buerokasse") setModusState("buerokasse"); } });
  }, [sichtbar]);
  const setModus = useCallback((next: Modus) => { setModusState(next); schreiben(MODUS_KEY, next); }, []);
  const setSichtbar = useCallback((next: boolean) => {
    setSichtbarState(next); schreiben(SICHTBAR_KEY, next ? "1" : null);
    if (!next) { setModusState("spesen"); schreiben(MODUS_KEY, "spesen"); }
  }, []);
  return { modus: sichtbar ? modus : "spesen" as Modus, setModus, sichtbar, setSichtbar };
}

export type ModusWahl = "aussendienst" | "innendienst" | "buerokasse";
export function ModusChip({ staffRole, modus, kasse, onWahl }: { staffRole: Settings["staffRole"]; modus: Modus; kasse: boolean; onWahl: (wahl: ModusWahl) => void }) {
  const aktiv: ModusWahl = modus === "buerokasse" ? "buerokasse" : staffRole;
  const optionen: [ModusWahl, string][] = [["aussendienst", "Außendienst"], ["innendienst", "Innendienst"], ...(kasse ? [["buerokasse", "Bürokasse"] as [ModusWahl, string]] : [])];
  return <div className="modus-chip" role="radiogroup" aria-label="Arbeitsbereich">
    {optionen.map(([wert, label]) => <button key={wert} type="button" role="radio" aria-checked={aktiv === wert} className={aktiv === wert ? "aktiv" : ""} onClick={() => aktiv !== wert && onWahl(wert)}>{label}</button>)}
  </div>;
}

/* ---------- Hilfen ---------- */

const uid = () => typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `bk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const kontext = (): Kontext => ({ id: uid(), jetzt: new Date().toISOString(), heute: today() });
const fehlerText = (error: unknown) => error instanceof KassenFehler || error instanceof Error ? error.message : "Unbekannter Fehler.";
const betragText = (cent: number) => (cent / 100).toFixed(2).replace(".", ",");
const herunterladen = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};
type PickerWindow = Window & { showDirectoryPicker?: (options?: { mode?: "readwrite"; id?: string }) => Promise<DirHandleLike> };
const ordnerMoeglich = () => typeof window !== "undefined" && typeof (window as PickerWindow).showDirectoryPicker === "function";
const tageSeit = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 864e5);

function Fenster({ titel, schliessen, children }: { titel: string; schliessen: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop kasse-fenster" onMouseDown={(e) => { if (e.target === e.currentTarget) schliessen(); }}>
    <div className="modal" role="dialog" aria-label={titel}>
      <header><h2>{titel}</h2><button className="icon" onClick={schliessen} aria-label="Schließen"><X /></button></header>
      <div className="modal-body">{children}</div>
    </div>
  </div>;
}

function BetragFeld({ label, wert, setWert, autoFocus }: { label: string; wert: string; setWert: (v: string) => void; autoFocus?: boolean }) {
  return <label className="kasse-betrag">{label}<span><input inputMode="decimal" autoComplete="off" value={wert} autoFocus={autoFocus} placeholder="0,00" onChange={(e) => setWert(e.target.value)} /><b>€</b></span></label>;
}

function Zaehlhilfe({ anzahl, setAnzahl }: { anzahl: Record<string, number>; setAnzahl: (a: Record<string, number>) => void }) {
  return <details className="kasse-zaehlhilfe"><summary>Zählhilfe: Scheine und Münzen einzeln eingeben</summary>
    <div>{STUECKELUNG.map((wert) => <label key={wert}><span>{wert >= 100 ? `${wert / 100} €` : `${wert} ct`}</span>
      <input inputMode="numeric" value={anzahl[wert] || ""} placeholder="0" aria-label={`Anzahl ${wert >= 100 ? `${wert / 100} Euro` : `${wert} Cent`}`}
        onChange={(e) => { const n = Math.max(0, Math.min(99999, Math.floor(Number(e.target.value.replace(/\D/g, "")) || 0))); setAnzahl({ ...anzahl, [wert]: n }); }} />
    </label>)}</div>
  </details>;
}
const zaehlSumme = (anzahl: Record<string, number>) => Object.entries(anzahl).reduce((s, [wert, n]) => s + Number(wert) * n, 0);

/* ---------- Bürokasse ---------- */

export interface KostenUebernahme { kosten: Expense[]; uebernommen: (ids: string[]) => void }

export function Buerokasse({ appVersion, notify, uebernahme }: { appVersion: string; notify: (text: string) => void; uebernahme?: KostenUebernahme }) {
  const [records, setRecords] = useState<KasseRecord[] | null>(null);
  const [meta, setMeta] = useState<KasseMeta>({});
  const [ladefehler, setLadefehler] = useState("");
  const [monat, setMonat] = useState(() => today().slice(0, 7));
  const [fenster, setFenster] = useState<null | { art: "ausgabe" | "einnahme" | "zaehlen" | "uebernahme" } | { art: "abschluss"; monat: string } | { art: "detail"; id: string }>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const neuLaden = useCallback(async () => {
    try { const [r, m] = await Promise.all([kasseLaden(), metaLaden()]); setRecords(r); setMeta(m); setLadefehler(""); }
    catch (error) { setLadefehler(`Die Bürokasse konnte nicht geladen werden. ${fehlerText(error)}`); }
  }, []);
  useEffect(() => { void neuLaden(); }, [neuLaden]);

  /** Eine Aktion zur Zeit; Fehler werden angezeigt, nichts wird halb gespeichert. */
  const ausfuehren = async (aktion: () => Promise<string | void>) => {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true);
    try { const text = await aktion(); if (text) notify(text); return true; }
    catch (error) { notify(fehlerText(error)); return false; }
    finally { busyRef.current = false; setBusy(false); }
  };

  /** Belegbild aus Browser oder (am PC) aus dem Bürokasse-Ordner. */
  const beleg = useCallback(async (fileId: string) => {
    const lokal = await belegLaden(fileId).catch(() => "");
    if (lokal || !meta.ordner) return lokal;
    if (!(await ordnerZugriff(meta.ordner, false).catch(() => false))) return "";
    return ordnerBeleg(meta.ordner, fileId);
  }, [meta.ordner]);

  /** Am PC: alles Fehlende im Bürokasse-Ordner ablegen. */
  const ablegen = async (alle: KasseRecord[], fragen: boolean) => {
    if (!meta.ordner) return "";
    if (!(await ordnerZugriff(meta.ordner, fragen))) return fragen ? " Kein Zugriff auf den Bürokasse-Ordner – bitte erneut versuchen und den Zugriff erlauben." : "";
    const bericht = await ordnerSchreiben(meta.ordner, alle, beleg, (m) => kassenbuchPdfDatei(alle, m));
    return ` Im Ordner abgelegt: ${bericht.buchungen} Einträge, ${bericht.belege} Belege${bericht.ablage.length ? `, ${bericht.ablage.join(", ")}` : ""}.${bericht.fehlendeBelege ? ` ${bericht.fehlendeBelege} Belegbild(er) fehlen noch – bitte eine vollständige Sicherung vom Handy übernehmen.` : ""}`;
  };
  const kassenbuchPdfDatei = async (alle: KasseRecord[], m: string) => (await import("../lib/buerokasse-pdf")).kassenbuchPdf(alle, m, beleg, appVersion);

  /** Neue Datensätze speichern (Bilder zuerst). */
  const speichern = async (neu: KasseRecord[], bilder: Record<string, string> = {}, ablage = true) => {
    for (const [fileId, dataUrl] of Object.entries(bilder)) await belegSpeichern(fileId, dataUrl);
    await kasseHinzufuegen(neu);
    const alle = await kasseLaden();
    setRecords(alle);
    // Am PC gleich im Ordner ablegen (ohne Nachfrage; beim Übernehmen legt der Aufrufer selbst ab).
    if (ablage && meta.ordner) void ablegen(alle, false).catch(() => undefined);
    return alle;
  };

  if (ladefehler) return <section className="card kasse"><p role="alert">{ladefehler}</p><button className="primary" onClick={() => void neuLaden()}>Erneut versuchen</button></section>;
  if (!records) return <section className="card kasse"><p>Bürokasse wird geladen …</p></section>;

  const start = anfang(records);
  const buchen = !!start && meta.buchungsgeraet === true;
  const stand = kassenstand(records);
  const blatt = monatsblatt(records, monat);
  const naechster = naechsterAbschluss(records, today());
  const offen = ungesichert(records, meta.gesendet);
  const heuteMonat = today().slice(0, 7);

  const importieren = (file?: File | null) => file && ausfuehren(async () => {
    const sicherung = sicherungLesen(await file.text());
    const ergebnis = zusammenfuehren(records, sicherung.records);
    const bilder: Record<string, string> = {};
    for (const [fileId, dataUrl] of Object.entries(sicherung.belege)) if (receiptFileId(dataUrl) === fileId) bilder[fileId] = dataUrl;
    const alle = await speichern(ergebnis.neu, bilder, false);
    const ordner = meta.ordner ? await ablegen(alle, true) : "";
    const tipp = !meta.ordner && ordnerMoeglich() ? " Tipp: „Bürokasse-Ordner wählen“, dann wird alles auf dem Laufwerk abgelegt." : "";
    return `${ergebnis.neu.length} neue Einträge übernommen, ${ergebnis.vorhanden} waren schon da.${ordner}${tipp}${ergebnis.konflikte.length ? ` Achtung: ${ergebnis.konflikte.join(" ")}` : ""}`;
  });

  const ordnerVerbinden = () => ausfuehren(async () => {
    let gewaehlt: DirHandleLike;
    try { gewaehlt = await (window as PickerWindow).showDirectoryPicker!({ mode: "readwrite", id: "spesenkit-buerokasse" }); }
    catch { return "Kein Ordner gewählt."; }
    const root = await kasseOrdner(gewaehlt);
    await metaSetzen("ordner", root);
    const gelesen = await ordnerLesen(root);
    const ergebnis = zusammenfuehren(records, gelesen.records);
    await kasseHinzufuegen(ergebnis.neu);
    const alle = await kasseLaden();
    setRecords(alle); setMeta((m) => ({ ...m, ordner: root }));
    const bericht = await ordnerSchreiben(root, alle, async (id) => (await belegLaden(id)) || ordnerBeleg(root, id), async (m) => (await import("../lib/buerokasse-pdf")).kassenbuchPdf(alle, m, async (id) => (await belegLaden(id)) || ordnerBeleg(root, id), appVersion));
    return `Bürokasse-Ordner „${root.name}“ verbunden. ${ergebnis.neu.length} Einträge aus dem Ordner gelesen, ${bericht.buchungen} Einträge und ${bericht.belege} Belege abgelegt.${gelesen.ungueltig ? ` ${gelesen.ungueltig} Datei(en) im Ordner sind keine gültigen Einträge und wurden übersprungen.` : ""}`;
  });

  const senden = (alleBelege = false) => ausfuehren(async () => {
    const stichtag = new Date().toISOString();
    const belege: Record<string, string> = {};
    let fehlen = 0;
    for (const fileId of belegeFuerSicherung(records, alleBelege)) { const url = await belegLaden(fileId); if (url) belege[fileId] = url; else fehlen++; }
    const jetzt = new Date();
    const name = `Buerokasse-Sicherung_${today()}_${String(jetzt.getHours()).padStart(2, "0")}${String(jetzt.getMinutes()).padStart(2, "0")}.txt`;
    const file = new File([sicherungText(records, belege, stichtag, appVersion)], name, { type: "text/plain" });
    const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean; share?: (data: { files: File[]; title?: string }) => Promise<void> };
    let geteilt = false;
    if (nav.canShare?.({ files: [file] }) && nav.share) {
      try { await nav.share({ files: [file], title: "Bürokasse-Sicherung" }); geteilt = true; }
      catch (error) {
        if ((error as { name?: string })?.name === "AbortError") return "Nicht gesendet – die Sicherung wurde abgebrochen.";
        geteilt = false;
      }
    }
    if (!geteilt) herunterladen(file, name);
    await metaSetzen("gesendet", stichtag);
    setMeta((m) => ({ ...m, gesendet: stichtag }));
    return `${geteilt ? "Sicherung gesendet." : `Sicherung „${name}“ heruntergeladen – bitte in OneDrive speichern.`}${fehlen ? ` ${fehlen} Belegbild(er) fehlen auf diesem Gerät.` : ""}`;
  });

  const exportieren = (art: "pdf" | "csv") => ausfuehren(async () => {
    if (art === "csv") herunterladen(new Blob([kassenbuchCsv(records, monat)], { type: "text/csv;charset=utf-8" }), `Kassenbuch_${monat}.csv`);
    else herunterladen(await kassenbuchPdfDatei(records, monat), `Kassenbuch_${monat}.pdf`);
  });

  /* ----- Start: noch kein Kassenbuch ----- */
  if (!start) return <section className="card kasse kasse-start" aria-label="Bürokasse einrichten">
    <h2>Bürokasse einrichten</h2>
    <p className="muted">Das Kassenbuch der Büro-Barkasse. Auf dem Handy: Beleg fotografieren, Betrag wird gelesen, fertig. Alles bleibt auf diesem Gerät, bis du die Sicherung sendest.</p>
    <StartFormular busy={busy} beginnen={(datum, cent, zaehlung) => ausfuehren(async () => {
      const k = kontext();
      const record = neueBuchung(records, { art: "anfangsbestand", datum, cent, text: "Anfangsbestand (gezählt)" }, k);
      const sturz = { ...kassensturz([record], cent, { ...k, id: uid() }, zaehlung) };
      await metaSetzen("buchungsgeraet", true);
      setMeta((m) => ({ ...m, buchungsgeraet: true }));
      await speichern([record, sturz]);
      await dauerhaftSpeichern();
      setMonat(datum.slice(0, 7));
      return `Kassenbuch beginnt am ${datumDe(datum)} mit ${euroAusCent(cent)}.`;
    })} />
    <div className="kasse-start-weitere">
      <label className="ghost kasse-datei">
        <Upload size={18} /> Sicherung einspielen (neues Handy oder PC)
        <input type="file" accept=".txt,.json,text/plain,application/json" onChange={(e) => { void importieren(e.target.files?.[0]); e.target.value = ""; }} />
      </label>
      {ordnerMoeglich() && <button className="ghost" disabled={busy} onClick={() => void ordnerVerbinden()}><FolderOpen size={18} /> Bürokasse-Ordner auf dem Laufwerk öffnen</button>}
    </div>
  </section>;

  /* ----- Kassenbuch ----- */
  const sicherungsStatus = !offen.length ? { klasse: "ok", text: meta.gesendet ? `Alles gesichert (zuletzt ${datumDe(meta.gesendet.slice(0, 10))})` : "Alles gesichert" }
    : tageSeit(offen.map((r) => r.erfasst).sort()[0]) >= 3 ? { klasse: "alarm", text: `${offen.length} Einträge seit ${tageSeit(offen.map((r) => r.erfasst).sort()[0])} Tagen nicht gesichert – bitte jetzt senden` }
    : { klasse: "warn", text: `${offen.length} ${offen.length === 1 ? "Eintrag" : "Einträge"} noch nicht gesichert` };
  const kandidaten = (uebernahme?.kosten || []).filter((e) => !records.some((r) => r.quelle === e.id) && e.date >= start.datum && !monatGeschlossen(records, e.date.slice(0, 7)));

  return <section className="kasse" aria-label="Bürokasse">
    {!buchen && <div className="notice kasse-nurlesen"><div><b>Nur Ansicht und Ablage</b><p>Gebucht wird auf dem Gerät, auf dem das Kassenbuch begonnen wurde (dem Handy). Hier: übernehmen, ablegen, drucken.</p></div>
      <button className="ghost" disabled={busy} onClick={() => { if (window.confirm("Ab jetzt auf diesem Gerät buchen (z. B. neues Handy)? Danach bitte auf dem alten Gerät nicht mehr buchen – sonst gibt es Belegnummern doppelt.")) void ausfuehren(async () => { await metaSetzen("buchungsgeraet", true); setMeta((m) => ({ ...m, buchungsgeraet: true })); return "Auf diesem Gerät wird jetzt gebucht."; }); }}>Hier weiterbuchen</button></div>}

    <div className="card kasse-kopf">
      <div className="kasse-stand"><span>In der Kasse laut Kassenbuch</span><strong data-testid="kassenstand">{euroAusCent(stand)}</strong></div>
      {buchen && <div className={`kasse-sicherung ${sicherungsStatus.klasse}`} role="status">{sicherungsStatus.text}</div>}
      {buchen && <div className="kasse-knoepfe">
        <button className="primary kasse-gross" disabled={busy} onClick={() => setFenster({ art: "ausgabe" })}><Camera size={24} /> Ausgabe mit Beleg</button>
        <button className="ghost kasse-gross" disabled={busy} onClick={() => setFenster({ art: "einnahme" })}><Plus size={22} /> Einnahme</button>
        <button className="ghost kasse-gross" disabled={busy} onClick={() => setFenster({ art: "zaehlen" })}><Coins size={22} /> Kasse zählen</button>
      </div>}
      {buchen && kandidaten.length > 0 && <button className="link kasse-uebernahme" onClick={() => setFenster({ art: "uebernahme" })}>{kandidaten.length} Kosten aus „Innendienst/Außendienst“ in die Bürokasse übernehmen …</button>}
    </div>

    <div className="card kasse-monat">
      <header>
        <button className="icon" aria-label="Voriger Monat" onClick={() => setMonat(vorigerMonat(monat))} disabled={monat <= start.datum.slice(0, 7)}><ChevronLeft /></button>
        <h2>{monatName(monat)}</h2>
        <button className="icon" aria-label="Nächster Monat" onClick={() => setMonat(naechsterMonat(monat))} disabled={monat >= heuteMonat}><ChevronRight /></button>
        <span className={`status-pill ${blatt.abschluss ? "month-closed" : ""}`}>{blatt.abschluss ? <><Lock size={13} /> abgeschlossen</> : "offen"}</span>
      </header>
      <dl className="kasse-summen">
        <div><dt>Anfangsbestand</dt><dd>{euroAusCent(blatt.anfangsbestand)}</dd></div>
        <div><dt>Einnahmen</dt><dd>+ {euroAusCent(blatt.einnahmen)}</dd></div>
        <div><dt>Ausgaben</dt><dd>− {euroAusCent(blatt.ausgaben)}</dd></div>
        <div><dt>Ende</dt><dd><b>{euroAusCent(blatt.endbestand)}</b></dd></div>
      </dl>
      {blatt.zeilen.length ? <ol className="kasse-liste" aria-label="Buchungen">
        {[...blatt.zeilen].reverse().map(({ record: r, wirkung, bestand, storniert }) => <li key={r.id}>
          <button className={`kasse-zeile ${storniert ? "storniert" : ""} ${r.art}`} onClick={() => setFenster({ art: "detail", id: r.id })}>
            <span className="kasse-zeile-text"><b>{r.art === "anfangsbestand" ? "Anfangsbestand" : r.art === "storno" ? "Storno" : r.kategorie}</b><small>{r.nr} · {datumDe(r.datum)}{r.text || r.haendler ? ` · ${r.haendler || r.text}` : ""}{storniert ? " · storniert" : ""}{!r.beleg && r.art === "ausgabe" ? " · Eigenbeleg" : ""}</small></span>
            <span className="kasse-zeile-betrag"><b className={wirkung < 0 ? "minus" : "plus"}>{wirkung < 0 ? "−" : "+"} {euroAusCent(Math.abs(wirkung))}</b><small>Bestand {euroAusCent(bestand)}</small></span>
          </button>
        </li>)}
      </ol> : <p className="muted">Keine Buchungen in diesem Monat.</p>}
      {blatt.zaehlungen.length > 0 && <p className="muted kasse-zaehlungen">{blatt.zaehlungen.map((z) => `Gezählt am ${datumDe(z.datum)}: ${euroAusCent(z.ist!)}${z.ist === z.soll ? " ✓" : ` (Kassenbuch ${euroAusCent(z.soll!)})`}`).join(" · ")}</p>}
      <footer>
        {buchen && naechster === monat && <button className="primary" disabled={busy} onClick={() => setFenster({ art: "abschluss", monat })}><Lock size={17} /> {monatName(monat)} abschließen</button>}
        <button className="ghost" disabled={busy} onClick={() => void exportieren("pdf")}><FileDown size={17} /> Kassenbuch als PDF</button>
        <button className="ghost" disabled={busy} onClick={() => void exportieren("csv")}><FileDown size={17} /> Excel (CSV)</button>
      </footer>
    </div>

    <div className="card kasse-sichern">
      <h3>Sicherung</h3>
      {buchen ? <>
        <p className="muted">Auf dem Handy liegt das Kassenbuch nur im Browser. Bitte regelmäßig senden: „Sicherung senden“ → <b>OneDrive</b> wählen → speichern. Am PC dann „Vom Handy übernehmen“. Doppelt senden schadet nicht.</p>
        <button className="primary kasse-gross" disabled={busy} onClick={() => void senden()}><Send size={20} /> Sicherung senden</button>
        <button className="link" disabled={busy} onClick={() => void senden(true)}>Vollständige Sicherung mit allen Belegbildern senden</button>
      </> : <p className="muted">Sicherungen vom Handy hier einspielen.</p>}
      <label className="ghost kasse-datei">
        <Upload size={18} /> {ordnerMoeglich() ? "Vom Handy übernehmen" : "Sicherung einspielen"}
        <input type="file" accept=".txt,.json,text/plain,application/json" onChange={(e) => { void importieren(e.target.files?.[0]); e.target.value = ""; }} />
      </label>
      {ordnerMoeglich() && <div className="kasse-ordner">
        <p>{meta.ordner ? <>Ablage auf dem Laufwerk: <b>{meta.ordner.name}</b> – Einträge, Belege und abgeschlossene Monate werden dort automatisch abgelegt.</> : "Noch kein Bürokasse-Ordner auf dem Laufwerk verbunden."}</p>
        <button className="ghost" disabled={busy} onClick={() => void ordnerVerbinden()}><FolderOpen size={17} /> {meta.ordner ? "Anderen Ordner wählen" : "Bürokasse-Ordner wählen"}</button>
        {meta.ordner && <button className="ghost" disabled={busy} onClick={() => void ausfuehren(async () => `Abgleich fertig.${await ablegen(records, true)}`)}>Jetzt ablegen</button>}
      </div>}
    </div>

    {fenster?.art === "ausgabe" && <BuchungFenster art="ausgabe" records={records} busy={busy} schliessen={() => setFenster(null)}
      buchen={(eingabe, bild) => ausfuehren(async () => {
        const record = neueBuchung(records, eingabe, kontext());
        await speichern([record], bild ? { [bild.fileId]: bild.dataUrl } : {});
        setFenster(null); setMonat(record.datum.slice(0, 7));
        return `Ausgabe ${record.nr} gebucht: ${euroAusCent(record.cent!)}.`;
      })} />}
    {fenster?.art === "einnahme" && <BuchungFenster art="einnahme" records={records} busy={busy} schliessen={() => setFenster(null)}
      buchen={(eingabe, bild) => ausfuehren(async () => {
        const record = neueBuchung(records, eingabe, kontext());
        await speichern([record], bild ? { [bild.fileId]: bild.dataUrl } : {});
        setFenster(null); setMonat(record.datum.slice(0, 7));
        return `Einnahme ${record.nr} gebucht: ${euroAusCent(record.cent!)}.`;
      })} />}
    {(fenster?.art === "zaehlen" || fenster?.art === "abschluss") && <ZaehlFenster records={records} busy={busy} abschlussMonat={fenster.art === "abschluss" ? fenster.monat : undefined}
      schliessen={() => setFenster(null)}
      speichernZaehlung={(ist, zaehlung, differenz) => ausfuehren(async () => {
        const k = kontext();
        const sturz = kassensturz(records, ist, k, zaehlung);
        const diff = differenz ? differenzBuchung([...records, sturz], ist, { ...kontext() }) : null;
        await speichern(diff ? [sturz, diff] : [sturz]);
        setFenster(null);
        return diff ? `Gezählt ${euroAusCent(ist)} – Differenz als ${diff.nr} gebucht.` : `Zählung gespeichert: ${euroAusCent(ist)}${ist === sturz.soll ? " – stimmt." : "."}`;
      })}
      abschliessen={(m, ist, zaehlung) => ausfuehren(async () => {
        const diff = differenzBuchung(records, ist, kontext());
        const basis = diff ? [...records, diff] : records;
        const [sturz, schluss] = abschluss(basis, m, ist, kontext());
        await speichern([...(diff ? [diff] : []), zaehlung ? { ...sturz, zaehlung: Object.fromEntries(Object.entries(zaehlung).filter(([, n]) => n > 0)) } : sturz, schluss]);
        setFenster(null);
        return `${monatName(m)} abgeschlossen. Endbestand ${euroAusCent(schluss.endbestand!)}.${buchen ? " Bitte jetzt die Sicherung senden." : ""}`;
      })} />}
    {fenster?.art === "detail" && (() => {
      const record = records.find((r) => r.id === fenster.id);
      return record ? <DetailFenster record={record} records={records} buchen={buchen} busy={busy} beleg={beleg} schliessen={() => setFenster(null)}
        stornieren={(grund) => ausfuehren(async () => {
          const s = storno(records, record.id, grund, kontext());
          await speichern([s]);
          setFenster(null);
          return `${record.nr} storniert (Gegenbuchung ${s.nr}).`;
        })} /> : null;
    })()}
    {fenster?.art === "uebernahme" && uebernahme && <UebernahmeFenster kosten={kandidaten} busy={busy} schliessen={() => setFenster(null)}
      uebernehmen={(ids) => ausfuehren(async () => {
        let alle = records;
        const neu: KasseRecord[] = [], bilder: Record<string, string> = {}, fertig: string[] = [];
        const auswahl = kandidaten.filter((e) => ids.includes(e.id)).sort((a, b) => a.date.localeCompare(b.date));
        let problem = "";
        for (const kosten of auswahl) {
          let bild: { fileId: string; dataUrl: string; beleg: KasseBeleg } | undefined;
          if (kosten.receipt) {
            const dataUrl = await receiptDataUrl(kosten.receipt).catch(() => "");
            const fileId = dataUrl ? receiptFileId(dataUrl) : null;
            if (fileId) bild = { fileId, dataUrl, beleg: { fileId, name: kosten.receipt.name, type: kosten.receipt.type, size: kosten.receipt.size } };
          }
          try {
            const record = neueBuchung(alle, {
              art: "ausgabe", datum: kosten.date, cent: Math.round(kosten.gross * (kosten.exchangeRate || 1) * 100),
              kategorie: AUSGABE_KATEGORIEN.includes(kosten.category) ? kosten.category : "Sonstiges",
              text: [kosten.category, kosten.description].filter((t, i, a) => t && a.indexOf(t) === i).join(" · ") || undefined,
              haendler: kosten.merchant, mwst: kosten.vatRate, rechnungsnr: kosten.invoiceNumber,
              beleg: bild?.beleg, eigenbeleg: !bild, quelle: kosten.id,
            }, kontext());
            alle = [...alle, record]; neu.push(record); fertig.push(kosten.id);
            if (bild) bilder[bild.fileId] = bild.dataUrl;
          } catch (error) { problem = `${datumDe(kosten.date)} ${euroAusCent(Math.round(kosten.gross * 100))}: ${fehlerText(error)}`; break; }
        }
        if (neu.length) { await speichern(neu, bilder); uebernahme.uebernommen(fertig); }
        setFenster(null);
        return `${neu.length} Kosten in die Bürokasse übernommen.${problem ? ` Gestoppt bei ${problem}` : ""}`;
      })} />}
  </section>;
}

/* ---------- Fenster ---------- */

function StartFormular({ busy, beginnen }: { busy: boolean; beginnen: (datum: string, cent: number, zaehlung?: Record<string, number>) => void }) {
  const [datum, setDatum] = useState(today());
  const [betrag, setBetrag] = useState("");
  const [anzahl, setAnzahl] = useState<Record<string, number>>({});
  const summe = zaehlSumme(anzahl);
  useEffect(() => { if (summe) setBetrag(betragText(summe)); }, [summe]);
  const cent = centAusEingabe(betrag);
  return <form className="kasse-formular" onSubmit={(e) => { e.preventDefault(); if (cent !== null) beginnen(datum, cent, summe ? anzahl : undefined); }}>
    <label>Kassenbuch beginnt am<input type="date" value={datum} max={today()} onChange={(e) => setDatum(e.target.value)} /></label>
    <BetragFeld label="Geld in der Kasse (gezählt)" wert={betrag} setWert={setBetrag} />
    <Zaehlhilfe anzahl={anzahl} setAnzahl={setAnzahl} />
    <button className="primary kasse-gross" disabled={busy || cent === null}>Kassenbuch beginnen</button>
  </form>;
}

type Bild = { fileId: string; dataUrl: string };

function BuchungFenster({ art, records, busy, schliessen, buchen }: {
  art: "ausgabe" | "einnahme"; records: KasseRecord[]; busy: boolean; schliessen: () => void;
  buchen: (eingabe: NeuEingabe, bild?: Bild) => void;
}) {
  const ausgabe = art === "ausgabe";
  const [datum, setDatum] = useState(today());
  const [betrag, setBetrag] = useState("");
  const [kategorie, setKategorie] = useState(ausgabe ? "" : "Bankabhebung");
  const [haendler, setHaendler] = useState("");
  const [text, setText] = useState("");
  const [mwst, setMwst] = useState(19);
  const [rechnungsnr, setRechnungsnr] = useState("");
  const [ohneBeleg, setOhneBeleg] = useState(false);
  const [bild, setBild] = useState<(Bild & { name: string; type: string; size: number }) | null>(null);
  const [lesen, setLesen] = useState("");
  const revision = useRef(0);
  const geaendert = useRef(new Set<string>());
  const setze = <T,>(feld: string, setter: (v: T) => void) => (v: T) => { geaendert.current.add(feld); setter(v); };
  useEffect(() => () => { revision.current++; }, []);

  const datei = async (file?: File) => {
    if (!file) return;
    const rev = ++revision.current;
    setLesen("Foto wird vorbereitet …");
    try {
      const gelesen = await readReceiptFile(file);
      const fileId = receiptFileId(gelesen.dataUrl);
      if (rev !== revision.current) return;
      if (!fileId) throw new Error("Bild nicht lesbar");
      setBild({ fileId, dataUrl: gelesen.dataUrl, name: gelesen.name, type: gelesen.type, size: gelesen.size }); setOhneBeleg(false);
      if (!/^image\/(jpeg|jpg|png|webp)$/i.test(gelesen.type)) { setLesen(""); return; }
      setLesen("Beleg wird gelesen …");
      const erkannt = await recognizeReceiptLocally(gelesen.dataUrl, (p) => { if (rev === revision.current) setLesen(`Beleg wird gelesen … ${p} %`); });
      if (rev !== revision.current) return;
      const frei = (feld: string) => !geaendert.current.has(feld);
      if (frei("datum") && erkannt.date && erkannt.date <= today()) setDatum(erkannt.date);
      if (frei("betrag") && erkannt.gross && erkannt.gross > 0) setBetrag(betragText(Math.round(erkannt.gross * 100)));
      if (frei("haendler") && erkannt.merchant) setHaendler(erkannt.merchant);
      if (frei("mwst") && erkannt.vatRate !== undefined && MWST_SAETZE.includes(erkannt.vatRate)) setMwst(erkannt.vatRate);
      if (frei("rechnungsnr") && erkannt.invoiceNumber) setRechnungsnr(erkannt.invoiceNumber);
      // Gleicher Händler wie früher: dieselbe Kategorie vorschlagen.
      const frueher = erkannt.merchant && [...records].reverse().find((r) => r.art === art && r.haendler && r.haendler.toLowerCase() === erkannt.merchant!.toLowerCase());
      if (frei("kategorie") && frueher && frueher.kategorie) setKategorie(frueher.kategorie);
      if (erkannt.rotation) {
        const gedreht = await rotateReceiptImage(gelesen.dataUrl, erkannt.rotation);
        const id = gedreht && receiptFileId(gedreht.dataUrl);
        if (gedreht && id && rev === revision.current) setBild({ fileId: id, dataUrl: gedreht.dataUrl, name: gelesen.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg", type: "image/jpeg", size: gedreht.size });
      }
      if (rev === revision.current) setLesen("");
    } catch {
      if (rev === revision.current) setLesen("Automatisches Lesen nicht möglich – bitte Betrag und Datum eintippen.");
    }
  };

  const cent = centAusEingabe(betrag);
  const liest = /…/.test(lesen);
  const absenden = () => {
    if (cent === null) return;
    buchen({
      art, datum, cent, kategorie, text: text || undefined, haendler: haendler || undefined, ...(ausgabe ? { mwst } : {}),
      rechnungsnr: rechnungsnr || undefined, eigenbeleg: ausgabe && ohneBeleg && !bild,
      beleg: bild ? { fileId: bild.fileId, name: bild.name, type: bild.type, size: bild.size } : undefined,
    }, bild || undefined);
  };
  const kategorien = ausgabe ? AUSGABE_KATEGORIEN : EINNAHME_KATEGORIEN;
  return <Fenster titel={ausgabe ? "Ausgabe buchen" : "Einnahme buchen"} schliessen={schliessen}>
    <form className="kasse-formular" onSubmit={(e) => { e.preventDefault(); absenden(); }}>
      {bild ? <div className="kasse-foto">
        {bild.type.startsWith("image/") && !/heic/i.test(bild.type) ? <img src={bild.dataUrl} alt="Belegfoto" /> : <p>{bild.name}</p>}
        <label className="ghost">Neu fotografieren<input type="file" accept="image/*,.pdf" capture="environment" aria-label="Neu fotografieren" onChange={(e) => void datei(e.target.files?.[0])} /></label>
      </div> : !ohneBeleg && <label className="kasse-kamera">
        <Camera size={40} /><b>{ausgabe ? "Beleg fotografieren" : "Beleg fotografieren (wenn vorhanden)"}</b><small>Betrag und Datum werden gelesen</small>
        <input type="file" accept="image/*,.pdf" capture="environment" aria-label="Beleg fotografieren" onChange={(e) => void datei(e.target.files?.[0])} />
      </label>}
      {lesen && <p className={liest ? "kasse-lesen" : "info-box yellow"} role="status">{lesen}</p>}
      <BetragFeld label="Betrag" wert={betrag} setWert={setze("betrag", setBetrag)} />
      <label>Datum<input type="date" value={datum} max={today()} onChange={(e) => setze("datum", setDatum)(e.target.value)} /></label>
      <label>{ausgabe ? "Wofür?" : "Woher?"}<select value={kategorie} onChange={(e) => setze("kategorie", setKategorie)(e.target.value)}>
        {ausgabe && <option value="">– bitte wählen –</option>}
        {kategorien.map((k) => <option key={k}>{k}</option>)}
      </select></label>
      {ausgabe && <label>Geschäft<input value={haendler} onChange={(e) => setze("haendler", setHaendler)(e.target.value)} placeholder="z. B. Deutsche Post" /></label>}
      <label>{ausgabe && ohneBeleg && !bild ? "Wofür genau? (Pflicht ohne Beleg)" : "Notiz (freiwillig)"}<input value={text} onChange={(e) => setText(e.target.value)} /></label>
      {ausgabe && !bild && <label className="kasse-check"><input type="checkbox" checked={ohneBeleg} onChange={(e) => setOhneBeleg(e.target.checked)} /> Kein Beleg vorhanden (Eigenbeleg)</label>}
      {ausgabe && <details className="kasse-mehr"><summary>Mehr Angaben (MwSt, Rechnungsnummer)</summary>
        <label>MwSt<select value={mwst} onChange={(e) => setze("mwst", setMwst)(Number(e.target.value))}>{MWST_SAETZE.map((s) => <option key={s} value={s}>{s} %</option>)}</select></label>
        <label>Rechnungsnummer<input value={rechnungsnr} onChange={(e) => setze("rechnungsnr", setRechnungsnr)(e.target.value)} /></label>
      </details>}
      <footer>
        <button type="button" className="ghost" onClick={schliessen}>Abbrechen</button>
        <button className="primary kasse-gross" disabled={busy || liest || cent === null || !cent || (ausgabe && !kategorie) || (ausgabe && !bild && !ohneBeleg)}>{ausgabe ? "Ausgabe buchen" : "Einnahme buchen"}</button>
      </footer>
    </form>
  </Fenster>;
}

function ZaehlFenster({ records, busy, abschlussMonat, schliessen, speichernZaehlung, abschliessen }: {
  records: KasseRecord[]; busy: boolean; abschlussMonat?: string; schliessen: () => void;
  speichernZaehlung: (ist: number, zaehlung: Record<string, number> | undefined, differenzBuchen: boolean) => void;
  abschliessen: (monat: string, ist: number, zaehlung?: Record<string, number>) => void;
}) {
  const [betrag, setBetrag] = useState("");
  const [anzahl, setAnzahl] = useState<Record<string, number>>({});
  const summe = zaehlSumme(anzahl);
  useEffect(() => { if (summe) setBetrag(betragText(summe)); }, [summe]);
  const ist = centAusEingabe(betrag);
  const soll = kassenstand(records);
  const diff = ist === null ? 0 : ist - soll;
  const laufend = abschlussMonat && abschlussMonat === today().slice(0, 7);
  return <Fenster titel={abschlussMonat ? `${monatName(abschlussMonat)} abschließen` : "Kasse zählen"} schliessen={schliessen}>
    <form className="kasse-formular" onSubmit={(e) => e.preventDefault()}>
      {abschlussMonat && <p className="muted">Zum Abschluss das Geld in der Kasse zählen. Danach kann in {monatName(abschlussMonat)} nichts mehr gebucht oder storniert werden.{laufend ? " Achtung: Der Monat läuft noch – spätere Belege dieses Monats können dann nicht mehr gebucht werden." : ""}</p>}
      <BetragFeld label="Gezählt" wert={betrag} setWert={setBetrag} autoFocus />
      <Zaehlhilfe anzahl={anzahl} setAnzahl={setAnzahl} />
      <p className="kasse-vergleich">Laut Kassenbuch: <b>{euroAusCent(soll)}</b>{ist !== null && <> · {diff === 0 ? <span className="ok">stimmt</span> : <span className="alarm">Differenz {diff > 0 ? "+" : "−"} {euroAusCent(Math.abs(diff))}</span>}</>}</p>
      {ist !== null && diff !== 0 && <p className="info-box yellow"><AlertTriangle size={18} /> Bitte zuerst nachzählen und prüfen, ob ein Beleg fehlt. Bleibt die Differenz, wird sie als „Kassendifferenz“ gebucht.</p>}
      <footer>
        <button type="button" className="ghost" onClick={schliessen}>Abbrechen</button>
        {!abschlussMonat && <button className="primary kasse-gross" disabled={busy || ist === null} onClick={() => ist !== null && speichernZaehlung(ist, summe ? anzahl : undefined, diff !== 0)}>{diff ? "Speichern und Differenz buchen" : "Zählung speichern"}</button>}
        {abschlussMonat && <button className="primary kasse-gross" disabled={busy || ist === null} onClick={() => ist !== null && abschliessen(abschlussMonat, ist, summe ? anzahl : undefined)}>{diff ? "Differenz buchen und abschließen" : "Monat abschließen"}</button>}
      </footer>
    </form>
  </Fenster>;
}

function DetailFenster({ record: r, records, buchen, busy, beleg, schliessen, stornieren }: {
  record: KasseRecord; records: KasseRecord[]; buchen: boolean; busy: boolean; beleg: (fileId: string) => Promise<string>; schliessen: () => void; stornieren: (grund: string) => void;
}) {
  const [bild, setBild] = useState("");
  const [grund, setGrund] = useState("");
  const [frage, setFrage] = useState(false);
  useEffect(() => { let aktiv = true; if (r.beleg) void beleg(r.beleg.fileId).then((url) => { if (aktiv) setBild(url); }); return () => { aktiv = false; }; }, [r, beleg]);
  const storniertDurch = records.find((x) => x.art === "storno" && x.bezug === r.id);
  const ziel = r.bezug ? records.find((x) => x.id === r.bezug) : undefined;
  const darf = buchen && (r.art === "einnahme" || r.art === "ausgabe") && !storniertDurch && !monatGeschlossen(records, r.datum.slice(0, 7));
  return <Fenster titel={`${r.art === "anfangsbestand" ? "Anfangsbestand" : r.art === "storno" ? "Storno" : r.art === "einnahme" ? "Einnahme" : "Ausgabe"} ${r.nr}`} schliessen={schliessen}>
    <dl className="kasse-detail">
      <div><dt>Betrag</dt><dd>{euroAusCent(r.cent || 0)}</dd></div>
      <div><dt>Datum</dt><dd>{datumDe(r.datum)}</dd></div>
      {r.kategorie && <div><dt>Kategorie</dt><dd>{r.kategorie}</dd></div>}
      {r.haendler && <div><dt>Geschäft</dt><dd>{r.haendler}</dd></div>}
      {r.text && <div><dt>Notiz</dt><dd>{r.text}</dd></div>}
      {r.art === "ausgabe" && <div><dt>MwSt</dt><dd>{r.mwst ?? "–"} %</dd></div>}
      {r.rechnungsnr && <div><dt>Rechnungsnr.</dt><dd>{r.rechnungsnr}</dd></div>}
      {r.eigenbeleg && <div><dt>Beleg</dt><dd>Eigenbeleg (kein Originalbeleg)</dd></div>}
      {ziel && <div><dt>Hebt auf</dt><dd>{ziel.nr} · {ziel.kategorie} · {euroAusCent(ziel.cent || 0)} · Grund: {r.grund}</dd></div>}
      {storniertDurch && <div><dt>Storniert</dt><dd>durch {storniertDurch.nr} am {datumDe(storniertDurch.datum)} – {storniertDurch.grund}</dd></div>}
      <div><dt>Erfasst</dt><dd>{new Date(r.erfasst).toLocaleString("de-DE")}</dd></div>
    </dl>
    {r.beleg && (bild ? /^data:image\/(jpe?g|png|webp)/i.test(bild) ? <img className="kasse-beleg" src={bild} alt="Beleg" /> : <p className="muted">Beleg {r.beleg.name} (nicht als Bild darstellbar)</p> : <p className="muted">Belegbild ist auf diesem Gerät nicht vorhanden.</p>)}
    {darf && !frage && <button className="ghost" onClick={() => setFrage(true)}>Falsch gebucht? Stornieren …</button>}
    {darf && frage && <form className="kasse-formular" onSubmit={(e) => { e.preventDefault(); stornieren(grund); }}>
      <p className="muted">Die Buchung bleibt sichtbar; eine Gegenbuchung hebt sie auf. Danach bei Bedarf richtig neu buchen.</p>
      <label>Grund<input value={grund} onChange={(e) => setGrund(e.target.value)} placeholder="z. B. Betrag falsch eingegeben" autoFocus /></label>
      <footer><button type="button" className="ghost" onClick={() => setFrage(false)}>Abbrechen</button><button className="primary" disabled={busy || !grund.trim()}>Stornieren</button></footer>
    </form>}
  </Fenster>;
}

function UebernahmeFenster({ kosten, busy, schliessen, uebernehmen }: { kosten: Expense[]; busy: boolean; schliessen: () => void; uebernehmen: (ids: string[]) => void }) {
  const [auswahl, setAuswahl] = useState<Set<string>>(() => new Set());
  const sortiert = useMemo(() => [...kosten].sort((a, b) => a.date.localeCompare(b.date)), [kosten]);
  return <Fenster titel="Kosten in die Bürokasse übernehmen" schliessen={schliessen}>
    <p className="muted">Kosten, die eigentlich aus der Bürokasse bezahlt wurden, werden als Ausgabe ins Kassenbuch übernommen (mit Belegbild). In deinen eigenen Spesen stehen sie danach als „Bürokasse“ – sie werden dir nicht erstattet.</p>
    <ul className="kasse-auswahl">{sortiert.map((e) => <li key={e.id}><label className="kasse-check">
      <input type="checkbox" checked={auswahl.has(e.id)} onChange={(ev) => { const next = new Set(auswahl); if (ev.target.checked) next.add(e.id); else next.delete(e.id); setAuswahl(next); }} />
      <span>{datumDe(e.date)} · {(e.gross * (e.exchangeRate || 1)).toLocaleString("de-DE", { style: "currency", currency: "EUR" })} · {e.merchant || e.description || e.category}{e.receipt ? "" : " · ohne Beleg"}</span>
    </label></li>)}</ul>
    <footer className="kasse-fuss">
      <button type="button" className="ghost" onClick={() => setAuswahl(new Set(sortiert.map((e) => e.id)))}>Alle auswählen</button>
      <button className="primary" disabled={busy || !auswahl.size} onClick={() => uebernehmen([...auswahl])}>{auswahl.size} übernehmen</button>
    </footer>
  </Fenster>;
}
