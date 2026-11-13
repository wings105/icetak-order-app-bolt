export type CodPresentation = {
  isCod: boolean | null;
  inconsistent: boolean;
  paymentMethod: string | null;
};

type CodInput = {
  cod?: unknown;
  paymentMethod?: unknown;
  payment_method?: unknown;
  metadata?: Record<string, unknown> | null;
};

function normalized(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : '';
}

function explicitCod(input: CodInput): boolean | null {
  if (typeof input.cod === 'boolean') return input.cod;
  if (typeof input.metadata?.cod === 'boolean') return input.metadata.cod;
  return null;
}

export function codPresentation(input: CodInput): CodPresentation {
  const explicit = explicitCod(input);
  const paymentMethod = typeof input.paymentMethod === 'string'
    ? input.paymentMethod.trim()
    : typeof input.payment_method === 'string' ? input.payment_method.trim() : null;
  const method = normalized(paymentMethod);
  const methodIsCod = method === 'cod' || method === 'cash on delivery' || method === 'cash delivery';
  const inconsistent = explicit === false && methodIsCod;
  return {
    isCod: explicit === true || methodIsCod ? true : explicit === false ? false : null,
    inconsistent,
    paymentMethod,
  };
}
