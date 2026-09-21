import Link from "next/link";
import { Wallet, TrendingUp, Clock } from "lucide-react";
import { requireFinance } from "@/lib/finance/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { pageNumber } from "@/lib/admin/access";
import { ManagedForm } from "@/components/admissions/managed-form";
import { recordPayment, requestAdjustment, decideAdjustment, requestRefund, decideRefund, setTutorRate, preparePayrollRun, decidePayrollRun } from "./actions";
export const dynamic = "force-dynamic";
type InvoiceRow = { id: string; reference: string; student_name: string; total_amount: number; balance_amount: number; status: string; created_at: string; total_count: number };
type LineItem = { id: string; description: string; amount: number };
type Payment = { id: string; amount: number; method: string; reference: string; created_at: string };
type AdjustmentRequest = { id: string; invoice_id: string; adjustment_amount: number; reason: string; requested_by: string; invoices: { reference: string } | null };
type RefundRequest = { id: string; invoice_id: string; amount: number; reason: string; requested_by: string; invoices: { reference: string } | null };
type FinanceTutor = { tutor_id: string; full_name: string; rate_amount: number | null };
type PayrollCandidate = { tutor_id: string; full_name: string; rate_amount: number | null; eligible_sessions: number };
type PayrollRun = { id: string; tutor_id: string; period_start: string; period_end: string; session_count: number; total_amount: number; status: string; requested_by: string };
const statuses = ["invoice_created", "pending", "processing", "partially_paid", "paid", "failed", "cancelled", "refunded", "overdue"];
const methods: Record<string, string> = { cash: "Cash", bank_transfer: "Bank transfer", mobile_money: "Mobile money" };

export default async function FinancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const account = await requireFinance();
  const params = await searchParams;
  const page = pageNumber(params.page);
  const status = typeof params.status === "string" && statuses.includes(params.status) ? params.status : "";
  const db = await createSupabaseServerClient();
  const [invoicesResult, revenueResult, outstandingResult, adjustmentsResult, refundsResult, tutorsResult, candidatesResult, payrollRunsResult] = await Promise.all([
    db.rpc("finance_invoices", { p_status: status || null, p_page: page }),
    db.from("payments").select("amount"),
    db.from("invoices").select("balance_amount").not("status", "in", "(paid,cancelled,refunded)"),
    db.from("payment_adjustment_requests").select("id,invoice_id,adjustment_amount,reason,requested_by,invoices(reference)").eq("status", "pending").order("created_at"),
    db.from("refund_requests").select("id,invoice_id,amount,reason,requested_by,invoices(reference)").eq("status", "pending").order("created_at"),
    db.rpc("finance_tutors"),
    db.rpc("payroll_candidates"),
    db.from("payroll_runs").select("id,tutor_id,period_start,period_end,session_count,total_amount,status,requested_by").eq("status", "pending").order("created_at"),
  ]);
  if (invoicesResult.error) throw new Error("Unable to load invoices. Apply the finance migration first.");
  const invoices = (invoicesResult.data ?? []) as InvoiceRow[];
  const totalRevenue = (revenueResult.data ?? []).reduce((sum, row) => sum + Number(row.amount), 0);
  const totalOutstanding = (outstandingResult.data ?? []).reduce((sum, row) => sum + Number(row.balance_amount), 0);
  const pendingAdjustments = (adjustmentsResult.data ?? []) as unknown as AdjustmentRequest[];
  const pendingRefunds = (refundsResult.data ?? []) as unknown as RefundRequest[];
  const financeTutors = (tutorsResult.data ?? []) as FinanceTutor[];
  const payrollCandidates = (candidatesResult.data ?? []) as PayrollCandidate[];
  const pendingPayrollRuns = (payrollRunsResult.data ?? []) as PayrollRun[];
  const tutorName = (tutorId: string) => financeTutors.find(tutor => tutor.tutor_id === tutorId)?.full_name ?? tutorId;
  const [lineItemsResults, paymentsResults] = await Promise.all([
    Promise.all(invoices.map(invoice => db.from("invoice_line_items").select("id,description,amount").eq("invoice_id", invoice.id))),
    Promise.all(invoices.map(invoice => db.from("payments").select("id,amount,method,reference,created_at").eq("invoice_id", invoice.id).order("created_at"))),
  ]);
  const link = (n: number) => "/portal/finance?" + new URLSearchParams({ status, page: String(n) });
  const canRecord = account.roles.includes("finance_officer") || account.roles.includes("super_admin");
  const canDecideAdjustments = account.roles.includes("finance_administrator");
  const canDecideRefunds = account.roles.includes("super_admin");
  const canSetRates = account.roles.includes("finance_administrator");
  const canPrepareRuns = canRecord;
  const canDecidePayroll = account.roles.includes("finance_administrator");
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
        {canRecord && <details><summary>Request an adjustment</summary><p><small>Corrects the invoice total and balance. Requires Finance Administrator approval.</small></p><ManagedForm action={requestAdjustment} label="Request adjustment">
          <input type="hidden" name="invoiceId" value={invoice.id}/>
          <label>Amount, MWK (negative to reduce, positive to increase)<input type="number" name="amount" step="0.01" required/></label>
          <label>Reason<textarea name="reason" required minLength={5} maxLength={2000}/></label>
        </ManagedForm></details>}
        {canRecord && <details><summary>Request a refund</summary><p><small>Requires Super Administrator approval.</small></p><ManagedForm action={requestRefund} label="Request refund">
          <input type="hidden" name="invoiceId" value={invoice.id}/>
          <label>Amount, MWK<input type="number" name="amount" min={1} max={invoice.total_amount} step="0.01" required/></label>
          <label>Reason<textarea name="reason" required minLength={5} maxLength={2000}/></label>
        </ManagedForm></details>}
      </section>;
    })}
    <nav className="pagination" aria-label="Invoice pages">{page > 1 && <Link href={link(page - 1)}>Previous</Link>}<span>Page {page}</span>{invoices.length && page * 25 < Number(invoices[0].total_count) ? <Link href={link(page + 1)}>Next</Link> : null}</nav>
    {(canDecideAdjustments || canDecideRefunds) && <div className="dashgrid">
      {canDecideAdjustments && <div className="panel"><header><h2>Pending adjustments</h2></header>
        {pendingAdjustments.length ? pendingAdjustments.map(request => <section className="account-card" key={request.id}>
          <p>{request.invoices?.reference ?? request.invoice_id} · MWK {Number(request.adjustment_amount).toLocaleString("en-GB")}</p>
          <p>{request.reason}</p>
          {request.requested_by === account.user.id ? <p><small>A different Finance Administrator must decide this request.</small></p> : <ManagedForm action={decideAdjustment} label="Record decision">
            <input type="hidden" name="id" value={request.id}/>
            <label>Decision<select name="decision"><option value="approve">Approve</option><option value="reject">Reject</option></select></label>
            <label>Decision reason<textarea name="reason" required minLength={5} maxLength={2000}/></label>
          </ManagedForm>}
        </section>) : <p>No pending adjustments.</p>}
      </div>}
      {canDecideRefunds && <div className="panel"><header><h2>Pending refunds</h2></header>
        {pendingRefunds.length ? pendingRefunds.map(request => <section className="account-card" key={request.id}>
          <p>{request.invoices?.reference ?? request.invoice_id} · MWK {Number(request.amount).toLocaleString("en-GB")}</p>
          <p>{request.reason}</p>
          {request.requested_by === account.user.id ? <p><small>A different Super Administrator must decide this request.</small></p> : <ManagedForm action={decideRefund} label="Record decision">
            <input type="hidden" name="id" value={request.id}/>
            <label>Decision<select name="decision"><option value="approve">Approve</option><option value="reject">Reject</option></select></label>
            <label>Decision reason<textarea name="reason" required minLength={5} maxLength={2000}/></label>
          </ManagedForm>}
        </section>) : <p>No pending refunds.</p>}
      </div>}
    </div>}
    {(canSetRates || canPrepareRuns || canDecidePayroll) && <div className="dashgrid">
      {canSetRates && <div className="panel"><header><h2>Tutor pay rates</h2></header>
        {financeTutors.length ? financeTutors.map(tutor => <section className="account-card" key={tutor.tutor_id}>
          <p>{tutor.full_name} · {tutor.rate_amount ? `MWK ${Number(tutor.rate_amount).toLocaleString("en-GB")} per class` : "No rate set"}</p>
          <ManagedForm action={setTutorRate} label="Save rate">
            <input type="hidden" name="tutorId" value={tutor.tutor_id}/>
            <label>Rate per class (MWK)<input type="number" name="rateAmount" min={1} step="0.01" required defaultValue={tutor.rate_amount ?? undefined}/></label>
            <label>Reason<textarea name="reason" required minLength={5} maxLength={2000}/></label>
          </ManagedForm>
        </section>) : <p>No tutors on record yet.</p>}
      </div>}
      {canPrepareRuns && <div className="panel"><header><h2>Prepare payroll</h2></header>
        {payrollCandidates.length ? payrollCandidates.map(candidate => <section className="account-card" key={candidate.tutor_id}>
          <p>{candidate.full_name} · {candidate.eligible_sessions} unpaid completed classes · {candidate.rate_amount ? `MWK ${Number(candidate.rate_amount).toLocaleString("en-GB")} per class` : "No rate set"}</p>
          {candidate.rate_amount ? <ManagedForm action={preparePayrollRun} label="Prepare payroll run">
            <input type="hidden" name="tutorId" value={candidate.tutor_id}/>
            <label>Period start<input type="date" name="periodStart" required/></label>
            <label>Period end<input type="date" name="periodEnd" required/></label>
            <label>Reason<textarea name="reason" required minLength={5} maxLength={2000}/></label>
          </ManagedForm> : <p><small>Set a pay rate for this tutor first.</small></p>}
        </section>) : <p>No unpaid completed classes.</p>}
      </div>}
      {canDecidePayroll && <div className="panel"><header><h2>Pending payroll runs</h2></header>
        {pendingPayrollRuns.length ? pendingPayrollRuns.map(run => <section className="account-card" key={run.id}>
          <p>{tutorName(run.tutor_id)} · {run.session_count} classes · MWK {Number(run.total_amount).toLocaleString("en-GB")} · {run.period_start} to {run.period_end}</p>
          {run.requested_by === account.user.id ? <p><small>A different Finance Administrator must decide this run.</small></p> : <ManagedForm action={decidePayrollRun} label="Record decision">
            <input type="hidden" name="id" value={run.id}/>
            <label>Decision<select name="decision"><option value="approve">Approve</option><option value="reject">Reject</option></select></label>
            <label>Decision reason<textarea name="reason" required minLength={5} maxLength={2000}/></label>
          </ManagedForm>}
        </section>) : <p>No pending payroll runs.</p>}
      </div>}
    </div>}
  </div>;
}
