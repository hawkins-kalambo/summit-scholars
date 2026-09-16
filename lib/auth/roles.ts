export const roles = ["super_admin", "system_admin", "academic_admin", "admissions_officer", "finance_officer", "tutor", "student", "support_officer", "auditor"] as const;
export type Role = (typeof roles)[number];

export const roleLabels: Record<Role, string> = {
  super_admin: "Super Administrator", system_admin: "System Administrator",
  academic_admin: "Academic Administrator", admissions_officer: "Admissions Officer",
  finance_officer: "Finance Officer", tutor: "Tutor", student: "Student",
  support_officer: "Support Officer", auditor: "Auditor",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && roles.some((role) => role === value);
}

export function canEnterWorkspace(assigned: readonly Role[], requested: Role): boolean {
  return assigned.includes(requested) || assigned.includes("super_admin");
}

