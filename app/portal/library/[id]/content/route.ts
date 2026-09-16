import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
const headers = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cross-Origin-Resource-Policy": "same-origin", "X-Frame-Options": "DENY" };
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return new Response("Not found", { status: 404, headers });
  if (request.headers.get("sec-fetch-site") === "cross-site") return new Response("Forbidden", { status: 403, headers });
  try {
    const db = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await db.auth.getUser();
    if (authError || !user?.email_confirmed_at) return new Response("Sign in required", { status: 401, headers });
    // RLS rechecks current status, publication and audience on every request.
    const { data: resource, error } = await db.from("library_resources").select("object_path,mime_type").eq("id",id).maybeSingle();
    if (error) return new Response("Unavailable", { status: 503, headers });
    if (!resource?.object_path) return new Response("Not found", { status: 404, headers });
    const { data: file, error: storageError } = await createServiceClient().storage.from("library-materials").download(resource.object_path);
    if (storageError || !file) return new Response("File unavailable", { status: 503, headers });
    return new Response(file, { headers: { ...headers, "Content-Type": resource.mime_type, "Content-Disposition": "inline" } });
  } catch { return new Response("File service unavailable", { status: 503, headers }); }
}
