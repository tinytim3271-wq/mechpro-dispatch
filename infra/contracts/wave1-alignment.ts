export const WAVE1_ENTITY_TYPE_MAP = {
  customers: 'customers',
  employees: 'employees',
  inspections: 'inspections',
  invoices: 'invoices',
  bookings: 'appointments',
} as const;

export type Wave1LegacyEntityType = keyof typeof WAVE1_ENTITY_TYPE_MAP;
export type Wave1TargetEntityType = typeof WAVE1_ENTITY_TYPE_MAP[Wave1LegacyEntityType];

export interface LegacyAwsCustomer {
  id?: string | number;
  name?: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface LegacyAwsEmployee {
  id?: string | number;
  name?: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  salary?: number | string | null;
  status?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface LegacyAwsBooking {
  id?: string | number;
  customer_id?: string | number | null;
  employee_id?: string | number | null;
  booking_date?: string | null;
  service_type?: string | null;
  notes?: string | null;
  status?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface LegacyAwsInvoice {
  id?: string | number;
  customer_id?: string | number | null;
  booking_id?: string | number | null;
  total_amount?: number | string | null;
  status?: string | null;
  payment_method?: string | null;
  items?: unknown[];
  created_at?: string;
  updated_at?: string;
}

export interface LegacyAwsInspection {
  id?: string | number;
  customer_id?: string | number | null;
  vehicle_vin?: string | null;
  findings?: string | null;
  ai_analysis?: string | null;
  created_at?: string;
  updated_at?: string;
}

function sourceContract(entityType: string) {
  return `MechPro-aws.${entityType}`;
}

function hasAnyKey(payload: Record<string, unknown>, keys: string[]) {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(payload, key));
}

function normalizeDateTime(value: unknown) {
  const text = String(value || '').trim();
  if (!text) return {};
  const parsed = new Date(text);
  if (Number.isNaN(parsed.valueOf())) {
    const [date = '', time = ''] = text.split('T');
    return { date, time: time.slice(0, 5) };
  }
  return {
    date: parsed.toISOString().slice(0, 10),
    time: parsed.toISOString().slice(11, 16),
  };
}

function customerLabel(customerId: unknown) {
  return customerId === null || customerId === undefined || customerId === '' ? 'Customer pending' : `Customer #${customerId}`;
}

function employeeLabel(employeeId: unknown) {
  return employeeId === null || employeeId === undefined || employeeId === '' ? 'Unassigned' : `Employee #${employeeId}`;
}

export function normalizeWave1EntityType(entityType: unknown): string {
  const normalized = String(entityType || '').trim().toLowerCase();
  return WAVE1_ENTITY_TYPE_MAP[normalized as Wave1LegacyEntityType] ?? normalized;
}

export function normalizeWave1EntityPayload(entityType: unknown, payload: Record<string, unknown>): Record<string, unknown> {
  const sourceType = String(entityType || '').trim().toLowerCase();
  switch (sourceType) {
    case 'customers': {
      if (!hasAnyKey(payload, ['address', 'created_at', 'updated_at'])) return payload;
      const customer = payload as LegacyAwsCustomer;
      return {
        ...payload,
        email: customer.email ?? payload.email ?? '',
        phone: customer.phone ?? payload.phone ?? '',
        billingAddress: payload.billingAddress ?? customer.address ?? '',
        sourceContract: payload.sourceContract ?? sourceContract(sourceType),
        createdAt: payload.createdAt ?? customer.created_at,
        updatedAt: payload.updatedAt ?? customer.updated_at,
      };
    }
    case 'employees': {
      if (!hasAnyKey(payload, ['salary', 'created_at', 'updated_at'])) return payload;
      const employee = payload as LegacyAwsEmployee;
      return {
        ...payload,
        phone: employee.phone ?? payload.phone ?? '',
        role: employee.role ?? payload.role ?? 'technician',
        payRate: payload.payRate ?? employee.salary ?? 0,
        active: payload.active ?? employee.status !== 'inactive',
        sourceContract: payload.sourceContract ?? sourceContract(sourceType),
        createdAt: payload.createdAt ?? employee.created_at,
        updatedAt: payload.updatedAt ?? employee.updated_at,
      };
    }
    case 'bookings': {
      const booking = payload as LegacyAwsBooking;
      const { date, time } = normalizeDateTime(booking.booking_date);
      return {
        ...payload,
        customerId: payload.customerId ?? booking.customer_id ?? undefined,
        employeeId: payload.employeeId ?? booking.employee_id ?? undefined,
        customer: payload.customer ?? customerLabel(booking.customer_id),
        vehicle: payload.vehicle ?? 'Vehicle pending',
        service: payload.service ?? booking.service_type ?? 'General service',
        date: payload.date ?? date,
        time: payload.time ?? time,
        tech: payload.tech ?? employeeLabel(booking.employee_id),
        notes: payload.notes ?? booking.notes ?? '',
        status: payload.status ?? booking.status ?? 'scheduled',
        sourceContract: payload.sourceContract ?? sourceContract(sourceType),
        createdAt: payload.createdAt ?? booking.created_at,
        updatedAt: payload.updatedAt ?? booking.updated_at,
      };
    }
    case 'invoices': {
      if (!hasAnyKey(payload, ['customer_id', 'booking_id', 'total_amount', 'payment_method', 'created_at', 'updated_at'])) return payload;
      const invoice = payload as LegacyAwsInvoice;
      return {
        ...payload,
        customerId: payload.customerId ?? invoice.customer_id ?? undefined,
        bookingId: payload.bookingId ?? invoice.booking_id ?? undefined,
        customer: payload.customer ?? customerLabel(invoice.customer_id),
        amount: payload.amount ?? invoice.total_amount ?? 0,
        paymentMethod: payload.paymentMethod ?? invoice.payment_method ?? '',
        items: payload.items ?? invoice.items ?? [],
        sourceContract: payload.sourceContract ?? sourceContract(sourceType),
        createdAt: payload.createdAt ?? invoice.created_at,
        updatedAt: payload.updatedAt ?? invoice.updated_at,
      };
    }
    case 'inspections': {
      if (!hasAnyKey(payload, ['customer_id', 'vehicle_vin', 'ai_analysis', 'created_at', 'updated_at'])) return payload;
      const inspection = payload as LegacyAwsInspection;
      return {
        ...payload,
        customerId: payload.customerId ?? inspection.customer_id ?? undefined,
        customer: payload.customer ?? customerLabel(inspection.customer_id),
        vin: payload.vin ?? inspection.vehicle_vin ?? '',
        aiAnalysis: payload.aiAnalysis ?? inspection.ai_analysis ?? '',
        sourceContract: payload.sourceContract ?? sourceContract(sourceType),
        createdAt: payload.createdAt ?? inspection.created_at,
        updatedAt: payload.updatedAt ?? inspection.updated_at,
      };
    }
    default:
      return payload;
  }
}
