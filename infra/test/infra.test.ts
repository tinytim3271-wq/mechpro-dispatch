import { buildPayrollEntries, weekPeriod } from '../lambda/payroll/sync';
import { buildTaxReport, invoiceTaxBreakdown } from '../lambda/tax/report';

describe('tax reporting math', () => {
	test('splits a tax-inclusive invoice and preserves explicit tax values', () => {
		expect(invoiceTaxBreakdown({ number: 'INV-1', amount: 108.25 }, 8.25)).toEqual({ subtotal: 100, tax: 8.25, taxRate: 8.25 });
		expect(invoiceTaxBreakdown({ number: 'INV-2', amount: 120, subtotal: 100, tax: 20, taxRate: 20 }, 8.25)).toEqual({ subtotal: 100, tax: 20, taxRate: 20 });
	});

	test('reports completed partial payments in range and rounds totals to cents', () => {
		const report = buildTaxReport(
			[
				{ invoiceNumber: 'INV-1', customer: 'Customer', amount: 54.13, receivedAt: '2026-08-14T23:59:59.000Z', status: 'completed' },
				{ invoiceNumber: 'INV-1', customer: 'Customer', amount: 10, receivedAt: '2026-08-14T12:00:00.000Z', status: 'pending' },
				{ invoiceNumber: 'INV-1', customer: 'Customer', amount: 20, receivedAt: '2026-08-15T00:00:00.000Z', status: 'completed' },
			],
			[{ number: 'INV-1', amount: 108.25, subtotal: 100, tax: 8.25 }],
			8.25,
			'2026-08-14',
			'2026-08-14',
		);
		expect(report.rows).toHaveLength(1);
		expect(report.rows[0]).toMatchObject({ gross: 54.13, taxable: 50, tax: 4.13 });
		expect(report.totals).toEqual({ gross: 54.13, taxable: 50, tax: 4.13 });
	});
});

describe('payroll math', () => {
	test('uses a Monday-anchored UTC period', () => {
		expect(weekPeriod(new Date('2026-08-16T12:00:00Z')).key).toBe('2026-08-10');
		expect(weekPeriod(new Date('2026-08-17T00:00:00Z')).key).toBe('2026-08-17');
	});

	test('posts eligible jobs, applies labor fallback, and skips ineligible records', () => {
		const now = new Date('2026-08-14T12:00:00Z');
		const entries = buildPayrollEntries(
			[
				{ id: 'RO-1', status: 'completed', tech: 'Eli R.', laborHours: 1.25 },
				{ id: 'RO-2', status: 'invoiced', tech: 'Eli R.', labor: 247.5 },
				{ id: 'RO-3', status: 'estimate', tech: 'Eli R.', laborHours: 5 },
				{ id: 'RO-4', status: 'completed', tech: 'Inactive', laborHours: 2 },
				{ id: 'RO-5', status: 'completed', tech: 'Manager', laborHours: 2 },
			],
			[
				{ id: 'EMP-1', techName: 'Eli R.', payRate: 32.15, employmentType: 'Hourly', active: true },
				{ id: 'EMP-2', techName: 'Inactive', payRate: 30, employmentType: 'Hourly', active: false },
				{ id: 'EMP-3', techName: 'Manager', payRate: 72000, employmentType: 'Salary', active: true },
			],
			'shop-1',
			now,
		);
		expect(entries).toHaveLength(3);
		expect(entries.map(entry => ({ id: entry.workOrderId, hours: entry.hours, gross: entry.grossPay }))).toEqual([
			{ id: 'RO-1', hours: 1.25, gross: 40.19 },
			{ id: 'RO-2', hours: 1.5, gross: 48.23 },
			{ id: 'RO-5', hours: 2, gross: 0 },
		]);
		expect(entries.every(entry => entry.periodKey === '2026-08-10' && entry.shopId === 'shop-1')).toBe(true);
	});
});
