import type { Role } from "./roles";
export const portals = ["admin", "staff", "student"] as const;
export type Portal = (typeof portals)[number];
export const portalLabels: Record<Portal, string> = { admin: "Admin", staff: "Staff & Tutors", student: "Student" };
export const portalRoles: Record<Portal, readonly Role[]> = {
  admin: ["super_admin", "system_admin", "academic_admin"],
  staff: ["admissions_officer", "finance_officer", "finance_administrator", "tutor", "support_officer", "auditor"],
  student: ["student"],
};
export function isPortal(value: unknown): value is Portal { return portals.some(portal => portal === value); }
export function canEnterPortal(assigned: readonly Role[], status: string, portal: Portal): boolean {
  if (status !== "active" && !(portal === "student" && status === "pending")) return false;
  return assigned.some(role => portalRoles[portal].includes(role));
}
export function defaultPortal(assigned: readonly Role[], status: string): Portal | null {
  return portals.find(portal => canEnterPortal(assigned, status, portal)) ?? null;
}
