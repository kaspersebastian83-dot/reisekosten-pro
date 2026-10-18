import type { StatementChange, StatementComparison } from '../lib/statement-comparison';

const euro = (value: number) => value.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const difference = (value: number) => `${value > 0 ? '+' : ''}${euro(value)}`;
const kindLabels = { added: 'Neu hinzugefügt', removed: 'Nicht mehr im Monatsstand / storniert', changed: 'Geändert' };
export function StatementChanges({ comparison, creating, error, create, resume }: {
  comparison: StatementComparison; creating: boolean; error: string; create: () => void; resume: (id: string) => void;
}) {
  const { baseline, current, hasChanges, limitations, deltas, draft, draftCurrent, latestCancelled } = comparison;
  if (!baseline || (!hasChanges && !limitations.length && !draft)) return null;
  const list = (items: StatementChange[]) => items.map((item, index) => <article key={`${item.label}-${index}`}><p className="eyebrow">{kindLabels[item.kind]}</p><h4>{item.label}</h4><dl>{item.fields.map((field, fieldIndex) => <div key={fieldIndex}><dt>{field.field}</dt><dd><span>Bisher: {field.before}</span><span>Aktuell: {field.after}</span></dd></div>)}</dl></article>);
  return <section className="statement-changes" aria-label="Änderungen nach Abschluss">
    <h3>{latestCancelled ? 'Neueste Version storniert – Verlauf prüfen' : draft ? 'Abschluss vorhanden – Korrekturentwurf offen' : hasChanges ? comparison.changes.length ? 'Abgeschlossen – Änderungen erkannt' : 'Abgeschlossen – Dokumentänderungen erkannt' : 'Historischer Vergleich eingeschränkt'}</h3>
    <p>{comparison.changes.length ? 'Seit dem letzten nicht stornierten Abschluss wurden abrechnungsrelevante Monatsdaten geändert.' : hasChanges ? 'Dokument- oder Profildaten weichen vom gespeicherten Abschluss ab. Dies ist für sich keine Geldbetragsänderung.' : 'Der historische Abschluss bleibt erhalten. Der aktuelle Stand ist noch nicht erneut abgeschlossen.'}</p>
    {!!limitations.length && <div className="notice"><div><b>Historischer Vergleich eingeschränkt.</b><ul>{limitations.map((item, index) => <li key={index}>{item}</li>)}</ul><p>Es ist nicht sichergestellt, dass sämtliche historischen Unterschiede erkennbar sind.</p></div></div>}
    <dl className="correction-summary">
      <div><dt>Abgeschlossene Version {baseline.version} · persönlicher Erstattungsbetrag</dt><dd>{euro(baseline.data.totals.openAmount)}</dd></div>
      {current && <div><dt>Aktueller Rechenstand · persönlicher Erstattungsbetrag</dt><dd>{euro(current.totals.openAmount)}</dd></div>}
      {deltas && <div><dt>Rechnerische Differenz</dt><dd>{difference(deltas.personal)}</dd></div>}
    </dl>
    <p className="correction-payment-note">Rechnerische Gegenüberstellung, keine Zahlungsforderung. Auszahlungsstatus dokumentieren keine vollständige Zahlungshistorie. Differenzen sind weder eine automatisch offene Auszahlung noch eine Rückforderung.</p>
    <details className="correction-details"><summary>Änderungen ansehen</summary>
      {!!comparison.changes.length && <><h4>Monatsdaten und Berechnung</h4>{list(comparison.changes)}</>}
      {!!comparison.documentChanges.length && <><h4>Dokument- und Profildaten</h4>{list(comparison.documentChanges)}</>}
      {!hasChanges && <p>In den vergleichbaren gespeicherten Feldern wurden keine Änderungen erkannt.</p>}
      {deltas && <dl className="correction-summary">
        {([['Verpflegung', deltas.allowance], ['Kilometererstattung', deltas.mileage], ['Hotel', deltas.accommodation], ['Weitere Kosten einschließlich Tanken', deltas.other], ['Gesamtkosten', deltas.grandTotal], ['Persönlicher Erstattungsbetrag laut Berechnungsständen', deltas.personal]] as [string, number][]).map(([label, amount]) => <div key={label}><dt>{label}</dt><dd>{difference(amount)}</dd></div>)}
      </dl>}
    </details>
    {draft && <p>Version {draft.version}: {draftCurrent ? 'Korrekturentwurf entspricht dem aktuellen Vergleichsstand. Die sichere Abschlussprüfung steht noch aus.' : 'Korrekturentwurf ist veraltet oder nicht vollständig vergleichbar. Er bleibt unverändert; eine neue Version ist erforderlich.'}</p>}
    <div className="correction-actions">
      {draft && <button className="ghost" disabled={creating} onClick={() => resume(draft.id)}>Korrekturentwurf fortsetzen</button>}
      {(!draft || !draftCurrent) && <button className="primary" disabled={creating || !current} onClick={create}>{creating ? 'Korrekturentwurf wird gespeichert …' : draft ? 'Neue Korrekturversion erstellen' : 'Korrekturentwurf erstellen'}</button>}
    </div>
    {error && <p className="error-box" role="alert">{error}</p>}
  </section>;
}
