import { describe, expect, it } from "vitest";
import { buildStatement } from "../lib/calculations";
import { demoState } from "../lib/demo";
import { autoBackupDue, backupsToPrune, closingBackup, dailyBackup, droppedClosings, listBackups, parseBackupName, readBackup, type BackupEntry } from "../lib/folder-backups";
import { COPY_DIR, FOLDER_NAME, readDataFile, writeDataFile, writeSafetyCopy } from "../lib/folder-store";
import { normalizeState } from "../lib/storage";
import type { AppState, StatementSnapshot } from "../lib/types";
import { FakeDir } from "./helpers/fake-dir";

const at = (date: string, time = "09:00:00") => new Date(`${date}T${time}`);
const app = { version: "1.7.0", commit: "test" };
const withTrip = (state: AppState, id: string): AppState => { const next = structuredClone(state); next.trips.push({ ...structuredClone(next.trips[0]), id }); return next; };
const auto = (date: string, time = "090000"): BackupEntry => ({ ...parseBackupName(`spesenkit_auto_${date}_${time}.json`)!, size: 10 });
const closed = (state: AppState, month: string, version: number): AppState => {
  const snapshot: StatementSnapshot = { id: `${month}-v${version}`, month, number: "RK", createdAt: "x", status: "freigegeben", version, locked: true, data: buildStatement(state, month), settingsSnapshot: structuredClone(state.settings), expensesSnapshot: [], relatedTripsSnapshot: [] };
  return { ...state, statements: [...state.statements, snapshot] };
};

describe("Sicherungsstände: Namen und Aufbewahrung", () => {
  it("erkennt alle Sicherungsarten, auch Abschlüsse mit Monat und Version", () => {
    expect(parseBackupName("spesenkit_auto_2026-10-18_090512.json")).toMatchObject({ kind: "auto", date: "2026-10-18", time: "09:05:12", restorable: true });
    expect(parseBackupName("spesenkit_abschluss_2026-09_V02_2026-10-18_090512.json")).toMatchObject({ kind: "abschluss", detail: "2026-09 V02", date: "2026-10-18" });
    expect(parseBackupName("spesenkit_browserstand_2026-10-18_090512_2.json")).toMatchObject({ kind: "browserstand" });
    expect(parseBackupName("spesenkit_ungueltig_2026-10-18_090512.json")).toMatchObject({ kind: "ungueltig", restorable: false });
    expect(parseBackupName("Reisekosten_Backup_2026-10-18.json")).toBeNull();
    expect(parseBackupName("spesenkit_auto_2026-10-18_0905.json")).toBeNull();
  });

  it("ist pro Kalendertag einmal fällig", () => {
    expect(autoBackupDue([], at("2026-10-18"))).toBe(true);
    expect(autoBackupDue([auto("2026-10-17")], at("2026-10-18"))).toBe(true);
    expect(autoBackupDue([auto("2026-10-18", "000100")], at("2026-10-18", "23:59:00"))).toBe(false);
  });

  it("behält die letzten 14 Tagessicherungen und je Monat eine für 12 Monate", () => {
    const now = at("2026-10-18");
    const days: BackupEntry[] = [];
    for (let d = new Date("2025-06-01T12:00:00Z"); d.toISOString().slice(0, 10) <= "2026-10-18"; d = new Date(d.getTime() + 86_400_000)) days.push(auto(d.toISOString().slice(0, 10)));
    const pruned = new Set(backupsToPrune(days, now));
    const kept = days.filter((e) => !pruned.has(e.name)).map((e) => e.date).sort();
    // 14 neueste Tage (05.–18.10.) + je die neueste aus Nov 2025 … Sep 2026 (11 Monate); Oktober steckt in den 14 Tagen.
    expect(kept.filter((d) => d >= "2026-10-05")).toHaveLength(14);
    expect(kept.filter((d) => d < "2026-10-05")).toEqual(["2025-11-30", "2025-12-31", "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30"]);
    expect(kept.some((d) => d < "2025-11-01")).toBe(false);
  });

  it("schlägt nie Abschluss-, Konflikt-, manuelle oder fremde Dateien zum Löschen vor", () => {
    const now = at("2026-10-18");
    const old = ["abschluss_2020-01_V01", "browserstand", "ordnerstand", "manuell", "vor_wiederherstellung", "ungueltig"].map((label) => ({ ...parseBackupName(`spesenkit_${label}_2020-01-01_090000.json`)!, size: 1 }));
    const recent = Array.from({ length: 14 }, (_, i) => auto(`2026-10-${String(i + 1).padStart(2, "0")}`));
    expect(backupsToPrune([...old, ...recent, auto("2020-01-01")], now)).toEqual(["spesenkit_auto_2020-01-01_090000.json"]);
  });
});

describe("Sicherungsstände im Ordner", () => {
  it("sichert beim ersten Speichern des Tages den Stand davor – und nur einmal pro Tag", async () => {
    const root = new FakeDir(FOLDER_NAME);
    const v1 = demoState(); const v2 = withTrip(v1, "a"); const v3 = withTrip(v2, "b");
    const backup = { beforeReplace: async (current: { state: AppState }) => { await dailyBackup(root, current.state, at("2026-10-18", "10:00:00")); } };
    await writeDataFile(root, v1, 0, app, at("2026-10-18", "09:00:00"), backup);
    expect(await listBackups(root)).toEqual([]);
    await writeDataFile(root, v2, 1, app, at("2026-10-18", "10:00:00"), backup);
    await writeDataFile(root, v3, 2, app, at("2026-10-18", "10:05:00"), backup);
    const list = await listBackups(root);
    expect(list.map((e) => e.kind)).toEqual(["auto"]);
    const restored = await readBackup(root, list[0].name);
    expect(restored.trips.map((t) => t.id)).toEqual(v1.trips.map((t) => t.id));
    expect((await readDataFile(root))?.content.revision).toBe(3);
  });

  it("räumt beim Sichern alte Tagessicherungen auf, lässt alles andere stehen", async () => {
    const root = new FakeDir(FOLDER_NAME);
    for (let day = 1; day <= 20; day++) await writeSafetyCopy(root, "auto", demoState(), at(`2026-09-${String(day).padStart(2, "0")}`));
    await writeSafetyCopy(root, "browserstand", demoState(), at("2026-01-01"));
    const result = await dailyBackup(root, demoState(), at("2026-10-18"));
    expect(result.written).toMatch(/spesenkit_auto_2026-10-18_090000\.json$/);
    const kinds = (await listBackups(root)).reduce<Record<string, number>>((n, e) => ({ ...n, [e.kind]: (n[e.kind] || 0) + 1 }), {});
    expect(kinds).toEqual({ auto: 14, browserstand: 1 });
    expect(result.pruned).toHaveLength(7);
    expect((await dailyBackup(root, demoState(), at("2026-10-18", "18:00:00"))).written).toBeNull();
  });

  it("legt nach einem Abschluss eine benannte Sicherung an und liest sie geprüft zurück", async () => {
    const root = new FakeDir(FOLDER_NAME);
    const state = closed(demoState(), "2026-07", 1);
    const name = await closingBackup(root, state, "2026-07-v1", at("2026-08-02", "11:12:13"));
    expect(name).toBe(`${FOLDER_NAME}/${COPY_DIR}/spesenkit_abschluss_2026-07_V01_2026-08-02_111213.json`);
    const [entry] = await listBackups(root);
    expect(entry).toMatchObject({ kind: "abschluss", detail: "2026-07 V01" });
    expect((await readBackup(root, entry.name)).statements[0].locked).toBe(true);
  });

  it("verweigert unlesbare, leere oder fremde Dateien beim Wiederherstellen", async () => {
    const root = new FakeDir(FOLDER_NAME);
    const dir = await root.getDirectoryHandle(COPY_DIR, { create: true }) as FakeDir;
    dir.files.set("spesenkit_manuell_2026-10-18_090000.json", "{kaputt");
    dir.files.set("spesenkit_manuell_2026-10-18_090001.json", JSON.stringify({ settings: {}, trips: [{ id: 1 }] }));
    dir.files.set("spesenkit_ungueltig_2026-10-18_090000.json", JSON.stringify(demoState()));
    await expect(readBackup(root, "spesenkit_manuell_2026-10-18_090000.json")).rejects.toMatchObject({ code: "invalid" });
    await expect(readBackup(root, "spesenkit_manuell_2026-10-18_090001.json")).rejects.toMatchObject({ code: "invalid" });
    await expect(readBackup(root, "spesenkit_ungueltig_2026-10-18_090000.json")).rejects.toMatchObject({ code: "invalid" });
    await expect(readBackup(root, "../Daten/spesenkit.json")).rejects.toMatchObject({ code: "invalid" });
  });

  it("nennt abgeschlossene Abrechnungen, die eine Wiederherstellung entfernen würde", () => {
    const base = normalizeState(JSON.parse(JSON.stringify(demoState())));
    const older = closed(base, "2026-06", 1);
    const current = closed(closed(older, "2026-07", 1), "2026-07", 2);
    expect(droppedClosings(current, older)).toEqual(["2026-07 V01", "2026-07 V02"]);
    expect(droppedClosings(older, current)).toEqual([]);
  });
});
