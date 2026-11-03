/**
 * 存量单据联系方式回填（一次性维护脚本）：
 * 按 backend/src/shared/contacts.ts 的口径，为历史单据补齐「企业侧 + 执行侧」联系方式。
 * 企业侧 ← 企业档案（法定代表人或名称 + 档案电话）；
 * 执行侧 ← 承办职员档案（实名 + 手机）→ 回退服务商备案联系人。
 * 用法：node scripts/backfill-stage-contacts.mjs [--dry]
 */
import { createPrisma } from "./harness.mjs";

const dry = process.argv.includes("--dry");
const prisma = createPrisma();

const TABLES = [
  { table: "contracts", enterprise: "enterprise_id" },
  { table: "logistics_orders", enterprise: "enterprise_id" },
  { table: "marketing_orders", enterprise: "enterprise_id" },
  { table: "overseas_claims", enterprise: "enterprise_id" },
  { table: "legal_requests", enterprise: "enterprise_id" },
  { table: "ip_requests", enterprise: "enterprise_id" },
  { table: "flex_onboardings", enterprise: "enterprise_id" },
  { table: "flex_work_orders", enterprise: "enterprise_id" },
  { table: "flex_payrolls", enterprise: "enterprise_id" },
  { table: "tax_declarations", enterprise: "enterprise_id" },
  { table: "tax_material_packs", enterprise: "enterprise_id" },
  { table: "invoice_requests", enterprise: "enterprise_id" },
];

const columnsOf = async (table) => {
  const rows = await prisma.$queryRaw`
    SELECT column_name AS name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
  `;
  return new Set(rows.map((row) => row.name));
};

const enterpriseContact = async (enterpriseId, cache) => {
  if (!enterpriseId) return { name: "", phone: "" };
  if (cache.has(enterpriseId)) return cache.get(enterpriseId);
  const row = await prisma.enterpriseProfile.findUnique({
    where: { id: Number(enterpriseId) },
  });
  const pair = row
    ? {
        name: String(row.legalPerson || "").trim() || String(row.name || "").trim(),
        phone: String(row.phone || "").trim(),
      }
    : { name: "", phone: "" };
  cache.set(enterpriseId, pair);
  return pair;
};

const providerContact = async (staffUserId, providerUserId, cache) => {
  const key = `${staffUserId}|${providerUserId}`;
  if (cache.has(key)) return cache.get(key);
  let pair = { name: "", phone: "" };
  if (staffUserId) {
    const profile = await prisma.staffProfile.findUnique({
      where: { userId: String(staffUserId) },
    });
    pair = {
      name: String(profile?.realName || "").trim(),
      phone: String(profile?.phone || "").trim(),
    };
  }
  if ((!pair.name && !pair.phone) && providerUserId) {
    const app =
      (await prisma.providerApplication.findFirst({
        where: { userId: String(providerUserId), status: "APPROVED" },
        orderBy: { id: "desc" },
      })) ||
      (await prisma.providerApplication.findFirst({
        where: { userId: String(providerUserId) },
        orderBy: { id: "desc" },
      }));
    if (app) {
      pair = {
        name: String(app.contactName || "").trim() || String(app.orgName || "").trim(),
        phone: String(app.contactPhone || "").trim(),
      };
    }
  }
  cache.set(key, pair);
  return pair;
};

let totalUpdated = 0;
const epCache = new Map();
const pvCache = new Map();

for (const item of TABLES) {
  const cols = await columnsOf(item.table);
  if (!cols.has("contact_name") || !cols.has("provider_contact_name")) continue;
  const hasStaff = cols.has("staff_user_id");
  const hasProvider = cols.has("provider_user_id");
  const table = `"${item.table}"`;
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id, enterprise_id, ${hasStaff ? "staff_user_id" : "'' AS staff_user_id"}, ${hasProvider ? "provider_user_id" : "'' AS provider_user_id"},
            contact_name, contact_phone, provider_contact_name, provider_contact_phone
       FROM ${table}
      WHERE contact_name = '' OR provider_contact_name = ''`,
  );
  let updated = 0;
  for (const row of rows) {
    const ep = await enterpriseContact(row.enterprise_id, epCache);
    const pv = await providerContact(row.staff_user_id, row.provider_user_id, pvCache);
    const contactName = row.contact_name || ep.name;
    const contactPhone = row.contact_phone || ep.phone;
    const providerContactName = row.provider_contact_name || pv.name;
    const providerContactPhone = row.provider_contact_phone || pv.phone;
    if (
      contactName === row.contact_name &&
      contactPhone === row.contact_phone &&
      providerContactName === row.provider_contact_name &&
      providerContactPhone === row.provider_contact_phone
    ) {
      continue;
    }
    if (!dry) {
      await prisma.$executeRawUnsafe(
        `UPDATE ${table}
            SET contact_name = $1,
                contact_phone = $2,
                provider_contact_name = $3,
                provider_contact_phone = $4
          WHERE id = $5`,
        contactName, contactPhone, providerContactName, providerContactPhone, Number(row.id),
      );
    }
    updated++;
  }
  totalUpdated += updated;
  console.log(
    `${item.table.padEnd(22)} 待回填 ${String(rows.length).padStart(3)} 条 → 已${dry ? "演练" : "更新"} ${updated} 条`,
  );
}

console.log(`\n合计 ${dry ? "待更新" : "已更新"} ${totalUpdated} 条`);
await prisma.$disconnect();
