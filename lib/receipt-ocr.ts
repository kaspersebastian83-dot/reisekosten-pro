import type { MerchantRule, ReceiptSuggestion } from "./types";

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
    const matches = line.match(/\b\d{1,5}(?:[.,]\d{2})\b/g) || [];
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

function merchantFromLines(lines: string[]) {
  return lines
    .find((line) => {
      const clean = line.trim();
      return (
        clean.length >= 3 &&
        clean.length <= 60 &&
        /[A-Za-zÄÖÜäöü]/.test(clean) &&
        !/(rechnung|kassenbon|beleg|datum|steuer|ust|mwst|eur|gesamt|summe)/i.test(
          clean,
        )
      );
    })
    ?.trim();
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
  return {
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

export function applyMerchantRule(
  suggestion: ReceiptSuggestion,
  rules: MerchantRule[],
) {
  if (!suggestion.merchant) return { suggestion, rule: undefined };
  const merchant = suggestion.merchant.toLowerCase();
  const rule = rules
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

export async function recognizeReceiptLocally(
  image: string,
  onProgress?: (progress: number, status: string) => void,
) {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(["deu", "eng"], 1, {
    logger: (message) =>
      onProgress?.(
        Math.round((message.progress || 0) * 100),
        message.status || "Texterkennung",
      ),
  });
  try {
    const result = await worker.recognize(image);
    return parseReceiptText(result.data.text);
  } finally {
    await worker.terminate();
  }
}
