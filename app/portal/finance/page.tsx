import Link from "next/link";
import { Wallet, TrendingUp, Clock } from "lucide-react";
import { requireFinance } from "@/lib/finance/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { pageNumber } from "@/lib/admin/access";
import { ManagedForm } from "@/components/admissions/managed-form";
import { recordPayment } from "./actions";
export const dynamic = "force-dynamic";
type InvoiceRow = { id: string; reference: string; student_name: string; total_amount: number; balance_amount: number; status: string; created_at: string; total_count: number };
type LineItem = { id: string; description: string; amount: number };
type Payment = { id: string; amount: number; method: string; reference: string; created_at: string };
const statuses = ["invoice_created", "pending", "processing", "partially_paid", "paid", "failed", "cancelled", "refunded", "overdue"];
const methods: Record<string, string> = { cash: "Cash", bank_transfer: "Bank transfer", mobile_money: "Mobile money" };

export default async function FinancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const account = await requireFinance();
  const params = await searchParams;
  const page = pageNumber(params.page);
  const status = typeof params.status === "string" && statuses.includes(params.status) ? params.status : "";
  const db = await createSupabaseServerClient();
  const [invoicesResult, revenueResult, outstandingResult] = await Promise.all([
    db.rpc("finance_invoices", { p_status: status || null, p_page: page }),
    db.from("payments").select("amount"),
    db.from("invoices").select("balance_amount").not("status", "in", "(paid,cancelled,refunded)"),
  ]);
  if (invoicesResult.error) throw new Error("Unable to load invoices. Apply the finance migration first.");
  const invoices = (invoicesResult.data ?? []) as InvoiceRow[];
  const totalRevenue = (revenueResult.data ?? []).reduce((sum, row) => sum + Number(row.amount), 0);
  const totalOutstanding = (outstandingResult.data ?? []).reduce((sum, row) => sum + Number(row.balance_amount), 0);
  const [lineItemsResults, paymentsResults] = await Promise.all([
    Promise.all(invoices.map(invoice => db.from("invoice_line_items").select("id,description,amount").eq("invoice_id", invoice.id))),
    Promise.all(invoices.map(invoice => db.from("payments").select("id,amount,method,reference,created_at").eq("invoice_id", invoice.id).order("created_at"))),
  ]);
  const link = (n: number) => "/portal/finance?" + new URLSearchParams({ status, page: String(n) });
  const canRecord = account.roles.includes("finance_officer") || account.roles.includes("super_admin");
  return <div className="dash">
    <div className="dash-title"><div><span className="eyebrow">Finance</span><h1>Welcome, {account.fullName}.</h1><p>Invoices, payments and balances across the institution.</p></div></div>
    <div className="stats">
      <div className="stat green"><i><TrendingUp size={21}/></i><div><strong>MWK {totalRevenue.toLocaleString("en-GB")}</strong><span>Total collected</span></div></div>
      <div className="stat gold"><i><Clock size={21}/></i><div><strong>MWK {totalOutstanding.toLocaleString("en-GB")}</strong><span>Outstanding balance</span></div></div>
      <div className="stat"><i><Wallet size={21}/></i><div><strong>{invoices.length ? Number(invoices[0].total_count) : 0}</strong><span>Invoices on record</span></div></div>
    </div>
    <form className="admin-search"><label>Status<select name="status" defaultValue={status}><option value="">All statuses</option>{statuses.map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label><button className="btn teal">Filter</button></form>
    {!invoices.length && <p>No invoices on this page.</p>}
    {invoices.map((invoice, index) => {
      const lineItems = (lineItemsResults[index].data ?? []) as LineItem[];
      const payments = (paymentsResults[index].data ?? []) as Payment[];
      const payable = !["paid", "cancelled", "refunded"].includes(invoice.status);
      return <section className="account-panel" key={invoice.id}>
        <div className="section-title"><h2>{invoice.reference}</h2><span className="status-badge">{invoice.status.replaceAll("_", " ")}</span></div>
        <p>{invoice.student_name} · MWK {Number(invoice.total_amount).toLocaleString("en-GB")} total · MWK {Number(invoice.balance_amount).toLocaleString("en-GB")} outstanding</p>
        <details><summary>Line items and payment history</summary>
          <ul>{lineItems.map(item => <li key={item.id}>{item.description} — MWK {Number(item.amount).toLocaleString("en-GB")}</li>)}</ul>
          {payments.length ? <ul>{payments.map(payment => <li key={payment.id}>{payment.reference} · MWK {Number(payment.amount).toLocaleString("en-GB")} · {methods[payment.method] ?? payment.method} · {new Date(payment.created_at).toLocaleDateString("en-GB")}</li>)}</ul> : <p>No payments recorded yet.</p>}
        </details>
        {canRecord && payable && <details><summary>Record a payment</summary><ManagedForm action={recordPayment} label="Record payment">
          <input type="hidden" name="invoiceId" value={invoice.id}/>
          <label>Amount (MWK)<input type="number" name="amount" min={1} max={invoice.balance_amount} step="0.01" required/></label>
          <label>Method<select name="method" required><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="mobile_money">Mobile money</option></select></label>
          <label>Note (optional)<input name="note" maxLength={500}/></label>
          <label>Reason<textarea name="reason" required minLength={5} maxLength={2000}/></label>
        </ManagedForm></details>}
      </section>;
    })}
    <nav className="pagination" aria-label="Invoice pages">{page > 1 && <Link href={link(page - 1)}>Previous</Link>}<span>Page {page}</span>{invoices.length && page * 25 < Number(invoices[0].total_count) ? <Link href={link(page + 1)}>Next</Link> : null}</nav>
  </div>;
}
