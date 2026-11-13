import { createClient } from "@/lib/supabase/server";
export async function getMe() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { user: null, profile: null };
  const { data: profile } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
  return { user, profile };
}
/** Для API: только одобренные администраторы и медиабайеры. */
export async function requireWriter() {
  const { user, profile } = await getMe();
  if (!user) return { error: Response.json({ error: "Войдите в доску" }, { status: 401 }) };
  if (!profile || profile.status !== "approved" || profile.role === "viewer")
    return { error: Response.json({ error: "Недостаточно прав" }, { status: 403 }) };
  return { user, profile };
}
