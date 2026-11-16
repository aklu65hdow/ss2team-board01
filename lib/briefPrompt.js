// Общий для сервера и браузера: запрос для брифа и разбор ответа модели.
const MONTHS = ["янв","фев","мар","апр","мая","июн","июл","авг","сен","окт","ноя","дек"];
const fmtDate = (s) => { if (!s) return ""; const [, m, d] = s.split("-"); return `${+d} ${MONTHS[+m - 1]}`; };

export function buildBriefPrompt(call, transcript) {
  return `Ты помощник руководителя команды медиабаинга. Ниже транскрипт рабочего созвона команды (${fmtDate(call.date)}, ${call.kind || ""}).
Составь бриф на русском. Верни ТОЛЬКО JSON без пояснений вида:
{"summary":"2-3 предложения о главном","discussed":["тема"],"decisions":["о чём договорились"],"plans":[{"what":"что сделать","who":"кто (как назвали в разговоре, или пусто)","due":"срок (как назвали, или пусто)"}],"nextCheckin":"когда следующий чек-ин по планам (например «чт, 19 ноя» или «на следующем созвоне»)"}
Пиши коротко и конкретно. Не выдумывай того, чего нет в транскрипте.

ТРАНСКРИПТ:
${transcript}`;
}

export function parseBriefReply(text) {
  const t = String(text || "").trim();
  let obj = null;
  try { obj = JSON.parse(t); } catch {}
  if (!obj) {
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a >= 0 && b > a) { try { obj = JSON.parse(t.slice(a, b + 1)); } catch {} }
  }
  if (!obj || typeof obj !== "object") return null;
  const arr = (x) => (Array.isArray(x) ? x.map(String) : []);
  return {
    summary: String(obj.summary || ""),
    discussed: arr(obj.discussed),
    decisions: arr(obj.decisions),
    plans: (Array.isArray(obj.plans) ? obj.plans : []).map((p) => ({ what: String((p && p.what) || ""), who: String((p && p.who) || ""), due: String((p && p.due) || "") })),
    nextCheckin: String(obj.nextCheckin || ""),
  };
}
