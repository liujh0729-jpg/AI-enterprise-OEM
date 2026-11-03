import type { EnterpriseMe } from "@/lib/session";

/**
 * 环节联系方式（全局口径）：
 * 系统按承办人/企业档案自动带出，企业侧 = 法定代表人/经营者/姓名 + 档案电话，
 * 执行侧 = 承办职员实名 + 电话（无职员时回退服务商备案联系人）。
 * 临时换人时可在各环节「改联系方式」处人工覆盖。
 */
export type StageContactFields = {
  contactName?: string | null;
  contactPhone?: string | null;
  providerContactName?: string | null;
  providerContactPhone?: string | null;
};

/** 接口回传可能是下划线列名（部分页面直读 Prisma 行，部分是接口字段）。 */
export function contactOf(
  row: Record<string, unknown> | null | undefined,
  key: "contact" | "provider_contact",
): { name: string; phone: string } {
  if (!row) return { name: "", phone: "" };
  const camel = key === "contact" ? "contactName" : "providerContactName";
  const snake = key === "contact" ? "contact_name" : "provider_contact_name";
  const phoneCamel = key === "contact" ? "contactPhone" : "providerContactPhone";
  const phoneSnake = key === "contact" ? "contact_phone" : "provider_contact_phone";
  return {
    name: String(row[camel] ?? row[snake] ?? "").trim(),
    phone: String(row[phoneCamel] ?? row[phoneSnake] ?? "").trim(),
  };
}

/** 联系方式文案：联系人 · 电话（缺失时回退占位）。 */
export function contactText(
  name?: string | null,
  phone?: string | null,
  fallback = "—",
): string {
  const parts = [String(name || "").trim(), String(phone || "").trim()].filter(
    Boolean,
  );
  return parts.length ? parts.join(" · ") : fallback;
}

/** 企业侧联系方式文案（自动带出后人工可改，缺失时回退占位）。 */
export function stageEnterpriseContact(
  row: Record<string, unknown> | null | undefined,
  fallback = "—",
): string {
  const pair = contactOf(row, "contact");
  return contactText(pair.name, pair.phone, fallback);
}

/** 执行侧联系方式文案（承办人/承办职员；未指派时回退占位）。 */
export function stageProviderContact(
  row: Record<string, unknown> | null | undefined,
  fallback = "—",
): string {
  const pair = contactOf(row, "provider_contact");
  return contactText(pair.name, pair.phone, fallback);
}

/** 下单/预约表单预填：企业侧联系人（法定代表人/经营者/姓名 + 档案联系电话）。 */
export function enterpriseContactDefaults(me: EnterpriseMe | null) {
  const enterprise = (me?.enterprise || {}) as Record<string, unknown>;
  return {
    name: String(enterprise.legalPerson || enterprise.name || ""),
    phone: String(enterprise.phone || ""),
  };
}

/** 报价表单预填：服务商侧联系人（承办职员档案优先，其次服务商备案联系人）。 */
export function providerContactDefaults(me: EnterpriseMe | null) {
  const profile = (me?.staffProfile || null) as Record<string, unknown> | null;
  if (profile?.realName || profile?.phone) {
    return {
      name: String(profile.realName || ""),
      phone: String(profile.phone || ""),
    };
  }
  const app = ((me?.providerApps || [])[0] || null) as Record<
    string,
    unknown
  > | null;
  return {
    name: String(app?.contactName || ""),
    phone: String(app?.contactPhone || ""),
  };
}
