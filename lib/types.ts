export type ReviewStatus =
  | "importiert"
  | "ungeprüft"
  | "geprüft"
  | "vollständig"
  | "zur Freigabe eingereicht"
  | "freigegeben"
  | "ausgezahlt"
  | "storniert";

export type VehicleType =
  "firmenfahrzeug" | "privatfahrzeug" | "mietwagen" | "öffentlich" | "anderes";
export type PaymentType =
  "Firmenkarte" | "privat vorgestreckt" | "Unternehmen" | "bereits erstattet" | "unbekannt";

export interface VehicleProfile {
  id: string;
  name: string;
  plate: string;
  ownership: "dienstwagen" | "privatwagen";
  reimbursementMethod: "keine" | "pauschale" | "tatsächliche Kosten";
  active: boolean;
}

export interface Tariff {
  id: string;
  label: string;
  validFrom: string;
  validTo?: string;
  amount: number;
  country: string;
  kind:
    | "partial"
    | "full"
    | "arrival"
    | "departure"
    | "mileage"
    | "breakfast"
    | "lunch"
    | "dinner";
  source: string;
  checkedAt: string;
  unit: "EUR" | "percent";
}

export interface MealSelection {
  breakfast: boolean;
  lunch: boolean;
  dinner: boolean;
}

export interface Trip {
  id: string;
  date: string;
  endDate?: string;
  startTime: string;
  endTime: string;
  startPlace: string;
  destination: string;
  purpose: string;
  customer: string;
  order: string;
  costCenter: string;
  plate: string;
  vehicle: string;
  vehicleId?: string;
  vehicleType: VehicleType;
  kmStart?: number;
  kmEnd?: number;
  businessKm: number;
  totalKm?: number;
  commuteKm?: number;
  privateKm: number;
  driveMinutes?: number;
  standMinutes?: number;
  driver?: string;
  importSource?: string;
  tripType: "dienstlich" | "privat" | "erste Tätigkeitsstätte";
  notes: string;
  overnight: boolean;
  tripGroup?: string;
  absenceConfirmed: boolean;
  manualAbsenceMinutes?: number;
  meals: MealSelection;
  dailyMeals?: Record<string, MealSelection>;
  status: ReviewStatus;
  sourceHash: string;
  importedAt: string;
  warnings: string[];
}

export interface Receipt {
  id: string;
  name: string;
  type: string;
  size: number;
  hash: string;
  dataUrl: string;
}

// Optional receipt context; old backups need no migration or inferred defaults.
export interface ExpenseContext {
  projectNumber?: string;
  /** Bewusst ohne Reise und ohne Projekt erfasst (z. B. Büromaterial): keine Hinweise auf fehlende Zuordnung. */
  noTrip?: boolean;
  stayStart?: string;
  stayEnd?: string;
  breakfastIncluded?: "yes" | "no" | "unknown";
}

export interface ReceiptSuggestion extends ExpenseContext {
  date?: string;
  gross?: number;
  merchant?: string;
  invoiceNumber?: string;
  category?: string;
  vatRate?: number;
  rawText?: string;
  confidence: number;
}

export interface ReceiptInboxItem {
  id: string;
  receipt: Receipt;
  capturedAt: string;
  status: "neu" | "erkannt" | "zugeordnet" | "archiviert";
  suggestion: ReceiptSuggestion;
  tripId?: string;
  expenseId?: string;
  paymentType?: PaymentType;
  notes: string;
}

export interface MerchantRule {
  id: string;
  merchantPattern: string;
  category: string;
  paymentType: PaymentType;
  vatRate: number;
  uses: number;
  updatedAt: string;
}

export interface Expense extends ExpenseContext {
  id: string;
  date: string;
  tripId?: string;
  category: string;
  description: string;
  gross: number;
  net: number;
  vatRate: number;
  vat: number;
  currency: string;
  exchangeRate: number;
  paymentType: PaymentType;
  paidBy: string;
  reimbursementStatus: "offen" | "erstattet" | "nicht erstattungsfähig";
  vehicleId?: string;
  fuelLiters?: number;
  odometer?: number;
  merchant?: string;
  invoiceNumber?: string;
  businessShare: number;
  notes: string;
  receipt?: Receipt;
  status: ReviewStatus;
  warnings: string[];
}

export interface ImportProfile {
  id: string;
  name: string;
  mapping: Record<string, string>;
  delimiter?: string;
  createdAt: string;
}

export interface ChangeLog {
  id: string;
  entityType: "trip" | "expense" | "statement" | "settings" | "receipt";
  entityId: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string;
  user: string;
  changedAt: string;
}

export interface StatementSnapshot {
  id: string;
  month: string;
  number: string;
  createdAt: string;
  status: ReviewStatus;
  version: number;
  locked: boolean;
  data: StatementData;
  settingsSnapshot?: Settings;
  expensesSnapshot?: Expense[];
  // Optional evidence for invoice-month expenses linked to trips outside that month.
  relatedTripsSnapshot?: Trip[];
}

export interface Settings {
  profileName: string;
  employeeNumber: string;
  company: string;
  department: string;
  costCenter: string;
  homeAddress: string;
  firstWorkplace: string;
  regularSites: string;
  timezone: string;
  rounding: "keine" | "5 Minuten" | "15 Minuten";
  /** Außendienst: Dienstreisen, Fahrtenbuch, Verpflegung. Innendienst: nur Kosten und Belege, ohne Reise-/Projektzuordnung. */
  staffRole: "aussendienst" | "innendienst";
  ruleMode: "legal" | "internal";
  internalMinutes: number;
  internalComparator: "greater" | "atLeast";
  mileageMethod: "pauschale" | "tatsächliche Kosten";
  vehicles: VehicleProfile[];
  defaultVehicleId: string;
  tariffs: Tariff[];
}

export interface AppState {
  version: number;
  trips: Trip[];
  expenses: Expense[];
  receiptInbox: ReceiptInboxItem[];
  merchantRules: MerchantRule[];
  profiles: ImportProfile[];
  statements: StatementSnapshot[];
  changes: ChangeLog[];
  settings: Settings;
}

export interface DayCalculation {
  calculation?: {
    threshold: string;
    manual: boolean;
    meals: MealSelection;
    fullRate: number;
    mealPercent: { breakfast: number; lunch: number; dinner: number };
    rateLabel: string;
  };
  date: string;
  trips: Trip[];
  firstStart: string;
  lastEnd: string;
  absenceMinutes: number;
  totalKm: number;
  allowanceBefore: number;
  breakfastCut: number;
  lunchCut: number;
  dinnerCut: number;
  allowanceAfter: number;
  reason: string;
  tariffIds: string[];
  warnings: string[];
  destinations: string[];
  customers: string[];
}

export interface StatementRow extends DayCalculation {
  contributions?: {
    mileage: { tripId: string; vehicle: string; ownership: string; km: number; rate: number; amount: number; reason: string }[];
    expenses: { id: string; description: string; category: string; gross: number; currency: string; receiptName?: string; businessShare: number; exchangeRate: number; paymentType: string; reimbursementStatus: string; excluded: boolean; openAmount: number }[];
    openExpenses: number;
  };
  mileage: number;
  fuel: number;
  accommodation: number;
  other: number;
  companyPaid: number;
  reimbursed: number;
  privatelyAdvanced: number;
  openAmount: number;
}

export interface StatementData {
  month: string;
  rows: StatementRow[];
  totals: {
    allowance: number;
    mileage: number;
    fuel: number;
    accommodation: number;
    other: number;
    companyPaid: number;
    reimbursed: number;
    privatelyAdvanced: number;
    openAmount: number;
    grandTotal: number;
  };
  tariffSnapshot: Tariff[];
}
