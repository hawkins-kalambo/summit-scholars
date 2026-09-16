import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { sendTransactionalEmail } from "@/lib/email/resend";

function reply(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control":"private, no-store" } });
}
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const supplied = Buffer.from(token);
  const expected = Buffer.from(secret ?? "");
  if (!secret || secret.length<32 || supplied.length!==expected.length ||
      !timingSafeEqual(supplied,expected)) return reply({error:"Unauthorized"},401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) return reply({error:"Notification delivery is not configured."},503);
  const db = createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  try {
    const { data, error } = await db.rpc("claim_notifications",{p_limit:5});
    if (error) return reply({error:"Unable to claim notifications."},503);
    let sent=0;
    let deferred=0;
    for (const job of data ?? []) {
      let providerId: string | null = null;
      try {
        const result = await sendTransactionalEmail({to:job.recipient,subject:job.subject,text:job.body,idempotencyKey:job.event_key});
        providerId=result.id;
      } catch { /* Keep the same event key when the database schedules a retry. */ }
      const result = await db.rpc("finish_notification",{p_id:job.id,p_lease:job.lease_token,p_provider_id:providerId});
      if (!result.error && result.data===true && providerId) sent++; else deferred++;
    }
    return reply({sent,deferred});
  } catch {
    return reply({error:"Notification delivery is temporarily unavailable."},503);
  }
}
