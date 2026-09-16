import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAccount } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LibraryReader } from "@/components/library/reader";
export const dynamic = "force-dynamic";
export default async function ResourcePage({ params }: { params: Promise<{ id: string }> }) {
  const account = await requireAccount(); const { id } = await params; if (!z.string().uuid().safeParse(id).success) notFound();
  const db = await createSupabaseServerClient();
  const { data,error } = await db.from("library_resources").select("id,title,description,content_text,mime_type,status").eq("id",id).maybeSingle();
  if (error) throw new Error("Unable to load this material."); if (!data) notFound();
  return <main className="account-content"><Link href="/portal/library">Back to library</Link><h1>{data.title}</h1><p>{data.description}</p>{data.status !== "published" && <p>Administrator preview ? {data.status}</p>}
    <LibraryReader id={id} mime={data.mime_type} text={data.content_text} watermark={account.fullName + " ? " + (account.studentNumber ?? account.user.id.slice(0,8))} />
  </main>;
}
