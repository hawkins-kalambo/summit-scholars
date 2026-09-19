import { requireAccount } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ManagedForm } from "@/components/admissions/managed-form";
import { updateProfile, changePassword } from "./actions";
export const dynamic = "force-dynamic";
export default async function ProfilePage() {
  const account = await requireAccount();
  const db = await createSupabaseServerClient();
  const { data: application } = await db.from("applications")
    .select("year_of_study,learning_mode,universities(name),programmes(name)")
    .eq("applicant_id", account.user.id).eq("status", "approved")
    .order("decided_at", { ascending: false }).limit(1).maybeSingle();
  const placement = application as unknown as { year_of_study: number; learning_mode: string; universities: { name: string } | null; programmes: { name: string } | null } | null;
  return <div className="dash">
    <div className="dash-title"><div><span className="eyebrow">Account</span><h1>My profile</h1><p>Manage your personal details, contact number and password.</p></div></div>
    <div className="dashgrid">
      <div className="panel"><header><h2>Personal details</h2></header>
        <ManagedForm action={updateProfile} label="Save changes">
          <label>Full name<input name="fullName" required minLength={2} maxLength={120} defaultValue={account.fullName}/></label>
          <label>Phone<input name="phone" type="tel" maxLength={20} defaultValue={account.phone ?? ""}/></label>
        </ManagedForm>
      </div>
      <div className="panel"><header><h2>Account</h2></header>
        <p>Email: {account.user.email}</p>
        {account.studentNumber && <p>Student number: {account.studentNumber}</p>}
        {placement && <p>{placement.programmes?.name ?? "Unknown programme"} at {placement.universities?.name ?? "Unknown university"} · Year {placement.year_of_study} · {placement.learning_mode === "online" ? "Online" : "Face-to-face"}</p>}
      </div>
      <div className="panel"><header><h2>Password</h2></header>
        <ManagedForm action={changePassword} label="Update password">
          <label>New password<input name="password" type="password" required minLength={12} maxLength={128}/></label>
        </ManagedForm>
      </div>
    </div>
  </div>;
}
