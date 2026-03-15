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

export type NLCommandStep =
  | { intent: 'add'; groups: ExtractedGroup[] }
  | { intent: 'remove'; query: string }
  | { intent: 'show' }
  | { intent: 'start_shopping' }
  | { intent: 'unknown' };

/** @deprecated Use NLCommandStep */
export type NLCommand = NLCommandStep;

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



/** Parse and validate a groups array from LLM output. */
function parseGroups(raw: unknown): ExtractedGroup[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
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
}

/**
 * Classify the user's intent and extract commands. Returns an ordered array of
 * NLCommandStep — usually one element, but two for compound messages like
 * "убери X и добавь Y" or "замени X на Y" (remove + add in order).
 * Returns [{intent:'unknown'}] if Groq key is absent or on any error.
 */
export async function classifyAndExtract(text: string, state: BotState): Promise<NLCommandStep[]> {
  if (!GROQ_API_KEY) {
    logger.debug("extractor", "no GROQ_API_KEY — returning unknown");
    return [{ intent: "unknown" }];
  }

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

    if (!res.ok) throw new Error(`Groq API error: ${res.status} ${res.statusText}`);

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = json.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    const rawCommands = Array.isArray(parsed.commands) ? parsed.commands : null;
    if (!rawCommands || rawCommands.length === 0) {
      logger.debug("extractor", "classify: no commands array in response");
      return [{ intent: "unknown" }];
    }

    const steps: NLCommandStep[] = [];
    for (const cmd of rawCommands as unknown[]) {
      const c = cmd as Record<string, unknown>;
      const intent = c.intent as string;

      if (intent === "show") {
        steps.push({ intent: "show" });
      } else if (intent === "start_shopping") {
        steps.push({ intent: "start_shopping" });
      } else if (intent === "remove") {
        const query = typeof c.query === "string" ? c.query.trim() : "";
        steps.push(query ? { intent: "remove", query } : { intent: "unknown" });
      } else if (intent === "add") {
        const groups = parseGroups(c.groups);
        steps.push(groups.length > 0 ? { intent: "add", groups } : { intent: "unknown" });
      } else {
        steps.push({ intent: "unknown" });
      }
    }

    const itemCount = steps.reduce(
      (n, s) => n + (s.intent === "add" ? s.groups.flatMap((g) => g.items).length : 0),
      0,
    );
    logger.debug(
      "extractor",
      `classify: [${steps.map((s) => s.intent).join(", ")}]${itemCount > 0 ? `, ${itemCount} item(s)` : ""}`,
    );
    return steps.length > 0 ? steps : [{ intent: "unknown" }];
  } catch (err) {
    logger.error("extractor", "classify groq error", err);
    return [{ intent: "unknown" }];
  }
}

function buildClassifyPrompt(state: BotState): string {
  const stateDesc: Record<BotState, string> = {
    IDLE: "no active shopping list exists",
    NORMAL: "a shopping list exists",
    SHOPPING: "shopping is in progress",
  };
  return `You are a shopping list bot assistant. Classify the user's message and extract commands.
Bot state: ${state} — ${stateDesc[state]}.

Commands:
- "add": user wants to add grocery items (e.g. "добавь молоко", "купи хлеб и масло", bare product list like "молоко хлеб яйца")
- "remove": user wants to remove or delete items (e.g. "убери молоко", "удали хлеб", "вычеркни вино")
- "show": user wants to see the current list (e.g. "покажи список", "что в списке")
- "start_shopping": user wants to begin shopping (e.g. "начни покупки", "поехали", "старт")
- "unknown": unclear or unrelated

Messages can contain multiple commands in sequence:
- "убери молоко и добавь кефир" → [{"intent":"remove","query":"молоко"}, {"intent":"add",...кефир...}]
- "замени молоко на кефир" → [{"intent":"remove","query":"молоко"}, {"intent":"add",...кефир...}]
Single-intent messages produce a one-element array. Commands must be in execution order (removes before adds).

Return ONLY valid JSON: {"commands": [...]}
Each element:
- add: {"intent":"add","groups":[{"group":"<exact dept name>","items":[{"code":"canonical item name","details":"quantity or null"}]}]}
- remove: {"intent":"remove","query":"<canonical base form, e.g. вино, молоко>"}
- others: {"intent":"show"} / {"intent":"start_shopping"} / {"intent":"unknown"}

Department mapping (use these exact Russian department names):
${DEPT_MAPPING}

Rules for extraction (intent="add"):
- code: canonical base/nominative form (1–4 words), e.g. "картошка", "белое вино"
- details: quantity/weight if mentioned ("1кг", "2л"), else null
- Strip command words ("добавь", "купи", "замени" etc.); keep original language; unknown items → "Разное"`;
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
