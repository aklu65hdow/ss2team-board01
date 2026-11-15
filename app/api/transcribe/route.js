import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requireWriter } from "@/lib/auth";
import { createAdminClient, mergeDoc } from "@/lib/supabase/admin";
import { makeBrief } from "@/lib/brief";

export const runtime = "nodejs";
export const maxDuration = 300;

// ffmpeg: системный (FFMPEG_PATH) или из пакета ffmpeg-static, если он установился.
async function ffmpegBin() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try { const m = await import("ffmpeg-static"); if (m.default) return m.default; } catch {}
  return "ffmpeg";
}

const SEGMENT_SECONDS = 600; // режем на куски по 10 минут: каждый кусок ~2-3 МБ

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let err = "";
    p.stderr.on("data", (d) => { err += d; if (err.length > 4000) err = err.slice(-4000); });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error("ffmpeg: " + err.split("\n").filter(Boolean).slice(-2).join(" ")))));
  });
}

// Любой сервис с OpenAI-совместимым API расшифровки (/audio/transcriptions).
const TR_URL = () => (process.env.TRANSCRIBE_API_URL || "https://api.openai.com/v1").replace(/\/$/, "") + "/audio/transcriptions";
const TR_KEY = () => process.env.TRANSCRIBE_API_KEY || process.env.OPENAI_API_KEY;
const TR_MODEL = () => process.env.TRANSCRIBE_MODEL || process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-transcribe";

async function transcribeChunk(buf, name) {
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "audio/mpeg" }), name);
  form.append("model", TR_MODEL());
  form.append("response_format", "json");
  const r = await fetch(TR_URL(), {
    method: "POST",
    headers: { Authorization: `Bearer ${TR_KEY()}` },
    body: form,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || "Сервис расшифровки: ошибка " + r.status);
  return (j.text || "").trim();
}

export async function POST(request) {
  const auth = await requireWriter();
  if (auth.error) return auth.error;
  const { callId } = await request.json().catch(() => ({}));
  if (!callId || !/^[\w-]+$/.test(callId)) return Response.json({ error: "Не указан созвон" }, { status: 400 });
  if (!TR_KEY()) return Response.json({ error: "Автоматическая расшифровка не настроена. Вставьте транскрипт вручную или задайте TRANSCRIBE_API_KEY." }, { status: 400 });

  const admin = createAdminClient();
  const path = "calls/" + callId;
  const { data: row } = await admin.from("docs").select("data").eq("path", path).single();
  if (!row || !row.data.audioPath) return Response.json({ error: "У созвона нет записи" }, { status: 400 });

  await mergeDoc(admin, path, { transcribeStatus: "running", transcribeError: null });
  const dir = await mkdtemp(join(tmpdir(), "call-"));
  try {
    const { data: file, error } = await admin.storage.from("recordings").download(row.data.audioPath);
    if (error) throw new Error("Не удалось скачать запись: " + error.message);
    const input = join(dir, "input");
    await writeFile(input, Buffer.from(await file.arrayBuffer()));
    // моно, 16 кГц, 32 кбит/с — для речи этого достаточно, и куски проходят лимит API
    await run(await ffmpegBin(), ["-hide_banner", "-loglevel", "error", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k",
      "-f", "segment", "-segment_time", String(SEGMENT_SECONDS), "-reset_timestamps", "1", join(dir, "part-%03d.mp3")]);
    const parts = (await readdir(dir)).filter((f) => f.startsWith("part-")).sort();
    if (!parts.length) throw new Error("В записи не найден звук");
    const texts = new Array(parts.length);
    let next = 0;
    const worker = async () => { while (next < parts.length) { const i = next++; texts[i] = await transcribeChunk(await readFile(join(dir, parts[i])), parts[i]); } };
    await Promise.all([worker(), worker(), worker()]);
    const transcript = texts.filter(Boolean).join("\n\n");
    if (!transcript) throw new Error("Речь в записи не распознана");
    await mergeDoc(admin, path, { transcript, transcribeStatus: "done", transcribedAt: Date.now() });
  } catch (e) {
    await mergeDoc(admin, path, { transcribeStatus: "error", transcribeError: String(e.message || e).slice(0, 300) }).catch(() => {});
    return Response.json({ error: e.message }, { status: 500 });
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  try { await makeBrief(admin, callId); } catch (e) { return Response.json({ ok: true, briefError: e.message }); }
  return Response.json({ ok: true });
}
