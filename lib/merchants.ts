import type { AppState, Expense, MerchantRule, PaymentType } from "./types";

/*
 * Wiederkehrende Händler und Tankstellen.
 * - knownMerchants: alle bisher verwendeten Händler (aus Kosten und gelernten Regeln), häufigste zuerst – für die
 *   Auswahlliste im Feld „Händler“.
 * - findKnownMerchant: einen bekannten Händler im erkannten Belegtext wiederfinden, auch bei kleinen Lesefehlern
 *   („SHEL1“ → Shell, „Muller“ → Müller). Ein Händler gilt als gefunden, wenn alle seine kennzeichnenden Wörter im Text
 *   stehen; Rechtsformen und Allgemeines („GmbH“, „Tankstelle“) zählen nicht. „Aral“ findet so jede Aral-Station,
 *   „Shell Würselen“ nur die in Würselen.
 * - learnMerchant: nach dem Speichern einer Kostenposition Kategorie, Steuersatz und Zahlungsart zum Händler merken.
 */

const STOP = new Set(["gmbh", "mbh", "ag", "kg", "ohg", "gbr", "ug", "ek", "ev", "co", "und", "the", "inh", "inhaber", "tankstelle",
  "station", "service", "shop", "filiale", "str", "strasse", "fa", "firma", "se", "ltd", "inc", "dankt", "vielen", "dank"]);
const normalize = (text: string) => text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ß/g, "ss");
/** Häufige Lesefehler der Texterkennung in Wörtern aus Buchstaben. */
const ocrWord = (word: string) => /[a-z]/.test(word) ? word.replace(/0/g, "o").replace(/1/g, "l").replace(/5/g, "s") : word;
const words = (text: string) => normalize(text).replace(/\|/g, "l").split(/[^a-z0-9&]+/).filter(Boolean).map(ocrWord);
/** Kennzeichnende Wörter eines Händlernamens (ohne Rechtsform, Zahlen und Allgemeines). */
export function significantWords(name: string) {
  const all = words(name).filter((word) => !/^\d+$/.test(word));
  const significant = all.filter((word) => word.length >= 3 && !STOP.has(word));
  return significant.length ? significant : all;
}
/** Höchstens ein Zeichen anders (ersetzt, fehlt oder zu viel). */
function nearlyEqual(a: string, b: string) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
/** Ein Wort im Text: kurze Wörter genau, ab 5 Zeichen mit höchstens einem Lesefehler. */
const wordIn = (word: string, text: string[]) => text.includes(word) || (word.length >= 5 && text.some((candidate) => nearlyEqual(candidate, word)));

export const tidyMerchant = (name: string) => name.replace(/\s+/g, " ").trim().slice(0, 60);
/** Schlüssel einer gelernten Regel (wie bisher im Beleg-Eingang: klein geschrieben, höchstens 40 Zeichen). */
export const merchantPattern = (name: string) => tidyMerchant(name).toLowerCase().slice(0, 40);

export interface KnownMerchant {
  name: string;
  uses: number;
  lastUsed: string;
  rule?: MerchantRule;
  /** Nur als gelernte Regel bekannt (Schreibweise unbekannt, Name klein geschrieben). */
  fromRuleOnly: boolean;
}

/** Bisher verwendete Händler, häufigste und zuletzt verwendete zuerst. Gleiche Namen (Groß-/Kleinschreibung) einmal. */
export function knownMerchants(state: Pick<AppState, "expenses" | "merchantRules">): KnownMerchant[] {
  const byKey = new Map<string, { spellings: Map<string, number>; uses: number; lastUsed: string }>();
  for (const expense of state.expenses) {
    if (!expense.merchant?.trim() || expense.status === "storniert") continue;
    const name = tidyMerchant(expense.merchant), key = merchantPattern(name);
    const entry = byKey.get(key) || { spellings: new Map(), uses: 0, lastUsed: "" };
    entry.spellings.set(name, (entry.spellings.get(name) || 0) + 1);
    entry.uses++;
    if (expense.date > entry.lastUsed) entry.lastUsed = expense.date;
    byKey.set(key, entry);
  }
  const result: KnownMerchant[] = [...byKey.entries()].map(([key, entry]) => ({
    name: [...entry.spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
    uses: entry.uses, lastUsed: entry.lastUsed, rule: state.merchantRules.find((rule) => rule.merchantPattern === key), fromRuleOnly: false,
  }));
  for (const rule of state.merchantRules) {
    const key = rule.merchantPattern.trim().toLowerCase();
    if (!key || byKey.has(key)) continue;
    byKey.set(key, { spellings: new Map(), uses: rule.uses, lastUsed: rule.updatedAt?.slice(0, 10) || "" });
    result.push({ name: rule.merchantPattern.trim(), uses: rule.uses, lastUsed: rule.updatedAt?.slice(0, 10) || "", rule, fromRuleOnly: true });
  }
  return result.sort((a, b) => b.uses - a.uses || b.lastUsed.localeCompare(a.lastUsed) || a.name.localeCompare(b.name));
}

/** Bekannter Händler mit genau diesem Namen (Groß-/Kleinschreibung egal) – z. B. aus der Auswahlliste gewählt. */
export const knownMerchantNamed = (name: string, known: KnownMerchant[]) => {
  const key = merchantPattern(name);
  return key ? known.find((merchant) => merchantPattern(merchant.name) === key) : undefined;
};

/**
 * Bekannten Händler im erkannten Text finden. lines: nur diese Zeilen durchsuchen (z. B. die Kopfzeilen).
 * Bei mehreren Treffern gewinnt der genauere (mehr kennzeichnende Wörter), dann der häufiger verwendete.
 */
export function findKnownMerchant(text: string | undefined, known: KnownMerchant[], lines?: number) {
  if (!text) return undefined;
  const scope = lines ? text.split(/\r?\n/).slice(0, lines).join("\n") : text;
  const textWords = words(scope);
  let best: { merchant: KnownMerchant; score: number } | undefined;
  for (const merchant of known) {
    const significant = significantWords(merchant.name);
    if (!significant.length || !significant.every((word) => wordIn(word, textWords))) continue;
    const score = significant.length * 1000 + merchant.uses;
    if (!best || score > best.score) best = { merchant, score };
  }
  return best?.merchant;
}

/** Nach dem Speichern: Kategorie, Steuersatz und Zahlungsart zum Händler merken (gleiche Regeln wie im Beleg-Eingang). */
export function learnMerchant(state: AppState, expense: Pick<Expense, "merchant" | "category" | "vatRate" | "status"> & { paymentType?: PaymentType | string }, id: () => string, now = new Date()) {
  const pattern = expense.merchant ? merchantPattern(expense.merchant) : "";
  if (!pattern || expense.status === "storniert" || !expense.category) return state;
  const paymentType = (expense.paymentType || "privat vorgestreckt") as PaymentType;
  const rule = state.merchantRules.find((entry) => entry.merchantPattern === pattern);
  if (rule) Object.assign(rule, { category: expense.category, paymentType, vatRate: expense.vatRate, uses: rule.uses + 1, updatedAt: now.toISOString() });
  else state.merchantRules.push({ id: id(), merchantPattern: pattern, category: expense.category, paymentType, vatRate: expense.vatRate, uses: 1, updatedAt: now.toISOString() });
  return state;
}
