import Link from "next/link";
import type { ReactNode } from "react";
import { ShieldCheck, Users, GraduationCap, CheckCircle2, Wallet, type LucideIcon } from "lucide-react";

type PortalTheme = "admin" | "staff" | "student" | "finance";
type Theme = { icon: LucideIcon; eyebrow: string; heading: string; blurb: string; points: string[] };
const themes: Record<PortalTheme, Theme> = {
  admin: {
    icon: ShieldCheck, eyebrow: "Administration",
    heading: "Run the institution with confidence.",
    blurb: "Configure academic structure, manage access and keep every sensitive change on the record.",
    points: ["Role-based access, enforced in the database", "A full audit trail on every sensitive change", "Organisation-wide settings in one place"],
  },
  staff: {
    icon: Users, eyebrow: "Staff & tutors",
    heading: "Everything your workspace needs.",
    blurb: "Review admissions, manage your assigned courses and support students.",
    points: ["Assigned courses and students only", "Independent approval on every decision", "Built for growing responsibilities"],
  },
  student: {
    icon: GraduationCap, eyebrow: "Students",
    heading: "Your academic journey, tracked.",
    blurb: "Apply, track your admission and access your student account and library.",
    points: ["Apply and track your admission status", "Access your enrolled courses and library", "Independent academic support, transparently run"],
  },
  finance: {
    icon: Wallet, eyebrow: "Finance",
    heading: "Every transaction, accounted for.",
    blurb: "Manage invoices, record payments and keep the ledger accurate.",
    points: ["Server-verified balances, never client-reported", "Separation of duties on adjustments and refunds", "A full audit trail on every transaction"],
  },
};
const defaultTheme: Theme = {
  icon: ShieldCheck, eyebrow: "Summit ScholarsBridge",
  heading: "Structured support, professionally run.",
  blurb: "Sign in to your assigned workspace.",
  points: ["Secure, role-based accounts", "Every sensitive action is recorded", "Independent academic support"],
};

export function AuthShell({ title, description, portal, children }: { title: string; description: string; portal?: PortalTheme; children: ReactNode }) {
  const theme = portal ? themes[portal] : defaultTheme;
  const Icon = theme.icon;
  return <main className="auth-page">
    <aside className="auth-side">
      <Link className="auth-brand" href="/">▲ Summit ScholarsBridge</Link>
      <i><Icon size={30}/></i>
      <span className="eyebrow">{theme.eyebrow}</span>
      <h2>{theme.heading}</h2>
      <p>{theme.blurb}</p>
      <ul>{theme.points.map(point => <li key={point}><CheckCircle2 size={18}/>{point}</li>)}</ul>
    </aside>
    <div className="auth-main">
      <Link className="mobile-brand" href="/">▲ Summit ScholarsBridge</Link>
      <section className="auth-card">
        <span className="eyebrow">Your next step starts here</span>
        <h1>{title}</h1><p>{description}</p>
        {children}
      </section>
      <p className="auth-footnote">Independent academic support. Summit records are not official university transcripts.</p>
    </div>
  </main>;
}
export function UnavailableNotice() {
  return <p className="form-notice" role="status">Online accounts are not open yet. Contact <a href="mailto:summitscholarsbridge@gmail.com">summitscholarsbridge@gmail.com</a> for assistance.</p>;
}
