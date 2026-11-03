/**
 * 全站联系方式口径（用户口径）：
 * - **不同环节都能找到对应人**：每个业务环节的单据都随单保存「发起方（企业当事人）」
 *   与「执行方（承办职员，未指派时回退服务商备案人）」两组联系方式；
 * - **系统自动带出**：联系方式由后端按对应人档案自动解析写入，不是一张单子填一次；
 * - **临时作业换人了可以改**：入参显式给出的联系方式逐字段覆盖自动带出值。
 *
 * 列名约定（全站统一）：
 * - `contact_name` / `contact_phone`：企业/发起方联系人；
 * - `provider_contact_name` / `provider_contact_phone`：服务商/执行方联系人。
 */
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
export interface ContactPair {
  name: string;
  phone: string;
}
export const EMPTY_CONTACT: ContactPair = { name: '', phone: '' };
/** 单据落库的四个字段（两组联系方式），可直接传给 Prisma。 */
export interface StageContactData {
  contactName: string;
  contactPhone: string;
  providerContactName: string;
  providerContactPhone: string;
}
export function contactStr(value: unknown, fallback = ''): string {
  return value === undefined ? fallback : text(value).trim();
}
/**
 * 入参读联系方式：兼容 snake_case 与 camelCase。
 * side=contact 为企业/发起方；side=provider_contact 为服务商/执行方。
 */
export function readContact(
  body: Record<string, unknown> | undefined,
  side: 'contact' | 'provider_contact',
): ContactPair {
  const source = body || {};
  const [nameKey, phoneKey] =
    side === 'contact'
      ? ['contactName', 'contactPhone']
      : ['providerContactName', 'providerContactPhone'];
  return {
    name: contactStr(source[`${side}_name`] ?? source[nameKey]),
    phone: contactStr(source[`${side}_phone`] ?? source[phoneKey]),
  };
}
/** 覆盖规则：入参（换人后人工填写）逐字段优先，缺省回退系统自动带出值。 */
export function mergeContact(
  auto: ContactPair,
  manual: ContactPair,
): ContactPair {
  return {
    name: manual.name || auto.name,
    phone: manual.phone || auto.phone,
  };
}
/**
 * 改联系方式的**归属侧**（用户口径：企业只能改企业自己的，服务商只能改服务商自己的，
 * 职员只能改职员自己的）——即：企业当事人只改企业侧，服务商账号与承办职员只改执行侧；
 * 平台管理员不受限（两侧都可改）。创建/推进单据时的自动带出不受此限。
 */
export type ContactSide = 'contact' | 'provider_contact' | 'both';
export function contactSideOf(input: {
  isAdmin: boolean;
  isEnterpriseParty: boolean;
}): ContactSide {
  if (input.isAdmin) return 'both';
  return input.isEnterpriseParty ? 'contact' : 'provider_contact';
}
/** 每一侧的四个键：[库列名·姓, 库列名·电话, Prisma 字段·姓, Prisma 字段·电话] */
const PAIR_KEYS: Record<
  'contact' | 'provider_contact',
  [string, string, string, string]
> = {
  contact: ['contact_name', 'contact_phone', 'contactName', 'contactPhone'],
  provider_contact: [
    'provider_contact_name',
    'provider_contact_phone',
    'providerContactName',
    'providerContactPhone',
  ],
};
function sideTouched(
  body: Record<string, unknown>,
  side: 'contact' | 'provider_contact',
) {
  const [snakeName, snakePhone, camelName, camelPhone] = PAIR_KEYS[side];
  return [snakeName, snakePhone, camelName, camelPhone].some(
    (key) => body[key] !== undefined,
  );
}
/**
 * 按归属侧收口「改联系方式」入参：
 * - 只接受本侧字段，夹带对方侧字段直接 400——否则会出现「提交成功但其实没改」的错觉；
 * - 本侧按入参逐字段覆盖，缺省字段回退单据已存值（有值时）或档案自动带出值；
 * - 对方侧只沿用单据已存值：保存本侧不得把对方临时换人的值改回档案解析值。
 *
 * stored 传单据原件（含 contactName/contactPhone/providerContactName/providerContactPhone）。
 * 平台管理员（side=both）两侧都可改，规则同上。
 */
export function sideContactBody(
  body: Record<string, unknown> | undefined,
  side: ContactSide,
  stored?: Record<string, unknown> | null,
): Record<string, unknown> {
  const source = body || {};
  if (side !== 'both') {
    const other = side === 'contact' ? 'provider_contact' : 'contact';
    if (sideTouched(source, other)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        side === 'contact'
          ? '只能修改企业侧联系方式，执行侧由承办人维护'
          : '只能修改执行侧联系方式，企业侧由企业当事人维护',
      );
    }
  }
  const allowed: Array<'contact' | 'provider_contact'> =
    side === 'both' ? ['contact', 'provider_contact'] : [side];
  const out: Record<string, unknown> = {};
  for (const key of ['contact', 'provider_contact'] as const) {
    const [snakeName, snakePhone, camelName, camelPhone] = PAIR_KEYS[key];
    const editable = allowed.includes(key);
    const name = editable
      ? (source[snakeName] ?? source[camelName])
      : undefined;
    const phone = editable
      ? (source[snakePhone] ?? source[camelPhone])
      : undefined;
    if (name !== undefined) out[camelName] = name;
    else if (stored && contactStr(stored[camelName]))
      out[camelName] = stored[camelName];
    if (phone !== undefined) out[camelPhone] = phone;
    else if (stored && contactStr(stored[camelPhone]))
      out[camelPhone] = stored[camelPhone];
  }
  return out;
}
/** 两组联系方式合并为落库字段。 */
export function contactSnapshot(
  auto: {
    contact: ContactPair;
    providerContact: ContactPair;
  },
  body?: Record<string, unknown>,
): StageContactData {
  const contact = mergeContact(auto.contact, readContact(body, 'contact'));
  const providerContact = mergeContact(
    auto.providerContact,
    readContact(body, 'provider_contact'),
  );
  return {
    contactName: contact.name,
    contactPhone: contact.phone,
    providerContactName: providerContact.name,
    providerContactPhone: providerContact.phone,
  };
}
