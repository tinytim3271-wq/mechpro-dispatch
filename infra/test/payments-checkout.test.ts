import { headerValue, openInvoiceBalance, safeCheckoutUrl } from '../lambda/payments/checkout';

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
});
