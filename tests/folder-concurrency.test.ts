import { describe, expect, it, vi } from "vitest";
import { demoState } from "../lib/demo";
import { buildStatement } from "../lib/calculations";
import { COPY_DIR, DATA_DIR, DATA_FILE, FOLDER_NAME, PREVIOUS_FILE, decideReconcile, readDataFile, stateHash, writeDataFile, writeSafetyCopy } from "../lib/folder-store";
import { backupsToPrune, listBackups, readBackup } from "../lib/folder-backups";
import { FakeDir } from "./helpers/fake-dir";

const barrier = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
};
const profile = (name: string) => {
  const state = demoState(); state.settings.profileName = name; return state;
};
const candidates = async (root: FakeDir) => {
  const entries = (await listBackups(root)).filter((entry) => entry.kind === "speicherkandidat");
  return Promise.all(entries.map((entry) => readBackup(root, entry.name)));
};

describe("Gleichzeitige Ordnerspeicherung ohne gemeinsame Browsersperre", () => {
  it("stoppt A nach einer abgeschlossenen Änderung von B statt beide als Revision 2 zu bestätigen", async () => {
    const root = new FakeDir(FOLDER_NAME);
    await writeDataFile(root, profile("Ausgangsstand"), 0);
    const paused = barrier(), resume = barrier();
    const savingA = writeDataFile(root, profile("Sitzung A"), 1, undefined, new Date(), {
      beforeReplace: async () => { paused.release(); await resume.promise; },
    }).then(() => "success", (error: unknown) => error);
    await paused.promise;
    const savedB = await writeDataFile(root, profile("Sitzung B"), 1);
    resume.release();
    const resultA = await savingA;
    const current = await readDataFile(root);
    expect(resultA).toMatchObject({ code: "conflict" });
    expect(savedB.revision).toBe(2);
    expect(current?.state.settings.profileName).toBe("Sitzung B");
    expect(JSON.parse(root.file(DATA_DIR, DATA_FILE) as string).revision).toBe(2);
    expect((await candidates(root)).map((state) => state.settings.profileName).sort()).toEqual(["Ausgangsstand", "Sitzung A", "Sitzung B"]);
  });

  it.each(["create", "close"] as const)("erhält beide vollständigen Kandidaten selbst im letzten Rennfenster vor %s", async (operation) => {
    const root = new FakeDir(FOLDER_NAME);
    const initial = profile("Ausgangsstand");
    await writeDataFile(root, initial, 0);
    const paused = barrier(), resume = barrier(); let pause = true;
    root.faults.beforeOperation = async (name, op) => {
      if (pause && name === DATA_FILE && op === operation) { pause = false; paused.release(); await resume.promise; }
    };
    const a = profile("Sitzung A"), b = profile("Sitzung B");
    // A hat den letzten Vergleich bestanden. B speichert vollständig, während A erst bei create/close pausiert.
    const savingA = writeDataFile(root, a, 1);
    await paused.promise;
    const savedB = await writeDataFile(root, b, 1);
    resume.release();
    const savedA = await savingA;
    expect(savedA.revision).toBe(2); expect(savedB.revision).toBe(2);
    expect((await readDataFile(root))?.state.settings.profileName).toBe("Sitzung A");
    const restored = await candidates(root);
    expect(restored).toContainEqual(a); expect(restored).toContainEqual(b);
    expect(restored.find((state) => state.settings.profileName === "Sitzung B")?.trips).toEqual(b.trips);
    const entries = await listBackups(root);
    expect(new Set(entries.map((entry) => entry.name)).size).toBe(entries.length);
    expect(backupsToPrune(entries, new Date("2040-01-01"))).toEqual([]);
  });

  it("meldet einen Konflikt, wenn B nach A schreibt, bevor A seinen Stand zurückliest", async () => {
    const root = new FakeDir(FOLDER_NAME); await writeDataFile(root, profile("Ausgangsstand"), 0);
    let closed = false, intercept = true;
    root.faults.beforeOperation = async (name, op) => {
      if (name === DATA_FILE && op === "close") closed = true;
      if (intercept && closed && name === DATA_FILE && op === "read") {
        intercept = false; await writeDataFile(root, profile("Sitzung B"), 2);
      }
    };
    await expect(writeDataFile(root, profile("Sitzung A"), 1)).rejects.toMatchObject({ code: "conflict" });
    expect((await readDataFile(root))?.state.settings.profileName).toBe("Sitzung B");
    expect((await candidates(root)).map((state) => state.settings.profileName)).toEqual(expect.arrayContaining(["Sitzung A", "Sitzung B"]));
  });

  it("erkennt eine Änderung ohne Revisionswechsel am erwarteten Inhaltsfingerabdruck", async () => {
    const root = new FakeDir(FOLDER_NAME); const initial = profile("Ausgangsstand");
    await writeDataFile(root, initial, 0);
    const dir = root.dirs.get(DATA_DIR)!;
    const changed = JSON.parse(dir.files.get(DATA_FILE) as string); changed.state.settings.profileName = "Extern geändert";
    dir.files.set(DATA_FILE, JSON.stringify(changed));
    await expect(writeDataFile(root, profile("Sitzung A"), 1, undefined, new Date(), { expectedHash: await stateHash(initial) })).rejects.toMatchObject({ code: "conflict" });
    expect((await readDataFile(root))?.state.settings.profileName).toBe("Extern geändert");
  });

  it("friert den Kandidaten vor asynchronen Sicherungen ein", async () => {
    const root = new FakeDir(FOLDER_NAME); await writeDataFile(root, profile("Ausgangsstand"), 0);
    const state = profile("Sitzung A");
    const expectedHash = await stateHash(state);
    const result = await writeDataFile(root, state, 1, undefined, new Date(), { beforeReplace: async () => { state.settings.profileName = "Spätere Eingabe"; } });
    expect((await readDataFile(root))?.state.settings.profileName).toBe("Sitzung A");
    expect(result.hash).toBe(expectedHash);
    expect((await candidates(root)).some((state) => state.settings.profileName === "Spätere Eingabe")).toBe(false);
  });

  it.each([
    ["Kandidat schreiben", "failWrite", /^spesenkit_speicherkandidat_/, "write"],
    ["Kandidat schließen", "failClose", /^spesenkit_speicherkandidat_/, "write"],
    ["Kandidat prüfen", "truncate", /^spesenkit_speicherkandidat_/, "verify"],
    ["Vorgänger schreiben", "failWrite", /^spesenkit_vor_speichern_/, "write"],
    ["Vorgänger schließen", "failClose", /^spesenkit_vor_speichern_/, "write"],
    ["Vorgänger prüfen", "truncate", /^spesenkit_vor_speichern_/, "verify"],
    ["Vorherdatei schreiben", "failWrite", PREVIOUS_FILE, "write"],
    ["Vorherdatei schließen", "failClose", PREVIOUS_FILE, "write"],
    ["Vorherdatei prüfen", "truncate", PREVIOUS_FILE, "verify"],
    ["Hauptdatei schreiben", "failWrite", DATA_FILE, "write"],
    ["Hauptdatei schließen", "failClose", DATA_FILE, "write"],
  ] as const)("stoppt bei Fehler: %s", async (_label, fault, name, code) => {
    const root = new FakeDir(FOLDER_NAME); await writeDataFile(root, profile("Ausgangsstand"), 0);
    const before = root.file(DATA_DIR, DATA_FILE);
    root.faults[fault] = name;
    await expect(writeDataFile(root, profile("Sitzung A"), 1)).rejects.toMatchObject({ code });
    expect(root.file(DATA_DIR, DATA_FILE)).toBe(before);
    if (!String(name).includes("speicherkandidat")) expect((await candidates(root)).some((state) => state.settings.profileName === "Sitzung A")).toBe(true);
  });

  it("erhält geprüfte Kandidaten und Vorgänger bei beschädigter Hauptdatei", async () => {
    const root = new FakeDir(FOLDER_NAME); await writeDataFile(root, profile("Ausgangsstand"), 0);
    root.faults.truncate = DATA_FILE;
    await expect(writeDataFile(root, profile("Sitzung A"), 1)).rejects.toMatchObject({ code: "verify" });
    const copies = await listBackups(root);
    expect((await candidates(root)).some((state) => state.settings.profileName === "Sitzung A")).toBe(true);
    const previous = copies.find((entry) => entry.kind === "vor_speichern")!;
    expect((await readBackup(root, previous.name)).settings.profileName).toBe("Ausgangsstand");
    expect(root.dirs.get(COPY_DIR)?.files.size).toBeGreaterThan(1);
  });

  it.each([1, 2])("fragt bei abweichendem Inhalt mit Revision %i statt bestätigter Revision 2 nach", async (revision) => {
    const root = new FakeDir(FOLDER_NAME);
    const local = profile("Sitzung B"), foreign = profile("Sitzung A");
    for (let i = 0; i < revision; i++) await writeDataFile(root, foreign, i);
    const file = (await readDataFile(root))!;
    const hash = await stateHash(local);
    expect(decideReconcile({ revision: 2, hash }, hash, false, file).kind).toBe("conflict");
  });

  it("erhält eingebettete Belege und eingefrorene Abschlüsse exakt im wiederherstellbaren Kandidaten", async () => {
    const root = new FakeDir(FOLDER_NAME); const state = profile("Mit Abschluss");
    state.expenses[0].receipt = { id: "synthetic", name: "beleg.pdf", type: "application/pdf", hash: "synthetic-hash", size: 5, dataUrl: "data:application/pdf;base64,SGFsbG8=" };
    state.statements.push({ id: "closed-july", month: "2026-07", number: "RK-202607", version: 1,
      createdAt: "2026-08-01T10:00:00Z", status: "freigegeben", locked: true,
      data: buildStatement(state, "2026-07"), settingsSnapshot: structuredClone(state.settings),
      expensesSnapshot: structuredClone(state.expenses), relatedTripsSnapshot: structuredClone(state.trips) });
    await writeDataFile(root, state, 0);
    const [restored] = await candidates(root);
    expect(restored.expenses[0].receipt).toEqual(state.expenses[0].receipt);
    expect(restored.statements).toEqual(state.statements);
  });

  it("verwendet einen bereits vorhandenen Kopienamen auch bei einer UUID-Kollision nicht erneut", async () => {
    const root = new FakeDir(FOLDER_NAME); const now = new Date("2026-10-20T12:00:00Z");
    const id = vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000000");
    try {
      const path = await writeSafetyCopy(root, "browserstand", profile("Sitzung A"), now);
      await expect(writeSafetyCopy(root, "browserstand", profile("Sitzung B"), now)).rejects.toMatchObject({ code: "write" });
      expect((await readBackup(root, path.split("/").at(-1)!)).settings.profileName).toBe("Sitzung A");
    } finally { id.mockRestore(); }
  });

  it("überschreibt keine inzwischen reparierte Datei beim bewussten Neu-Anlegen", async () => {
    const root = new FakeDir(FOLDER_NAME); const dir = await root.getDirectoryHandle(DATA_DIR, { create: true }) as FakeDir;
    dir.files.set(DATA_FILE, "{kaputt");
    const other = new FakeDir(FOLDER_NAME); await writeDataFile(other, profile("Reparierter Stand"), 0);
    let reads = 0;
    root.faults.beforeOperation = async (name, op) => {
      if (name === DATA_FILE && op === "read" && ++reads === 2) dir.files.set(DATA_FILE, other.file(DATA_DIR, DATA_FILE)!);
    };
    await expect(writeDataFile(root, profile("Sitzung A"), 0, undefined, new Date(), { replaceInvalid: true })).rejects.toMatchObject({ code: "conflict" });
    expect((await readDataFile(root))?.state.settings.profileName).toBe("Reparierter Stand");
  });

  it("legt eine zwischenzeitlich gelöschte Hauptdatei nicht still neu an", async () => {
    const root = new FakeDir(FOLDER_NAME); await writeDataFile(root, profile("Ausgangsstand"), 0);
    await expect(writeDataFile(root, profile("Sitzung A"), 1, undefined, new Date(), {
      beforeReplace: async () => { await root.dirs.get(DATA_DIR)!.removeEntry(DATA_FILE); },
    })).rejects.toMatchObject({ code: "conflict" });
    expect(root.file(DATA_DIR, DATA_FILE)).toBeUndefined();
    expect((await candidates(root)).some((state) => state.settings.profileName === "Sitzung A")).toBe(true);
  });
});
