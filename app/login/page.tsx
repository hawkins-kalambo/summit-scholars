import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { portals, portalLabels } from "@/lib/auth/portals";
export const dynamic = "force-dynamic";
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return <AuthShell title="Choose your portal" description="Select where you want to sign in.">
    {params.verification === "failed" && <p className="form-error" role="alert">This verification link is invalid or expired. Contact support if you need a new link.</p>}
    {params.password === "updated" && <p className="form-success" role="status">Password updated. Choose your portal to sign in.</p>}
    <div className="portal-choices">{portals.map(portal => <Link className="account-panel" href={"/login/" + portal} key={portal}><h2>{portalLabels[portal]} portal</h2><p>{portal === "admin" ? "Manage the institution, academic settings and access." : portal === "staff" ? "Open your assigned staff or teaching workspace." : "Apply, track admission and access your student account."}</p></Link>)}</div>
  </AuthShell>;
}
