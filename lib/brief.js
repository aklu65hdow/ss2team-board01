import { mergeDoc } from "@/lib/supabase/admin";

const MONTHS = ["янв","фев","мар","апр","мая","июн","июл","авг","сен","окт","ноя","дек"];
const fmtDate = (s) => { if (!s) return ""; const [, m, d] = s.split("-"); return `${+d} ${MONTHS[+m - 1]}`; };

function parseJson(text) {
  try { return JSON.parse(text); } catch {}
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(text.slice(a, b + 1));
  throw new Error("Claude вернул ответ не в том формате");
}

/** Собирает бриф по транскрипту созвона и сохраняет его в документ созвона. */
export async function makeBrief(admin, callId) {
  const path = "calls/" + callId;
  const { data: row, error } = await admin.from("docs").select("data").eq("path", path).single();
  if (error || !row) throw new Error("Созвон не найден");
  const c = row.data;
  const transcript = (c.transcript || "").slice(0, 300000);
  if (!transcript.trim()) throw new Error("У созвона нет транскрипта");
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Не задан ключ ANTHROPIC_API_KEY");

  await mergeDoc(admin, path, { briefStatus: "running" });
  try {
    const prompt = `Ты помощник руководителя команды медиабаинга. Ниже транскрипт рабочего созвона команды (${fmtDate(c.date)}, ${c.kind || ""}).
Составь бриф на русском. Верни ТОЛЬКО JSON без пояснений вида:
{"summary":"2-3 предложения о главном","discussed":["тема"],"decisions":["о чём договорились"],"plans":[{"what":"что сделать","who":"кто (как назвали в разговоре, или пусто)","due":"срок (как назвали, или пусто)"}],"nextCheckin":"когда следующий чек-ин по планам (например «чт, 19 ноя» или «на следующем созвоне»)"}
Пиши коротко и конкретно. Не выдумывай того, чего нет в транскрипте.

ТРАНСКРИПТ:
${transcript}`;
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5", max_tokens: 4000, messages: [{ role: "user", content: prompt }] }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error((j.error && j.error.message) || "Claude API: ошибка " + r.status);
    const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    const br = parseJson(text);
    const brief = {
      summary: String(br.summary || ""),
      discussed: (br.discussed || []).map(String),
      decisions: (br.decisions || []).map(String),
      plans: (br.plans || []).map((p) => ({ what: String(p.what || ""), who: String(p.who || ""), due: String(p.due || "") })),
      nextCheckin: String(br.nextCheckin || ""),
    };
    await mergeDoc(admin, path, { brief, briefAt: Date.now(), briefStatus: "done" });
    return brief;
  } catch (e) {
    await mergeDoc(admin, path, { briefStatus: "error" }).catch(() => {});
    throw e;
  }
}
