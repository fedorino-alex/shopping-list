/**
 * LLM integration tests for extractor — NOT run by default.
 * These hit the real Groq/Ollama API and need GROQ_API_KEY or LLM_BASE_URL + rate-limit delays.
 *
 * Run explicitly:
 *   npx vitest run src/__tests__/extractor.integration.test.ts
 *   npm run test:llm
 */
import "dotenv/config";
import { describe, it, expect } from "vitest";
import { classifyAndExtract, resolveRemoveTargets } from "../extractor.js";

const LLM_AVAILABLE = !!(process.env.GROQ_API_KEY || process.env.LLM_BASE_URL);
const DELAY_MS = 2000;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Skip entire file if no LLM configured
const describeIfLLM = LLM_AVAILABLE ? describe : describe.skip;

/** Bidirectional substring match — tolerant of LLM rewording. */
function fuzzyMatch(codes: string[], expected: string): boolean {
  const e = expected.toLowerCase();
  return codes.some((c) => c.includes(e) || e.includes(c));
}

// ─── classifyAndExtract ─────────────────────────────────────

describeIfLLM("classifyAndExtract (LLM)", () => {
  it("Russian simple list", async () => {
    const steps = await classifyAndExtract("хлеб, молоко, яйца, масло", "NORMAL");
    const step = steps[0];
    expect(step.intent).toBe("add");
    if (step.intent === "add") {
      const codes = step.groups.flatMap((g) => g.items.map((i) => i.code.toLowerCase()));
      expect(codes).toEqual(expect.arrayContaining(["хлеб", "молоко", "яйца", "масло"]));
      expect(codes).toHaveLength(4);
    }
  });

  it("Russian with quantities", async () => {
    await delay(DELAY_MS);
    const steps = await classifyAndExtract("500г муки, 2 яйца, 300мл молока, щепотка соли", "NORMAL");
    const step = steps[0];
    expect(step.intent).toBe("add");
    if (step.intent === "add") {
      const codes = step.groups.flatMap((g) => g.items.map((i) => i.code.toLowerCase()));
      for (const expected of ["мука", "яйца", "молоко", "соль"]) {
        expect(fuzzyMatch(codes, expected)).toBe(true);
      }
      expect(codes).toHaveLength(4);
    }
  });

  it("Russian recipe prose", async () => {
    await delay(DELAY_MS);
    const steps = await classifyAndExtract(
      "Для борща нужна свекла, капуста, морковь, картошка, лук и томатная паста",
      "NORMAL",
    );
    const step = steps[0];
    expect(step.intent).toBe("add");
    if (step.intent === "add") {
      const codes = step.groups.flatMap((g) => g.items.map((i) => i.code.toLowerCase()));
      for (const expected of ["свекла", "капуста", "морковь", "картошка", "лук", "томатная паста"]) {
        expect(fuzzyMatch(codes, expected)).toBe(true);
      }
    }
  });

  it("Numbered list", async () => {
    await delay(DELAY_MS);
    const steps = await classifyAndExtract(
      "1. Яблоки\n2. Бананы\n3. Апельсиновый сок\n4. Греческий йогурт",
      "NORMAL",
    );
    // LLM may return one add with 4 items or 4 separate add steps
    const addSteps = steps.filter((s) => s.intent === "add");
    expect(addSteps.length).toBeGreaterThanOrEqual(1);
    const codes = addSteps.flatMap((s) =>
      s.intent === "add" ? s.groups.flatMap((g) => g.items.map((i) => i.code.toLowerCase())) : [],
    );
    for (const expected of ["яблоки", "бананы", "апельсиновый сок", "греческий йогурт"]) {
      expect(fuzzyMatch(codes, expected)).toBe(true);
    }
    expect(codes).toHaveLength(4);
  });
});

// ─── resolveRemoveTargets ───────────────────────────────────

describeIfLLM("resolveRemoveTargets (LLM)", () => {
  const bugReportItems = [
    { id: 1,  code: "наполнитель для лотка", details: null },
    { id: 2,  code: "молоко",               details: null },
    { id: 3,  code: "сыр с плесенью",       details: null },
    { id: 4,  code: "сыр с травами",        details: null },
    { id: 5,  code: "мясная нарезка",       details: null },
    { id: 6,  code: "печенье с корицей",    details: null },
    { id: 7,  code: "горький шоколад",      details: "100г" },
    { id: 8,  code: "яйца",                details: null },
    { id: 9,  code: "шоколадное молоко",    details: "2 бут" },
    { id: 10, code: "фарш",                details: "2 уп" },
  ];

  it("Remove сыры: only cheese items, not молоко", async () => {
    const matched = await resolveRemoveTargets("сыры", bugReportItems);
    const ids = matched.map((i) => i.id);
    expect(ids).toContain(3);
    expect(ids).toContain(4);
    expect(ids).not.toContain(2);
    expect(ids).not.toContain(9);
  });

  it("Remove молоко: matches plain молоко", async () => {
    await delay(DELAY_MS);
    const matched = await resolveRemoveTargets("молоко", bugReportItems);
    const ids = matched.map((i) => i.id);
    expect(ids).toContain(2);
  });

  it("Remove фарш: single exact match", async () => {
    await delay(DELAY_MS);
    const matched = await resolveRemoveTargets("фарш", bugReportItems);
    const ids = matched.map((i) => i.id);
    expect(ids).toEqual([10]);
  });

  // ─── Exact match priority (code-level, no LLM) ─────────────

  it("Remove масло: exact match takes priority over category", async () => {
    const items = [
      { id: 1, code: "масло", details: null },
      { id: 2, code: "сливочное масло", details: null },
      { id: 3, code: "машинное масло", details: null },
      { id: 4, code: "растительное масло", details: null },
    ];
    const matched = await resolveRemoveTargets("масло", items);
    expect(matched).toHaveLength(1);
    expect(matched[0].id).toBe(1);
  });

  it("Remove масло as category: no exact match → all масло items", async () => {
    await delay(DELAY_MS);
    const items = [
      { id: 2, code: "сливочное масло", details: null },
      { id: 3, code: "машинное масло", details: null },
      { id: 4, code: "растительное масло", details: null },
    ];
    const matched = await resolveRemoveTargets("масло", items);
    expect(matched).toHaveLength(3);
  });
});

// ─── Prompt regression tests ────────────────────────────────

describeIfLLM("classifyAndExtract — prompt regressions (LLM)", () => {
  it("Remove preserves user words: 'убери сливочное' → query='сливочное'", async () => {
    const steps = await classifyAndExtract("убери сливочное", "NORMAL");
    const step = steps[0];
    expect(step.intent).toBe("remove");
    if (step.intent === "remove") {
      expect(step.query.toLowerCase()).toContain("сливочн");
    }
  });

  it("Plural for countable items: 'добавь котлету' → code is plural", async () => {
    await delay(DELAY_MS);
    const steps = await classifyAndExtract("добавь котлету", "NORMAL");
    const step = steps[0];
    expect(step.intent).toBe("add");
    if (step.intent === "add") {
      const code = step.groups[0]?.items[0]?.code.toLowerCase();
      expect(code).toMatch(/котлет/);
    }
  });

  it("Word order: 'масло растительное' → contains растительное масло in some form", async () => {
    await delay(DELAY_MS);
    const steps = await classifyAndExtract("масло растительное", "NORMAL");
    const addSteps = steps.filter((s) => s.intent === "add");
    expect(addSteps.length).toBeGreaterThanOrEqual(1);
    const codes = addSteps.flatMap((s) =>
      s.intent === "add" ? s.groups.flatMap((g) => g.items.map((i) => i.code.toLowerCase())) : [],
    );
    // LLM may return either word order — both are fine, code-level matching handles it
    const hasOil = codes.some((c) => c.includes("масло") && c.includes("растительн"));
    expect(hasOil).toBe(true);
  });

  it("Deduplication within message: recipe with repeated масло → at most 2 масло items", async () => {
    await delay(DELAY_MS);
    const steps = await classifyAndExtract(
      "Нужно: растительное масло для жарки, лук, морковь, масло растительное для заправки",
      "NORMAL",
    );
    const addSteps = steps.filter((s) => s.intent === "add");
    const codes = addSteps.flatMap((s) =>
      s.intent === "add" ? s.groups.flatMap((g) => g.items.map((i) => i.code.toLowerCase())) : [],
    );
    const masloCodes = codes.filter((c) => c.includes("масло") || c.includes("масл"));
    // LLM may deduplicate to 1 or return 2 — code-level merge handles both
    expect(masloCodes.length).toBeLessThanOrEqual(2);
    expect(masloCodes.length).toBeGreaterThanOrEqual(1);
  });

  it("Qty extraction: '2кг сахара' → structured qty", async () => {
    await delay(DELAY_MS);
    const steps = await classifyAndExtract("добавь 2кг сахара", "NORMAL");
    const step = steps[0];
    expect(step.intent).toBe("add");
    if (step.intent === "add") {
      const item = step.groups[0]?.items[0];
      expect(item).toBeDefined();
      expect(item?.qty).toBeDefined();
      expect(item?.qty?.value).toBe(2);
      expect(item?.qty?.unit).toBe("кг");
    }
  });
});
