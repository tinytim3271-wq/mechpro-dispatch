import { buildPayrollEntries, weekPeriod } from '../lambda/payroll/sync';
import { buildTaxReport, invoiceTaxBreakdown } from '../lambda/tax/report';
import { creditAmount, ownerEmployeeProfile, validPassword, validShopId } from '../lambda/admin/accounts';
import { deletionConflict, entityPrefix } from '../lambda/entities/handler';
import { normalizeVinResult, validVin } from '../lambda/vehicles/decode';
import { openInvoiceBalance, originHeader, safeCheckoutUrl } from '../lambda/payments/checkout';
import { verifyStripeSignature } from '../lambda/payments/webhook';
import { verifyAgentPhoneSignature } from '../lambda/ai/agentphone-webhook';
import { subscriptionEntitlement } from '../lambda/subscription/entitlement';
import { matchCoverageRecord, evaluateEligibility } from '../lambda/diagnostics/coverage';
import { isResettableShopRecord, isSampleRecord } from '../lambda/onboarding/start';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { appUrl, envValue, filesBucketName, userPoolId } from '../lambda/common/runtime-env';
import { normalizeWave1EntityPayload, normalizeWave1EntityType } from '../contracts/wave1-alignment';
import { GitHubActionsStack } from '../lib/github-actions-stack';

describe('desktop subscription entitlement', () => {
	test('allows active and trial subscriptions that have not expired', () => {
		const now = new Date('2026-08-17T12:00:00.000Z');
		expect(subscriptionEntitlement({ subscriptionStatus: 'active' }, now).active).toBe(true);
		expect(subscriptionEntitlement({ subscriptionStatus: 'trialing', subscriptionExpiresAt: '2026-08-18T00:00:00.000Z' }, now).active).toBe(true);
	});

	test('rejects missing, suspended, inactive, and expired accounts', () => {
		const now = new Date('2026-08-17T12:00:00.000Z');
		expect(subscriptionEntitlement(undefined, now).active).toBe(false);
		expect(subscriptionEntitlement(undefined, now).status).toBe('missing');
		expect(subscriptionEntitlement({ subscriptionStatus: '' }, now).status).toBe('missing');
		expect(subscriptionEntitlement({ suspended: true }, now).status).toBe('suspended');
		expect(subscriptionEntitlement({ subscriptionStatus: 'past_due' }, now).active).toBe(false);
		expect(subscriptionEntitlement({ subscriptionStatus: 'active', subscriptionExpiresAt: '2026-08-17T11:59:59.000Z' }, now).status).toBe('expired');
	});
});

describe('super admin account controls', () => {
	test('accepts normalized tenant IDs and rejects unsafe IDs', () => {
		expect(validShopId('high-plains-auto')).toBe(true);
		expect(validShopId('ab')).toBe(false);
		expect(validShopId('High Plains')).toBe(false);
	});

	test('accepts positive currency credits and rejects zero or negative values', () => {
		expect(creditAmount('25.678')).toBe(25.68);
		expect(creditAmount(0)).toBeNull();
		expect(creditAmount(-10)).toBeNull();
	});

	test('requires a strong permanent password', () => {
		expect(validPassword('LongEnough1!')).toBe(true);
		expect(validPassword('Short1!')).toBe(false);
		expect(validPassword('nouppercase1!')).toBe(false);
		expect(validPassword('NOLOWERCASE1!')).toBe(false);
		expect(validPassword('MissingNumber!')).toBe(false);
		expect(validPassword('MissingSymbol1')).toBe(false);
	});

	test('provisions a tenant-scoped owner employee profile for each customer account', () => {
		const profile = ownerEmployeeProfile('high-plains-auto', 'Alex Owner', 'alex@example.com', '2026-08-17T12:00:00.000Z');
		expect(profile).toMatchObject({
			id: 'owner-high-plains-auto',
			pk: 'SHOP#high-plains-auto',
			sk: 'EMPLOYEE#owner-high-plains-auto',
			shopId: 'high-plains-auto',
			name: 'Alex Owner',
			email: 'alex@example.com',
			role: 'admin',
			active: true,
		});
	});
});

describe('shop entity controls', () => {
	test('supports all linked shop-management records and rejects unknown types', () => {
		expect(entityPrefix('bookings')).toBe('APPOINTMENT');
		expect(entityPrefix('inventory')).toBe('INVENTORY');
		expect(entityPrefix('inspectionTemplates')).toBe('INSPECTIONTEMPLATE');
		expect(entityPrefix('inspections')).toBe('INSPECTION');
		expect(entityPrefix('reminders')).toBe('REMINDER');
		expect(entityPrefix('vendors')).toBe('VENDOR');
		expect(entityPrefix('services')).toBe('SERVICE');
		expect(entityPrefix('shopSettings')).toBe('SHOPSETTING');
		expect(entityPrefix('appointments')).toBe('APPOINTMENT');
		expect(entityPrefix('purchases')).toBe('PURCHASE');
		expect(entityPrefix('not-a-real-entity')).toBeUndefined();
	});

	test('protects linked customers while allowing invoice deletion with payment history', () => {
		expect(deletionConflict('customers', { name: 'Alex Owner' }, [
			{ sk: 'ORDER#RO-1', customer: 'Alex Owner' },
		])).toContain('work orders');
		expect(deletionConflict('customers', { name: 'Alex Owner' }, [
			{ sk: 'ORDER#RO-1', customer: 'Another Customer' },
		])).toBeNull();
		expect(deletionConflict('invoices', { number: 'INV-1' }, [
			{ sk: 'PAYMENT#payment-1', invoiceNumber: 'INV-1' },
		])).toBeNull();
		expect(deletionConflict('invoices', { number: 'INV-1' }, [])).toBeNull();
	});
});

describe('Wave 1 source compatibility', () => {
	test('normalizes MechPro-AWS bookings into dispatch appointments', () => {
		expect(normalizeWave1EntityType('bookings')).toBe('appointments');
		expect(normalizeWave1EntityPayload('bookings', {
			id: 42,
			customer_id: 7,
			employee_id: 9,
			booking_date: '2026-08-17T14:30:00Z',
			service_type: 'Brake inspection',
			status: 'scheduled',
		})).toMatchObject({
			customerId: 7,
			employeeId: 9,
			customer: 'Customer #7',
			vehicle: 'Vehicle pending',
			service: 'Brake inspection',
			date: '2026-08-17',
			time: '14:30',
			tech: 'Employee #9',
			status: 'scheduled',
			sourceContract: 'MechPro-aws.bookings',
		});
	});

	test('maps legacy invoice and customer fields without overwriting current names', () => {
		expect(normalizeWave1EntityPayload('invoices', {
			customer_id: 11,
			total_amount: 250.75,
			payment_method: 'card',
		})).toMatchObject({
			customerId: 11,
			customer: 'Customer #11',
			amount: 250.75,
			paymentMethod: 'card',
			sourceContract: 'MechPro-aws.invoices',
		});
		expect(normalizeWave1EntityPayload('customers', {
			name: 'Alex Owner',
			address: '123 Main St',
		})).toMatchObject({
			billingAddress: '123 Main St',
			sourceContract: 'MechPro-aws.customers',
		});
		expect(normalizeWave1EntityPayload('customers', {
			name: 'Already current',
			billingAddress: '456 Oak Ave',
		})).toEqual({
			name: 'Already current',
			billingAddress: '456 Oak Ave',
		});
	});
});

describe('runtime env aliases', () => {
	test('prefers dispatch env names and falls back to MechPro aliases', () => {
		expect(envValue(['USER_POOL_ID', 'COGNITO_USER_POOL_ID'], {
			USER_POOL_ID: 'dispatch-pool',
			COGNITO_USER_POOL_ID: 'legacy-pool',
		})).toBe('dispatch-pool');
		expect(userPoolId({ COGNITO_USER_POOL_ID: 'legacy-pool' })).toBe('legacy-pool');
		expect(filesBucketName({ S3_BUCKET: 'legacy-bucket' })).toBe('legacy-bucket');
		expect(appUrl({ FRONTEND_URL: 'https://legacy.example.com' })).toBe('https://legacy.example.com');
	});
});

describe('deployment workflow', () => {
	test('assumes the AWS deploy role from the main-branch deploy job', () => {
		const workflow = readFileSync(resolve(process.cwd(), '..', '.github', 'workflows', 'deploy.yml'), 'utf8');
		expect(workflow).toMatch(/deploy:\n(?:.*\n)*?\s+- uses: aws-actions\/configure-aws-credentials@v4/);
		expect(workflow).toMatch(/deploy:\n(?:.*\n)*?\s+environment:\s+production\n(?:.*\n)*?\s+- uses: aws-actions\/configure-aws-credentials@v4/);
		expect(workflow).toContain("role-to-assume: ${{ vars.AWS_ROLE_ARN || 'arn:aws:iam::001018341557:role/MechProGitHubActionsDeployRole' }}");
	});

	test('uses the production environment before assuming the AWS role in Windows publish-download', () => {
		const workflow = readFileSync(resolve(process.cwd(), '..', '.github', 'workflows', 'windows-desktop.yml'), 'utf8');
		expect(workflow).toMatch(/publish-download:\n(?:.*\n)*?\s+- uses: aws-actions\/configure-aws-credentials@v4/);
		expect(workflow).toMatch(/publish-download:\n(?:.*\n)*?\s+environment:\s+production\n(?:.*\n)*?\s+- uses: aws-actions\/configure-aws-credentials@v4/);
		expect(workflow).toContain("role-to-assume: ${{ vars.AWS_ROLE_ARN || 'arn:aws:iam::001018341557:role/MechProGitHubActionsDeployRole' }}");
	});

	test('refreshes the GitHub Actions stack before publishing Windows downloads', () => {
		const workflow = readFileSync(resolve(process.cwd(), '..', '.github', 'workflows', 'windows-desktop.yml'), 'utf8');
		expect(workflow).toContain('- name: Refresh GitHub Actions publish role permissions');
		expect(workflow).toContain('npx cdk deploy MechProGitHubActionsStack --require-approval never --strict -c enableCustomDomain=true -c githubRepository=${{ github.repository }}');
		expect(workflow).toMatch(/publish-download:\n(?:.*\n)*?\s+- uses: aws-actions\/configure-aws-credentials@v4\n(?:.*\n)*?\s+- name: Refresh GitHub Actions publish role permissions\n(?:.*\n)*?\s+- uses: aws-actions\/configure-aws-credentials@v4\n(?:.*\n)*?\s+- name: Publish Windows installer to site bucket/);
	});

	test('keeps the GitHub Actions deploy role trust aligned to deploy and publish subjects', () => {
		const app = new cdk.App();
		const stack = new GitHubActionsStack(app, 'TestGitHubActionsStack', {
			repository: 'tinytim3271-wq/mechpro-dispatch',
			env: { account: '001018341557', region: 'us-east-1' },
		});
		const template = Template.fromStack(stack);
		template.hasResourceProperties('AWS::IAM::Role', {
			AssumeRolePolicyDocument: {
				Statement: Match.arrayWith([
					Match.objectLike({
						Action: 'sts:AssumeRoleWithWebIdentity',
						Condition: {
							StringLike: {
								'token.actions.githubusercontent.com:sub': Match.arrayWith([
									'repo:tinytim3271-wq/mechpro-dispatch:ref:refs/heads/main',
									'repo:tinytim3271-wq/mechpro-dispatch:environment:production',
								]),
							},
						},
					}),
				]),
			},
		});
	});

	test('uses the configured OIDC subject in the deploy role description', () => {
		const app = new cdk.App();
		const stack = new GitHubActionsStack(app, 'TestGitHubActionsStackCustomSubject', {
			repository: 'tinytim3271-wq/mechpro-dispatch',
			subject: 'repo:tinytim3271-wq/mechpro-dispatch:ref:refs/heads/main',
			env: { account: '001018341557', region: 'us-east-1' },
		});
		const template = Template.fromStack(stack);
		template.hasResourceProperties('AWS::IAM::Role', {
			Description: 'CDK deployment role for tinytim3271-wq/mechpro-dispatch (repo:tinytim3271-wq/mechpro-dispatch:ref:refs/heads/main)',
		});
	});
});

describe('onboarding sample cleanup', () => {
	test('recognizes bundled and explicitly marked samples without matching normal shop data', () => {
		expect(isSampleRecord({ sk: 'ORDER#RO-1048', id: 'RO-1048' })).toBe(true);
		expect(isSampleRecord({ sk: 'INVOICE#INV-2041', id: 'INV-2041', number: 'INV-2041' })).toBe(true);
		expect(isSampleRecord({ sk: 'CUSTOMER#legacy-id', name: 'Maria Hernandez' })).toBe(true);
		expect(isSampleRecord({ sk: 'EXPENSE#legacy-id', vendor: 'City of Lubbock', memo: 'Shop electric service', amount: 286.14 })).toBe(true);
		expect(isSampleRecord({ sk: 'VEHICLE#sample', sampleData: true })).toBe(true);
		expect(isSampleRecord({ sk: 'ORDER#RO-9000', id: 'RO-9000', customer: 'Real Customer' })).toBe(false);
		expect(isSampleRecord({ sk: 'EMPLOYEE#owner-shop', id: 'owner-shop' })).toBe(false);
	});

	test('full reset preserves employee access and removes all other shop records', () => {
		expect(isResettableShopRecord({ sk: 'EMPLOYEE#owner-shop' })).toBe(false);
		expect(isResettableShopRecord({ sk: 'EMPLOYEE#technician-1' })).toBe(false);
		expect(isResettableShopRecord({ sk: 'CUSTOMER#real-customer' })).toBe(true);
		expect(isResettableShopRecord({ sk: 'INVOICE#INV-9000' })).toBe(true);
		expect(isResettableShopRecord({ sk: 'SHOPSETTING#profile' })).toBe(true);
		expect(isResettableShopRecord({ sk: 'VINDECODE#1HGCM82633A004352' })).toBe(true);
	});
});

describe('vehicle decoding', () => {
	test('validates VIN characters and normalizes NHTSA data', () => {
		expect(validVin('1HGCM82633A004352')).toBe(true);
		expect(validVin('1HGCM82633A00I352')).toBe(false);
		expect(validVin('short')).toBe(false);
		expect(normalizeVinResult({
			VIN: '1hgcm82633a004352', ModelYear: '2003', Make: 'HONDA', Model: 'Accord',
			Trim: 'EX', FuelTypePrimary: 'Gasoline', DisplacementL: '3', ErrorCode: '0',
		})).toMatchObject({
			vin: '1HGCM82633A004352', year: '2003', make: 'HONDA', model: 'Accord',
			trim: 'EX', fuelType: 'Gasoline', engineDisplacementLiters: '3', errorCode: '0',
		});
	});
});

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

describe('payment integrity', () => {
	test('charges only the unpaid invoice balance', () => {
		expect(openInvoiceBalance(125, [
			{ amount: 25, status: 'completed' },
			{ amount: 50, status: 'pending' },
		])).toBe(100);
		expect(openInvoiceBalance(25, [{ amount: 30, status: 'completed' }])).toBe(0);
	});

	test('accepts only checkout redirects on the requesting origin', () => {
		expect(safeCheckoutUrl('https://shop.example/invoices#paid', 'https://shop.example')).toBe('https://shop.example/invoices#paid');
		expect(safeCheckoutUrl('https://attacker.example/paid', 'https://shop.example')).toBeNull();
	});

	test('reads Origin header case-insensitively', () => {
		expect(originHeader({ origin: 'https://shop.example' })).toBe('https://shop.example');
		expect(originHeader({ Origin: 'https://shop.example' })).toBe('https://shop.example');
		expect(originHeader({ ORIGIN: 'https://shop.example' })).toBe('https://shop.example');
		expect(originHeader({ host: 'api.example.com' })).toBeUndefined();
	});

	test('rejects stale Stripe signatures', () => {
		const payload = '{"id":"evt_1"}';
		const timestamp = 1_800_000_000;
		const signature = createHmac('sha256', 'secret').update(`${timestamp}.${payload}`).digest('hex');
		const header = `t=${timestamp},v1=${signature}`;
		expect(verifyStripeSignature(payload, header, 'secret', timestamp + 299)).toBe(true);
		expect(verifyStripeSignature(payload, header, 'secret', timestamp + 301)).toBe(false);
	});

	test('verifies AgentPhone signatures and rejects stale deliveries', () => {
		const payload = '{"event":"agent.message"}';
		const timestamp = 1_800_000_000;
		const digest = createHmac('sha256', 'secret').update(`${timestamp}.${payload}`).digest('hex');
		const header = `sha256=${digest}`;
		expect(verifyAgentPhoneSignature(payload, header, String(timestamp), 'secret', timestamp + 299)).toBe(true);
		expect(verifyAgentPhoneSignature(payload, header, String(timestamp), 'secret', timestamp + 301)).toBe(false);
	});
});

describe('diagnostics coverage', () => {
	const records = [
		{
			id: 'ram-dt',
			make: 'Ram',
			model: '1500',
			yearRange: [2019, 2024] as [number, number],
			platform: 'DT',
			procedures: {
				add_key: { supported: true, authorizationRequired: 'autoauth_stellantis' },
				erase_keys: { supported: false, authorizationRequired: null },
			},
			preconditions: ['Ignition ON'],
			warnings: ['Authorization required'],
			supported: 'requires_authorization',
		},
	];

	test('matches platform and year range', () => {
		expect(matchCoverageRecord(records, 'DT', 2020)?.id).toBe('ram-dt');
		expect(matchCoverageRecord(records, 'XX', 2020)).toBeUndefined();
	});

	test('evaluates procedure eligibility and authorization requirements', () => {
		const addKey = evaluateEligibility(matchCoverageRecord(records, 'DT', 2020), 'add_key');
		expect(addKey.eligible).toBe(true);
		expect(addKey.requiredAuth).toEqual(['autoauth_stellantis']);
		const erase = evaluateEligibility(matchCoverageRecord(records, 'DT', 2020), 'erase_keys');
		expect(erase.eligible).toBe(false);
		expect(erase.blockers.length).toBeGreaterThan(0);
	});
});
