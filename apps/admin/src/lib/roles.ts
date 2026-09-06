import type { AdminRole } from "@clawd/db";

export type { AdminRole };

const ROLE_RANK: Record<AdminRole, number> = { analyst: 0, operator: 1, super_admin: 2 };

export function hasRole(current: AdminRole, min: AdminRole): boolean {
  return ROLE_RANK[current] >= ROLE_RANK[min];
}

export interface AdminSession {
  username: string;
  role: AdminRole;
}
