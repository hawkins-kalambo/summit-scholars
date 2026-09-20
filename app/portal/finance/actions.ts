"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireFinance } from "@/lib/finance/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { FormResult } from "@/lib/admissions/validation";
function failure(error: { code?: string; message: string }): FormResult {
  return { error: error.code === "P0001" ? error.message : "This payment could not be recorded. Check the fields and try again." };
}
export async function recordPayment(_state: FormResult, form: FormData): Promise<FormResult> {
  await requireFinance();
  const input = z.object({
    invoiceId: z.string().uuid(), amount: z.coerce.number().positive(),
    method: z.enum(["cash", "bank_transfer", "mobile_money"]),
    note: z.string().trim().max(500).optional(),
    reason: z.string().trim().min(5).max(2000),
  }).safeParse(Object.fromEntries(form));
  if (!input.success) return { error: "Choose an invoice, amount, method and reason." };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("record_payment", {
    p_invoice_id: input.data.invoiceId, p_amount: input.data.amount, p_method: input.data.method,
    p_note: input.data.note ?? null, p_reason: input.data.reason,
  });
  if (error) return failure(error);
  revalidatePath("/portal/finance");
  return { success: "Payment recorded." };
}
