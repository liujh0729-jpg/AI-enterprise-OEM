/**
 * 机构级动作判定（与后端 requireRoles(user,'SERVICE_PROVIDER') 同口径）：
 * 回复公开池需求 / 登记资源 / 指定业务人员等由**服务商账号本人**操作，已挂靠的职员不代替。
 */
export function isProviderAccount(me: { roles?: string[] } | null) {
  return (me?.roles || []).includes("SERVICE_PROVIDER");
}

/**
 * 承办判定（与后端 identity.canWorkOn 同口径）：签约主体是服务商，具体作业由承办人完成。
 * - 平台管理员：可操作；
 * - 服务商账号：本人名下且尚未指派承办人（或指派给本人）的单据；
 * - 承办职员：`staffUserId = 本人` 且仍被该服务商绑定（ACTIVE）。
 */
export function canWorkOn(
  me: { userId?: string; staffOf?: unknown[] } | null,
  row: { providerUserId?: string; staffUserId?: string },
  isAdmin = false,
) {
  if (isAdmin) return true;
  const myId = me?.userId || "";
  if (!myId) return false;
  const providerUserId = String(row.providerUserId || "");
  const staffUserId = String(row.staffUserId || "");
  if (providerUserId && providerUserId === myId) {
    return !staffUserId || staffUserId === myId;
  }
  if (staffUserId === myId) {
    return (me?.staffOf || []).some((bind) => {
      const item = bind as { providerUserId?: string; status?: string };
      return (
        item.providerUserId === providerUserId && item.status === "ACTIVE"
      );
    });
  }
  return false;
}
