import { z } from '@enterprise/contracts';

/** Output contract failures are server errors, separate from request validation. */
export class ResponseContractError extends Error {
  constructor(detail?: string) {
    super(detail ? `响应不符合接口契约：${detail}` : '响应不符合接口契约');
    this.name = 'ResponseContractError';
  }
}

export function serializeResponse<T extends z.ZodType>(
  schema: T,
  value: unknown,
): z.output<T> {
  const parsed = schema.safeParse(JSON.parse(JSON.stringify(value)));
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 6)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new ResponseContractError(detail);
  }
  return parsed.data;
}
