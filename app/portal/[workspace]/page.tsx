import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAccount } from "@/lib/auth/session";
import { canEnterWorkspace, isRole, roleLabels } from "@/lib/auth/roles";
export const dynamic = "force-dynamic";

export default async function WorkspacePage({ params }: { params: Promise<{ workspace: string }> }) {
  const account = await requireAccount();
  const { workspace } = await params;
  if (workspace === "super_admin" && account.status === "active" && account.roles.includes("super_admin")) redirect("/portal/home/admin");
  if (account.status !== "active") redirect("/portal");
  if (!isRole(workspace) || !canEnterWorkspace(account.roles, workspace)) notFound();
  return <main className="account-content"><Link href="/portal">← My account</Link><h1>{roleLabels[workspace]}</h1>
    {["super_admin","academic_admin","admissions_officer","auditor","student"].includes(workspace) &&
      <Link className="account-panel" href="/portal/applications"><h2>{workspace==="student" ? "My applications" : "Applications and reviews"}</h2><p>Open application records, documents and decision history.</p></Link>}
    {["super_admin","academic_admin"].includes(workspace) &&
      <Link className="account-panel" href="/portal/academics"><h2>Academic configuration</h2><p>Manage universities, programmes, intakes and courses.</p></Link>}
    {!["super_admin","academic_admin","admissions_officer","auditor","student"].includes(workspace) &&
      <section className="account-panel"><h2>Your workspace is ready</h2><p>There are no available activities here yet. Contact Summit ScholarsBridge for assistance.</p><a href="mailto:summitscholarsbridge@gmail.com">Contact support</a></section>}
  </main>;
}
