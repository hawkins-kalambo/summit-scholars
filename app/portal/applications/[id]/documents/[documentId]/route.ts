import { NextResponse } from "next/server";
import { requireAdmissionsAccount } from "@/lib/admissions/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordId } from "@/lib/admissions/validation";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; documentId: string }> }) {
  await requireAdmissionsAccount();
  const { id, documentId } = await params;
  if (!recordId.safeParse(id).success || !recordId.safeParse(documentId).success) return new Response("Not found", { status:404 });
  const db = await createSupabaseServerClient();
  const { data, error } = await db.from("application_documents").select("object_path,file_name").eq("id",documentId).eq("application_id",id).maybeSingle();
  if (error || !data) return new Response("Not found", { status:404 });
  const { data: signed, error: signingError } = await db.storage.from("application-documents").createSignedUrl(data.object_path,60,{download:data.file_name});
  if (signingError || !signed) return new Response("Document unavailable", { status:503 });
  const response = NextResponse.redirect(signed.signedUrl);
  response.headers.set("Cache-Control","private, no-store");
  response.headers.set("Referrer-Policy","no-referrer");
  return response;
}
