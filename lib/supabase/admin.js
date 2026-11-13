import { createClient } from "@supabase/supabase-js";
// Серверный клиент с полными правами. Только для API-маршрутов, никогда не попадает в браузер.
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}
export async function mergeDoc(admin, path, patch) {
  const { error } = await admin.rpc("doc_merge", { p_path: path, p_patch: patch });
  if (error) throw new Error(error.message);
}
