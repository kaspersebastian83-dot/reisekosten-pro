/*
 * Teilen-Menü des Geräts (Web Share API) für Exporte: Die Datei geht direkt an Mail, OneDrive, AirDrop … statt in den
 * Download-Ordner des Handys. Welche Dateiarten ein Gerät teilen kann, entscheidet der Browser je Datei (canShare) –
 * was er nicht teilt, wird wie bisher heruntergeladen.
 */
type ShareNavigator = { canShare?: (data: { files: File[] }) => boolean; share?: (data: { files: File[] }) => Promise<void> };
const deviceNavigator = (): ShareNavigator | undefined => typeof navigator === "undefined" ? undefined : navigator as unknown as ShareNavigator;

/** Datei für das Teilen-Menü: Dateityp ohne Zusätze wie „;charset=utf-8“ (manche Browser lehnen sie sonst ab). */
export const shareableFile = (blob: Blob, name: string) => new File([blob], name, { type: blob.type.split(";")[0].trim() });

export function canShareFile(file: File, nav = deviceNavigator()) {
  try { return typeof nav?.share === "function" && nav.canShare?.({ files: [file] }) === true; } catch { return false; }
}
/** Kann dieses Gerät überhaupt Dateien teilen? Geprüft mit einer PDF, der Abrechnung selbst. */
export const shareSupported = (nav = deviceNavigator()) => canShareFile(new File(["x"], "x.pdf", { type: "application/pdf" }), nav);

/**
 * shared: an das Teilen-Menü übergeben · cancelled: Menü ohne Auswahl geschlossen · needs-tap: Der Browser verlangt einen
 * frischen Fingertipp (die Datei entstand zu lange nach dem Tipp, z. B. eine große PDF) · unsupported: diese Dateiart teilt
 * das Gerät nicht · failed: anderer Fehler.
 */
export type ShareOutcome = "shared" | "cancelled" | "needs-tap" | "unsupported" | "failed";
export async function shareFile(file: File, nav = deviceNavigator()): Promise<ShareOutcome> {
  if (!canShareFile(file, nav)) return "unsupported";
  try { await nav!.share!({ files: [file] }); return "shared"; }
  catch (error) {
    const name = (error as { name?: string } | null)?.name;
    return name === "AbortError" ? "cancelled" : name === "NotAllowedError" ? "needs-tap" : "failed";
  }
}
