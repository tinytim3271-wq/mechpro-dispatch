/** Within-shop RBAC for the generic entities CRUD handler. */

export const ALL_SHOP_ROLES = ['admin', 'office', 'service_writer', 'technician'] as const;

/** Roles allowed to mutate each entity type. Missing entry = all authenticated shop roles. */
export const ENTITY_WRITE_ROLES: Record<string, string[]> = {
  employees: ['admin'],
  invoices: ['admin', 'office', 'service_writer'],
  payments: ['admin', 'office', 'service_writer'],
  expenses: ['admin', 'office'],
  payrollentries: ['admin'],
  estimates: ['admin', 'office', 'service_writer'],
  shopsettings: ['admin'],
  purchases: ['admin', 'office'],
  vendors: ['admin', 'office'],
  services: ['admin', 'office', 'service_writer'],
  inspectiontemplates: ['admin', 'office', 'service_writer'],
};

/** Roles allowed to read each entity type. Missing entry = all authenticated shop roles. */
export const ENTITY_READ_ROLES: Record<string, string[]> = {
  payrollentries: ['admin', 'office'],
};

const EMPLOYEE_SENSITIVE_FIELDS = [
  'payRate',
  'payFrequency',
  'employmentType',
  'address',
  'emergencyContact',
  'taxStatus',
  'phone',
] as const;

export function canReadEntity(entityType: string, role: string): boolean {
  const allowed = ENTITY_READ_ROLES[entityType];
  if (!allowed) return true;
  return allowed.includes(role);
}

export function canWriteEntity(entityType: string, role: string): boolean {
  const allowed = ENTITY_WRITE_ROLES[entityType];
  if (!allowed) return true;
  return allowed.includes(role);
}

/** Strip compensation / PII fields from employee records for non-privileged readers. */
export function redactEmployeeForRole(
  item: Record<string, unknown>,
  role: string,
): Record<string, unknown> {
  if (role === 'admin' || role === 'office') return item;
  const redacted = { ...item };
  for (const field of EMPLOYEE_SENSITIVE_FIELDS) {
    delete redacted[field];
  }
  return redacted;
}

export function redactEmployeesForRole(
  items: Record<string, unknown>[],
  role: string,
): Record<string, unknown>[] {
  return items.map((item) => redactEmployeeForRole(item, role));
}

/** Entity path prefixes that must never enter the offline mutation queue on the client. */
export const OFFLINE_QUEUE_BLOCKED_TYPES = new Set([
  'employees',
  'payrollentries',
  'shopsettings',
  'invoices',
  'payments',
  'expenses',
]);
