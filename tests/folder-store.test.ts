import { describe, expect, it } from "vitest";
import { emptyState } from "../lib/config";
import { demoState } from "../lib/demo";
import {
  COPY_DIR, DATA_DIR, DATA_FILE, FOLDER_NAME, FolderError, PREVIOUS_FILE, decideReconcile, isEmptyState,
  readDataFile, resolveAppFolder, stateHash, writeDataFile, writeSafetyCopy,
  type FolderLink,
} from "../lib/folder-store";
import { FakeDir } from "./helpers/fake-dir";
import { normalizeState } from "../lib/storage";
import type { AppState } from "../lib/types";

const app = { version: "1.7.0", commit: "test123" };
const clock = (minute: number) => new Date(2026, 9, 18, 13, minute, 0);
const withTrip = (state: AppState, id: string): AppState => {
  const next = structuredClone(state);
  next.trips.push({ ...structuredClone(next.trips[0]), id, purpose: `Zweck ${id}` });
  return next;
};

describe("SpesenKit-Ordner: Datei schreiben und lesen", () => {
  it("legt den Unterordner SpesenKit an oder verwendet ihn, wenn er selbst gewählt wurde", async () => {
    const employee = new FakeDir("Max Mustermann");
    const root = await resolveAppFolder(employee);
    expect(root.name).toBe(FOLDER_NAME);
    expect(employee.dirs.has(FOLDER_NAME)).toBe(true);
    expect(await resolveAppFolder(root)).toBe(root);
    expect(await resolveAppFolder(new FakeDir("spesenkit"))).toHaveProperty("name", "spesenkit");
  });

  it("schreibt Revision 1, liest sie zurück und erkennt denselben Inhalt per Fingerabdruck", async () => {
    const root = new FakeDir(FOLDER_NAME);
    const state = demoState();
    expect(await readDataFile(root)).toBeNull();
    const written = await writeDataFile(root, state, 0, app, clock(1));
    expect(written.revision).toBe(1);
    const file = await readDataFile(root);
    expect(file?.content).toMatchObject({ format: "spesenkit-daten", formatVersion: 1, revision: 1, app });
    expect(file?.hash).toBe(written.hash);
    expect(written.hash).toBe(await stateHash(state));
    expect(file?.state.trips.map((t) => t.id)).toEqual(state.trips.map((t) => t.id));
    expect(root.file(DATA_DIR, PREVIOUS_FILE)).toBeUndefined();
  });

  it("hält den vorherigen Stand als spesenkit.vorher.json und zählt die Revision hoch", async () => {
    const root = new FakeDir(FOLDER_NAME);
    const first = demoState();
    await writeDataFile(root, first, 0, app, clock(1));
    const firstText = root.file(DATA_DIR, DATA_FILE);
    const second = withTrip(first, "neu");
    const written = await writeDataFile(root, second, 1, app, clock(2));
    expect(written.revision).toBe(2);
    expect(root.file(DATA_DIR, PREVIOUS_FILE)).toBe(firstText);
    expect((await readDataFile(root))?.state.trips.some((t) => t.id === "neu")).toBe(true);
  });

  it("überschreibt nie einen Stand, der inzwischen an anderer Stelle geschrieben wurde", async () => {
    const root = new FakeDir(FOLDER_NAME);
    await writeDataFile(root, demoState(), 0, app, clock(1));
    await writeDataFile(root, withTrip(demoState(), "server-b"), 1, app, clock(2));
    const before = root.file(DATA_DIR, DATA_FILE);
    const stale = writeDataFile(root, withTrip(demoState(), "server-a"), 1, app, clock(3));
    await expect(stale).rejects.toMatchObject({ code: "conflict" });
    expect(root.file(DATA_DIR, DATA_FILE)).toBe(before);
  });

  it("lässt die Datei unverändert, wenn das Schreiben abbricht (z. B. Netzlaufwerk weg)", async () => {
    const root = new FakeDir(FOLDER_NAME);
    await writeDataFile(root, demoState(), 0, app, clock(1));
    const before = root.file(DATA_DIR, DATA_FILE);
    root.faults.failClose = DATA_FILE;
    await expect(writeDataFile(root, withTrip(demoState(), "x"), 1, app, clock(2))).rejects.toMatchObject({ code: "write" });
    expect(root.file(DATA_DIR, DATA_FILE)).toBe(before);
    root.faults.failClose = undefined;
    root.faults.failWrite = DATA_FILE;
    await expect(writeDataFile(root, withTrip(demoState(), "x"), 1, app, clock(2))).rejects.toMatchObject({ code: "write" });
    expect(root.file(DATA_DIR, DATA_FILE)).toBe(before);
  });

  it("meldet einen unvollständig gespeicherten Stand statt Erfolg", async () => {
    const root = new FakeDir(FOLDER_NAME, { truncate: DATA_FILE });
    await expect(writeDataFile(root, demoState(), 0, app, clock(1))).rejects.toMatchObject({ code: "verify" });
  });

  it("meldet fehlenden Zugriff als Berechtigungsproblem", async () => {
    const root = new FakeDir(FOLDER_NAME);
    await writeDataFile(root, demoState(), 0, app, clock(1));
    root.faults.denyRead = true;
    await expect(readDataFile(root)).rejects.toMatchObject({ code: "permission" });
  });

  it.each([
    ["leer", ""],
    ["kein JSON", "{kaputt"],
    ["fremde Datei", JSON.stringify({ hallo: 1 })],
    ["unbekannte Formatversion", JSON.stringify({ format: "spesenkit-daten", formatVersion: 99, revision: 1, savedAt: "x", state: emptyState })],
    ["ohne Revision", JSON.stringify({ format: "spesenkit-daten", formatVersion: 1, savedAt: "x", state: emptyState })],
    ["ungültige Daten", JSON.stringify({ format: "spesenkit-daten", formatVersion: 1, revision: 1, savedAt: "x", state: { settings: emptyState.settings, trips: [{ id: 1 }] } })],
  ])("schützt eine ungültige Datei (%s) vor dem Überschreiben", async (_label, text) => {
    const root = new FakeDir(FOLDER_NAME);
    await root.getDirectoryHandle(DATA_DIR, { create: true });
    root.dirs.get(DATA_DIR)!.files.set(DATA_FILE, text);
    await expect(readDataFile(root)).rejects.toBeInstanceOf(FolderError);
    await expect(readDataFile(root)).rejects.toMatchObject({ code: "invalid" });
    await expect(writeDataFile(root, demoState(), 0, app, clock(1))).rejects.toMatchObject({ code: "invalid" });
    expect(root.file(DATA_DIR, DATA_FILE)).toBe(text);
  });

  it("legt eine ungültige Datei nur auf ausdrücklichen Wunsch als Kopie beiseite und beginnt neu", async () => {
    const root = new FakeDir(FOLDER_NAME);
    await root.getDirectoryHandle(DATA_DIR, { create: true });
    root.dirs.get(DATA_DIR)!.files.set(DATA_FILE, "{kaputt");
    await expect(writeDataFile(root, demoState(), 1, app, clock(1), { replaceInvalid: true })).rejects.toMatchObject({ code: "invalid" });
    const written = await writeDataFile(root, demoState(), 0, app, clock(1), { replaceInvalid: true });
    expect(written.revision).toBe(1);
    expect([...root.dirs.get(COPY_DIR)!.files.entries()].filter(([name]) => name.startsWith("spesenkit_ungueltig_")).map(([, text]) => text)).toEqual(["{kaputt"]);
  });

  it("schreibt Sicherungskopien im Format der JSON-Sicherung, ohne vorhandene zu überschreiben", async () => {
    const root = new FakeDir(FOLDER_NAME);
    const first = await writeSafetyCopy(root, "browserstand", demoState(), clock(5));
    const second = await writeSafetyCopy(root, "browserstand", emptyState, clock(5));
    expect(first).toMatch(/^SpesenKit\/Sicherungen\/spesenkit_browserstand_2026-10-18_130500_[0-9a-f-]{36}\.json$/);
    expect(second).not.toBe(first);
    const restored = normalizeState(JSON.parse(root.file(COPY_DIR, first.split("/").at(-1)!) as string));
    expect(restored.trips.length).toBe(demoState().trips.length);
  });
});

describe("SpesenKit-Ordner: Fingerabdruck", () => {
  it("ist unabhängig von Schlüsselreihenfolge, undefinierten Feldern und dem JSON-Weg", async () => {
    const state = demoState();
    const reordered = JSON.parse(JSON.stringify(state, Object.keys(state).reverse())) as AppState;
    const withUndefined = { ...structuredClone(state), trips: state.trips.map((t) => ({ ...t, endDate: t.endDate ?? undefined })) };
    const hash = await stateHash(state);
    expect(await stateHash({ ...reordered, ...state })).toBe(hash);
    expect(await stateHash(withUndefined)).toBe(hash);
    expect(await stateHash(normalizeState(JSON.parse(JSON.stringify(state))))).toBe(hash);
    expect(await stateHash(withTrip(state, "x"))).not.toBe(hash);
  });
  it("erkennt einen leeren Datenbestand", () => {
    expect(isEmptyState(normalizeState(undefined))).toBe(true);
    expect(isEmptyState(demoState())).toBe(false);
    expect(isEmptyState({ ...structuredClone(emptyState), settings: { ...emptyState.settings, profileName: "Max" } })).toBe(false);
  });
});

describe("SpesenKit-Ordner: Abgleich beim Start", () => {
  const file = async (state: AppState, revision: number) => {
    const root = new FakeDir(FOLDER_NAME);
    for (let r = 0; r < revision; r++) await writeDataFile(root, state, r, app, clock(r));
    return (await readDataFile(root))!;
  };
  it("entscheidet nur eindeutige Fälle automatisch", async () => {
    const a = demoState(); const b = withTrip(a, "b"); const c = withTrip(a, "c");
    const [ha, hb, hc] = await Promise.all([stateHash(a), stateHash(b), stateHash(c)]);
    const fileA = await file(a, 3); const fileB = await file(b, 4);
    const linked = (revision: number, hash: string) => ({ revision, hash });
    // Neuer Ordner ohne Datei: Browserstand anlegen.
    expect(decideReconcile(linked(0, ""), ha, false, null)).toEqual({ kind: "write-local", expectedRevision: 0 });
    // Datei wurde gelöscht oder verschoben: nachfragen.
    expect(decideReconcile(linked(3, ha), ha, false, null)).toEqual({ kind: "missing" });
    // Gleicher Inhalt.
    expect(decideReconcile(linked(3, ha), ha, false, fileA).kind).toBe("in-sync");
    expect(decideReconcile(linked(0, ""), ha, false, fileA).kind).toBe("in-sync");
    // Anderer Terminalserver hat weitergearbeitet, hier nichts geändert: Datei übernehmen.
    expect(decideReconcile(linked(3, ha), ha, false, fileB).kind).toBe("load-file");
    // Ordner war nicht erreichbar, hier weitergearbeitet, Datei unverändert: Browserstand schreiben.
    expect(decideReconcile(linked(3, ha), hc, false, fileA)).toEqual({ kind: "write-local", expectedRevision: 3 });
    // Beide Seiten geändert: Benutzer entscheidet.
    expect(decideReconcile(linked(3, ha), hc, false, fileB).kind).toBe("conflict");
    // Neu verbunden, Browser leer, Datei vorhanden (neues Profil/neuer Server): Datei übernehmen.
    expect(decideReconcile(linked(0, ""), await stateHash(emptyState), true, fileB).kind).toBe("load-file");
    // Neu verbunden, Browser hat eigene, abweichende Daten: Benutzer entscheidet.
    expect(decideReconcile(linked(0, ""), hc, false, fileB).kind).toBe("conflict");
    // Bewusst geleerter Browser bei inzwischen geänderter Datei: kein stilles Laden.
    expect(decideReconcile(linked(3, ha), await stateHash(emptyState), true, fileB).kind).toBe("conflict");
    // Browserdaten plötzlich weg, Datei unverändert: die Datei wird nicht automatisch geleert.
    expect(decideReconcile(linked(3, ha), await stateHash(emptyState), true, fileA).kind).toBe("conflict");
    // Datei absichtlich geleert und abgeglichen, Browser ebenfalls leer: gleicher Stand.
    const empty = await file(normalizeState(undefined), 1);
    expect(decideReconcile(linked(1, empty.hash), empty.hash, true, empty).kind).toBe("in-sync");
    expect(hb).toBe(fileB.hash);
  });

  it("spielt den Terminalserver-Ablauf ohne Datenverlust durch", async () => {
    const root = new FakeDir(FOLDER_NAME);
    const syncWith = async (link: FolderLink, local: AppState) => {
      const decision = decideReconcile(link, await stateHash(local), isEmptyState(local), await readDataFile(root));
      return decision;
    };
    // Server A: erster Start, Ordner verbunden, Daten erfasst.
    let localA = demoState();
    let linkA: FolderLink = { handle: root, revision: 0, hash: "" };
    expect((await syncWith(linkA, localA)).kind).toBe("write-local");
    let w = await writeDataFile(root, localA, 0, app, clock(1)); linkA = { ...linkA, ...w };
    localA = withTrip(localA, "a1");
    w = await writeDataFile(root, localA, linkA.revision, app, clock(2)); linkA = { ...linkA, ...w };
    // Server B: leerer Browser, gleicher Ordner gewählt -> lädt Datei, arbeitet weiter.
    let localB = normalizeState(undefined);
    let linkB: FolderLink = { handle: root, revision: 0, hash: "" };
    const onB = await syncWith(linkB, localB);
    expect(onB.kind).toBe("load-file");
    if (onB.kind !== "load-file") throw new Error();
    localB = onB.file.state; linkB = { ...linkB, revision: onB.file.content.revision, hash: onB.file.hash };
    localB = withTrip(localB, "b1");
    w = await writeDataFile(root, localB, linkB.revision, app, clock(3)); linkB = { ...linkB, ...w };
    // Zurück auf Server A: Browser seit dem letzten Abgleich unverändert -> Stand von B wird übernommen.
    const backOnA = await syncWith(linkA, localA);
    expect(backOnA.kind).toBe("load-file");
    if (backOnA.kind !== "load-file") throw new Error();
    expect(backOnA.file.state.trips.map((t) => t.id)).toEqual(expect.arrayContaining(["a1", "b1"]));
    // Hätte A in der Zwischenzeit offline weitergearbeitet, gäbe es einen Konflikt statt eines Überschreibens.
    expect((await syncWith(linkA, withTrip(localA, "a2"))).kind).toBe("conflict");
    await expect(writeDataFile(root, withTrip(localA, "a2"), linkA.revision, app, clock(4))).rejects.toMatchObject({ code: "conflict" });
  });
});
