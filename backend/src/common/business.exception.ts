import type { ErrorCodeValue } from './error-code';

export class BusinessException extends Error {
  readonly errorCode: ErrorCodeValue;
  readonly data: unknown;

  constructor(
    errorCode: ErrorCodeValue,
    message?: string,
    data: unknown = null,
  ) {
    super(message || errorCode.message);
    this.errorCode = errorCode;
    this.data = data;
  }

  getStatus() {
    return this.errorCode.httpStatus;
  }
}
