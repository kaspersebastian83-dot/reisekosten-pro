import type { DayCalculation, StatementData, StatementRow } from "../lib/types";
import { round2 } from "../lib/calculations";
const euro = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const date = (d: string) => d.split("-").reverse().join(".");
const number = (n: number) => n.toLocaleString("de-DE", { maximumFractionDigits: 8 });

export function DayDetails({ day, frozen = false, tripId }: { day: DayCalculation; frozen?: boolean; tripId?: string }) {
  const row = "openAmount" in day ? day as StatementRow : undefined;
  const context = day.calculation;
  return <details className="calculation-details"><summary>Berechnung anzeigen{tripId ? " · Fahrt" : ` · ${date(day.date)}`}</summary>
    <div className="calculation-body">
      <h4>{date(day.date)} · {frozen ? "Gespeicherte Berechnung" : "Berechnung dieses Tages"}</h4>
      {tripId && <p>Die Spesen gelten gemeinsam für den Tag und werden nicht je Fahrt addiert. Diese Fahrt ist Teil des unten gezeigten Tages.</p>}
      <p>{day.firstStart || "Zeit offen"} – {day.lastEnd || "Zeit offen"} · {Math.floor(day.absenceMinutes / 60)}:{String(day.absenceMinutes % 60).padStart(2, "0")} Std. Abwesenheit{context?.manual ? " (manuell bestätigt)" : ""}</p>
      {day.trips.map((trip) => <p key={trip.id}>{date(trip.date)}{trip.endDate ? ` – ${date(trip.endDate)}` : ""} · {trip.startTime || "Zeit offen"} – {trip.endTime || "Zeit offen"} · {trip.purpose || "Zweck offen"}</p>)}
      <p>{day.reason}. {context && `Schwelle: ${context.threshold}. Tarif: ${context.rateLabel.replace("partial", "Eintägig").replace("full", "Voller Tag").replace("arrival", "Anreise").replace("departure", "Abreise")}.`}</p>
      <p>Pauschale vor Kürzung: <b>{euro(day.allowanceBefore)}</b></p>
      <ul>{([ ["breakfast", "Frühstück", day.breakfastCut], ["lunch", "Mittagessen", day.lunchCut], ["dinner", "Abendessen", day.dinnerCut] ] as const).map(([key, label, cut]) =>
        <li key={key}>{label}: {context ? context.meals[key] ? `gestellt · ${number(context.mealPercent[key])} % von ${euro(context.fullRate)}` : "nicht gestellt" : "historische Auswahl nicht gespeichert"} · Kürzung {euro(cut)}</li>)}</ul>
      <p>{euro(day.allowanceBefore)} − {euro(day.breakfastCut)} − {euro(day.lunchCut)} − {euro(day.dinnerCut)} = <b>{euro(day.allowanceAfter)} Spesen</b>. Kürzungen werden auf Cent gerundet; die Spesen fallen höchstens auf 0 €. {day.allowanceBefore - day.breakfastCut - day.lunchCut - day.dinnerCut < 0 && `Begrenzung auf null: +${euro(round2(day.allowanceAfter - (day.allowanceBefore - day.breakfastCut - day.lunchCut - day.dinnerCut)))}.`}</p>
      {row && <>
        <h4>Fahrzeug und Kilometer</h4>
        {row.contributions?.mileage.map((item) => <p key={item.tripId}>{item.vehicle || "Fahrzeug offen"} · {item.ownership} · {number(item.km)} berechtigte km × {euro(item.rate)}/km = {euro(item.amount)}. {item.reason}</p>)}
        <p>Kilometererstattung gesamt: <b>{euro(row.mileage)}</b>{row.contributions && ` · Rundung der Summe: ${euro(round2(row.mileage - row.contributions.mileage.reduce((sum, item) => sum + round2(item.amount), 0)))}`}</p>
        <h4>Ausgaben</h4>
        {row.contributions?.expenses.map((expense) => <p key={expense.id}>{expense.description || expense.category} · {expense.category} · Brutto {number(expense.gross)} {expense.currency} · {expense.paymentType} · {expense.reimbursementStatus}{expense.receiptName ? ` · Beleg: ${expense.receiptName}` : " · ohne Beleg"}. {expense.excluded ? "Tankkosten durch Kilometerpauschale abgedeckt: keine zusätzliche Erstattung." : expense.paymentType !== "privat vorgestreckt" || expense.reimbursementStatus !== "offen" ? "Keine offene Erstattung dieser Ausgabe." : `${number(expense.businessShare)} % dienstlicher Anteil × Wechselkurs ${number(expense.exchangeRate)}; auf Cent gerundet.`} Offen: <b>{euro(expense.openAmount)}</b></p>)}
        {row.contributions && !row.contributions.expenses.length && <p>Keine Ausgaben an diesem Tag.</p>}
        <p>Ausgabensummen: Tanken {euro(row.fuel)} · Hotel {euro(row.accommodation)} · Sonstiges {euro(row.other)}. Diese Bruttosummen und der offene Erstattungsbetrag können sich durch Zahlungsart, dienstlichen Anteil, Wechselkurs und bereits erfolgte Erstattung unterscheiden.</p>
        {row.contributions && <p>{euro(row.allowanceAfter)} Spesen + {euro(row.mileage)} Kilometer + {euro(row.contributions.openExpenses)} offene Ausgaben = <b>{euro(row.openAmount)} offen</b>. Rundung auf Cent.</p>}
        {!row.contributions && <p>Gespeicherter offener Betrag: <b>{euro(row.openAmount)}</b>. Einzelne Fahrzeug- und Ausgabenbeiträge wurden in dieser älteren Abrechnung nicht gespeichert; sie werden nicht aus aktuellen Einstellungen rekonstruiert.</p>}
      </>}
      {!context && <p>Diese ältere Berechnung enthält keine historischen Schwellen-, Mahlzeiten- oder Tarifdetails. Angezeigt werden ausschließlich die gespeicherten Beträge.</p>}
      {day.warnings.length > 0 && <p className="warning-line">Prüfhinweise: {day.warnings.join(" · ")}</p>}
    </div>
  </details>;
}

export function MonthDetails({ statement, frozen = false }: { statement: StatementData; frozen?: boolean }) {
  const t = statement.totals;
  return <details className="calculation-details monthly-details"><summary>Berechnung anzeigen · Monat</summary><div className="calculation-body">
    <h4>{statement.month} · {frozen ? "Gespeicherter Monatsstand" : "Monatssummen"}</h4>
    <p>Die Monatssummen addieren die auf Cent gerundeten Tagesbeträge.</p>
    <div className="table-wrap"><table><thead><tr><th>Tag</th><th>Spesen</th><th>Kilometer</th><th>Offen</th></tr></thead><tbody>{statement.rows.map((r) => <tr key={r.date}><td>{date(r.date)}</td><td>{euro(r.allowanceAfter)}</td><td>{euro(r.mileage)}</td><td>{euro(r.openAmount)}</td></tr>)}</tbody></table></div>
    <p>{euro(t.allowance)} Spesen + {euro(t.mileage)} Kilometer + {euro(t.fuel)} Tanken + {euro(t.accommodation)} Hotel + {euro(t.other)} Sonstiges = <b>{euro(t.grandTotal)} Gesamtkosten</b>.</p>
    <p>Unternehmen bezahlt: {euro(t.companyPaid)} · Bereits erstattet: {euro(t.reimbursed)} · Privat vorgestreckt: {euro(t.privatelyAdvanced)}.</p>
    <p>Offene Erstattung: <b>{euro(t.openAmount)}</b> = Summe der offenen Tagesbeträge. Zahlungsart, Erstattungsstatus und dienstlicher Anteil sind in den Tagesdetails erklärt.</p>
    <p>Monatsrundung der offenen Tagesbeträge: {euro(round2(t.openAmount - statement.rows.reduce((sum, r) => sum + r.openAmount, 0)))}.</p>
  </div></details>;
}
