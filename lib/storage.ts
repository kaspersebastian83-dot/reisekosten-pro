import { openDB, type IDBPDatabase } from "idb";
import type { AppState } from "./types";
import { emptyState } from "./config";

const DB = "reisekosten-pro";
const STORE = "state";

let connection: Promise<IDBPDatabase> | undefined;

async function db() {
  if (!connection) {
    connection = new Promise<IDBPDatabase>((resolve, reject) => {
      let expired = false;
      const fail = (message: string) => { expired = true; reject(new Error(message)); };
      const timeout = setTimeout(() => fail("Der lokale Speicher antwortet nicht. Bitte andere App-Tabs schließen und erneut versuchen."), 10000);
      const opening = openDB(DB, 1, {
        upgrade(database) {
          if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
        },
        blocked() { fail("Der lokale Speicher ist durch einen anderen Tab blockiert. Bitte diesen schließen und erneut versuchen."); },
        blocking() { connection = undefined; void opening.then((database) => database.close()); },
        terminated() { connection = undefined; },
      });
      opening.then((database) => {
        clearTimeout(timeout);
        if (expired) database.close();
        else resolve(database);
      }, (error: unknown) => { clearTimeout(timeout); reject(error); });
    });
    connection.catch(() => { connection = undefined; });
  }
  return connection;
}

// Fehlgeformte Sicherungen dürfen weder den Bildschirm noch vorhandene Daten ersetzen.
function validateState(value: Partial<AppState>) {
  const fail = () => { throw new Error("Ungültiges Datenformat. Bitte eine vollständige Reisekosten-JSON-Sicherung verwenden."); };
  const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const texts = (v: Record<string, unknown>, keys: string[]) => keys.every((key) => typeof v[key] === "string");
  const numbers = (v: Record<string, unknown>, keys: string[]) => keys.every((key) => typeof v[key] === "number" && Number.isFinite(v[key]));
  const meals = (v: unknown) => record(v) && ["breakfast", "lunch", "dinner"].every((key) => typeof v[key] === "boolean");
  const warnings = (v: unknown) => Array.isArray(v) && v.every((item) => typeof item === "string");
  if (!record(value) || !record(value.settings)) fail();
  for (const key of ["trips", "expenses", "receiptInbox", "merchantRules", "profiles", "statements", "changes"] as const) {
    if (value[key] !== undefined && !Array.isArray(value[key])) fail();
  }
  for (const trip of value.trips || []) {
    if (!record(trip) || !texts(trip, ["id", "date", "startTime", "endTime", "startPlace", "destination", "purpose", "customer", "order", "costCenter", "plate", "vehicle", "vehicleType", "tripType", "notes", "status"]) || !numbers(trip, ["businessKm", "privateKm"]) || !warnings(trip.warnings) || !meals(trip.meals)) fail();
    if (trip.dailyMeals && (!record(trip.dailyMeals) || !Object.values(trip.dailyMeals).every(meals))) fail();
  }
  const receipt = (v: unknown) => record(v) && texts(v, ["id", "name", "type", "hash", "dataUrl"]) && numbers(v, ["size"]);
  for (const expense of value.expenses || []) {
    if (!record(expense) || !texts(expense, ["id", "date", "category", "description", "currency", "paymentType", "reimbursementStatus", "status"]) || !numbers(expense, ["gross", "net", "vatRate", "vat", "exchangeRate", "businessShare"]) || !warnings(expense.warnings) || (expense.receipt && !receipt(expense.receipt))) fail();
  }
  for (const item of value.receiptInbox || []) {
    if (!record(item) || !receipt(item.receipt) || !record(item.suggestion) || !numbers(item.suggestion, ["confidence"]) || !texts(item, ["id", "capturedAt", "status", "notes"])) fail();
  }
  const settings = value.settings!;
  for (const key of Object.keys(emptyState.settings) as (keyof typeof settings)[]) {
    const field = settings[key];
    const fallback = emptyState.settings[key];
    if (field !== undefined && !Array.isArray(fallback) && (typeof field !== typeof fallback || (typeof field === "number" && !Number.isFinite(field)))) fail();
  }
  if (settings.vehicles !== undefined && (!Array.isArray(settings.vehicles) || settings.vehicles.some((v) => !record(v) || !texts(v, ["id", "name", "plate", "ownership", "reimbursementMethod"])))) fail();
  if (settings.tariffs !== undefined && (!Array.isArray(settings.tariffs) || settings.tariffs.some((v) => !record(v) || !texts(v, ["id", "label", "validFrom", "country", "kind", "source", "checkedAt", "unit"]) || !numbers(v, ["amount"])))) fail();
  for (const profile of value.profiles || []) if (!record(profile) || !texts(profile, ["id", "name"]) || !record(profile.mapping)) fail();
  for (const rule of value.merchantRules || []) if (!record(rule) || !texts(rule, ["id", "merchantPattern", "category", "paymentType"]) || !numbers(rule, ["uses", "vatRate"])) fail();
  for (const statement of value.statements || []) {
    if (!record(statement) || !texts(statement, ["id", "month", "number", "status"]) || !numbers(statement, ["version"]) || !record(statement.data) || !Array.isArray(statement.data.rows) || !record(statement.data.totals)) fail();
    if (!numbers(statement.data.totals, ["allowance", "mileage", "fuel", "accommodation", "other", "companyPaid", "reimbursed", "privatelyAdvanced", "openAmount", "grandTotal"])) fail();
    for (const row of statement.data.rows) {
      if (!record(row) || !texts(row, ["date", "firstStart", "lastEnd", "reason"]) || !numbers(row, ["absenceMinutes", "totalKm", "allowanceBefore", "breakfastCut", "lunchCut", "dinnerCut", "allowanceAfter", "mileage", "fuel", "accommodation", "other", "companyPaid", "reimbursed", "privatelyAdvanced", "openAmount"]) || !warnings(row.warnings) || !warnings(row.destinations) || !warnings(row.customers) || !Array.isArray(row.trips)) fail();
      validateState({ settings: value.settings, trips: row.trips });
    }
    if (statement.settingsSnapshot || statement.expensesSnapshot) validateState({ settings: statement.settingsSnapshot || value.settings, expenses: statement.expensesSnapshot });
  }
  for (const change of value.changes || []) if (!record(change) || !texts(change, ["id", "entityType", "entityId", "field", "reason", "user", "changedAt"])) fail();
}

export async function loadState(): Promise<AppState> {
  const value = await (await db()).get(STORE, "main");
  return normalizeState(value);
}

export function normalizeState(value?: Partial<AppState>): AppState {
  if (value === undefined) return structuredClone(emptyState);
  validateState(value);
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
