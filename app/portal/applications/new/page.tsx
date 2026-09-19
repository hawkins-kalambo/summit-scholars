import { notFound } from "next/navigation";
import { getCatalogue, requireAdmissionsAccount } from "@/lib/admissions/data";
import { ApplicationForm } from "@/components/admissions/application-form";
export const dynamic = "force-dynamic";
export default async function NewApplicationPage() {
  const account = await requireAdmissionsAccount();
  if (!account.roles.includes("student")) notFound();
  const catalogue = await getCatalogue();
  return <div className="dash narrow-content">
    <div className="dash-title"><div><span className="eyebrow">Admissions</span><h1>Start your application</h1><p>Choose your academic details and the courses you would like support with. You can upload documents after saving this draft.</p></div></div>
    <section className="account-panel"><ApplicationForm catalogue={catalogue} /></section>
  </div>;
}
