import "dotenv/config";
import { extractItems } from "./extractor.js";

interface TestCase {
  label: string;
  input: string;
  expectContains: string[];
  expectCount?: number;
}

const TESTS: TestCase[] = [
  {
    label: "Simple English comma list",
    input: "bread, milk, eggs, butter",
    expectContains: ["bread", "milk", "eggs", "butter"],
    expectCount: 4,
  },
  {
    label: "English with quantities",
    input: "2 cups of flour, 500g sugar, 3 eggs, 1 liter of milk",
    expectContains: ["flour", "sugar", "eggs", "milk"],
    expectCount: 4,
  },
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
    input: "1. Apples\n2. Bananas\n3. Orange juice\n4. Greek yogurt",
    expectContains: ["Apples", "Bananas", "Orange juice", "Greek yogurt"],
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
  console.log(`Running ${TESTS.length} test cases...\n`);

  let passed = 0;
  let failed = 0;

  for (const tc of TESTS) {
    let items: string[];
    try {
      items = await extractItems(tc.input);
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

  console.log(`\n${passed}/${TESTS.length} passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
