"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  LayoutDashboard, UserCircle, FileText, GraduationCap, Users, BookOpen,
  ShieldCheck, ClipboardList, UserCog, School, Settings, Mail, ClipboardCheck,
  Menu, X, LogOut,
} from "lucide-react";
import { signOut } from "@/app/auth/actions";

const icons = {
  home: LayoutDashboard, profile: UserCircle, applications: FileText, academics: GraduationCap,
  staff: Users, library: BookOpen, manageLibrary: ShieldCheck, audit: ClipboardList,
  users: UserCog, universities: School, settings: Settings, notifications: Mail, enrolments: ClipboardCheck,
} as const;
export type NavItem = { href: string; label: string; icon: keyof typeof icons };

export function PortalShell({ navItems, fullName, roleLine, children }: { navItems: NavItem[]; fullName: string; roleLine: string; children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return <div className="shell">
    <aside className={open ? "side open" : "side"}>
      <div className="sidehead">
        <Link className="brand" href="/" onClick={() => setOpen(false)}><span className="peak">▲</span><span><b>Summit ScholarsBridge</b><small>Academic Solutions</small></span></Link>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close menu"><X size={20}/></button>
      </div>
      <em>Navigation</em>
      <nav>{navItems.map(item => { const Icon = icons[item.icon]; const active = pathname === item.href; return <Link key={item.href} href={item.href} className={active ? "active" : ""} onClick={() => setOpen(false)}><Icon/>{item.label}</Link>; })}</nav>
      <form action={signOut}><button className="back" type="submit"><LogOut size={16}/> Sign out</button></form>
    </aside>
    <div className="main">
      <div className="bar">
        <button type="button" className="hamb" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={22}/></button>
        <div><strong>{fullName}</strong><small>{roleLine}</small></div>
        <span><i>{fullName.charAt(0).toUpperCase()}</i></span>
      </div>
      {children}
    </div>
  </div>;
}
