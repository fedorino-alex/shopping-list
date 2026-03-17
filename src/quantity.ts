/**
 * Quantity parsing, arithmetic, and formatting for item merging.
 * Handles "2кг", "5 шт", "500мл", "1.5л", etc.
 */

export interface ParsedQty {
  value: number;
  unit: string; // normalized unit: "кг", "г", "л", "мл", "шт", or raw
}

// --- Unit synonyms → canonical form ---

const UNIT_SYNONYMS: Record<string, string> = {
  // Weight
  кг: "кг", килограмм: "кг", килограмма: "кг", килограммов: "кг",
  г: "г", грамм: "г", грамма: "г", граммов: "г",
  // Volume
  л: "л", литр: "л", литра: "л", литров: "л",
  мл: "мл", миллилитр: "мл", миллилитра: "мл", миллилитров: "мл",
  // Pieces
  шт: "шт", штук: "шт", штука: "шт", штуки: "шт",
  // Packs
  уп: "уп", упаковка: "уп", упаковки: "уп", упаковок: "уп", пачка: "уп", пачки: "уп", пачек: "уп",
  // Bottles
  бут: "бут", бутылка: "бут", бутылки: "бут", бутылок: "бут",
  // Bunches
  пучок: "пучок", пучка: "пучок", пучков: "пучок",
  // Bags / cans
  банка: "банка", банки: "банка", банок: "банка",
};

function normalizeUnit(raw: string): string {
  const lower = raw.toLowerCase().trim();
  return UNIT_SYNONYMS[lower] ?? lower;
}

// --- Conversion groups: bidirectional conversion factors ---
// Key = "fromUnit→toUnit", value = multiplier (from * multiplier = to)

const CONVERSIONS: Record<string, number> = {
  "кг→г": 1000,
  "г→кг": 0.001,
  "л→мл": 1000,
  "мл→л": 0.001,
};

/** Check if two (normalized) units can be converted to each other. */
export function unitsCompatible(a: string, b: string): boolean {
  if (a === b) return true;
  return `${a}→${b}` in CONVERSIONS;
}

/**
 * Convert a value from one unit to another.
 * Returns the converted value, or null if units are incompatible.
 */
function convert(value: number, fromUnit: string, toUnit: string): number | null {
  if (fromUnit === toUnit) return value;
  const factor = CONVERSIONS[`${fromUnit}→${toUnit}`];
  if (factor === undefined) return null;
  return value * factor;
}

/**
 * Choose the "preferred" (larger) unit for display when merging two compatible units.
 * E.g. кг > г, л > мл. If same unit, returns that unit.
 */
function preferredUnit(a: string, b: string): string {
  if (a === b) return a;
  // The "larger" unit is the one where converting 1 of it to the other gives > 1
  // e.g. кг→г = 1000, so 1кг = 1000г → кг is the larger/preferred unit (= a)
  const factor = CONVERSIONS[`${a}→${b}`];
  if (factor !== undefined) {
    return factor > 1 ? a : b;
  }
  return a;
}

// --- Parse quantity from details string ---

// Matches patterns like: "2кг", "2 кг", "500мл", "1.5 л", "5шт", "3", "0.5кг"
// Also handles Russian number words for small quantities
const QTY_REGEX = /^(\d+(?:[.,]\d+)?)\s*([a-zа-яё]*)/i;

const RUSSIAN_NUMBERS: Record<string, number> = {
  один: 1, одна: 1, одну: 1, одно: 1,
  два: 2, две: 2,
  три: 3,
  четыре: 4,
  пять: 5,
  шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10,
};

/**
 * Parse a details string into a structured quantity.
 * Returns null if the string doesn't look like a quantity (e.g. "органическое").
 */
export function parseQty(details: string | null | undefined): ParsedQty | null {
  if (!details || !details.trim()) return null;

  const s = details.trim();

  // Try numeric pattern: "2кг", "500 мл", "1.5л", "3"
  const m = QTY_REGEX.exec(s);
  if (m && m[1]) {
    const value = parseFloat(m[1].replace(",", "."));
    if (isNaN(value) || value <= 0) return null;
    const rawUnit = m[2]?.trim() || "шт";
    return { value, unit: normalizeUnit(rawUnit) };
  }

  // Try Russian number words: "одна штука", "две бутылки"
  const words = s.toLowerCase().split(/\s+/);
  if (words.length >= 1 && words[0] in RUSSIAN_NUMBERS) {
    const value = RUSSIAN_NUMBERS[words[0]];
    const rawUnit = words.slice(1).join(" ") || "шт";
    return { value, unit: normalizeUnit(rawUnit) };
  }

  return null;
}

/**
 * Add two quantities. Converts to the preferred (larger) unit.
 * Returns null if units are incompatible.
 */
export function addQty(a: ParsedQty, b: ParsedQty): ParsedQty | null {
  if (!unitsCompatible(a.unit, b.unit)) return null;

  const targetUnit = preferredUnit(a.unit, b.unit);
  const aConverted = convert(a.value, a.unit, targetUnit)!;
  const bConverted = convert(b.value, b.unit, targetUnit)!;

  return { value: roundQty(aConverted + bConverted), unit: targetUnit };
}

/**
 * Subtract `amount` from `from`. Converts to the `from` unit for result.
 * Returns null if result ≤ 0 or units incompatible.
 */
export function subtractQty(from: ParsedQty, amount: ParsedQty): ParsedQty | null {
  if (!unitsCompatible(from.unit, amount.unit)) return null;

  const amountConverted = convert(amount.value, amount.unit, from.unit);
  if (amountConverted === null) return null;

  const result = roundQty(from.value - amountConverted);
  if (result <= 0) return null;

  return { value: result, unit: from.unit };
}

/**
 * Format a ParsedQty back to a natural details string.
 * E.g. {value: 2.5, unit: "кг"} → "2.5кг", {value: 5, unit: "шт"} → "5 шт"
 */
export function formatQty(qty: ParsedQty): string {
  const v = qty.value % 1 === 0 ? qty.value.toString() : qty.value.toFixed(1).replace(/\.0$/, "");
  // Units that are typically written without a space (кг, г, л, мл)
  const noSpace = ["кг", "г", "л", "мл"];
  const sep = noSpace.includes(qty.unit) ? "" : " ";
  return `${v}${sep}${qty.unit}`;
}

/** Round to avoid floating point artifacts (e.g. 2.0000000001 → 2). */
function roundQty(v: number): number {
  return Math.round(v * 1000) / 1000;
}
