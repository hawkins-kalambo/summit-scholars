import Link from "next/link";
import type { ReactNode } from "react";

export function AuthShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <main className="auth-page">
    <Link className="auth-brand" href="/">▲ Summit ScholarsBridge <small>Academic Solutions</small></Link>
    <section className="auth-card">
      <span className="eyebrow">Your next step starts here</span>
      <h1>{title}</h1><p>{description}</p>
      {children}
    </section>
    <p className="auth-footnote">Independent academic support. Summit records are not official university transcripts.</p>
  </main>;
}
export function UnavailableNotice() {
  return <p className="form-notice" role="status">Online accounts are not open yet. Contact <a href="mailto:summitscholarsbridge@gmail.com">summitscholarsbridge@gmail.com</a> for assistance.</p>;
}
