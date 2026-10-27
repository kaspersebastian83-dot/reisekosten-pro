/*
 * Umrechnungskurs für Belege in Fremdwährung.
 *
 * Maßgeblich ist, was tatsächlich gezahlt wurde: Bei Kartenzahlung der Euro-Betrag bzw. Kurs der Kartenabrechnung.
 * Ohne diesen Nachweis wird ein amtlicher Kurs am Zahlungstag angesetzt – hier der EZB-Referenzkurs (bei Wochenende
 * oder Feiertag der letzte vorherige Kurs). Kurs und Quelle werden an der Kostenposition gespeichert.
 *
 * Abgefragt werden nur Währung und Datum – kein Beleg, kein Betrag. Zuerst bei der EZB (data-api.ecb.europa.eu),
 * sonst bei frankfurter.dev (veröffentlicht dieselben EZB-Referenzkurse).
 */
export const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "DKK", "SEK", "NOK", "PLN", "CZK", "HUF", "JPY", "CAD", "AUD"] as const;
export const currencyLabel = (code: string) => ({ EUR: "Euro (EUR)", USD: "US-Dollar (USD)", GBP: "Britisches Pfund (GBP)", CHF: "Schweizer Franken (CHF)" } as Record<string, string>)[code] || code;

export interface RateResult { rate: number; date: string; source: string }
type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; text(): Promise<string>; json(): Promise<unknown> }>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const de = (date: string) => date.split("-").reverse().join(".");
const minusDays = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};
/** EUR je 1 Einheit, 6 Nachkommastellen. */
export const roundRate = (rate: number) => Math.round(rate * 1e6) / 1e6;

/** EZB-Antwort (CSV) lesen: letzter Kurs am oder vor dem Datum. OBS_VALUE = Einheiten je 1 EUR. */
export function parseEcbCsv(csv: string, date: string): { value: number; date: string } | null {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const head = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const t = head.indexOf("TIME_PERIOD"), v = head.indexOf("OBS_VALUE");
  if (t < 0 || v < 0) return null;
  let best: { value: number; date: string } | null = null;
  for (const line of lines.slice(1)) {
    const cells = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const value = Number(cells[v]), day = cells[t];
    if (!DATE.test(day) || day > date || !(value > 0)) continue;
    if (!best || day > best.date) best = { value, date: day };
  }
  return best;
}

const cache = new Map<string, RateResult>();

async function withTimeout<T>(task: (signal: AbortSignal) => Promise<T>, ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try { return await task(controller.signal); } finally { clearTimeout(timer); }
}

/** EZB-Referenzkurs für Währung und Belegdatum (EUR je 1 Einheit). Wirft mit verständlicher Meldung. */
export async function ecbRate(currency: string, date: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<RateResult> {
  const code = currency.toUpperCase();
  if (code === "EUR") return { rate: 1, date, source: "Euro" };
  if (!/^[A-Z]{3}$/.test(code) || !DATE.test(date)) throw new Error("Bitte Währung und Belegdatum angeben.");
  const today = new Date().toLocaleDateString("sv-SE");
  const day = date > today ? today : date;
  const key = `${code}:${day}`;
  const hit = cache.get(key);
  if (hit) return hit;
  // 1. EZB direkt
  try {
    const url = `https://data-api.ecb.europa.eu/service/data/EXR/D.${code}.EUR.SP00.A?startPeriod=${minusDays(day, 10)}&endPeriod=${day}&format=csvdata`;
    const found = await withTimeout(async (signal) => {
      const response = await fetchImpl(url, { signal });
      return response.ok ? parseEcbCsv(await response.text(), day) : null;
    }, 8000);
    if (found) {
      const result = { rate: roundRate(1 / found.value), date: found.date, source: `EZB-Referenzkurs ${de(found.date)}` };
      cache.set(key, result);
      return result;
    }
  } catch { /* weiter mit dem zweiten Weg */ }
  // 2. frankfurter.dev (EZB-Referenzkurse)
  try {
    const found = await withTimeout(async (signal) => {
      const response = await fetchImpl(`https://api.frankfurter.dev/v1/${day}?base=${code}&symbols=EUR`, { signal });
      if (!response.ok) return null;
      const body = await response.json() as { date?: string; rates?: { EUR?: number } };
      return body?.rates?.EUR && body.rates.EUR > 0 && typeof body.date === "string" && DATE.test(body.date) && body.date <= day ? { rate: body.rates.EUR, date: body.date } : null;
    }, 8000);
    if (found) {
      const result = { rate: roundRate(found.rate), date: found.date, source: `EZB-Referenzkurs ${de(found.date)}` };
      cache.set(key, result);
      return result;
    }
  } catch { /* unten melden */ }
  throw new Error("Kurs konnte nicht geladen werden (keine Internetverbindung?). Bitte den Kurs oder Euro-Betrag von der Kartenabrechnung eintragen.");
}

/** Euro-Betrag einer Fremdwährung, auf Cent gerundet. */
export const euroAmount = (gross: number, rate: number) => Math.round(gross * rate * 100) / 100;
