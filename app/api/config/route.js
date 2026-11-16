import { briefConfigured } from "@/lib/brief";
export const dynamic = "force-dynamic";
// Какие автоматические функции подключены на сервере (без раскрытия ключей).
export function GET() {
  const transcribe = !!(process.env.TRANSCRIBE_API_KEY || process.env.OPENAI_API_KEY);
  return Response.json({ brief: briefConfigured(), transcribe });
}
