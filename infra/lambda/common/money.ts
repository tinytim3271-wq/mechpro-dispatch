export function roundCurrency(value: number) {
  const tolerance = Math.sign(value) * 1e-9;
  return Math.round((value + tolerance) * 100) / 100;
}
