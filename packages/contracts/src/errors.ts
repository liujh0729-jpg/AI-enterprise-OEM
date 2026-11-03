export const ErrorCode = {
  SUCCESS: { code: 0, message: "ok", httpStatus: 200 },
  BAD_REQUEST: { code: 400, message: "bad request", httpStatus: 400 },
  UNAUTHORIZED: { code: 401, message: "unauthorized", httpStatus: 401 },
  FORBIDDEN: { code: 403, message: "forbidden", httpStatus: 403 },
  NOT_FOUND: { code: 404, message: "not found", httpStatus: 404 },
  CONFLICT: { code: 409, message: "conflict", httpStatus: 409 },
  PAYLOAD_TOO_LARGE: {
    code: 413,
    message: "请求内容过大，请减少单次上传的文件数量后重试",
    httpStatus: 413,
  },
  VALIDATION_ERROR: {
    code: 422,
    message: "validation failed",
    httpStatus: 422,
  },
  RATE_LIMITED: {
    code: 429,
    message: "rate limited",
    httpStatus: 429,
  },
  INTERNAL_ERROR: {
    code: 500,
    message: "internal server error",
    httpStatus: 500,
  },
  SERVICE_UNAVAILABLE: {
    code: 503,
    message: "service unavailable",
    httpStatus: 503,
  },
  NO_ACTIVE_CONTRACT: {
    code: 20001,
    message: "no active contract",
    httpStatus: 403,
  },
  ROLE_MISMATCH: {
    code: 20002,
    message: "role mismatch",
    httpStatus: 403,
  },
  CONTRACT_STATE: {
    code: 20003,
    message: "invalid contract state",
    httpStatus: 409,
  },
  DECL_STATE: {
    code: 21001,
    message: "invalid declaration state",
    httpStatus: 409,
  },
  ORDER_STATE: {
    code: 23001,
    message: "invalid order state",
    httpStatus: 409,
  },
  AIWORKIN_UNAVAILABLE: {
    code: 24001,
    message: "aiworkin channel unavailable",
    httpStatus: 503,
  },
  AIWORKIN_AUTH_FAILED: {
    code: 24002,
    message: "aiworkin upstream authentication failed",
    httpStatus: 502,
  },
  POINTS_INSUFFICIENT: {
    code: 25001,
    message: "积分余额不足，请先充值",
    httpStatus: 403,
  },
  POINTS_ARREARS: {
    code: 25002,
    message: "账户欠费中，该操作已被暂停",
    httpStatus: 403,
  },
  NOT_IMPLEMENTED: {
    code: 501,
    message: "not implemented",
    httpStatus: 501,
  },
} as const;
export type ErrorCodeName = keyof typeof ErrorCode;
export type ErrorCodeValue = (typeof ErrorCode)[ErrorCodeName];
