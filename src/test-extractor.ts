import "dotenv/config";
import { extractItems, resolveRemoveTargets } from "./extractor.js";

interface TestCase {
  label: string;
  input: string;
  expectContains: string[];
  expectCount?: number;
}

const TESTS: TestCase[] = [
  {
    label: "Russian simple list",
    input: "хлеб, молоко, яйца, масло",
    expectContains: ["хлеб", "молоко", "яйца", "масло"],
    expectCount: 4,
  },
  {
    label: "Russian with quantities",
    input: "500г муки, 2 яйца, 300мл молока, щепотка соли",
    expectContains: ["мука", "яйца", "молоко", "соль"],
    expectCount: 4,
  },
  {
    label: "Russian recipe prose",
    input: "Для борща нужна свекла, капуста, морковь, картошка, лук и томатная паста",
    expectContains: ["свекла", "капуста", "морковь", "картошка", "лук", "томатная паста"],
  },
  {
    label: "Numbered list",
    input: "1. Яблоки\n2. Бананы\n3. Апельсиновый сок\n4. Греческий йогурт",
    expectContains: ["Яблоки", "Бананы", "Апельсиновый сок", "Греческий йогурт"],
    expectCount: 4,
  },
];

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

function check(label: string, items: string[], tc: TestCase): boolean {
  const lower = items.map((s) => s.toLowerCase());
  const missing = tc.expectContains.filter((e) => !lower.some((s) => s.includes(e.toLowerCase())));
  const countOk = tc.expectCount == null || items.length === tc.expectCount;

  if (missing.length === 0 && countOk) {
    console.log(`${GREEN}✓ PASS${RESET} ${label}`);
    console.log(`       result: [${items.join(", ")}]`);
    return true;
  }

  console.log(`${RED}✗ FAIL${RESET} ${label}`);
  console.log(`       result: [${items.join(", ")}]`);
  if (missing.length > 0) {
    console.log(`       missing: [${missing.join(", ")}]`);
  }
  if (!countOk) {
    console.log(`       expected ${tc.expectCount} items, got ${items.length}`);
  }
  return false;
}

async function main() {
  const usingGroq = !!process.env.GROQ_API_KEY;
  console.log(`\nExtractor mode: ${usingGroq ? `${GREEN}Groq LLM (llama-3.3-70b-versatile)${RESET}` : `${YELLOW}heuristic fallback (no GROQ_API_KEY)${RESET}`}`);
  console.log(`Running tests...\n`);

  let passed = 0;
  let failed = 0;

  // --- extractItems tests ---
  for (const tc of TESTS) {
    let items: string[] = [];
    try {
      const groups = await extractItems(tc.input);
      items = groups.flatMap((g) => g.items.map((i) => i.code));
    } catch (err) {
      console.log(`${RED}✗ ERROR${RESET} ${tc.label}: ${err}`);
      failed++;
      continue;
    }
    if (check(tc.label, items, tc)) {
      passed++;
    } else {
      failed++;
    }
  }

  // --- resolveRemoveTargets tests ---
  console.log("\n--- NL Remove matching tests ---\n");

  // Fixture: exact list from the bug report
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

  const removeTests: {
    label: string;
    query: string;
    items: typeof bugReportItems;
    expectIds: number[];
    rejectIds: number[];
  }[] = [
    {
      label: "Remove сыры: only cheese items, NOT молоко (bug report regression)",
      query: "сыры",
      items: bugReportItems,
      expectIds: [3, 4],
      rejectIds: [2, 9], // молоко and шоколадное молоко must NOT be matched
    },
    {
      label: "Remove молоко: matches молоко and/or шоколадное молоко (both are milk)",
      query: "молоко",
      items: bugReportItems,
      expectIds: [2],     // plain молоко must be matched
      rejectIds: [],      // шоколадное молоко is also acceptable — LLM decides
    },
    {
      label: "Remove фарш: single exact match",
      query: "фарш",
      items: bugReportItems,
      expectIds: [10],
      rejectIds: [],
    },
  ];

  for (const rt of removeTests) {
    try {
      const matched = await resolveRemoveTargets(rt.query, rt.items);
      const matchedIds = matched.map((i) => i.id);
      const missingExpected = rt.expectIds.filter((id) => !matchedIds.includes(id));
      const unwantedPresent = rt.rejectIds.filter((id) => matchedIds.includes(id));

      if (missingExpected.length === 0 && unwantedPresent.length === 0) {
        console.log(`${GREEN}✓ PASS${RESET} ${rt.label}`);
        const names = matched.map((i) => (i.details ? `${i.code}, ${i.details}` : i.code));
        console.log(`       matched: [${names.join(", ")}]`);
        passed++;
      } else {
        console.log(`${RED}✗ FAIL${RESET} ${rt.label}`);
        const names = matched.map((i) => (i.details ? `${i.code}, ${i.details}` : i.code));
        console.log(`       matched: [${names.join(", ")}]`);
        if (missingExpected.length > 0) {
          console.log(`       missing expected ids: [${missingExpected.join(", ")}]`);
        }
        if (unwantedPresent.length > 0) {
          const unwanted = rt.items
            .filter((i) => unwantedPresent.includes(i.id))
            .map((i) => (i.details ? `${i.code}, ${i.details}` : i.code));
          console.log(`       wrongly matched: [${unwanted.join(", ")}]`);
        }
        failed++;
      }
    } catch (err) {
      console.log(`${RED}✗ ERROR${RESET} ${rt.label}: ${err}`);
      failed++;
    }
  }

  const total = TESTS.length + removeTests.length;
  console.log(`\n${passed}/${total} passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
