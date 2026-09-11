import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { handler, headerValue, needsLegacyPaymentFallback, openInvoiceBalance, safeCheckoutUrl } from '../lambda/payments/checkout';
import { ddb } from '../lambda/common/ddb';

describe('payments checkout helpers', () => {
  test('openInvoiceBalance only counts completed payments', () => {
    expect(openInvoiceBalance(100, [
      { amount: 20, status: 'completed' },
      { amount: 5, status: 'pending' },
      { amount: 10, status: 'completed' },
    ])).toBe(70);
  });

  test('safeCheckoutUrl requires same origin', () => {
    expect(safeCheckoutUrl('https://app.example.com/success', 'https://app.example.com')).toBe('https://app.example.com/success');
    expect(safeCheckoutUrl('https://evil.example.com/success', 'https://app.example.com')).toBeNull();
  });

  test('headerValue matches header names case-insensitively', () => {
    expect(headerValue({ Origin: 'https://app.example.com' }, 'origin')).toBe('https://app.example.com');
    expect(headerValue({ origin: 'https://app.example.com' }, 'Origin')).toBe('https://app.example.com');
  });

  test('legacy payment fallback is only required for pre-rollout invoices', () => {
    expect(needsLegacyPaymentFallback({ createdAt: '2026-09-03T23:59:59.000Z' })).toBe(true);
    expect(needsLegacyPaymentFallback({ createdAt: '2026-09-04T00:00:00.000Z' })).toBe(false);
  });

  test('handler accepts capitalized Origin header', async () => {
    const ddbSend = jest.spyOn(ddb, 'send');
    (ddbSend as any)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Item: { amount: 100 } })
      .mockResolvedValueOnce({ Items: [{ amount: 25, status: 'completed' }] })
      .mockResolvedValueOnce({ Items: [] });
    const secretsSend = jest.spyOn(SecretsManagerClient.prototype, 'send').mockImplementation(command => {
      if (command instanceof GetSecretValueCommand) return Promise.resolve({ SecretString: 'sk_test_123' } as any);
      return Promise.resolve({} as any);
    });
    const fetchMock = jest.spyOn(global as any, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/session/123', id: 'cs_test_123' }),
    } as any);
    const event = {
      body: JSON.stringify({
        invoiceNumber: 'INV-1',
        successUrl: 'https://shop.example/success',
        cancelUrl: 'https://shop.example/cancel',
      }),
      headers: { Origin: 'https://shop.example' },
      requestContext: {
        http: { method: 'POST' },
        authorizer: { jwt: { claims: { 'custom:shopId': 'shop-1', 'custom:role': 'admin', sub: 'user-1', email: 'owner@example.com' } } },
      },
    } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;

    const result = await handler(event) as { statusCode: number };

    expect(result.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ddbSend).toHaveBeenCalledTimes(3);
    expect(ddbSend.mock.calls[2][0]).toBeInstanceOf(QueryCommand);
    expect((ddbSend.mock.calls[2][0] as QueryCommand).input.IndexName).toBe('gsi1');

    fetchMock.mockRestore();
    secretsSend.mockRestore();
    ddbSend.mockRestore();
  });

  test('handler falls back to legacy payment scan when invoice index has no matches', async () => {
    const ddbSend = jest.spyOn(ddb, 'send');
    (ddbSend as any)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Item: { amount: 100 } })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [{ amount: 25, status: 'completed' }] });
    const secretsSend = jest.spyOn(SecretsManagerClient.prototype, 'send');
    (secretsSend as any).mockResolvedValue({ SecretString: 'sk_test_123' });
    const fetchMock = jest.spyOn(global as any, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/session/legacy', id: 'cs_test_legacy' }),
    } as any);
    const event = {
      body: JSON.stringify({
        invoiceNumber: 'INV-1',
        successUrl: 'https://shop.example/success',
        cancelUrl: 'https://shop.example/cancel',
      }),
      headers: { origin: 'https://shop.example' },
      requestContext: {
        http: { method: 'POST' },
        authorizer: { jwt: { claims: { 'custom:shopId': 'shop-1', 'custom:role': 'admin', sub: 'user-1', email: 'owner@example.com' } } },
      },
    } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;

    const result = await handler(event) as { statusCode: number };

    expect(result.statusCode).toBe(200);
    expect(ddbSend).toHaveBeenCalledTimes(4);
    expect((ddbSend.mock.calls[2][0] as QueryCommand).input.IndexName).toBe('gsi1');
    expect((ddbSend.mock.calls[3][0] as QueryCommand).input.KeyConditionExpression).toContain('begins_with(sk, :prefix)');

    fetchMock.mockRestore();
    secretsSend.mockRestore();
    ddbSend.mockRestore();
  });
});
