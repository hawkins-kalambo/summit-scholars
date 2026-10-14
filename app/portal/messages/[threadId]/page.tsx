import { notFound } from "next/navigation";
import { requireAccount } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ManagedForm } from "@/components/admissions/managed-form";
import { sendMessage } from "../actions";
export const dynamic = "force-dynamic";
type Thread = { thread_id: string; course_name: string; course_code: string; other_name: string };
type Message = { id: string; sender_id: string; body: string; created_at: string };

export default async function ThreadPage({ params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;
  const account = await requireAccount();
  const db = await createSupabaseServerClient();
  const { data: threadsData, error } = await db.rpc("my_message_threads");
  if (error) throw new Error("Unable to load this conversation.");
  const thread = ((threadsData ?? []) as Thread[]).find(row => row.thread_id === threadId);
  if (!thread) notFound();
  await db.rpc("mark_thread_read", { p_thread_id: threadId });
  const { data: messagesData, error: messagesError } = await db.from("messages").select("id,sender_id,body,created_at").eq("thread_id", threadId).order("created_at");
  if (messagesError) throw new Error("Unable to load this conversation.");
  const messages = (messagesData ?? []) as Message[];
  return <div className="dash">
    <div className="dash-title"><div><span className="eyebrow">{thread.course_name} ({thread.course_code})</span><h1>{thread.other_name}</h1></div></div>
    <div className="panel">
      {!messages.length && <p>No messages yet. Say hello.</p>}
      <ul>{messages.map(message => <li key={message.id}>
        <strong>{message.sender_id === account.user.id ? "You" : thread.other_name}</strong>
        <span><small>{new Date(message.created_at).toLocaleString("en-GB", { timeZone: "Africa/Blantyre" })}</small></span>
        <p>{message.body}</p>
      </li>)}</ul>
      <ManagedForm action={sendMessage} label="Send">
        <input type="hidden" name="threadId" value={threadId}/>
        <label>Message<textarea name="body" required minLength={1} maxLength={4000}/></label>
      </ManagedForm>
    </div>
  </div>;
}
