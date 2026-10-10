import { openDB } from "idb";
import type { AppState } from "./types";
import { emptyState } from "./config";

const DB = "reisekosten-pro";
const STORE = "state";

async function db() {
  return openDB(DB, 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE))
        database.createObjectStore(STORE);
    },
  });
}

export async function loadState(): Promise<AppState> {
  const value = await (await db()).get(STORE, "main");
  return normalizeState(value);
}

export function normalizeState(value?: Partial<AppState>): AppState {
  if (!value) return structuredClone(emptyState);
  const settings = {
    ...structuredClone(emptyState.settings),
    ...(value.settings || {}),
  };
  // Persönliche Daten werden nie als Quellcode-Vorgabe veröffentlicht.
  // Vorhandene Werte aus einer Sicherung bleiben durch die Zusammenführung
  // erhalten; leere Werte werden in den Einstellungen ergänzt.
  if (!Array.isArray(settings.vehicles) || settings.vehicles.length === 0)
    settings.vehicles = structuredClone(emptyState.settings.vehicles);
  if (
    !settings.vehicles.some(
      (vehicle) => vehicle.id === settings.defaultVehicleId,
    )
  )
    settings.defaultVehicleId = settings.vehicles[0].id;
  const trips = (value.trips || []).map((trip) => {
    if (trip.vehicleId) return trip;
    const ownership =
      trip.vehicleType === "privatfahrzeug"
        ? "privatwagen"
        : trip.vehicleType === "firmenfahrzeug"
          ? "dienstwagen"
          : undefined;
    const vehicle =
      settings.vehicles.find(
        (item) =>
          ownership === item.ownership &&
          ((trip.plate && item.plate === trip.plate) ||
            (trip.vehicle && item.name === trip.vehicle)),
      ) || settings.vehicles.find((item) => item.ownership === ownership);
    return vehicle ? { ...trip, vehicleId: vehicle.id } : trip;
  });
  const expenses = (value.expenses || []).map((expense) => {
    if (!expense.vehicleId) return expense;
    const vehicle = settings.vehicles.find(
      (item) =>
        item.id === expense.vehicleId ||
        item.name === expense.vehicleId ||
        item.plate === expense.vehicleId,
    );
    return vehicle ? { ...expense, vehicleId: vehicle.id } : expense;
  });
  return {
    ...structuredClone(emptyState),
    ...value,
    trips,
    expenses,
    receiptInbox: value.receiptInbox || [],
    merchantRules: value.merchantRules || [],
    profiles: value.profiles || [],
    statements: value.statements || [],
    changes: value.changes || [],
    settings,
  };
}

export async function saveState(state: AppState) {
  await (await db()).put(STORE, state, "main");
}

export async function clearState() {
  await (await db()).delete(STORE, "main");
}
