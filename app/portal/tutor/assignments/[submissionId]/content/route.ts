import { NextResponse } from "next/server";
import { requireTutor } from "@/lib/tutoring/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordId } from "@/lib/admissions/validation";
export async function GET(_request: Request, { params }: { params: Promise<{ submissionId: string }> }) {
  await requireTutor();
  const { submissionId } = await params;
  if (!recordId.safeParse(submissionId).success) return new Response("Not found", { status: 404 });
  const db = await createSupabaseServerClient();
  // RLS already restricts this select to the assignment's assigned tutor or an academic_admin.
  const { data, error } = await db.from("assignment_submissions").select("object_path,file_name").eq("id", submissionId).maybeSingle();
  if (error || !data) return new Response("Not found", { status: 404 });
  const { data: signed, error: signingError } = await db.storage.from("assignment-submissions").createSignedUrl(data.object_path, 60, { download: data.file_name });
  if (signingError || !signed) return new Response("Document unavailable", { status: 503 });
  const response = NextResponse.redirect(signed.signedUrl);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
