// Gemeinsame Hilfen der Seiten und Fenster (aus app/page.tsx herausgelöst, unverändert).
import { useRef } from "react";
import { Archive, BarChart3, FileSpreadsheet, Settings as SettingsIcon, X } from "lucide-react";
import type { AppState, Expense, Trip } from "../lib/types";
import { today } from "../lib/config";

// „Reisen“ und „Kosten & Belege“ sind in der Monatsübersicht aufgegangen; der Import ist von dort erreichbar.
export type Tab =
  | "Fahrten importieren"
  | "Monatsübersicht"
  | "Auswertungen"
  | "Einstellungen"
  | "Datensicherung";
export const tabs: { name: Tab; icon: typeof FileSpreadsheet }[] = [
  { name: "Monatsübersicht", icon: FileSpreadsheet },
  { name: "Auswertungen", icon: BarChart3 },
  { name: "Einstellungen", icon: SettingsIcon },
  { name: "Datensicherung", icon: Archive },
];
export const euro = (n: number) =>
  n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
export const duration = (m: number) =>
  `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} Std.`;
export const dateDe = (d: string) => (d ? d.split("-").reverse().join(".") : "–");
export const uid = () =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `rk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
export const blankTrip = (settings: AppState["settings"]): Trip => {
  const vehicle = (settings.vehicles || []).find(
    (item) => item.id === settings.defaultVehicleId,
  );
  return {
    id: uid(),
    date: new Date().toLocaleDateString("sv-SE"),
    endDate: new Date().toLocaleDateString("sv-SE"),
    startTime: "08:00",
    endTime: "17:00",
    startPlace: "",
    destination: "",
    purpose: "",
    customer: "",
    order: "",
    costCenter: "",
    plate: vehicle?.plate || "",
    vehicle: vehicle?.name || "",
    vehicleId: vehicle?.id,
    vehicleType:
      vehicle?.ownership === "privatwagen"
        ? "privatfahrzeug"
        : "firmenfahrzeug",
    businessKm: 0,
    privateKm: 0,
    tripType: "dienstlich",
    notes: "",
    overnight: false,
    absenceConfirmed: false,
    meals: { breakfast: false, lunch: false, dinner: false },
    status: "ungeprüft",
    sourceHash: "",
    importedAt: new Date().toISOString(),
    warnings: [],
  };
};

/** Reisefenster (Neu, Bearbeiten, Löschen) über der Monatsübersicht. */
export const blankExpense = (): Expense => ({
  id: uid(),
  date: today(),
  category: "Parken",
  description: "",
  gross: 0,
  net: 0,
  vatRate: 19,
  vat: 0,
  currency: "EUR",
  exchangeRate: 1,
  paymentType: "privat vorgestreckt",
  paidBy: "Reisender",
  reimbursementStatus: "offen",
  businessShare: 100,
  notes: "",
  status: "ungeprüft",
  warnings: [],
});
/** Kostenfenster (Neu, Bearbeiten, Löschen) über der Monatsübersicht. */
export function focusFirstField() {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(".modal-body input:not([type=hidden]):not([disabled]), .modal-body select, .modal-body textarea")?.focus();
  }));
}

/** Zähler der Stapelerfassung im Fenster. */
export function BatchCount({ count, noun }: { count: number; noun: [string, string] }) {
  if (!count) return null;
  return <span className="batch-count" role="status">{count} {count === 1 ? noun[0] : noun[1]} in dieser Runde erfasst</span>;
}
export function Modal({
  title,
  close,
  children,
  onSubmitShortcut,
  wide = false,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
  /** Breiteres Fenster für zweispaltige Formulare. */
  wide?: boolean;
  /** Strg+Enter (macOS: ⌘+Enter) im Fenster. */
  onSubmitShortcut?: () => void;
}) {
  // Immer die aktuelle Fassung: Strg+Enter verlässt erst das Feld (z. B. „Händler“ übernimmt dabei die gelernte Regel)
  // und speichert nach dem Neuzeichnen – sonst ginge der Stand von vor dem Verlassen des Felds ins Speichern.
  const submitRef = useRef(onSubmitShortcut);
  submitRef.current = onSubmitShortcut;
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className={wide ? "modal modal-wide" : "modal"}
        onKeyDown={onSubmitShortcut ? (e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            const active = document.activeElement;
            if (active instanceof HTMLElement && e.currentTarget.contains(active)) active.blur();
            setTimeout(() => submitRef.current?.(), 0);
          }
        } : undefined}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon" onClick={close}>
            <X />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
export function Empty({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="empty">
      <div>{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
