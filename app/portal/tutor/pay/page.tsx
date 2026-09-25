import { requireTutor } from "@/lib/tutoring/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
type PayrollRun = { id: string; period_start: string; period_end: string; session_count: number; total_amount: number; status: string };

export default async function TutorPayPage() {
  const account = await requireTutor();
  const db = await createSupabaseServerClient();
  const [rateResult, payrollRunsResult] = await Promise.all([
    db.from("tutor_rates").select("rate_amount").eq("tutor_id", account.user.id).order("effective_from", { ascending: false }).limit(1).maybeSingle(),
    db.from("payroll_runs").select("id,period_start,period_end,session_count,total_amount,status").eq("tutor_id", account.user.id).order("created_at", { ascending: false }),
  ]);
  const rate = (rateResult.data as { rate_amount: number } | null)?.rate_amount ?? null;
  const payrollRuns = (payrollRunsResult.data ?? []) as PayrollRun[];
  return <div className="dash">
    <div className="dash-title"><div><span className="eyebrow">Tutor</span><h1>My pay</h1><p>Your current rate and payroll run history.</p></div></div>
    <div className="panel"><header><h2>Current rate</h2></header>
      <p>{rate ? <>MWK {Number(rate).toLocaleString("en-GB")} per completed class.</> : "No pay rate has been set yet."}</p>
    </div>
    <div className="panel"><header><h2>Payroll runs</h2></header>
      {payrollRuns.length ? <ul>{payrollRuns.map(run => <li key={run.id}>
        {run.period_start} to {run.period_end} · {run.session_count} classes · MWK {Number(run.total_amount).toLocaleString("en-GB")} · {run.status}
      </li>)}</ul> : <p>No payroll runs yet.</p>}
    </div>
  </div>;
}
