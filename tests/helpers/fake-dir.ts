import type { DirHandleLike, FileHandleLike } from "../../lib/folder-store";

/** Ordner im Speicher. Wie die File System Access API: Inhalt wird erst bei close() übernommen. */
export type Faults = { failWrite?: string; failClose?: string; truncate?: string; denyRead?: boolean };
export class FakeDir implements DirHandleLike {
  kind = "directory" as const;
  dirs = new Map<string, FakeDir>();
  files = new Map<string, string | Blob>();
  constructor(public name: string, public faults: Faults = {}) {}
  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirHandleLike> {
    let dir = this.dirs.get(name);
    if (!dir) {
      if (!options?.create) throw new DOMException("missing", "NotFoundError");
      dir = new FakeDir(name, this.faults); this.dirs.set(name, dir);
    }
    return dir;
  }
  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike> {
    if (!this.files.has(name) && !options?.create) throw new DOMException("missing", "NotFoundError");
    // Wie der Browser: create legt die (leere) Datei sofort an.
    if (!this.files.has(name)) this.files.set(name, "");
    const dir = this; const faults = this.faults;
    return {
      async getFile() {
        if (faults.denyRead) throw new DOMException("denied", "NotAllowedError");
        const content = dir.files.get(name) ?? "";
        return { text: async () => typeof content === "string" ? content : content.text(), size: typeof content === "string" ? content.length : content.size };
      },
      async createWritable() {
        let buffer: string | Blob = "";
        return {
          async write(data: string | Blob) { if (faults.failWrite === name) throw new DOMException("disk", "InvalidStateError"); buffer = typeof data === "string" && typeof buffer === "string" ? buffer + data : data; },
          async close() {
            if (faults.failClose === name) throw new DOMException("network drive gone", "InvalidStateError");
            dir.files.set(name, faults.truncate === name && typeof buffer === "string" ? buffer.slice(0, Math.floor(buffer.length / 2)) : buffer);
          },
          async abort() { buffer = ""; },
        };
      },
    };
  }
  async *values() {
    for (const name of this.dirs.keys()) yield { kind: "directory" as const, name };
    for (const name of this.files.keys()) yield { kind: "file" as const, name };
  }
  async removeEntry(name: string) { if (!this.files.delete(name) && !this.dirs.delete(name)) throw new DOMException("missing", "NotFoundError"); }
  file(...path: string[]): string | Blob | undefined {
    let dir: FakeDir = this;
    for (const part of path.slice(0, -1)) dir = dir.dirs.get(part)!;
    return dir?.files.get(path.at(-1)!);
  }
}
