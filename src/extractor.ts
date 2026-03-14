import { logger } from "./logger.js";

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = "llama-3.3-70b-versatile";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const SYSTEM_PROMPT = `You are a shopping list extractor for a large supermarket that sells much more than groceries. Extract individual items to buy from the user's message.

The supermarket has these departments (not exhaustive):
- Food: овощи, фрукты, мясо, рыба, сыры, молоко, яйца, крупы, макароны, бакалея, приправы, завтраки, заморозка, алкоголь, напитки
- Household: бытовая химия, посуда (кастрюли, сковородки, тарелки, приборы, кружки, контейнеры)
- Textiles: подушки, одеяла, простыни, наволочки, комплекты постельного белья, скатерти
- Other: электротехника, спортивные товары, канцелярские товары, детские игрушки, одежда, товары для животных, товары для отдыха на природе

Rules:
- Return ONLY a JSON object with a single key "items" containing an array of strings, e.g. {"items": ["хлеб", "сковородка"]}
- Each string is a short item name (1-4 words) in its base/nominative form
- Keep the original language of the input (Russian stays Russian, English stays English)
- Strip quantities and units ("2 упаковки гречки" → "гречка", "500г молока" → "молоко")
- Normalize capitalization and spacing
- Strip numbering and bullet points
- Do not add items not mentioned; do not combine separate items
- If the input is already a simple list, just clean and return it`;

/**
 * Extract grocery/ingredient names from free-form text using Groq (llama-3.3-70b).
 * Falls back to heuristic splitting if GROQ_API_KEY is not set or on any error.
 */
export async function extractItems(text: string): Promise<string[]> {
  if (GROQ_API_KEY) {
    try {
      const res = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: text },
          ],
          response_format: { type: "json_object" },
          temperature: 0,
        }),
      });

      if (!res.ok) {
        throw new Error(`Groq API error: ${res.status} ${res.statusText}`);
      }

      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const raw = json.choices?.[0]?.message?.content?.trim() ?? "";
      const parsed: unknown = JSON.parse(raw);

      // Accept both ["item"] and {"items": ["item"]} response shapes
      const arr = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as Record<string, unknown>).items)
          ? (parsed as Record<string, unknown>).items
          : null;

      if (Array.isArray(arr)) {
        const items = (arr as unknown[])
          .map((s) => (typeof s === "string" ? s.trim() : ""))
          .filter((s) => s.length > 0);

        if (items.length > 0) {
          logger.debug("extractor", `groq extracted ${items.length} items: [${items.join(", ")}]`);
          return items;
        }
      }
      logger.debug("extractor", "groq returned empty result, falling back to heuristic");
    } catch (err) {
      logger.error("extractor", "groq API error, falling back to heuristic", err);
    }
  }

  return heuristicExtract(text);
}

/**
 * Simple heuristic fallback: splits on common delimiters, strips leading
 * quantities/numbering, deduplicates, and normalizes whitespace.
 */
function heuristicExtract(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(/[,\n;]|\s*[•\-\*]\s+/)
    .map((s) =>
      s
        .trim()
        // strip leading numbered list markers: "1.", "2)", "3 -"
        .replace(/^\d+[\.\)\-]\s*/, "")
        // strip leading quantity+unit: "500g ", "2 cups of ", "3 шт "
        .replace(/^\d+[\d.,]*\s*(?:g|kg|ml|l|oz|lb|шт|г|кг|мл|л|cups?|tbsp|tsp|pcs?)\.?\s+(?:of\s+)?/i, "")
        .trim()
    )
    .filter((s) => {
      if (s.length === 0) return false;
      const key = s.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
