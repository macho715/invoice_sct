export type UserRole =
  | 'COST_CONTROL_LEAD'
  | 'FINANCE_APPROVER'
  | 'MARINE_LEAD'
  | 'COMPLIANCE_LEAD'
  | 'WAREHOUSE_MANAGER'
  | 'DOCUMENT_CONTROLLER';

export const ALL_ROLES: UserRole[] = [
  'COST_CONTROL_LEAD',
  'FINANCE_APPROVER',
  'MARINE_LEAD',
  'COMPLIANCE_LEAD',
  'WAREHOUSE_MANAGER',
  'DOCUMENT_CONTROLLER'
];

export function isValidRole(role: string): role is UserRole {
  return ALL_ROLES.includes(role as UserRole);
}

export function roleCanResolveTrigger(role: string, requiredRoleSpec: string): boolean {
  const requiredRoles = requiredRoleSpec.split(',');
  return requiredRoles.includes(role);
}
