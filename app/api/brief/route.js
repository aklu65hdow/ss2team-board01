import { requireWriter } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { makeBrief } from "@/lib/brief";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request) {
  const auth = await requireWriter();
  if (auth.error) return auth.error;
  const { callId } = await request.json().catch(() => ({}));
  if (!callId || !/^[\w-]+$/.test(callId)) return Response.json({ error: "Не указан созвон" }, { status: 400 });
  try {
    const brief = await makeBrief(createAdminClient(), callId);
    return Response.json({ ok: true, brief });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
