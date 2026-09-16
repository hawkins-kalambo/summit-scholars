import "server-only";
import { Resend } from "resend";
import { z } from "zod";

const messageSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(200).refine(value => !/[\r\n]/.test(value)),
  text: z.string().min(1).max(100000),
  idempotencyKey: z.string().min(1).max(256).regex(/^[a-zA-Z0-9_:/.-]+$/),
});
export type TransactionalEmail = z.infer<typeof messageSchema>;
type Payload = { from: string; to: string; subject: string; text: string };
export type EmailTransport = (
  payload: Payload, options: { idempotencyKey: string }
) => Promise<{ data: { id: string } | null; error: unknown }>;

export async function sendTransactionalEmail(message: TransactionalEmail, transport?: EmailTransport) {
  const parsed = messageSchema.parse(message);
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) throw new Error("Email delivery is not configured.");
  const sender = z.string().email().safeParse(from);
  if (!sender.success) throw new Error("Email sender must be a verified email address.");
  const deliver: EmailTransport = transport ?? ((payload, options) => new Resend(apiKey).emails.send(payload, options));
  try {
    const { data, error } = await deliver(
      { from, to: parsed.to, subject: parsed.subject, text: parsed.text },
      { idempotencyKey: parsed.idempotencyKey },
    );
    if (error || !data?.id) throw new Error("Provider did not accept email.");
    return { id: data.id };
  } catch {
    // Never expose provider payloads, recipients, or credentials to a client.
    throw new Error("Email delivery failed. The notification can be retried.");
  }
}
