import { useEffect, useId, useRef, useState } from 'react';
import { receiptDataUrl } from '../lib/receipt-images';
import type { PaymentType, Receipt, Trip } from '../lib/types';
import { knownMerchantNamed, type KnownMerchant } from '../lib/merchants';
import { isHotel, linkingErrors, matchingTrips, paymentLabel, projectNumber, type LinkingInput } from '../lib/receipt-linking';

const dateDe = (date: string) => date.split('-').reverse().join('.');
export const tripLabel = (trip: Trip) => `${trip.order || trip.destination} · ${dateDe(trip.date)} – ${dateDe(trip.endDate || trip.date)}`;

export function PaymentSelect({ value, onChange }: { value: PaymentType; onChange: (value: PaymentType) => void }) {
  return <label>Zahlungsart<select aria-label="Zahlungsart" value={value} onChange={e => onChange(e.target.value as PaymentType)}>
    <option value="privat vorgestreckt">Privat bezahlt</option>
    <option value="Unternehmen">Vom Unternehmen bezahlt</option>
    <option value="Firmenkarte">Firmenkarte</option>
    <option value="Bürokasse">Aus der Bürokasse bezahlt</option>
    <option value="bereits erstattet">Bereits erstattet</option>
    {!["privat vorgestreckt", "Unternehmen", "Firmenkarte", "Bürokasse", "bereits erstattet"].includes(value) && <option value={value}>{paymentLabel(value)}</option>}
  </select></label>;
}

export function ReceiptLinkFields({ value, onChange, trips, travelLabel = 'Passende Reise', compact = false, innendienst = false }: {
  value: LinkingInput; onChange: (patch: Partial<LinkingInput>) => void; trips: Trip[]; travelLabel?: string;
  /** Kostenfenster: feste Erläuterungen aufklappbar, Hotelangaben in einer Zeile. Warnungen bleiben sichtbar. */
  compact?: boolean;
  /** Innendienst: keine Reisezuordnung, Projekt freiwillig. */
  innendienst?: boolean;
}) {
  const id = useId();
  const projects = [...new Map(trips.filter(t => projectNumber(t.order)).map(t => [projectNumber(t.order), t.order])).values()];
  const candidates = matchingTrips(value, trips);
  const linked = trips.find(t => t.id === value.tripId);
  const hotel = isHotel(value.category);
  const missingStay = hotel && !(value.stayStart && value.stayEnd);
  const hotelInfo = 'Rechnungsdatum und Übernachtungszeitraum sind getrennt. Für Hotelvorschläge wird das Rechnungsdatum nicht als Reisezeitraum verwendet.';
  const hotelReview = 'Hotelrechnung und Verpflegung werden getrennt erfasst. Keine automatische Übernachtungspauschale; vor Abrechnung eine mögliche anderweitige Erstattung prüfen.';
  const manualHint = 'Eine manuelle Auswahl bestätigt die konkrete Reise. Ohne Bestätigung wird keine Reisezuordnung gespeichert.';
  // Ohne Reise: Innendienst oder ausdrücklich „gehört zu keiner Reise / keinem Projekt“ (nur ohne bestätigte Reise).
  const noTrip = !value.tripId && (innendienst || !!value.noTrip);
  return <section className={`wide receipt-linking${compact ? ' compact' : ''}`} aria-label="Projekt und Reisezuordnung">
    <div className="form-grid">
      {!innendienst && !value.tripId && <label className="check wide no-trip">
        <input type="checkbox" checked={!!value.noTrip} onChange={e => onChange(e.target.checked ? {noTrip:true, tripId:undefined, projectNumber:undefined} : {noTrip:undefined})} />
        Gehört zu keiner Reise und keinem Projekt (z. B. Büromaterial)
      </label>}
      {!(value.noTrip && !innendienst && !value.tripId) && <label className="wide">Projekt<input aria-label="Projekt" list={id} placeholder="26.0123 Musterstadt (optional)" value={value.projectNumber || ''} onChange={e => onChange({projectNumber:e.target.value})} />
        <datalist id={id}>{projects.map(p => <option key={p} value={p} />)}</datalist>
      </label>}
      {hotel && <>
        <label>Übernachtungsbeginn<input type="date" value={value.stayStart || ''} onChange={e => onChange({stayStart:e.target.value})} /></label>
        <label>Übernachtungsende<input type="date" value={value.stayEnd || ''} onChange={e => onChange({stayEnd:e.target.value})} /></label>
        <label className={compact ? undefined : 'wide'}>Frühstück enthalten<select aria-label="Frühstück enthalten" value={value.breakfastIncluded || 'unknown'} onChange={e => onChange({breakfastIncluded:e.target.value as LinkingInput['breakfastIncluded']})}>
          <option value="unknown">Unbekannt</option><option value="yes">Ja</option><option value="no">Nein</option>
        </select></label>
        {!compact && <p className="wide muted">{hotelInfo}</p>}
      </>}
      {linkingErrors(value).map(e => <p className="wide link-warning" role="alert" key={e}>{e}</p>)}
      {noTrip ? <p className="wide muted">{innendienst ? 'Innendienst: Kosten ohne Reisezuordnung. Ein Projekt kann freiwillig angegeben werden.' : 'Ohne Reise und Projekt erfasst – dafür gibt es keine Hinweise auf eine fehlende Zuordnung.'}</p> : <>
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
      </select>{!compact && <small>{manualHint}</small>}</label>
      </>}
      {hotel && !compact && <p className="wide hotel-review">{hotelReview}</p>}
      {hotel && value.breakfastIncluded==='yes' && <p className="wide hotel-review">Prüfen, ob das Frühstück als gestellte Mahlzeit bei der Verpflegungspauschale berücksichtigt werden muss. Vorhandene Mahlzeitenangaben werden nicht verändert oder doppelt gekürzt.</p>}
      {compact && !noTrip && <details className="wide link-info"><summary>Hinweise zur Zuordnung</summary><p>{manualHint}</p>{hotel && <><p>{hotelInfo}</p><p>{hotelReview}</p></>}</details>}
    </div>
  </section>;
}

/** Bild eines Belegs (eingebettet oder unter fileId gespeichert); undefined, solange es geladen wird, "" wenn es fehlt. */
export function useReceiptDataUrl(receipt?: Receipt) {
  const [loaded, setLoaded] = useState<{ key: string; url: string } | null>(null);
  const key = receipt ? receipt.dataUrl ? `inline:${receipt.id}:${receipt.dataUrl.length}` : `file:${receipt.fileId || ""}` : "";
  useEffect(() => {
    if (!receipt || receipt.dataUrl) return;
    let active = true;
    void receiptDataUrl(receipt).then((url) => { if (active) setLoaded({ key, url }); });
    return () => { active = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!receipt) return "";
  if (receipt.dataUrl) return receipt.dataUrl;
  return loaded?.key === key ? loaded.url : undefined;
}

export function ReceiptAttachment({receipt}: {receipt?: Receipt}) {
  const url = useReceiptDataUrl(receipt);
  if (!receipt) return <span className="receipt-missing">Beleg fehlt</span>;
  return <details className="receipt-attachment"><summary>Beleg ansehen · {receipt.name}</summary>
    {url === undefined ? <p className="muted">Beleg wird geladen …</p>
      : !url ? <p className="receipt-missing">Das Belegbild ist auf diesem Gerät nicht verfügbar. Bitte den SpesenKit-Ordner verbinden.</p>
      : <>{/^image\/(png|jpe?g|webp)$/i.test(receipt.type) && <img src={url} alt="Gespeicherter Beleg" />}
        <a href={url} download={receipt.name}>Beleg öffnen / herunterladen</a></>}
  </details>;
}

/**
 * Feld „Händler“ mit Auswahlliste der bisher verwendeten Händler (häufigste zuerst). Freie Eingabe bleibt möglich.
 * onChange meldet mit, ob der Name einem bekannten Händler entspricht – dann können Kategorie und Steuersatz
 * aus dessen gelernter Regel übernommen werden. Das gilt erst, wenn der Name feststeht (aus der Liste gewählt oder
 * Feld verlassen), nicht bei jedem Tastendruck: sonst bliebe die Regel eines kürzeren Händlers hängen
 * („Star“ auf dem Weg zu „Starbucks“).
 */
export function MerchantInput({ label, value, known, onChange, className }: {
  label: string; value: string; known: KnownMerchant[]; className?: string;
  onChange: (value: string, match?: KnownMerchant) => void;
}) {
  const id = useId();
  const atFocus = useRef(value);
  // Die Liste steht neben dem Feld (nicht im Label), sonst würden ihre Einträge Teil des Feldnamens.
  return <>
    <label className={className}>{label}
      <input value={value} list={known.length ? id : undefined} autoComplete="off"
        onFocus={(event) => { atFocus.current = event.target.value; }}
        onChange={(event) => {
          // Auswahl aus der Liste kommt ohne inputType (Chrome) bzw. als insertReplacementText (Firefox); Tippen, Löschen, Einfügen nicht.
          const inputType = (event.nativeEvent as InputEvent).inputType;
          const picked = !inputType || inputType === 'insertReplacementText';
          onChange(event.target.value, picked ? knownMerchantNamed(event.target.value, known) : undefined);
        }}
        onBlur={(event) => {
          // Feld verlassen: getippter Name steht fest. Unverändert (nur hinein- und hinausgeklickt) ändert nichts.
          const name = event.target.value;
          if (name === atFocus.current) return;
          atFocus.current = name;
          const match = knownMerchantNamed(name, known);
          if (match) onChange(name, match);
        }} />
    </label>
    {known.length > 0 && <datalist id={id}>{known.slice(0, 80).map((merchant) => <option key={merchant.name} value={merchant.name}>{merchant.uses > 1 ? `${merchant.uses}×` : undefined}</option>)}</datalist>}
  </>;
}
