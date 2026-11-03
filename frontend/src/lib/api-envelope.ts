import type { ApiResponse } from '@enterprise/contracts';
export type { ApiResponse } from '@enterprise/contracts';

export function createApiEnvelope<T>(
  code: number,
  message: string,
  data: T | null,
): ApiResponse<T> {
  return { code, message, data };
}

export function isApiSuccessCode(code: number) {
  return code === 0;
}
