import { useEffect, useRef, useState } from 'react';
import { CURRENCIES, currencyLabel, ecbRate, euroAmount, roundRate } from '../lib/exchange-rates';

export interface CurrencyValue { currency: string; exchangeRate: number; exchangeRateSource?: string; gross: number; date: string }
type Patch = { currency: string; exchangeRate: number; exchangeRateSource?: string };

const fmtEuro = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const fmtRate = (n: number) => n ? n.toLocaleString('de-DE', { maximumFractionDigits: 6 }) : '';
const parse = (text: string) => { const n = Number(text.replace(/\s/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null; };

/**
 * Währung eines Belegs. Bei Fremdwährung: Kurs (EUR je 1 Einheit) – automatisch der EZB-Referenzkurs zum Belegdatum,
 * überschreibbar mit dem Kurs oder dem Euro-Betrag der Kartenabrechnung. Kurs und Quelle werden gespeichert.
 */
export function CurrencyFields({ value, onChange }: { value: CurrencyValue; onChange: (patch: Patch) => void }) {
  const { currency, exchangeRate, exchangeRateSource, gross, date } = value;
  const foreign = currency !== 'EUR';
  const [rateText, setRateText] = useState(fmtRate(exchangeRate));
  const [cardText, setCardText] = useState(() => exchangeRateSource === 'Kartenabrechnung' && gross > 0 && exchangeRate > 0 ? euroAmount(gross, exchangeRate).toFixed(2).replace('.', ',') : '');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  useEffect(() => { setRateText(fmtRate(exchangeRate)); }, [exchangeRate]);
  /** Laufende EZB-Abfrage verwerfen – ein selbst eingetragener Kurs oder Kartenbetrag darf nicht überschrieben werden. */
  const cancel = () => { request.current++; setLoading(false); setStatus(''); };
  const fetchRate = async (code = currency, day = date) => {
    if (code === 'EUR' || !day) return;
    const id = ++request.current;
    setLoading(true); setStatus('EZB-Kurs wird geladen …');
    try {
      const result = await ecbRate(code, day);
      if (id !== request.current) return;
      onChange({ currency: code, exchangeRate: result.rate, exchangeRateSource: result.source });
      setCardText(''); setStatus('');
    } catch (error) {
      if (id === request.current) setStatus(error instanceof Error ? error.message : 'Kurs konnte nicht geladen werden.');
    } finally { if (id === request.current) setLoading(false); }
  };
  // Neue Fremdwährung oder anderes Datum: EZB-Kurs holen – außer, der Kurs kommt von der Kartenabrechnung oder ist selbst eingetragen.
  const auto = !exchangeRateSource || exchangeRateSource.startsWith('EZB');
  const first = useRef(true);
  useEffect(() => {
    const opening = first.current; first.current = false;
    // Beim Öffnen einer gespeicherten Position mit Kurs nichts neu laden.
    if (opening && exchangeRate > 0) return;
    if (!foreign || !auto || !date) return;
    // Alten Kurs sofort verwerfen: bis der neue da ist, lässt sich nicht mit dem Kurs eines anderen Tages speichern.
    if (exchangeRate > 0) onChange({ currency, exchangeRate: 0, exchangeRateSource: undefined });
    void fetchRate(currency, date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency, date]);
  useEffect(() => () => { request.current++; }, []);

  return <>
    <label>
      Währung
      <select aria-label="Währung" value={currency} onChange={(e) => {
        const code = e.target.value;
        request.current++; setStatus(''); setCardText('');
        onChange(code === 'EUR' ? { currency: 'EUR', exchangeRate: 1, exchangeRateSource: undefined } : { currency: code, exchangeRate: 0, exchangeRateSource: undefined });
      }}>
        {CURRENCIES.map((code) => <option key={code} value={code}>{currencyLabel(code)}</option>)}
        {!(CURRENCIES as readonly string[]).includes(currency) && <option value={currency}>{currency}</option>}
      </select>
    </label>
    {foreign && <div className="wide currency-box" role="group" aria-label="Umrechnung in Euro">
      <div className="currency-row">
        <label>
          Kurs: 1 {currency} =
          <span className="currency-input"><input inputMode="decimal" aria-label={`Euro je 1 ${currency}`} value={rateText}
            onChange={(e) => { setRateText(e.target.value); const n = parse(e.target.value); if (n) { cancel(); onChange({ currency, exchangeRate: roundRate(n), exchangeRateSource: 'selbst eingetragen' }); } }} /> €</span>
        </label>
        <button type="button" className="ghost" disabled={loading || !date} onClick={() => void fetchRate()}>EZB-Kurs holen</button>
        <label>
          Laut Kartenabrechnung abgebucht (€)
          <input inputMode="decimal" aria-label="Euro-Betrag laut Kartenabrechnung" value={cardText} placeholder="freiwillig"
            onChange={(e) => { setCardText(e.target.value); const n = parse(e.target.value); if (n && gross > 0) { cancel(); onChange({ currency, exchangeRate: roundRate(n / gross), exchangeRateSource: 'Kartenabrechnung' }); } }} />
        </label>
      </div>
      <p className="currency-result" role="status">
        {exchangeRate > 0 && gross > 0 ? <><b>= {fmtEuro(euroAmount(gross, exchangeRate))}</b> · {exchangeRateSource || 'Kurs'}</> : 'Kurs fehlt – bitte EZB-Kurs holen oder von der Kartenabrechnung eintragen.'}
        {status && <span className={loading ? 'muted' : 'currency-error'}> {status}</span>}
      </p>
    </div>}
  </>;
}
