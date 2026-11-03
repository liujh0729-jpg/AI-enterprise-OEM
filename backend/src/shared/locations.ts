import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
/**
 * 所在省、市（2026-09-25 用户指令）：**三类主体**（用户 / 服务商 / 职员·代理人）与
 * **三类资源库**（律师·律所 / 知产机构·代理人 / 灵工机构·个人，规则 61）共用同一份口径与同一组助手：
 * - **申请 / 登记时就要选好**：提交认证、备案、个人资料、资源库登记必须带省、市，服务端强制非空；
 * - **名录与资源库按省市筛选**：`providerDirectory()` 与三库列表用同一对字段精确过滤；
 * - **未填省市的行不匹配任何筛选值**（存量靠 `scripts/align-*-locations.mjs` 显式对齐，不静默回填），界面显示「所在地待补充」；
 * - 选项来自平台省市字典 `GET /enterprise/connections/resources/locations`：凭证走 **平台级 AIPDD Key**
 *   （未配置时回落本人绑定的 Key），两者都没有或上游通道已关闭时回落本地内置省市字典
 *   （`shared/region-dictionary.ts`），因此服务端只校验非空与长度，不校验是否命中字典（字典会变，字典值原样入库）。
 */
export type Location = {
  province: string;
  city: string;
};
/** 名录筛选条件：任一为空即不参与过滤。 */
export type LocationFilter = {
  province?: string;
  city?: string;
};
/** 列宽 VARCHAR(48)，与地域范围三模式的省市裁剪一致。 */
function clip(value: string) {
  return value.slice(0, 48);
}
/** 新增 / 提交：省、市必填。 */
export function requireLocation(body: Record<string, unknown>): Location {
  const province = clip(text(body.province).trim());
  const city = clip(text(body.city).trim());
  if (!province || !city) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '请先选择所在省份与城市（提交时必填）',
    );
  }
  return { province, city };
}
/** 修改：未传省市即保持原值；传了则两者都必须非空。 */
export function resolveLocation(
  body: Record<string, unknown>,
  current: Location,
): Location {
  if (body.province === undefined && body.city === undefined) return current;
  return requireLocation(body);
}
