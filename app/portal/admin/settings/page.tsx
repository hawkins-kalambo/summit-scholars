import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdminArea } from "@/lib/admin/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ManagedForm } from "@/components/admissions/managed-form";
import { saveOrganisation } from "./actions";
export const dynamic = "force-dynamic";
export default async function SettingsPage() {
  const account = await requireAdminArea("overview"); if (!account.roles.includes("super_admin")) redirect("/portal");
  const db = await createSupabaseServerClient(); const { data,error } = await db.from("organisation_settings").select("organisation_name,support_email").single();
  if (error) throw new Error("Unable to load organisation settings.");
  const services = [ ["Supabase connection", Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)], ["Private library file service", Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)], ["Resend sender", Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL)], ["Notification scheduler credential", Boolean(process.env.CRON_SECRET && process.env.CRON_SECRET.length>=32)] ] as const;
  return <div className="dash">
    <div className="dash-title"><div><span className="eyebrow">Administration</span><h1>Organisation settings</h1></div></div>
    <div className="dashgrid">
      <div className="panel"><header><h2>Organisation details</h2></header><ManagedForm action={saveOrganisation} label="Save organisation settings"><label>Organisation name<input name="name" required minLength={2} maxLength={200} defaultValue={data.organisation_name}/></label><label>Support email<input name="email" type="email" required maxLength={254} defaultValue={data.support_email}/></label><label>Reason<textarea name="reason" required minLength={5} maxLength={2000}/></label></ManagedForm></div>
      <div className="panel"><header><h2>Integration configuration</h2></header><p>These checks confirm settings are present; they do not test delivery or scheduler operation.</p><ul>{services.map(([label,configured])=><li key={label}>{label}: {configured ? "Configured" : "Missing configuration"}</li>)}</ul><p><Link href="/portal/academics">Manage admissions, privacy notice and academic settings</Link></p></div>
    </div>
  </div>;
}
