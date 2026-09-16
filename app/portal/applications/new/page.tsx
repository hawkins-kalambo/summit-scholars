import Link from "next/link";
import { notFound } from "next/navigation";
import { getCatalogue, requireAdmissionsAccount } from "@/lib/admissions/data";
import { ApplicationForm } from "@/components/admissions/application-form";
export const dynamic = "force-dynamic";
export default async function NewApplicationPage() {
  const account = await requireAdmissionsAccount();
  if (!account.roles.includes("student")) notFound();
  const catalogue = await getCatalogue();
  return <main className="account-content narrow-content"><Link href="/portal/applications">← My applications</Link><h1>Start your application</h1><p>Choose your academic details and the courses you would like support with. You can upload documents after saving this draft.</p>
    <section className="account-panel"><ApplicationForm catalogue={catalogue} /></section>
  </main>;
}
