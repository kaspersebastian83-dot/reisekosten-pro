import type {
  AppState,
  DayCalculation,
  Expense,
  Settings,
  StatementData,
  StatementRow,
  Tariff,
  Trip,
} from "./types";

export const round2 = (n: number) =>
  Math.round((n + Number.EPSILON) * 100) / 100;

export function minutesBetween(
  date: string,
  start: string,
  end: string,
  endDate?: string,
) {
  if (!start || !end) return 0;
  const withSeconds = (value: string) =>
    value.length === 5 ? `${value}:00` : value;
  const a = new Date(`${date}T${withSeconds(start)}`);
  let b = new Date(`${endDate || date}T${withSeconds(end)}`);
  if (!endDate && b < a) b = new Date(b.getTime() + 86_400_000);
  // Angefangene Minuten werden aufgerundet. Damit bleibt z. B. 8:00:01
  // rechtlich korrekt "mehr als 8 Stunden" und wird nicht auf 8:00 gekürzt.
  return Math.max(0, Math.ceil((b.getTime() - a.getTime()) / 60000));
}

export function tariffFor(
  settings: Settings,
  date: string,
  kind: Tariff["kind"],
) {
  return settings.tariffs
    .filter(
      (t) =>
        t.kind === kind &&
        t.country === "DE" &&
        t.validFrom <= date &&
        (!t.validTo || t.validTo >= date),
    )
    .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
}

export function vehicleForTrip(settings: Settings, trip: Trip) {
  return (settings.vehicles || []).find(
    (vehicle) => vehicle.id === trip.vehicleId,
  );
}

export function usesMileageAllowance(settings: Settings, trip: Trip) {
  const vehicle = vehicleForTrip(settings, trip);
  if (vehicle)
    return (
      vehicle.ownership === "privatwagen" &&
      vehicle.reimbursementMethod === "pauschale"
    );
  return (
    trip.vehicleType === "privatfahrzeug" &&
    settings.mileageMethod === "pauschale"
  );
}

export function expenseConflictsWithMileageAllowance(
  settings: Settings,
  trips: Trip[],
  expense: Expense,
) {
  if (expense.category !== "Tanken") return false;
  const trip = expense.tripId
    ? trips.find((item) => item.id === expense.tripId)
    : undefined;
  if (trip) return usesMileageAllowance(settings, trip);
  const vehicle = (settings.vehicles || []).find(
    (item) => item.id === expense.vehicleId,
  );
  return (
    vehicle?.ownership === "privatwagen" &&
    vehicle.reimbursementMethod === "pauschale"
  );
}

function thresholdEligible(minutes: number, settings: Settings) {
  if (settings.ruleMode === "legal") return minutes > 480;
  return settings.internalComparator === "greater"
    ? minutes > settings.internalMinutes
    : minutes >= settings.internalMinutes;
}

function tripDays(trip: Trip) {
  const days: string[] = [];
  const start = new Date(`${trip.date}T12:00:00Z`);
  const end = new Date(`${trip.endDate || trip.date}T12:00:00Z`);
  for (let d = start; d <= end; d = new Date(d.getTime() + 86_400_000))
    days.push(d.toISOString().slice(0, 10));
  return days;
}

export function groupTripsByDay(trips: Trip[]) {
  const map = new Map<string, Trip[]>();
  for (const trip of trips.filter(
    (t) => t.status !== "storniert" && t.tripType === "dienstlich",
  )) {
    for (const day of tripDays(trip))
      map.set(day, [...(map.get(day) || []), trip]);
  }
  return map;
}

const dayAfter = (date: string) =>
  new Date(new Date(`${date}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
const dateDe = (date: string) => date.split("-").reverse().join(".");
const hhmm = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

/**
 * Über Mitternacht ohne Übernachtung (§ 9 Abs. 4a Satz 3 Nr. 3 EStG): Beginnt die Reise an einem Tag und endet
 * am Folgetag ohne Übernachtung, zählt die gesamte Abwesenheit als ein Tag – für den Kalendertag mit dem
 * überwiegenden Teil. Gilt nur ohne bestätigte Übernachtung und ohne manuelle Abwesenheitskorrektur, mit genau einem
 * Datumswechsel und vollständigen Zeiten; sonst null und die bisherige An-/Abreiseberechnung bleibt.
 */
export function midnightWithoutOvernight(trip: Trip) {
  if (trip.overnight || trip.manualAbsenceMinutes != null || !trip.endDate || trip.endDate !== dayAfter(trip.date) || !trip.startTime || !trip.endTime) return null;
  const before = minutesBetween(trip.date, trip.startTime, "24:00");
  const after = minutesBetween(trip.endDate, "00:00", trip.endTime);
  return { before, after, total: before + after, day: after > before ? trip.endDate : trip.date, tie: after === before };
}

export function calculateDay(
  date: string,
  trips: Trip[],
  settings: Settings,
): DayCalculation {
  const warnings = [...new Set(trips.flatMap((t) => t.warnings))];
  const night = trips
    .map((trip) => ({ trip, split: midnightWithoutOvernight(trip) }))
    .filter((item): item is { trip: Trip; split: NonNullable<ReturnType<typeof midnightWithoutOvernight>> } => !!item.split);
  const nightTrips = new Set(night.map((item) => item.trip));
  const regular = trips.filter((t) => !nightTrips.has(t));
  const nightHere = night.filter((item) => item.split.day === date);
  const nightMinutes = nightHere.reduce((sum, item) => sum + item.split.total, 0);
  if (nightHere.some((item) => item.split.tie))
    warnings.push("Über Mitternacht ohne Übernachtung: vor und nach Mitternacht gleich lange abwesend – angesetzt am Abfahrtstag, bitte prüfen.");
  const starts = regular
    .filter((t) => t.date === date)
    .map((t) => t.startTime)
    .filter(Boolean)
    .sort();
  const ends = regular
    .filter((t) => (t.endDate || t.date) === date)
    .map((t) => t.endTime)
    .filter(Boolean)
    .sort();
  // Zeiten der Nachtfahrt: am angesetzten Tag Abfahrt und Rückkehr, am anderen Tag die echte Grenze (Abfahrt bzw. Rückkehr).
  const nightStart = night.filter((item) => item.split.day === date || item.trip.date === date).map((item) => item.trip.startTime).sort()[0];
  const nightEnd = night.filter((item) => item.split.day === date || item.trip.endDate === date).map((item) => item.trip.endTime).sort().at(-1);
  const firstStart = starts[0] || nightStart || "00:00";
  const lastEnd = ends.at(-1) || nightEnd || "23:59";
  const multi = regular.find((t) => (t.endDate || t.date) > t.date);
  const isArrival = !!multi && date === multi.date;
  const isDeparture = !!multi && date === multi.endDate;
  const isFull =
    !!multi && date > multi.date && date < (multi.endDate || multi.date);
  let absenceMinutes = 0;
  const manual = trips.find(
    (t) => t.manualAbsenceMinutes != null,
  )?.manualAbsenceMinutes;
  if (manual != null) absenceMinutes = manual;
  else if (isFull) absenceMinutes = 1440;
  else if (isArrival)
    absenceMinutes = minutesBetween(date, firstStart, "24:00");
  else if (isDeparture) absenceMinutes = minutesBetween(date, "00:00", lastEnd);
  else if (starts.length && ends.length)
    absenceMinutes = minutesBetween(date, starts[0], ends.at(-1)!) + nightMinutes;
  else if (regular.length) warnings.push("Abwesenheitsdauer muss bestätigt werden.");
  else absenceMinutes = nightMinutes;

  if (trips.some((t) => !t.absenceConfirmed))
    warnings.push("Abwesenheitsdauer muss bestätigt werden.");
  // Über Mitternacht ohne Übernachtung gibt es höchstens die Teilpauschale, auch bei 24 Stunden und mehr.
  const nightOnly = nightHere.length > 0 && !multi && manual == null;
  const kind: Tariff["kind"] | null = nightOnly
    ? thresholdEligible(absenceMinutes, settings) ? "partial" : null
    : isFull || absenceMinutes >= 1440
      ? "full"
      : isArrival
        ? "arrival"
        : isDeparture
          ? "departure"
          : thresholdEligible(absenceMinutes, settings)
            ? "partial"
            : null;
  const baseTariff = kind ? tariffFor(settings, date, kind) : undefined;
  const fullTariff = tariffFor(settings, date, "full");
  const noMeals = { breakfast: false, lunch: false, dinner: false };
  const mealsOn = (t: Trip, day: string) => t.dailyMeals?.[day] || (t.date === day ? t.meals : noMeals);
  // Über Mitternacht ohne Übernachtung gibt es nur die eine Pauschale am überwiegenden Tag: Mahlzeiten beider Kalendertage
  // dieser Reise kürzen dort, am anderen Tag nicht (sonst ginge eine Mahlzeit am anderen Tag verloren bzw. kürzte gegen 0 €).
  const nightSplit = new Map(night.map((item) => [item.trip, item.split]));
  const meals = trips.reduce(
    (m, t) => {
      const split = nightSplit.get(t);
      const days = !split ? [date] : split.day === date ? [t.date, t.endDate || t.date] : [];
      for (const selected of days.map((day) => mealsOn(t, day)))
        m = {
          breakfast: m.breakfast || selected.breakfast,
          lunch: m.lunch || selected.lunch,
          dinner: m.dinner || selected.dinner,
        };
      return m;
    },
    { ...noMeals },
  );
  const full = fullTariff?.amount || 0;
  const breakfastCut = meals.breakfast
    ? round2(
        full * ((tariffFor(settings, date, "breakfast")?.amount ?? 20) / 100),
      )
    : 0;
  const lunchCut = meals.lunch
    ? round2(full * ((tariffFor(settings, date, "lunch")?.amount ?? 40) / 100))
    : 0;
  const dinnerCut = meals.dinner
    ? round2(full * ((tariffFor(settings, date, "dinner")?.amount ?? 40) / 100))
    : 0;
  const allowanceBefore = baseTariff?.amount || 0;
  const allowanceAfter = Math.max(
    0,
    round2(allowanceBefore - breakfastCut - lunchCut - dinnerCut),
  );
  const reason =
    kind === "full"
      ? "Voller Kalendertag (24 Stunden)"
      : kind === "arrival"
        ? "Anreisetag einer mehrtägigen Reise"
        : kind === "departure"
          ? "Abreisetag einer mehrtägigen Reise"
          : night.length && !multi && manual == null
            ? nightHere.length
              ? `Über Mitternacht ohne Übernachtung: ${hhmm(absenceMinutes)} Std. Abwesenheit, überwiegend an diesem Tag – ${kind ? "Schwelle erfüllt" : "Schwelle nicht überschritten"} (eine Pauschale für die ganze Reise; falls übernachtet wurde, in der Dienstreise bestätigen)`
              : `Über Mitternacht ohne Übernachtung: angesetzt am ${night.map((item) => dateDe(item.split.day)).join(", ")} (überwiegender Teil der Abwesenheit)${kind ? ` – zusätzlich ${hhmm(absenceMinutes)} Std. an diesem Tag, Schwelle erfüllt` : ""}`
            : kind === "partial"
              ? `${hhmm(absenceMinutes)} Std. Abwesenheit – Schwelle erfüllt`
              : "Schwelle für eintägige Auswärtstätigkeit nicht überschritten";
  return {
    date,
    trips,
    firstStart,
    lastEnd,
    absenceMinutes,
    // Bei einer mehrtägigen Reise ist der importierte Kilometerwert in der Regel
    // ein Gesamtwert. Er wird deshalb nur am Starttag angesetzt und nicht an
    // jedem durchlaufenen Kalendertag vervielfacht.
    totalKm: round2(
      trips
        .filter((t) => t.date === date)
        .reduce((s, t) => s + (t.businessKm || 0), 0),
    ),
    allowanceBefore,
    breakfastCut,
    lunchCut,
    dinnerCut,
    allowanceAfter,
    reason,
    calculation: {
      threshold: settings.ruleMode === "legal" ? "Mehr als 8 Stunden" : `${settings.internalComparator === "greater" ? "Mehr als" : "Mindestens"} ${settings.internalMinutes} Minuten (interne Regel)`,
      manual: manual != null, meals, fullRate: full,
      mealPercent: {
        breakfast: tariffFor(settings, date, "breakfast")?.amount ?? 20,
        lunch: tariffFor(settings, date, "lunch")?.amount ?? 40,
        dinner: tariffFor(settings, date, "dinner")?.amount ?? 40,
      },
      rateLabel: baseTariff ? `${baseTariff.label} · gültig ab ${baseTariff.validFrom}` : kind ? "Kein gültiger Tarif hinterlegt" : "Keine Pauschale für diesen Tag",
    },
    tariffIds: [baseTariff?.id, fullTariff?.id].filter(Boolean) as string[],
    warnings: [...new Set(warnings)],
    destinations: [...new Set(trips.map((t) => t.destination).filter(Boolean))],
    customers: [...new Set(trips.map((t) => t.customer).filter(Boolean))],
  };
}

/** Bruttobetrag in Euro (Fremdwährung mit dem gespeicherten Kurs; EUR: Kurs 1). Für Summen nach Kostenart. */
export const expenseGrossEur = (e: Expense) => round2(e.gross * (e.exchangeRate || 1));

export function expenseReimbursable(e: Expense) {
  if (e.reimbursementStatus !== "offen") return 0;
  if (e.paymentType !== "privat vorgestreckt") return 0;
  return round2(e.gross * (e.businessShare / 100) * (e.exchangeRate || 1));
}

function requiresThreeMonthReview(
  allTrips: Trip[],
  date: string,
  dayTrips: Trip[],
) {
  const destinations = new Set(
    dayTrips.map((t) => t.destination.trim().toLowerCase()).filter(Boolean),
  );
  for (const destination of destinations) {
    const dates = [
      ...new Set(
        allTrips
          .filter(
            (t) =>
              t.tripType === "dienstlich" &&
              t.destination.trim().toLowerCase() === destination,
          )
          .map((t) => t.date),
      ),
    ].sort();
    let periodStart = dates[0];
    let previous = dates[0];
    for (const current of dates.slice(1)) {
      const gap =
        (new Date(`${current}T12:00:00`).getTime() -
          new Date(`${previous}T12:00:00`).getTime()) /
        86_400_000;
      if (gap >= 28) periodStart = current;
      previous = current;
      if (current === date) {
        const span =
          (new Date(`${current}T12:00:00`).getTime() -
            new Date(`${periodStart}T12:00:00`).getTime()) /
          86_400_000;
        if (span >= 80) return true;
      }
    }
  }
  return false;
}

export function buildStatement(state: AppState, month: string): StatementData {
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-31`;
  const trips = state.trips.filter(
    (t) => t.date <= monthEnd && (t.endDate || t.date) >= monthStart,
  );
  const grouped = groupTripsByDay(trips);
  for (const expense of state.expenses) {
    if (expense.status !== "storniert" && expense.date.startsWith(month) && !grouped.has(expense.date)) grouped.set(expense.date, []);
  }
  const rows: StatementRow[] = [...grouped.entries()]
    .filter(([date]) => date.startsWith(month))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayTrips]) => {
      const day = calculateDay(date, dayTrips, state.settings);
      if (!dayTrips.length) {
        day.firstStart = "";
        day.lastEnd = "";
        day.warnings = [];
        day.reason = "Ausgaben ohne dienstliche Fahrt an diesem Tag";
      }
      if (requiresThreeMonthReview(state.trips, date, dayTrips))
        day.warnings.push("Prüfung der Drei-Monats-Regel erforderlich.");
      const expenses = state.expenses.filter((e) => e.date === date && e.status !== "storniert");
      const fuel = round2(
        expenses
          .filter(
            (expense) =>
              expense.category === "Tanken" &&
              !expenseConflictsWithMileageAllowance(
                state.settings,
                state.trips,
                expense,
              ),
          )
          .reduce((s, e) => s + expenseGrossEur(e), 0),
      );
      const accommodation = round2(
        expenses
          .filter((e) => ["Hotel", "Übernachtung"].includes(e.category))
          .reduce((s, e) => s + expenseGrossEur(e), 0),
      );
      const other = round2(
        expenses
          .filter(
            (e) => !["Tanken", "Hotel", "Übernachtung"].includes(e.category),
          )
          .reduce((s, e) => s + expenseGrossEur(e), 0),
      );
      const mileageDetails = dayTrips.map((trip) => {
        const profile = vehicleForTrip(state.settings, trip);
        const eligible = trip.date === date && usesMileageAllowance(state.settings, trip);
        const rate = eligible ? tariffFor(state.settings, trip.date, "mileage")?.amount || 0 : 0;
        return { tripId: trip.id, vehicle: profile?.name || trip.vehicle,
          ownership: profile ? profile.ownership === "privatwagen" ? "Privatwagen" : "Dienstwagen" : trip.vehicleType,
          km: eligible ? trip.businessKm : 0, rate, amount: eligible ? trip.businessKm * rate : 0,
          reason: trip.date !== date ? "Kilometer werden nur am Abfahrtstag angesetzt." : eligible ? rate ? "Privatwagen mit Kilometerpauschale" : "Kein gültiger Kilometertarif" : "Keine Kilometerpauschale für dieses Fahrzeug / diese Erstattungsart." };
      });
      const mileage = round2(mileageDetails.reduce((sum, item) => sum + item.amount, 0));
      const companyPaid = round2(
        expenses
          .filter((e) => ["Firmenkarte", "Unternehmen", "Bürokasse"].includes(e.paymentType))
          .reduce((s, e) => s + expenseGrossEur(e), 0),
      );
      const reimbursed = round2(
        expenses
          .filter((e) => e.reimbursementStatus === "erstattet")
          .reduce((s, e) => s + expenseGrossEur(e), 0),
      );
      const privatelyAdvanced = round2(
        expenses
          .filter((e) => e.paymentType === "privat vorgestreckt")
          .reduce((s, e) => s + expenseGrossEur(e), 0),
      );
      const expenseDetails = expenses.map((expense) => {
        const excluded = expenseConflictsWithMileageAllowance(state.settings, state.trips, expense);
        return { id: expense.id, description: expense.description, category: expense.category, gross: expense.gross, currency: expense.currency, receiptName: expense.receipt?.name,
          businessShare: expense.businessShare, exchangeRate: expense.exchangeRate || 1,
          paymentType: expense.paymentType, reimbursementStatus: expense.reimbursementStatus,
          excluded, openAmount: excluded ? 0 : expenseReimbursable(expense) };
      });
      const openExpenses = round2(expenseDetails.reduce((sum, expense) => sum + expense.openAmount, 0));
      const openAmount = round2(day.allowanceAfter + mileage + openExpenses);
      return {
        ...day,
        contributions: { mileage: mileageDetails, expenses: expenseDetails, openExpenses },
        mileage,
        fuel,
        accommodation,
        other,
        companyPaid,
        reimbursed,
        privatelyAdvanced,
        openAmount,
      };
    });
  const sum = (key: keyof StatementRow) =>
    round2(
      rows.reduce(
        (s, r) => s + (typeof r[key] === "number" ? (r[key] as number) : 0),
        0,
      ),
    );
  const totals = {
    allowance: sum("allowanceAfter"),
    mileage: sum("mileage"),
    fuel: sum("fuel"),
    accommodation: sum("accommodation"),
    other: sum("other"),
    companyPaid: sum("companyPaid"),
    reimbursed: sum("reimbursed"),
    privatelyAdvanced: sum("privatelyAdvanced"),
    openAmount: sum("openAmount"),
    grandTotal: round2(
      sum("allowanceAfter") +
        sum("mileage") +
        sum("fuel") +
        sum("accommodation") +
        sum("other"),
    ),
  };
  return {
    month,
    rows,
    totals,
    tariffSnapshot: structuredClone(state.settings.tariffs),
  };
}

export function validateTrip(t: Trip) {
  const w: string[] = [];
  if (!t.purpose) w.push("Reisezweck fehlt");
  if (!t.destination) w.push("Reiseziel fehlt");
  if (t.businessKm < 0 || t.privateKm < 0) w.push("Negative Kilometer");
  if (t.kmStart != null && t.kmEnd != null && t.kmEnd < t.kmStart)
    w.push("Kilometerstand Ende kleiner als Start");
  const mins = minutesBetween(t.date, t.startTime, t.endTime, t.endDate);
  if (mins && t.businessKm / (mins / 60) > 180)
    w.push("Unrealistische Durchschnittsgeschwindigkeit");
  if (
    t.tripType !== "dienstlich" &&
    t.meals &&
    (t.meals.breakfast || t.meals.lunch || t.meals.dinner)
  )
    w.push("Mahlzeitenangabe bei nicht-dienstlicher Fahrt");
  if (!t.absenceConfirmed) w.push("Abwesenheitsdauer muss bestätigt werden.");
  return w;
}

export function duplicateKey(t: Partial<Trip>) {
  return [
    t.date,
    t.startTime,
    t.endTime,
    t.startPlace?.trim().toLowerCase(),
    t.destination?.trim().toLowerCase(),
    t.kmStart,
    t.kmEnd,
    t.purpose?.trim().toLowerCase(),
  ].join("|");
}
