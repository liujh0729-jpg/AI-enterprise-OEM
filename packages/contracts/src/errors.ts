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
  /** §5.10 菜单/功能开关：关闭即拦——菜单隐藏、直链与 MCP 同路径请求一律 403 回此码。 */
  FEATURE_CLOSED: {
    code: 26001,
    message: "该功能已由平台关闭，暂不可用",
    httpStatus: 403,
  },
  /** §5.9 技能包安全审查：未达「绝对安全」门（pending/rejected/needsAdmin）的包被调用时返回。 */
  SKILL_NOT_PASSED: {
    code: 26002,
    message: "技能包未通过安全审查，不可调用",
    httpStatus: 403,
  },
  /** 上传四组确定性门禁未通过：拒绝入库，message 带命中组与证据。 */
  SKILL_SECURITY_REJECTED: {
    code: 26003,
    message: "技能包未通过上传安全检查",
    httpStatus: 400,
  },
  /** 技能声明了权限，启用/首次调用前必须由用户确认。 */
  SKILL_PERMISSIONS_UNCONFIRMED: {
    code: 26004,
    message: "技能声明了权限，需先确认后再启用",
    httpStatus: 403,
  },
  /** 运行期行为基线/输出兜底熔断。 */
  AGENT_SECURITY_BLOCKED: {
    code: 26005,
    message: "本次运行已被安全护栏中止",
    httpStatus: 403,
  },
  /** 发布审核命中违规 / 疑似违规：按平台配置的阿里云内容安全结果阻断本次发布。 */
  CONTENT_MODERATION_BLOCKED: {
    code: 26006,
    message: "内容未通过安全审核",
    httpStatus: 400,
  },
  NOT_IMPLEMENTED: {
    code: 501,
    message: "not implemented",
    httpStatus: 501,
  },
} as const;
export type ErrorCodeName = keyof typeof ErrorCode;
export type ErrorCodeValue = (typeof ErrorCode)[ErrorCodeName];
