import { mergeDoc } from "@/lib/supabase/admin";
import { buildBriefPrompt, parseBriefReply } from "@/lib/briefPrompt";

export const briefConfigured = () => !!(process.env.ANTHROPIC_API_KEY || (process.env.LLM_API_KEY && process.env.LLM_MODEL));

/** Запрос к языковой модели: Anthropic напрямую или любой OpenAI-совместимый /chat/completions. */
async function complete(prompt) {
  if (process.env.ANTHROPIC_API_KEY) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5", max_tokens: 4000, messages: [{ role: "user", content: prompt }] }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error((j.error && j.error.message) || "Claude API: ошибка " + r.status);
    return (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  }
  const url = (process.env.LLM_API_URL || "https://api.openai.com/v1").replace(/\/$/, "") + "/chat/completions";
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.LLM_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: process.env.LLM_MODEL, max_tokens: 4000, messages: [{ role: "user", content: prompt }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || "Сервис брифов: ошибка " + r.status);
  return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
}

/** Собирает бриф по транскрипту созвона и сохраняет его в документ созвона. */
export async function makeBrief(admin, callId) {
  const path = "calls/" + callId;
  const { data: row, error } = await admin.from("docs").select("data").eq("path", path).single();
  if (error || !row) throw new Error("Созвон не найден");
  const c = row.data;
  const transcript = (c.transcript || "").slice(0, 300000);
  if (!transcript.trim()) throw new Error("У созвона нет транскрипта");
  if (!briefConfigured()) throw new Error("Автоматический бриф не подключён. Соберите бриф вручную через «Скопировать запрос».");

  await mergeDoc(admin, path, { briefStatus: "running" });
  try {
    const prompt = buildBriefPrompt(c, transcript);
    const text = await complete(prompt);
    const brief = parseBriefReply(text);
    if (!brief) throw new Error("Модель вернула ответ не в том формате, попробуйте ещё раз");
    await mergeDoc(admin, path, { brief, briefAt: Date.now(), briefStatus: "done" });
    return brief;
  } catch (e) {
    await mergeDoc(admin, path, { briefStatus: "error" }).catch(() => {});
    throw e;
  }
}
