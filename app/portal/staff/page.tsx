import { redirect } from "next/navigation";
import { requireAccount } from "@/lib/auth/session";
import { roles, roleLabels, type Role } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ManagedForm } from "@/components/admissions/managed-form";
import { requestStaffAccess, decideStaffAccess } from "./actions";

export default async function StaffPage() {
  const account = await requireAccount();
  const manager = account.roles.some(role => role === "system_admin" || role === "super_admin");
  if (account.status !== "active" || (!manager && !account.roles.includes("auditor"))) redirect("/portal");
  const db = await createSupabaseServerClient();
  const { data, error } = await db.from("staff_access_requests").select("id,target_id,target_email,role,operation,reason,requested_by,status,decision_reason,created_at").order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error("Unable to load staff access requests.");
  return <div className="dash">
    <div className="dash-title"><div><span className="eyebrow">Staff</span><h1>Staff access</h1><p>Staff first register and verify their email. An administrator requests access, then a separate Super Administrator approves it.</p></div></div>
    {manager && <section className="account-card"><h2>Request an access change</h2><ManagedForm action={requestStaffAccess} label="Submit request">
      <label>Verified account email<input name="email" type="email" required maxLength={254} /></label>
      <label>Staff role<select name="role">{roles.filter(role => role !== "student").map(role => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label>
      <label>Change<select name="operation"><option value="grant">Grant access</option><option value="revoke">Revoke access</option></select></label>
      <label>Reason<textarea name="reason" required minLength={5} maxLength={2000} /></label>
    </ManagedForm></section>}
    <h2>Latest requests</h2><p>Showing the latest 100 requests. All decisions are retained in the audit log.</p>
    {!data?.length && <p>No requests yet.</p>}
    {data?.map(request => <section className="account-card" key={request.id}>
      <h3>{request.target_email}</h3><p>{request.operation === "grant" ? "Grant" : "Revoke"} {roleLabels[request.role as Role]} · {request.status}</p>
      <p>{request.reason}</p>{request.decision_reason && <p>Decision: {request.decision_reason}</p>}
      {request.status === "pending" && account.roles.includes("super_admin") && request.requested_by !== account.user.id && request.target_id !== account.user.id && <ManagedForm action={decideStaffAccess} label="Record decision">
        <input type="hidden" name="id" value={request.id} /><label>Decision<select name="decision"><option value="reject">Reject</option><option value="approve">Approve</option></select></label>
        <label>Decision reason<textarea name="reason" required minLength={5} maxLength={2000} /></label>
      </ManagedForm>}
    </section>)}
  </div>;
}
