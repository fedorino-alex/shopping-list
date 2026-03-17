import { describe, it, expect } from "vitest";
import { parseQty, addQty, subtractQty, formatQty, unitsCompatible } from "../quantity.js";

// ─── parseQty ───────────────────────────────────────────────

describe("parseQty", () => {
  it("returns null for null/undefined/empty", () => {
    expect(parseQty(null)).toBeNull();
    expect(parseQty(undefined)).toBeNull();
    expect(parseQty("")).toBeNull();
    expect(parseQty("  ")).toBeNull();
  });

  it("returns null for non-quantity text", () => {
    expect(parseQty("органическое")).toBeNull();
    expect(parseQty("без лактозы")).toBeNull();
    expect(parseQty("свежее")).toBeNull();
  });

  it("parses numeric + unit (no space)", () => {
    expect(parseQty("2кг")).toEqual({ value: 2, unit: "кг" });
    expect(parseQty("500мл")).toEqual({ value: 500, unit: "мл" });
    expect(parseQty("1.5л")).toEqual({ value: 1.5, unit: "л" });
    expect(parseQty("100г")).toEqual({ value: 100, unit: "г" });
  });

  it("parses numeric + unit (with space)", () => {
    expect(parseQty("2 кг")).toEqual({ value: 2, unit: "кг" });
    expect(parseQty("5 шт")).toEqual({ value: 5, unit: "шт" });
    expect(parseQty("500 мл")).toEqual({ value: 500, unit: "мл" });
  });

  it("parses bare number as шт", () => {
    expect(parseQty("3")).toEqual({ value: 3, unit: "шт" });
    expect(parseQty("10")).toEqual({ value: 10, unit: "шт" });
  });

  it("parses comma as decimal separator", () => {
    expect(parseQty("1,5кг")).toEqual({ value: 1.5, unit: "кг" });
    expect(parseQty("0,5л")).toEqual({ value: 0.5, unit: "л" });
  });

  it("normalizes unit synonyms", () => {
    expect(parseQty("2 килограмма")).toEqual({ value: 2, unit: "кг" });
    expect(parseQty("500 грамм")).toEqual({ value: 500, unit: "г" });
    expect(parseQty("1 литр")).toEqual({ value: 1, unit: "л" });
    expect(parseQty("200 миллилитров")).toEqual({ value: 200, unit: "мл" });
    expect(parseQty("3 штуки")).toEqual({ value: 3, unit: "шт" });
    expect(parseQty("2 упаковки")).toEqual({ value: 2, unit: "уп" });
    expect(parseQty("1 пачка")).toEqual({ value: 1, unit: "уп" });
    expect(parseQty("2 бутылки")).toEqual({ value: 2, unit: "бут" });
    expect(parseQty("1 пучок")).toEqual({ value: 1, unit: "пучок" });
    expect(parseQty("3 банки")).toEqual({ value: 3, unit: "банка" });
  });

  it("parses Russian number words", () => {
    expect(parseQty("одна штука")).toEqual({ value: 1, unit: "шт" });
    expect(parseQty("две бутылки")).toEqual({ value: 2, unit: "бут" });
    expect(parseQty("три пачки")).toEqual({ value: 3, unit: "уп" });
    expect(parseQty("пять штук")).toEqual({ value: 5, unit: "шт" });
  });

  it("Russian number word without unit defaults to шт", () => {
    expect(parseQty("одна")).toEqual({ value: 1, unit: "шт" });
    expect(parseQty("два")).toEqual({ value: 2, unit: "шт" });
  });
});

// ─── unitsCompatible ────────────────────────────────────────

describe("unitsCompatible", () => {
  it("same units are compatible", () => {
    expect(unitsCompatible("кг", "кг")).toBe(true);
    expect(unitsCompatible("шт", "шт")).toBe(true);
    expect(unitsCompatible("уп", "уп")).toBe(true);
  });

  it("кг ↔ г are compatible", () => {
    expect(unitsCompatible("кг", "г")).toBe(true);
    expect(unitsCompatible("г", "кг")).toBe(true);
  });

  it("л ↔ мл are compatible", () => {
    expect(unitsCompatible("л", "мл")).toBe(true);
    expect(unitsCompatible("мл", "л")).toBe(true);
  });

  it("incompatible units", () => {
    expect(unitsCompatible("кг", "л")).toBe(false);
    expect(unitsCompatible("шт", "кг")).toBe(false);
    expect(unitsCompatible("уп", "бут")).toBe(false);
    expect(unitsCompatible("кг", "шт")).toBe(false);
  });
});

// ─── addQty ─────────────────────────────────────────────────

describe("addQty", () => {
  it("adds same units", () => {
    expect(addQty({ value: 2, unit: "кг" }, { value: 3, unit: "кг" }))
      .toEqual({ value: 5, unit: "кг" });
    expect(addQty({ value: 5, unit: "шт" }, { value: 3, unit: "шт" }))
      .toEqual({ value: 8, unit: "шт" });
  });

  it("adds кг + г → result in кг", () => {
    expect(addQty({ value: 2, unit: "кг" }, { value: 500, unit: "г" }))
      .toEqual({ value: 2.5, unit: "кг" });
  });

  it("adds г + кг → result in кг", () => {
    expect(addQty({ value: 500, unit: "г" }, { value: 1, unit: "кг" }))
      .toEqual({ value: 1.5, unit: "кг" });
  });

  it("adds л + мл → result in л", () => {
    expect(addQty({ value: 1, unit: "л" }, { value: 250, unit: "мл" }))
      .toEqual({ value: 1.25, unit: "л" });
  });

  it("adds мл + л → result in л", () => {
    expect(addQty({ value: 500, unit: "мл" }, { value: 2, unit: "л" }))
      .toEqual({ value: 2.5, unit: "л" });
  });

  it("returns null for incompatible units", () => {
    expect(addQty({ value: 2, unit: "кг" }, { value: 1, unit: "л" })).toBeNull();
    expect(addQty({ value: 3, unit: "шт" }, { value: 1, unit: "кг" })).toBeNull();
    expect(addQty({ value: 1, unit: "уп" }, { value: 2, unit: "бут" })).toBeNull();
  });

  it("handles fractional results", () => {
    expect(addQty({ value: 0.5, unit: "кг" }, { value: 0.3, unit: "кг" }))
      .toEqual({ value: 0.8, unit: "кг" });
  });
});

// ─── subtractQty ────────────────────────────────────────────

describe("subtractQty", () => {
  it("subtracts same units", () => {
    expect(subtractQty({ value: 5, unit: "кг" }, { value: 2, unit: "кг" }))
      .toEqual({ value: 3, unit: "кг" });
    expect(subtractQty({ value: 10, unit: "шт" }, { value: 3, unit: "шт" }))
      .toEqual({ value: 7, unit: "шт" });
  });

  it("subtracts г from кг → result in кг", () => {
    expect(subtractQty({ value: 2, unit: "кг" }, { value: 500, unit: "г" }))
      .toEqual({ value: 1.5, unit: "кг" });
  });

  it("subtracts мл from л → result in л", () => {
    expect(subtractQty({ value: 2, unit: "л" }, { value: 500, unit: "мл" }))
      .toEqual({ value: 1.5, unit: "л" });
  });

  it("returns null when result is zero", () => {
    expect(subtractQty({ value: 2, unit: "кг" }, { value: 2, unit: "кг" })).toBeNull();
  });

  it("returns null when result is negative", () => {
    expect(subtractQty({ value: 1, unit: "кг" }, { value: 2, unit: "кг" })).toBeNull();
    expect(subtractQty({ value: 500, unit: "г" }, { value: 1, unit: "кг" })).toBeNull();
  });

  it("returns null for incompatible units", () => {
    expect(subtractQty({ value: 5, unit: "кг" }, { value: 1, unit: "л" })).toBeNull();
    expect(subtractQty({ value: 3, unit: "шт" }, { value: 1, unit: "кг" })).toBeNull();
  });
});

// ─── formatQty ──────────────────────────────────────────────

describe("formatQty", () => {
  it("formats weight/volume without space", () => {
    expect(formatQty({ value: 2, unit: "кг" })).toBe("2кг");
    expect(formatQty({ value: 500, unit: "г" })).toBe("500г");
    expect(formatQty({ value: 1.5, unit: "л" })).toBe("1.5л");
    expect(formatQty({ value: 250, unit: "мл" })).toBe("250мл");
  });

  it("formats шт and other units with space", () => {
    expect(formatQty({ value: 5, unit: "шт" })).toBe("5 шт");
    expect(formatQty({ value: 2, unit: "уп" })).toBe("2 уп");
    expect(formatQty({ value: 3, unit: "бут" })).toBe("3 бут");
    expect(formatQty({ value: 1, unit: "пучок" })).toBe("1 пучок");
  });

  it("formats integers without decimal point", () => {
    expect(formatQty({ value: 3, unit: "кг" })).toBe("3кг");
    expect(formatQty({ value: 10, unit: "шт" })).toBe("10 шт");
  });

  it("formats decimals with one decimal place", () => {
    expect(formatQty({ value: 2.5, unit: "кг" })).toBe("2.5кг");
    expect(formatQty({ value: 1.5, unit: "л" })).toBe("1.5л");
  });
});

// ─── End-to-end: parseQty → addQty/subtractQty → formatQty ─

describe("end-to-end merge scenarios", () => {
  it("Булочки 5шт + 1шт → 6шт", () => {
    const existing = parseQty("5 шт")!;
    const incoming = parseQty("1 шт")!;
    const merged = addQty(existing, incoming)!;
    expect(formatQty(merged)).toBe("6 шт");
  });

  it("Сахар 2кг + 1кг → 3кг", () => {
    const existing = parseQty("2кг")!;
    const incoming = parseQty("1кг")!;
    const merged = addQty(existing, incoming)!;
    expect(formatQty(merged)).toBe("3кг");
  });

  it("Сахар 2кг − 1кг → 1кг", () => {
    const existing = parseQty("2кг")!;
    const amount = parseQty("1кг")!;
    const result = subtractQty(existing, amount)!;
    expect(formatQty(result)).toBe("1кг");
  });

  it("Молоко 2л + 500мл → 2.5л (cross-unit)", () => {
    const existing = parseQty("2л")!;
    const incoming = parseQty("500мл")!;
    const merged = addQty(existing, incoming)!;
    expect(formatQty(merged)).toBe("2.5л");
  });

  it("Мука 1кг − 500г → 0.5кг (cross-unit subtract)", () => {
    const existing = parseQty("1кг")!;
    const amount = parseQty("500г")!;
    const result = subtractQty(existing, amount)!;
    expect(formatQty(result)).toBe("0.5кг");
  });

  it("Сахар 1кг − 2кг → null (over-subtract)", () => {
    const existing = parseQty("1кг")!;
    const amount = parseQty("2кг")!;
    expect(subtractQty(existing, amount)).toBeNull();
  });

  it("incompatible units return null on add", () => {
    const a = parseQty("2кг")!;
    const b = parseQty("1л")!;
    expect(addQty(a, b)).toBeNull();
  });

  it("bare number '3' treated as 3 шт", () => {
    const existing = parseQty("5 шт")!;
    const incoming = parseQty("3")!;
    const merged = addQty(existing, incoming)!;
    expect(formatQty(merged)).toBe("8 шт");
  });

  it("synonym units merge correctly (штуки + шт)", () => {
    const existing = parseQty("3 штуки")!;
    const incoming = parseQty("2 шт")!;
    expect(existing.unit).toBe("шт");
    expect(incoming.unit).toBe("шт");
    const merged = addQty(existing, incoming)!;
    expect(formatQty(merged)).toBe("5 шт");
  });

  it("synonym units merge correctly (грамм + кг)", () => {
    const existing = parseQty("500 грамм")!;
    const incoming = parseQty("1кг")!;
    expect(existing.unit).toBe("г");
    expect(incoming.unit).toBe("кг");
    const merged = addQty(existing, incoming)!;
    expect(formatQty(merged)).toBe("1.5кг");
  });
});
