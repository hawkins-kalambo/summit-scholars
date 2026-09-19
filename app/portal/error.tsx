"use client";
import Link from "next/link";
export default function PortalError({ reset }: { reset: () => void }) {
  return <div className="dash"><div className="dash-title"><div><span className="eyebrow">Something went wrong</span><h1>We couldn’t load your account</h1><p>Please try again. If the problem continues, contact support.</p></div></div><button className="btn teal" onClick={reset}>Try again</button><p><Link href="/login">Back to sign in</Link></p></div>;
}
