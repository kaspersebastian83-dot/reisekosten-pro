import { useEffect, useMemo, useRef, useState } from 'react';
import { checkStatementForClosing, groupClosingIssues, type ClosingCheck, type ClosingConfirmation, type ClosingIssue } from '../lib/statement-closing';
import { monthLabel } from '../lib/month-navigation';
import { usePendingWork } from '../lib/pending-work';
import type { AppState, StatementSnapshot } from '../lib/types';
import { isClosedStatement } from '../lib/statement-comparison';

const euro = (value: number) => value.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
export function StatementClosing({ state, month, snapshot, commit, edit }: {
  state: AppState; month: string; snapshot?: StatementSnapshot;
  commit: (confirmation: ClosingConfirmation) => Promise<void>;
  edit: (target: NonNullable<ClosingIssue['target']>) => void;
}) {
  const result = useMemo(() => checkStatementForClosing(state, month, snapshot), [state, month, snapshot]);
  const correction = state.statements.some(item => item.month === month && item.version < (snapshot?.version || 0) && isClosedStatement(item));
  const [dialog, setDialog] = useState<{ snapshot: StatementSnapshot; result: ClosingCheck } | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  usePendingWork(!!dialog);
  useEffect(() => {
    if (dialog) panel.current?.focus();
    return () => { if (dialog) opener.current?.focus(); };
  }, [dialog]);
  useEffect(() => { setDialog(null); }, [month]);
  // Gleichartige Hinweise zusammengefasst; große Gruppen eingeklappt (Fehler immer offen).
  const groupedList = (items: ClosingIssue[], openUpTo: number) => <div className="issue-groups">{groupClosingIssues(items).map(group => {
    const list = <ul className="closing-issues">{group.items.map(({ label, issue }, index) => <li key={`${issue.code}-${index}`}><span>{label || issue.message}</span>{issue.target && <button className="ghost" onClick={() => edit(issue.target!)}>{issue.target.kind === 'trip' ? 'Reise bearbeiten' : 'Kosten bearbeiten'}</button>}</li>)}</ul>;
    const count = <span className="issue-count">{group.items.length === 1 ? '1 Eintrag' : `${group.items.length} Einträge`}</span>;
    return group.items.length <= openUpTo
      ? <div className="issue-group" key={group.title}><h5>{group.title}{count}</h5>{list}</div>
      : <details className="issue-group" key={group.title}><summary><span>{group.title}</span>{count}</summary>{list}</details>;
  })}</div>;
  const groupSummary = (items: ClosingIssue[]) => <ul className="closing-issues compact">{groupClosingIssues(items).map(group => <li key={group.title}><span>{group.title}</span><span className="issue-count">{group.items.length}×</span></li>)}</ul>;
  const close = () => { if (!busy.current) setDialog(null); };
  const submit = async () => {
    if (!dialog || busy.current || !reviewed || (dialog.result.warnings.length > 0 && !accepted)) return;
    busy.current = true; setSaving(true); setError('');
    try {
      await commit({ month, snapshotId: dialog.snapshot.id, fingerprint: dialog.result.fingerprint, reviewed, warningsAccepted: accepted });
      setDialog(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Abschluss konnte nicht gespeichert werden. Bitte erneut prüfen.'); }
    finally { busy.current = false; setSaving(false); }
  };
  if (snapshot?.locked) return null;
  const changed = !!dialog && dialog.result.fingerprint !== result.fingerprint;
  return <section className="card closing-review" aria-label="Abschlussprüfung">
    <h3>Abschlussprüfung</h3>
    <p>Der gespeicherte Entwurf wird geprüft. Abschluss und Auszahlung sind getrennte Aktionen.</p>
    {result.errors.length > 0 && <div className="closing-errors"><h4>{result.errors.length} blockierende Fehler – vor dem Abschluss beheben</h4>{groupedList(result.errors, Infinity)}<p>Bei einem veralteten oder älteren Entwurf oben „Neue Version erstellen“ verwenden. Die bisherige Version bleibt erhalten.</p></div>}
    {result.warnings.length > 0 && <div className="closing-warnings"><h4>{result.warnings.length} bestätigbare Hinweise in {groupClosingIssues(result.warnings).length} Gruppen</h4><p className="muted">Hinweise blockieren nicht. Prüfe sie und behebe, was du beheben kannst; den Rest bestätigst du beim Abschluss.</p>{groupedList(result.warnings, 2)}</div>}
    {!result.errors.length && !result.warnings.length && <p>Keine bekannten Prüfprobleme.</p>}
    <button className="primary" ref={opener} disabled={!!result.errors.length || !snapshot} onClick={() => { setReviewed(false); setAccepted(false); setError(''); setDialog({ snapshot: structuredClone(snapshot!), result }); }}>Monatsabrechnung abschließen</button>
    {dialog && <div className="modal-backdrop closing-backdrop"><div className="modal closing-dialog" role="dialog" aria-modal="true" aria-labelledby="closing-title" tabIndex={-1} ref={panel} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') {
        const elements = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') || []);
        const first = elements[0]; const last = elements.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <header><h2 id="closing-title">Monatsabrechnung {monthLabel(month)}</h2><button className="ghost" onClick={close} disabled={saving}>Abbrechen</button></header>
      <div className="modal-body">
        <p>Verbindlicher Abschluss von Version {dialog.snapshot.version}. Gespeichert wird genau dieser Entwurfsstand.</p>
        <dl className="closing-totals">
          <div><dt>Dienstreisen</dt><dd>{new Set(dialog.snapshot.data.rows.flatMap(row => row.trips.map(trip => trip.id))).size}</dd></div>
          <div><dt>Kostenpositionen</dt><dd>{dialog.snapshot.expensesSnapshot?.filter(expense => expense.status !== 'storniert').length || 0}</dd></div>
          <div><dt>Verpflegung</dt><dd>{euro(dialog.snapshot.data.totals.allowance)}</dd></div>
          <div><dt>Kilometererstattung</dt><dd>{euro(dialog.snapshot.data.totals.mileage)}</dd></div>
          <div><dt>Hotel</dt><dd>{euro(dialog.snapshot.data.totals.accommodation)}</dd></div>
          <div><dt>Sonstiges einschließlich Tanken</dt><dd>{euro(dialog.snapshot.data.totals.other + dialog.snapshot.data.totals.fuel)}</dd></div>
          <div><dt>{correction ? 'Persönlicher Erstattungsbetrag laut Entwurfsstand' : 'Offene persönliche Erstattung'}</dt><dd>{euro(dialog.snapshot.data.totals.openAmount)}</dd></div>
        </dl>
        {correction && <p className="correction-payment-note">Dies ist eine neue vollständige Abrechnungsversion. Ihr Betrag und die rechnerische Differenz zum früheren Abschluss sind keine tatsächliche Restzahlung oder Rückforderung. Ein früherer Auszahlungsstatus wird nicht übertragen.</p>}
        {dialog.result.warnings.length ? <><h3>{dialog.result.warnings.length} verbleibende Hinweise</h3>{groupSummary(dialog.result.warnings)}</> : <p>Keine bekannten Prüfprobleme.</p>}
        <label className="closing-confirmation"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} disabled={saving} /><span>Ich habe diese Monatsabrechnung geprüft und alle mir bekannten erstattungsfähigen Ausgaben erfasst.</span></label>
        {dialog.result.warnings.length > 0 && <label className="closing-confirmation"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} disabled={saving} /><span>Ich habe die verbleibenden Hinweise gesehen und möchte die Abrechnung trotzdem abschließen.</span></label>}
        {changed && <p className="error-box" role="alert">Seit der angezeigten Bestätigung haben sich Daten geändert. Bitte abbrechen und die Abschlussprüfung erneut öffnen.</p>}
        {error && <p className="error-box" role="alert">{error}</p>}
        <div className="modal-actions"><button className="primary" onClick={() => void submit()} disabled={saving || changed || !!result.errors.length || !reviewed || (dialog.result.warnings.length > 0 && !accepted)}>{saving ? 'Abschluss wird gespeichert …' : 'Verbindlich abschließen'}</button></div>
      </div>
    </div></div>}
  </section>;
}
