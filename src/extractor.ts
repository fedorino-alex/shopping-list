import { logger } from "./logger.js";

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = "llama-3.3-70b-versatile";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export interface ExtractedItem {
  code: string;
  details?: string;
}

export interface ExtractedGroup {
  group: string;
  items: ExtractedItem[];
}

export type BotState = 'IDLE' | 'NORMAL' | 'SHOPPING';

export type NLCommand =
  | { intent: 'add'; groups: ExtractedGroup[] }
  | { intent: 'remove'; query: string }
  | { intent: 'show' }
  | { intent: 'start_shopping' }
  | { intent: 'unknown' };

const DEPT_MAPPING = `- Хлеб и хлебобулочные изделия: хлеб, булочки, багеты, выпечка, вафли, тортилья, безглютеновый хлеб
- Фрукты, овощи и зелень: фрукты, овощи, зелень, салаты, грибы, квашеные овощи
- Сухофрукты и орехи: сухофрукты, орехи, семечки, мак, чипсы из фруктов и овощей
- Замороженные продукты: мороженое, замороженные овощи, замороженные фрукты, замороженная рыба, замороженное мясо, пельмени, вареники
- Мясо и птица: курица, индейка, свинина, говядина, фарш, баранина, стейки, телятина
- Рыба и морепродукты: свежая рыба, копчёная рыба, вяленая рыба, морепродукты, суши, сельдь
- Сыры: сыры всех видов, маскарпоне, рикотта, плавленые сыры
- Колбасные изделия: колбасы, сосиски, кабанос, паштеты, кровянка
- Готовые блюда и кулинария: готовые блюда, супы, дания в банках, пицца
- Молоко, молочные продукты и яйца: молоко, сметана, йогурты, кефир, творог, масло, маргарин, яйца, дрожжи
- Растительные продукты: тофу, хумус, растительное мясо, растительное молоко, растительные сыры
- Кухни мира: японские, китайские, корейские, мексиканские, индийские, итальянские продукты
- Напитки и соки: вода, соки, газировка, нектары, морсы, энергетики, изотоники, сиропы
- Сладости: шоколад, конфеты, леденцы, печенье, батончики, жевательная резинка, халва
- Солёные закуски: чипсы, снеки, хрустяшки, крекеры, попкорн, орешки, вяленое мясо
- Консервы и заготовки: овощные консервы, рыбные консервы, мясные консервы, джемы, мёд, варенье
- Соусы, приправы и масла: специи, растительное масло, оливковое масло, уксус, кетчуп, майонез, горчица, томатная паста, соусы
- Крупы и сыпучие продукты: сахар, мука, крупы, рис, гречка, макароны, бобовые, семена
- Товары для выпечки: разрыхлитель, ванилин, желатин, пищевые красители, кондитерские добавки
- Кофе, чай и какао: кофе, чай, какао, ройбуш, мате, горячий шоколад
- Алкоголь: пиво, вино, водка, виски, ром, джин, коньяк, ликёр, текила, сидр, медовуха
- Бытовая химия и чистящие средства: стиральный порошок, средства для посудомойки, средства для мытья посуды, чистящие средства, губки, швабры, мусорные пакеты, туалетная бумага, освежитель воздуха
- Гигиена и косметика: мыло, гель для душа, шампунь, кондиционер, зубная паста, дезодорант, духи, крем, подгузники, прокладки, тампоны, витамины
- Товары для детей и мам: детское молоко (смесь), детское питание, детские соки, детская косметика, пелёнки
- Игрушки: LEGO, плюшевые игрушки, конструкторы, настольные игры, пазлы
- Товары для животных: корм для кошек, корм для собак, наполнитель для лотка (срало), корм для рыб, корм для птиц, лакомства
- Канцелярские и школьные товары: ручки, карандаши, тетради, бумага, папки, скоросшиватели, клей, скотч, калькулятор
- Товары для дома: лампочки, кастрюли, сковородки, тарелки, постельное бельё, подушки, полотенца, ковры, шторы
- Инструменты и ремонт: инструменты, клей строительный, герметик, батарейки
- Сад и огород: садовая мебель, грунт, семена, удобрения, аксессуары для гриля
- Электроника и мультимедиа: наушники, колонки, зарядное устройство, кабель, чехол для телефона
- Спорт и отдых: спортинвентарь, спортивная одежда
- Автотовары: моторное масло, автохимия, размораживатель`;

const SYSTEM_PROMPT = `You are a shopping list extractor for a large supermarket. Extract items from the user's message and assign each item to the correct department.

Department mapping (use these exact Russian department names):
${DEPT_MAPPING}

Return ONLY a JSON object in this format:
{"groups": [{"group": "<exact department name>", "items": [{"code": "canonical item name", "details": "quantity or null"}]}]}

Rules:
- Only include groups that have at least one item from the user's message
- code: canonical base/nominative form of the product (1-4 words). E.g. "картошка", "белое вино", "молоко"
- details: quantity, weight, or other specifics if mentioned (e.g. "1кг", "2л", "500г"). Use null if not mentioned
- Keep the original language (Russian stays Russian, English stays English)
- Strip numbering and bullet points
- Do not add items not mentioned; do not split or combine items
- If an item does not fit any department, assign it to "Разное"`;

/**
 * Extract items from free-form text using Groq (llama-3.3-70b), grouped by supermarket department.
 * Falls back to heuristic splitting if GROQ_API_KEY is not set or on any error.
 */
export async function extractItems(text: string): Promise<ExtractedGroup[]> {
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
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      const rawGroups = Array.isArray(parsed.groups) ? parsed.groups : null;

      if (rawGroups) {
        const groups: ExtractedGroup[] = (rawGroups as unknown[])
          .filter(
            (g): g is { group: string; items: unknown[] } =>
              typeof (g as Record<string, unknown>).group === "string" &&
              Array.isArray((g as Record<string, unknown>).items)
          )
          .map((g) => ({
            group: g.group.trim(),
            items: (g.items as unknown[])
              .filter(
                (it): it is { code: string; details?: string | null } =>
                  typeof (it as Record<string, unknown>).code === "string"
              )
              .map((it) => ({
                code: it.code.trim(),
                ...(it.details && typeof it.details === "string" && it.details.trim()
                  ? { details: it.details.trim() }
                  : {}),
              }))
              .filter((it) => it.code.length > 0),
          }))
          .filter((g) => g.items.length > 0);

        if (groups.length > 0) {
          const total = groups.reduce((n, g) => n + g.items.length, 0);
          logger.debug(
            "extractor",
            `groq extracted ${total} items in ${groups.length} groups: ${groups.map((g) => `${g.group}:[${g.items.map((i) => i.code).join(", ")}]`).join(" | ")}`
          );
          return groups;
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
 * Classify the user's natural-language intent and, when intent is "add",
 * simultaneously extract grocery items. Passes current bot state to the LLM
 * for smarter disambiguation. Falls back to keyword heuristics if Groq is unavailable.
 */
export async function classifyAndExtract(text: string, state: BotState): Promise<NLCommand> {
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
            { role: "system", content: buildClassifyPrompt(state) },
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
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const intent = parsed.intent as string;

      if (intent === "show") {
        logger.debug("extractor", "classify: show");
        return { intent: "show" };
      }
      if (intent === "start_shopping") {
        logger.debug("extractor", "classify: start_shopping");
        return { intent: "start_shopping" };
      }
      if (intent === "remove") {
        const query = typeof parsed.query === "string" ? parsed.query.trim() : "";
        if (query) {
          logger.debug("extractor", `classify: remove, query="${query}"`);
          return { intent: "remove", query };
        }
        return { intent: "unknown" };
      }
      if (intent === "add") {
        const rawGroups = Array.isArray(parsed.groups) ? parsed.groups : [];
        const groups: ExtractedGroup[] = (rawGroups as unknown[])
          .filter(
            (g): g is { group: string; items: unknown[] } =>
              typeof (g as Record<string, unknown>).group === "string" &&
              Array.isArray((g as Record<string, unknown>).items)
          )
          .map((g) => ({
            group: g.group.trim(),
            items: (g.items as unknown[])
              .filter(
                (it): it is { code: string; details?: string | null } =>
                  typeof (it as Record<string, unknown>).code === "string"
              )
              .map((it) => ({
                code: it.code.trim(),
                ...(it.details && typeof it.details === "string" && it.details.trim()
                  ? { details: it.details.trim() }
                  : {}),
              }))
              .filter((it) => it.code.length > 0),
          }))
          .filter((g) => g.items.length > 0);

        if (groups.length > 0) {
          const total = groups.reduce((n, g) => n + g.items.length, 0);
          logger.debug("extractor", `classify: add, ${total} items in ${groups.length} groups`);
          return { intent: "add", groups };
        }
        // Groq said "add" but extracted nothing
        return { intent: "unknown" };
      }

      logger.debug("extractor", `classify: unknown (intent="${intent}")`);
      return { intent: "unknown" };
    } catch (err) {
      logger.error("extractor", "classify groq error, falling back to heuristic", err);
    }
  }

  return heuristicClassify(text, state);
}

function buildClassifyPrompt(state: BotState): string {
  const stateDesc: Record<BotState, string> = {
    IDLE: "no active shopping list exists",
    NORMAL: "a shopping list exists",
    SHOPPING: "shopping is in progress",
  };
  return `You are a shopping list bot assistant. Classify the user's message intent.
Bot state: ${state} — ${stateDesc[state]}.

Intents:
- "add": user wants to add grocery items (e.g. "добавь молоко", "купи хлеб и масло", bare product list like "молоко хлеб яйца")
- "remove": user wants to remove or delete items from the list (e.g. "убери молоко", "удали хлеб", "вычеркни вино")
- "show": user wants to see the current shopping list (e.g. "покажи список", "что в списке", "what's on the list")
- "start_shopping": user wants to begin shopping (e.g. "начни покупки", "поехали", "идём", "старт", "go shopping")
- "unknown": unrelated to the shopping list or intent is unclear

If intent is "add", also extract grocery items and assign each to the correct supermarket department.
If intent is "remove", normalize what the user wants to remove to a clean base form (query).

Department mapping (use these exact Russian department names):
${DEPT_MAPPING}

Return ONLY valid JSON:
- For "add": {"intent":"add","groups":[{"group":"<exact dept name>","items":[{"code":"canonical item name","details":"quantity or null"}]}]}
- For "remove": {"intent":"remove","query":"<canonical base form of what to remove, e.g. вино, молоко>"}
- For others: {"intent":"show"} or {"intent":"start_shopping"} or {"intent":"unknown"}

Rules for item extraction (only when intent = "add"):
- code: canonical base/nominative form of the product (1-4 words). E.g. "картошка", "белое вино"
- details: quantity, weight, or other specifics if mentioned (e.g. "1кг", "2л"). Use null if not mentioned
- Strip numbering and command words ("добавь", "купи", "нужно" etc.)
- Keep original language of item names; unrecognized items → "Разное"`;
}

/** Heuristic fallback for when Groq is unavailable. */
function heuristicClassify(text: string, state: BotState): NLCommand {
  const lower = text.toLowerCase();

  if (/покажи|что (в|нужно купить)|состав/.test(lower) || /\bсписок\b/.test(lower) && /\bпокажи|\bвидеть|\bхочу\b/.test(lower)) {
    return { intent: "show" };
  }
  if (/начни|начать|стартуй|поехали|\bстарт\b|идём|в магазин|go shopping/.test(lower)) {
    return { intent: "start_shopping" };
  }
  if (/\b(убери|удали|вычеркни|сними|исключи)\b/.test(lower)) {
    const query = text.replace(/^\s*(убери|удали|вычеркни|сними|исключи)\s*/i, "").trim();
    return { intent: "remove", query: query || text };
  }

  const hasAddKeyword = /\b(добавь|добавить|купи|купить|нужно|возьми|взять|положи)\b/.test(lower);
  if (hasAddKeyword || state !== "SHOPPING") {
    const stripped = text
      .replace(/^\s*(добавь|добавить|купи|купить|нужно|возьми|взять|положи)\s*/i, "")
      .trim();
    const groups = heuristicExtract(stripped || text);
    if (groups.flatMap((g) => g.items).length > 0) {
      return { intent: "add", groups };
    }
  }

  return { intent: "unknown" };
}

/**
 * Simple heuristic fallback: splits on common delimiters, strips leading
 * quantities/numbering, deduplicates, and normalizes whitespace.
 * Returns a single group "Разное" containing all extracted items.
 */
function heuristicExtract(text: string): ExtractedGroup[] {
  const seen = new Set<string>();
  const items = text
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
    })
    .map((s): ExtractedItem => ({ code: s }));
  return items.length > 0 ? [{ group: "Разное", items }] : [];
}

/**
 * Given a removal query (e.g. "вино") and the current list of visible items,
 * uses the LLM to semantically match which items should be removed.
 * Falls back to substring matching if Groq is unavailable.
 */
export async function resolveRemoveTargets(
  query: string,
  items: { id: number; code: string; details: string | null }[],
): Promise<{ id: number; code: string; details: string | null }[]> {
  if (items.length === 0) return [];

  if (GROQ_API_KEY) {
    try {
      const itemList = items
        .map((item) => `- ${item.code}`)
        .join("\n");

        logger.debug("extractor", `resolveRemoveTargets: query="${query}", ${items.length} items:\n${itemList}`);

      const res = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            {
              role: "system",
              content: `You are a shopping list assistant. The user wants to remove items. Given the current list, return which items match the removal query.\n\nCurrent items:\n${itemList}\n\nReturn ONLY JSON: {"matching": ["exact item name 1", "exact item name 2"]}\nCopy item names EXACTLY as they appear in the list above.\n\nMatching rules:\n- "вино" with ["\u0431\u0435\u043b\u043e\u0435 \u0432\u0438\u043d\u043e", "\u043a\u0440\u0430\u0441\u043d\u043e\u0435 \u0432\u0438\u043d\u043e"] \u2192 matches both (query is the root noun of all items)\n- "\u0441\u044b\u0440\u044b" with ["\u0441\u044b\u0440 \u0441 \u043f\u043b\u0435\u0441\u0435\u043d\u044c\u044e", "\u0441\u044b\u0440 \u0441 \u0442\u0440\u0430\u0432\u0430\u043c\u0438", "\u043c\u043e\u043b\u043e\u043a\u043e"] \u2192 matches only the cheese items (\u0441\u044b\u0440*)\n- "\u043c\u043e\u043b\u043e\u043a\u043e" with ["\u043c\u043e\u043b\u043e\u043a\u043e", "\u0448\u043e\u043a\u043e\u043b\u0430\u0434\u043d\u043e\u0435 \u043c\u043e\u043b\u043e\u043a\u043e"] \u2192 matches only "\u043c\u043e\u043b\u043e\u043a\u043e" (exact match exists, do not match items where query is only a component modifier)\n- Match by the item's NAME only \u2014 do NOT match by food category or related products\n- Return {"matching": []} if nothing clearly matches by name`,
            },
            { role: "user", content: query },
          ],
          response_format: { type: "json_object" },
          temperature: 0,
        }),
      });

      if (!res.ok) throw new Error(`Groq error: ${res.status}`);
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const raw = json.choices?.[0]?.message?.content?.trim() ?? "";
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const matchingCodes = Array.isArray(parsed.matching)
        ? (parsed.matching as unknown[]).filter((s): s is string => typeof s === "string")
        : [];
      // Match returned strings against item codes (case-insensitive)
      const matchingLower = new Set(matchingCodes.map((s) => s.toLowerCase().trim()));
      const matched = items.filter((item) => matchingLower.has(item.code.toLowerCase().trim()));
      logger.debug("extractor", `resolveRemoveTargets: query="${query}" matched ${matched.length} item(s): [${matched.map((i) => i.code).join(", ")}]`);
      return matched;
    } catch (err) {
      logger.error("extractor", "resolveRemoveTargets groq error, falling back to heuristic", err);
    }
  }

  // Heuristic fallback: substring matching on code
  const q = query.toLowerCase().trim();
  return items.filter(
    (item) => item.code.toLowerCase().includes(q) || q.includes(item.code.toLowerCase()),
  );
}
