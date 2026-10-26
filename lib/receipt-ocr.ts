import type { MerchantRule, ReceiptSuggestion } from "./types";
import { findKnownMerchant, knownMerchants, merchantPattern, significantWords, type KnownMerchant } from "./merchants";

/** Kopfzeilen eines Belegs: dort steht der Händler. */
const HEADER_LINES = 8;

const parseGermanNumber = (value: string) => {
  const normalized = value
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3})/g, "")
    .replace(",", ".");
  const number = Number(normalized.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(number) ? number : undefined;
};

function parseDate(text: string) {
  const match = text.match(/\b(\d{1,2})[.\/-](\d{1,2})[.\/-](20\d{2}|\d{2})\b/);
  if (!match) return undefined;
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  const date = `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  return Number.isNaN(new Date(`${date}T12:00:00`).getTime())
    ? undefined
    : date;
}

function findGross(lines: string[]) {
  const priority =
    /(gesamt|summe|total|zu zahlen|zahlbetrag|endbetrag|brutto)/i;
  const candidates: Array<{ amount: number; priority: boolean }> = [];
  for (const line of lines) {
    // Datum und Uhrzeit sind keine Beträge („26.10.2026“ ergäbe sonst 26,10).
    const withoutDates = line
      .replace(/\b\d{1,2}[.\/-]\d{1,2}[.\/-](?:20)?\d{2}\b/g, " ")
      .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ");
    const matches = withoutDates.match(/\b\d{1,5}(?:[.,]\d{2})\b/g) || [];
    for (const value of matches) {
      const amount = parseGermanNumber(value);
      if (amount && amount > 0 && amount < 100000)
        candidates.push({ amount, priority: priority.test(line) });
    }
  }
  const preferred = candidates.filter((item) => item.priority);
  const pool = preferred.length ? preferred : candidates;
  return pool.sort((a, b) => b.amount - a.amount)[0]?.amount;
}

function inferCategory(text: string) {
  const value = text.toLowerCase();
  if (
    /(tank|diesel|benzin|super e|kraftstoff|aral|shell|esso|totalenergies)/.test(
      value,
    )
  )
    return "Tanken";
  if (/(park|parking|parkhaus|tiefgarage)/.test(value)) return "Parken";
  if (/(hotel|zimmer|übernacht|uebernacht)/.test(value)) return "Hotel";
  if (/(deutsche bahn|db vertrieb|fahrkarte|bahn)/.test(value)) return "Bahn";
  if (/(taxi|uber|bolt)/.test(value)) return "Taxi";
  if (/(maut|toll collect)/.test(value)) return "Maut";
  return "sonstige Nebenkosten";
}

function inferVat(text: string, category: string) {
  const explicit = text.match(/\b(0|7|19)[,.]?0*\s*%/);
  if (explicit) return Number(explicit[1]);
  return ["Hotel", "Bahn", "Taxi"].includes(category) ? 7 : 19;
}

/* Händler: Kopfzeilen bewerten statt die erste Zeile mit Buchstaben zu nehmen. Logos werden oft als Zeichensalat
 * („~~ HH ~~“) gelesen; Adresse, Telefon, Kasse und Bon-Nummer sind kein Händler. Rechtsform und bekannte Marken
 * sind starke Hinweise. */
const KNOWN_MERCHANTS = /\b(aral|shell|esso|total(?:energies)?|jet|star|agip|eni|hem|avia|westfalen|raiffeisen|orlen|omv|deutsche bahn|db fernverkehr|db vertrieb|rewe|edeka|lidl|aldi|netto|penny|kaufland|globus|real|dm|rossmann|müller|obi|bauhaus|hornbach|toom|hagebau|würth|conrad|media ?markt|saturn|ikea|mcdonald'?s|burger king|starbucks|tchibo|backwerk|ditsch|apcoa|contipark|q-park|apag|ibis|motel one|b&b hotels?|holiday inn|novotel|mercure|nh hotels?|best western|hilton|marriott|maritim|steigenberger|accor|sixt|europcar|avis|hertz|uber|free ?now|flixbus|toll collect)\b/i;
const LEGAL_FORM = /\b(gmbh|ag|kg|ohg|gbr|ug|e\.\s?k\.?|e\.\s?v\.|mbh|ltd|se|inc)\b/i;
const NOT_MERCHANT = /(rechnung|kassenbon|quittung|beleg|datum|uhrzeit|\buhr\b|steuer|\bust\b|mwst|\beur\b|gesamt|summe|zu zahlen|\bkasse\b|\bbon\b|\btel\b|telefon|\bfax\b|www\.|@|https?:|filiale|str\.|straße|strasse|\bplatz\b|\ballee\b|\bweg\b|\b\d{5}\b|bar\s|ec-karte|kartenzahlung|girocard|vielen dank|willkommen|kunden|ust-?id|steuer-?nr|bediener|tisch)/i;
const letters = (text: string) => (text.match(/[A-Za-zÄÖÜäöüß]/g) || []).length;

function merchantFromLines(lines: string[]) {
  let best: { line: string; score: number } | undefined;
  lines.forEach((raw, index) => {
    const line = raw.trim();
    const legal = LEGAL_FORM.test(line), known = KNOWN_MERCHANTS.test(line);
    if (index > 9 && !legal && !known) return;                       // Händler steht oben – außer Rechtsform/Marke
    if (line.length < 3 || line.length > 60) return;
    if (!/[A-Za-zÄÖÜäöüß]{3,}/.test(line)) return;                      // mindestens ein echtes Wort
    if (letters(line) / line.replace(/\s/g, "").length < 0.6) return;  // Zeichensalat, Zahlenzeilen
    if (NOT_MERCHANT.test(line) && !known) return;
    const words = line.split(" ").filter((word) => letters(word) >= 2).length;
    const upper = letters(line.replace(/[a-zäöüß]/g, "")) / letters(line);
    const score = 10 - index + (legal ? 15 : 0) + (known ? 20 : 0) + (upper > 0.7 ? 3 : 0) + (words >= 2 ? 2 : 0);
    if (!best || score > best.score) best = { line, score };
  });
  return best?.line;
}

export function parseReceiptText(rawText: string): ReceiptSuggestion {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const merchant = merchantFromLines(lines);
  const date = parseDate(rawText);
  const gross = findGross(lines);
  const category = inferCategory(rawText);
  const invoiceNumber = rawText.match(
    /(?:rechnungs?(?:nr|nummer)?|beleg(?:nr|nummer)?|bon)[\s.:#-]*([A-Z0-9\/-]{4,})/i,
  )?.[1];
  const confidence = Math.min(
    100,
    (merchant ? 20 : 0) +
      (date ? 25 : 0) +
      (gross ? 35 : 0) +
      (category !== "sonstige Nebenkosten" ? 20 : 5),
  );
  const projects = [...new Set(rawText.match(/\b\d{2}\.\d{4}\b/g) || [])];
  return {
    projectNumber: projects.length === 1 ? projects[0] : undefined,
    merchant,
    date,
    gross,
    category,
    invoiceNumber,
    vatRate: inferVat(rawText, category),
    rawText,
    confidence,
  };
}

/** Einmal bestätigter Händler (gelernte Regel) im erkannten Text wiederfinden – auch wenn die Kopfzeile unleserlich war. */
function learnedMerchant(rawText: string | undefined, rules: MerchantRule[]) {
  if (!rawText) return undefined;
  const lines = rawText.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim());
  for (const rule of [...rules].sort((a, b) => b.uses - a.uses)) {
    const pattern = rule.merchantPattern.trim().toLowerCase();
    if (pattern.length < 4) continue;
    for (const line of lines) {
      const at = line.toLowerCase().indexOf(pattern);
      if (at >= 0) return line.slice(at, at + pattern.length);
    }
  }
  return undefined;
}

/**
 * Bekannte Händler wiedererkennen und ihre gelernte Regel anwenden. known: bisher verwendete Händler (knownMerchants);
 * ohne Angabe nur die gelernten Regeln. Ein bekannter Händler im Text ersetzt die rohe Kopfzeile durch seinen
 * gewohnten Namen („ARAL AG Station 4711“ → „Aral“). Ist schon ein Händler erkannt, zählen dafür nur die Kopfzeilen.
 */
export function applyMerchantRule(
  suggestion: ReceiptSuggestion,
  rules: MerchantRule[],
  known: KnownMerchant[] = knownMerchants({ expenses: [], merchantRules: rules }),
) {
  // Ohne erkannten Händler: ganzer Text. Mit erkanntem Händler: Kopfzeilen – mehrteilige Namen („Cafe Lindenhof“) auch
  // weiter unten („… dankt“), einzelne Markennamen nicht (z. B. „Parkhaus Aral Center“ auf einer Hotelrechnung).
  const found = suggestion.merchant
    ? findKnownMerchant(suggestion.rawText, known, HEADER_LINES) ?? findKnownMerchant(suggestion.rawText, known.filter((merchant) => significantWords(merchant.name).length >= 2))
    : findKnownMerchant(suggestion.rawText, known);
  if (found) {
    // Nur als Regel bekannt (klein geschrieben): Schreibweise aus dem Beleg übernehmen.
    const name = found.fromRuleOnly && found.rule ? learnedMerchant(suggestion.rawText, [found.rule]) || found.name : found.name;
    suggestion = { ...suggestion, merchant: name };
  }
  if (!suggestion.merchant) return { suggestion, rule: undefined };
  const merchant = suggestion.merchant.toLowerCase(), exact = merchantPattern(suggestion.merchant);
  const rule = rules.find((item) => item.merchantPattern === exact) || rules
    .filter((item) => merchant.includes(item.merchantPattern.toLowerCase()))
    .sort((a, b) => b.uses - a.uses)[0];
  if (!rule) return { suggestion, rule: undefined };
  return {
    suggestion: {
      ...suggestion,
      category: rule.category,
      vatRate: rule.vatRate,
    },
    rule,
  };
}

/** Gilt als sicher erkannt: hohe Texterkennungs-Sicherheit und ein Betrag. Dann wird nicht weiter gedreht. */
const confident = (confidence: number, suggestion: ReceiptSuggestion) => confidence >= 75 && !!suggestion.gross;
const resultScore = (confidence: number, suggestion: ReceiptSuggestion) =>
  confidence + (suggestion.gross ? 15 : 0) + (suggestion.date ? 10 : 0) + (suggestion.merchant ? 5 : 0);
/** Reihenfolge: aufrecht, quer (beide Richtungen), auf dem Kopf. */
export const RECEIPT_ROTATIONS = [0, 90, 270, 180] as const;

type OcrWorker = Pick<import("tesseract.js").Worker, "recognize">;
type OcrImage = import("tesseract.js").ImageLike;

/**
 * Liest den Beleg; liegt er quer oder auf dem Kopf, liefert der erste Durchgang Zeichensalat mit niedriger Sicherheit.
 * Dann wird gedreht erneut gelesen und das beste Ergebnis genommen. `rotation` (Grad) sagt, um wie viel gedreht
 * gelesen wurde.
 */
export async function readReceiptRotated(worker: OcrWorker, image: OcrImage, onPhase?: (text: string) => void) {
  let best: { suggestion: ReceiptSuggestion; score: number; rotation: number; confidence: number } | undefined;
  for (const rotation of RECEIPT_ROTATIONS) {
    onPhase?.(rotation ? `Beleg liegt quer oder auf dem Kopf – lese gedreht (${rotation}°)` : "");
    const result = await worker.recognize(image, rotation ? { rotateRadians: (rotation * Math.PI) / 180 } : {});
    const suggestion = parseReceiptText(result.data.text);
    const score = resultScore(result.data.confidence, suggestion);
    if (!best || score > best.score) best = { suggestion, score, rotation, confidence: result.data.confidence };
    if (confident(result.data.confidence, suggestion)) break;
  }
  return { ...best!.suggestion, rotation: best!.rotation, ocrConfidence: Math.round(best!.confidence) };
}

/** Texterkennung im Browser (tesseract.js, Sprachdaten Deutsch und Englisch). */
export async function recognizeReceiptLocally(
  image: string,
  onProgress?: (progress: number, status: string) => void,
) {
  const { createWorker } = await import("tesseract.js");
  let phase = "";
  const worker = await createWorker(["deu", "eng"], 1, {
    logger: (message) =>
      onProgress?.(
        Math.round((message.progress || 0) * 100),
        phase || message.status || "Texterkennung",
      ),
  });
  try {
    return await readReceiptRotated(worker, image, (text) => { phase = text; });
  } finally {
    await worker.terminate();
  }
}
