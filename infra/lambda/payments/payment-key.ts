export function paymentGsiSortKey(invoiceNumber: unknown, sortTimestamp: unknown, id: unknown): string {
  const normalizedInvoiceNumber = String(invoiceNumber || '').trim();
  const normalizedTimestamp = String(sortTimestamp || '').trim();
  const normalizedId = String(id || '').trim();
  return normalizedInvoiceNumber
    ? `${normalizedInvoiceNumber}#${normalizedTimestamp || normalizedId}#${normalizedId}`
    : `${normalizedTimestamp || normalizedId}#${normalizedId}`;
}
