import { useId } from 'react';
import type { PaymentType, Receipt, Trip } from '../lib/types';
import { isHotel, linkingErrors, matchingTrips, paymentLabel, projectNumber, type LinkingInput } from '../lib/receipt-linking';

const dateDe = (date: string) => date.split('-').reverse().join('.');
export const tripLabel = (trip: Trip) => `${trip.order || trip.destination} · ${dateDe(trip.date)} – ${dateDe(trip.endDate || trip.date)}`;

export function PaymentSelect({ value, onChange }: { value: PaymentType; onChange: (value: PaymentType) => void }) {
  return <label>Zahlungsart<select aria-label="Zahlungsart" value={value} onChange={e => onChange(e.target.value as PaymentType)}>
    <option value="privat vorgestreckt">Privat bezahlt</option>
    <option value="Unternehmen">Vom Unternehmen bezahlt</option>
    <option value="Firmenkarte">Firmenkarte</option>
    <option value="bereits erstattet">Bereits erstattet</option>
    {!["privat vorgestreckt", "Unternehmen", "Firmenkarte", "bereits erstattet"].includes(value) && <option value={value}>{paymentLabel(value)}</option>}
  </select></label>;
}

export function ReceiptLinkFields({ value, onChange, trips, travelLabel = 'Passende Reise' }: {
  value: LinkingInput; onChange: (patch: Partial<LinkingInput>) => void; trips: Trip[]; travelLabel?: string;
}) {
  const id = useId();
  const projects = [...new Map(trips.filter(t => projectNumber(t.order)).map(t => [projectNumber(t.order), t.order])).values()];
  const candidates = matchingTrips(value, trips);
  const linked = trips.find(t => t.id === value.tripId);
  const hotel = isHotel(value.category);
  const missingStay = hotel && !(value.stayStart && value.stayEnd);
  return <section className="wide receipt-linking" aria-label="Projekt und Reisezuordnung">
    <div className="form-grid">
      <label className="wide">Projekt<input aria-label="Projekt" list={id} placeholder="26.0123 Musterstadt (optional)" value={value.projectNumber || ''} onChange={e => onChange({projectNumber:e.target.value})} />
        <datalist id={id}>{projects.map(p => <option key={p} value={p} />)}</datalist>
      </label>
      {hotel && <>
        <label>Übernachtungsbeginn<input type="date" value={value.stayStart || ''} onChange={e => onChange({stayStart:e.target.value})} /></label>
        <label>Übernachtungsende<input type="date" value={value.stayEnd || ''} onChange={e => onChange({stayEnd:e.target.value})} /></label>
        <label className="wide">Frühstück enthalten<select aria-label="Frühstück enthalten" value={value.breakfastIncluded || 'unknown'} onChange={e => onChange({breakfastIncluded:e.target.value as LinkingInput['breakfastIncluded']})}>
          <option value="unknown">Unbekannt</option><option value="yes">Ja</option><option value="no">Nein</option>
        </select></label>
        <p className="wide muted">Rechnungsdatum und Übernachtungszeitraum sind getrennt. Für Hotelvorschläge wird das Rechnungsdatum nicht als Reisezeitraum verwendet.</p>
      </>}
      {linkingErrors(value).map(e => <p className="wide link-warning" role="alert" key={e}>{e}</p>)}
      <div className="wide">
        {value.tripId ? <>
          <b>Bestätigte Zuordnung: {linked ? tripLabel(linked) : 'Reise nicht mehr vorhanden'}</b>
          <button type="button" className="link" onClick={() => onChange({tripId:undefined})}>Zuordnung lösen</button>
          {(!linked || !candidates.some(t=>t.id===value.tripId)) && <p className="link-warning">Die bestätigte Reise passt nicht zu allen aktuellen Projekt-/Zeitangaben. Bitte prüfen; sie wird nicht automatisch ersetzt.</p>}
        </> : <>
          <b>{candidates.length === 1 && !missingStay ? 'Passende Dienstreise gefunden' : candidates.length ? 'Mögliche Dienstreisen – bitte auswählen' : 'Noch keiner Dienstreise zugeordnet'}</b>
          {missingStay && <p className="link-warning">Übernachtungszeitraum fehlt. Projektvorschläge sind noch nicht zeitlich geprüft.</p>}
          {!value.projectNumber && <p className="muted">Ohne Projektangabe beruht der Vorschlag nur auf dem Zeitraum. Bitte Projekt prüfen.</p>}
          {candidates.map(t => <div className="trip-candidate" key={t.id}><span>{tripLabel(t)}</span><button type="button" className="ghost" onClick={() => onChange({tripId:t.id, projectNumber: value.projectNumber || projectNumber(t.order) || undefined})}>Zuordnung bestätigen</button></div>)}
        </>}
      </div>
      <label className="wide">{travelLabel}<select aria-label={travelLabel} value={value.tripId || ''} onChange={e => onChange({tripId:e.target.value || undefined})}>
        <option value="">Keine Zuordnung / später zuordnen</option>
        {trips.filter(t => t.tripType==='dienstlich' && t.status!=='storniert' || t.id===value.tripId).map(t => <option key={t.id} value={t.id}>{tripLabel(t)}</option>)}
        {value.tripId && !linked && <option value={value.tripId}>Bisherige Reise nicht mehr vorhanden</option>}
      </select><small>Eine manuelle Auswahl bestätigt die konkrete Reise. Ohne Bestätigung wird keine Reisezuordnung gespeichert.</small></label>
      {hotel && <p className="wide hotel-review">Hotelrechnung und Verpflegung werden getrennt erfasst. Keine automatische Übernachtungspauschale; vor Abrechnung eine mögliche anderweitige Erstattung prüfen.</p>}
      {hotel && value.breakfastIncluded==='yes' && <p className="wide hotel-review">Prüfen, ob das Frühstück als gestellte Mahlzeit bei der Verpflegungspauschale berücksichtigt werden muss. Vorhandene Mahlzeitenangaben werden nicht verändert oder doppelt gekürzt.</p>}
    </div>
  </section>;
}

export function ReceiptAttachment({receipt}: {receipt?: Receipt}) {
  if (!receipt) return <span className="receipt-missing">Beleg fehlt</span>;
  return <details className="receipt-attachment"><summary>Beleg ansehen · {receipt.name}</summary>
    {/^image\/(png|jpe?g|webp)$/i.test(receipt.type) && <img src={receipt.dataUrl} alt="Gespeicherter Beleg" />}
    <a href={receipt.dataUrl} download={receipt.name}>Beleg öffnen / herunterladen</a>
  </details>;
}
