"use client";

import { BankOutlined, InboxOutlined, UserOutlined } from "@ant-design/icons";
import { App, Button, Form, Input, Modal, Select, Table } from "antd";
import { useEffect, useState } from "react";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { LocationFields } from "@/components/location-fields";
import { EmptyState, Notice } from "@/components/ui/panel";
import { StatusBadge } from "@/components/status-badge";
import { useProviderApplication, useIdentityActions } from "@/query/identity";
import { type EndpointResponse } from "@enterprise/contracts";
import { uploadAttachments } from "@/lib/upload-attachments";
import { identityApi } from '@/api/identity';
import {
  ASSET_SUB_ITEMS,
  LOGISTICS_SUB_ITEMS,
  MARKETING_SUB_ITEMS,
  OVERSEAS_SUB_ITEMS,
  SMART_SUB_ITEMS,
  SUBITEM_LABELS,
} from "@/lib/provider-categories";

type Attachment = import('@enterprise/contracts').z.infer<typeof import('@enterprise/contracts').attachmentSchema>;

type ProviderApplication = NonNullable<EndpointResponse<"Identity_providerApplication">["data"]>["items"][number];

/** 服务商备案可申请的服务类型（对齐 demo 的可选项文案）。 */
const PROVIDER_TYPES: [string, string][] = [
  ["TAX_FINANCE", "企业财税服务（代理记账/申报/汇算清缴）"],
  ["EXPORT_REFUND", "跨境出海服务（出口退税/海外注册/结算/合规等）"],
  [
    "LOGISTICS",
    "物流服务商（境内陆运 / 跨境货代 / 仓储，须勾选承接细项；直营或由职员承办）",
  ],
  [
    "SMART_SERVICE",
    "IT服务服务商（AI实施 / 软件开发 / 算力服务 / 硬件服务 / 数据服务，须勾选承接细项）",
  ],
  ["LEGAL_SERVICE", "法律服务（法律顾问/合同审查/纠纷应对）"],
  ["IP_SERVICE", "知识产权服务（商标/专利/著作权/软著）"],
  [
    "THINK_TANK_SERVICE",
    "智库服务商（战略/管理/技术/财务等咨询机构，机构资源库展示与签约承接）",
  ],
  ["FLEX_WORK", "灵活用工服务（招聘/劳务派遣/外包/众包）"],
  [
    "SUPPLY_NETWORK",
    "供销网络服务（服务站供货与线下服务预约，直营或由职员承办）",
  ],
  [
    "MARKETING",
    "营销服务商（达人探店/直播带货/内容营销/GEO优化/精准营销/私域营销，须勾选承接细项）",
  ],
  [
    "ASSET_TRADE",
    "资产交易（资产租售与居间服务：房产销售/租赁、保险、投资理财、不良资产、汽车交易，须勾选承接细项）",
  ],
];

/** 细项选项（与名录分区共用一份定义：code + 中文名）。 */
const toItems = (
  list: readonly { type: string; name: string }[],
): [string, string][] =>
  list.map((item): [string, string] => [item.type, item.name]);

/** 出海服务细项（跨境出海服务商 6 个细分类，可多选）。 */
const OVERSEAS_ITEMS = toItems(OVERSEAS_SUB_ITEMS);

/**
 * 带细项的备案类目：分组标题 + 细项选项 + 说明文案。
 * 细项不落独立备案行，记在所属行的 serviceItems 上（与后端 constants.ts 同源）。
 */
const BEARING_CATEGORIES: Record<
  string,
  { label: string; items: [string, string][]; extra: string }
> = {
  EXPORT_REFUND: {
    label: "出海服务细项",
    items: OVERSEAS_ITEMS,
    extra: "跨境出海服务商按 6 个细分类分区展示服务商，只有备案（审核通过）了该细项的服务商才会出现在对应分区、并可被该子功能签约；6 个细分类分别独立签约。请精确勾选本机构可承接的细项（未勾选的子功能不会出现你的卡片）",
  },
  MARKETING: {
    label: "营销服务细项",
    items: toItems(MARKETING_SUB_ITEMS),
    extra: "营销服务商按 6 个细分类分区展示服务商，只有备案（审核通过）了该细项的服务商才会出现在对应分区、并可被该细项签约；6 个细分类分别独立签约。请精确勾选本机构可承接的细项（未勾选的细项不会出现你的卡片）",
  },
  LOGISTICS: {
    label: "物流服务细项",
    items: toItems(LOGISTICS_SUB_ITEMS),
    extra: "物流服务商按「境内陆运 / 跨境货代 / 仓储」三个细项分区展示，只有备案（审核通过）了该细项的服务商才会出现在对应分区、并可被该细项签约；三个细项分别独立签约、同一企业同一细项不限服务商。请精确勾选本机构可承接的细项（未勾选的细项不会出现你的卡片）",
  },
  SMART_SERVICE: {
    label: "IT服务细项",
    items: toItems(SMART_SUB_ITEMS),
    extra: "IT服务服务商按「AI实施 / 软件开发 / 算力服务 / 硬件服务 / 数据服务」五个细项分区展示，只有备案（审核通过）了该细项的服务商才会出现在对应分区、并可被该细项签约；五个细项分别独立签约、同一企业同一细项不限服务商。请精确勾选本机构可承接的细项（未勾选的细项不会出现你的卡片）",
  },
  MICRO: {
    label: "物流服务细项（小微直营）",
    items: toItems(LOGISTICS_SUB_ITEMS),
    extra: "小微服务商＝个人主体直营，同样按「境内陆运 / 跨境货代 / 仓储」勾选可承接细项：审核通过的细项决定你在物流名录哪个分区展示、可被哪个细项签约",
  },
  ASSET_TRADE: {
    label: "资产交易细项",
    items: toItems(ASSET_SUB_ITEMS),
    extra: "资产服务商按 5 个细项分区展示（房产销售/租赁、保险、投资理财、不良资产、汽车交易），只有备案（审核通过）了该细项的服务商才会出现在对应分区、并可被该细项签约；5 个细项分别独立签约。请精确勾选本机构可承接的细项（未勾选的细项不会出现你的卡片）",
  },
};

/** 带细项类目 → 表单字段名（小微与物流共用一个字段：个人主体即小微服务商）。 */
const ITEM_FIELD: Record<string, string> = {
  EXPORT_REFUND: "service_items",
  MARKETING: "marketing_items",
  LOGISTICS: "logistics_items",
  SMART_SERVICE: "smart_items",
  MICRO: "logistics_items",
  ASSET_TRADE: "asset_items",
};

/** 表单字段 → 承载备案类目（物流细项一行字段对应 LOGISTICS / MICRO 两行，回填取并集）。 */
const FIELD_BEARING_TYPES: Record<string, string[]> = {};
for (const [type, field] of Object.entries(ITEM_FIELD)) {
  (FIELD_BEARING_TYPES[field] ||= []).push(type);
}

/** 多类目细项提交：按备案类目分组传（同时勾多个带细项类目时后端按 key 分发）。 */
function groupServiceItems(picked: string[], perField: Record<string, string[]>) {
  const out: Record<string, string[]> = {};
  for (const type of picked) {
    if (BEARING_CATEGORIES[type])
      out[type] = perField[ITEM_FIELD[type]] || [];
  }
  return out;
}

/** 本次要渲染的细项分组（同一字段只渲染一次：小微与物流共用「物流细项」）。 */
function bearingGroupsOf(picked: string[]) {
  const seen = new Set<string>();
  const out: { type: string; field: string; spec: (typeof BEARING_CATEGORIES)[string] }[] =
    [];
  for (const type of picked) {
    const spec = BEARING_CATEGORIES[type];
    if (!spec) continue;
    const field = ITEM_FIELD[type];
    if (seen.has(field)) continue;
    seen.add(field);
    out.push({ type, field, spec });
  }
  return out;
}

const PROVIDER_TYPE_LABEL: Record<string, string> = {
  ...SUBITEM_LABELS,
  TAX_FINANCE: "企业财税服务",
  MICRO: "小微服务商",
  LOGISTICS: "物流服务",
  SMART_SERVICE: "IT服务",
  EXPORT_REFUND: "跨境出海服务",
  LEGAL_SERVICE: "法律服务",
  IP_SERVICE: "知识产权服务",
  FLEX_WORK: "灵活用工服务",
  SUPPLY_NETWORK: "供销服务",
  MARKETING: "营销服务",
  ASSET_TRADE: "资产交易",
};

const PROVIDER_TYPE_VARIANT: Record<string, string> = {
  TAX_FINANCE: "blue",
  MICRO: "green",
  LOGISTICS: "orange",
  SMART_SERVICE: "violet",
  EXPORT_REFUND: "sky",
  LEGAL_SERVICE: "green",
  FLEX_WORK: "orange",
  SUPPLY_NETWORK: "blue",
  MARKETING: "violet",
  ASSET_TRADE: "sky",
};

function providerTypeBadge(type: string) {
  return (
    <span
      className={`badge badge-${PROVIDER_TYPE_VARIANT[type] || "sky"}`}
    >
      {PROVIDER_TYPE_LABEL[type] || type}
    </span>
  );
}

function fmtSize(size: number) {
  if (!size) return "";
  return size >= 1048576
    ? `${(size / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`;
}

const SUBJECT_OPTIONS = [
  {
    value: "COMPANY",
    label: <><BankOutlined aria-hidden /> 公司主体（机构名称 + 统一社会信用代码）</>,
  },
  {
    value: "PERSONAL",
    label: <><UserOutlined aria-hidden /> 个人主体（小微服务商：本人即唯一职员，姓名 + 身份证号）</>,
  },
];

/** 服务商备案申请（顶部已提交资质台账 + 可多选服务类型的备案表单）。 */
export function ProviderApplicationPanel({ onSaved }: { onSaved: () => void }) {
  const { message } = App.useApp();
  const { request: requestPassword, modal: passwordModal } = usePasswordConfirm();
  const [form] = Form.useForm();
  const profileQuery = useProviderApplication();
  const actions = useIdentityActions();
  const data = profileQuery.data;
  const load = async () => { await profileQuery.refetch(); };
  const [files, setFiles] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const submitting = actions.submitProvider.isPending;
  const [types, setTypes] = useState<string[]>([]);
  const [editing, setEditing] = useState<ProviderApplication | null>(null);
  const [editForm] = Form.useForm();
  const [editFiles, setEditFiles] = useState<Attachment[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const subjectType = Form.useWatch("subject_type", form) || "COMPANY";
  const personal = subjectType === "PERSONAL";
  /** 服务商类型由「主体类型」决定：个人主体＝小微服务商（本人即唯一职员）；公司主体＝普通服务商（业务由职员承办） */
  const kindLabel = personal
    ? "小微服务商"
    : types.length
      ? "服务商（普通）"
      : "未选择";
  const kindHint = personal
    ? "小微服务商：本人即唯一职员 —— 物流等直营工单自动派给你本人，无需绑定/指派职员。"
    : types.length
      ? "普通服务商：业务由你指派的职员承办 —— 备案通过后需先在「职员/代理人管理」添加职员，并把企业分配给主办职员，工单未指派不可推进。"
      : "先勾选「服务类型」，再选择「主体类型」：公司主体＝普通服务商，个人主体＝小微服务商。";

  useEffect(() => {
    if(!profileQuery.isSuccess) return;
    const latest = profileQuery.data;
    const items = latest?.items || [];
    /** 细项预填只认已登记的 code（存量自由文本不回填，避免表单里出现非法选项）。 */
    const prefillOf = (bearingTypes: string[]) => {
      const allowed = (
        BEARING_CATEGORIES[bearingTypes[0]]?.items || []
      ).map(([code]) => code);
      const picked: string[] = [];
      for (const type of bearingTypes) {
        const row = items.find((item) => item.providerType === type);
        for (const key of String(row?.serviceItems || "")
          .split(",")
          .map((item) => item.trim())) {
          if (allowed.includes(key) && !picked.includes(key)) picked.push(key);
        }
      }
      return picked;
    };
    const prefillItems: Record<string, string[]> = {};
    for (const [field, bearingTypes] of Object.entries(FIELD_BEARING_TYPES)) {
      prefillItems[field] = prefillOf(bearingTypes);
    }
    setFiles((latest?.attachments || []).slice(0, 10));
    form.setFieldsValue({
      provider_types: [],
      ...prefillItems,
      subject_type:
        latest?.subjectType === "PERSONAL" ? "PERSONAL" : "COMPANY",
      org_name: latest?.orgName || "",
      uscc:
        latest?.subjectType === "PERSONAL"
          ? latest?.idCard || ""
          : latest?.uscc || "",
      qualification: latest?.qualification || "",
      contact_name: latest?.contactName || "",
      contact_phone: latest?.contactPhone || "",
      contact_email: latest?.contactEmail || "",
      intro: latest?.intro || "",
    });
  }, [form, profileQuery.data, profileQuery.isSuccess]);

  const items = data?.items || [];
  const owned = new Map(items.map((item) => [item.providerType, item]));
  const selectable = PROVIDER_TYPES.filter(([type]) => {
    const last = owned.get(type);
    return !last || !["PENDING", "APPROVED"].includes(last.status);
  });

  const uploadFiles = async (
    picked: File[],
    current: number,
    onUploaded: (files: Attachment[]) => void,
  ) => {
    const remain = 10 - current;
    if (remain <= 0) {
      message.warning("资质附件最多 10 个");
      return;
    }
    const batch = picked.slice(0, remain);
    if (picked.length > remain) {
      message.warning(`资质附件最多 10 个，本次仅上传 ${remain} 个`);
    }
    setUploading(true);
    try {
      const count = await uploadAttachments(
        identityApi.upload,
        batch,
        onUploaded,
      );
      if (count) message.success(`已上传 ${count} 个资质附件`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "文件上传失败");
    } finally {
      setUploading(false);
    }
  };

  const registerFiles = async (picked: File[]) => {
    await uploadFiles(picked, files.length, (uploaded) => {
      setFiles((current) => [...current, ...uploaded]);
    });
  };

  const registerEditFiles = async (picked: File[]) => {
    await uploadFiles(picked, editFiles.length, (uploaded) => {
      setEditFiles((current) => [...current, ...uploaded]);
    });
  };

  /** 修改备案：联系方式 / 简介 / 附件直接生效；主体信息变更将重置为待复审。 */
  const openEdit = (row: ProviderApplication) => {
    setEditing(row);
    setEditFiles((row.attachments || []).slice(0, 10));
    editForm.setFieldsValue({
      org_name: row.orgName || "",
      id_or_uscc: row.subjectType === "PERSONAL" ? row.idCard || "" : row.uscc || "",
      qualification: row.qualification || "",
      province: row.province || "",
      city: row.city || "",
      contact_name: row.contactName || "",
      contact_phone: row.contactPhone || "",
      contact_email: row.contactEmail || "",
      intro: row.intro || "",
      service_items: String(row.serviceItems || "")
        .split(",")
        .map((key) => key.trim())
        .filter((key) =>
          (BEARING_CATEGORIES[row.providerType]?.items || []).some(
            ([code]) => code === key,
          ),
        ),
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    const values = await editForm.validateFields();
    const isPersonal = editing.subjectType === "PERSONAL";
    const idOrUscc = String(values.id_or_uscc || "").trim();
    if (isPersonal && !/^\d{17}[\dXx]$/.test(idOrUscc)) {
      message.warning("身份证号格式不正确（18 位，末位可为 X）");
      return;
    }
    if (!isPersonal && !idOrUscc) {
      message.warning("统一社会信用代码必填");
      return;
    }
    const body: Record<string, unknown> = {
      org_name: String(values.org_name || "").trim(),
      uscc: isPersonal ? "" : idOrUscc,
      id_card: isPersonal ? idOrUscc : "",
      qualification: String(values.qualification || "").trim(),
      province: String(values.province || "").trim(),
      city: String(values.city || "").trim(),
      contact_name: String(values.contact_name || "").trim(),
      contact_phone: String(values.contact_phone || "").trim(),
      contact_email: String(values.contact_email || "").trim(),
      intro: String(values.intro || "").trim(),
      attachments: editFiles,
    };
    if (BEARING_CATEGORIES[editing.providerType]) {
      body.service_items = (values.service_items || []) as string[];
    }
    setEditSaving(true);
    try {
      requestPassword({
        title: "修改备案（需密码）",
        content: `确认修改「${editing.orgName}」的备案？若变更机构名称 / 证件号 / 服务细项，备案将重置为待平台复审。`,
        okText: "保存修改",
        onOk: async () => {
          await actions.updateProvider.mutateAsync({id:editing.id,body});
          message.success("备案已更新");
          setEditing(null);
          onSaved();
        },
      });
    } finally {
      setEditSaving(false);
    }
  };

  const removeApplication = (row: ProviderApplication) => {
    requestPassword({
      title: "删除备案",
      danger: true,
      okText: "确认删除",
      content: `确定删除「${PROVIDER_TYPE_LABEL[row.providerType] || row.providerType}」的备案记录？${
        row.status === "APPROVED"
          ? "该类目如存在生效中签约则不可删除（请先解约）；删除后需重新提交备案。"
          : "删除后需重新提交备案。"
      }`,
      onOk: async () => {
        await actions.removeProvider.mutateAsync(row.id);
        message.success("备案已删除");
        onSaved();
      },
    });
  };

  if(profileQuery.isPending) return <Notice variant="info">资料加载中…</Notice>;
  if(profileQuery.isError) return <Notice variant="error">{profileQuery.error.message} <Button onClick={() => void load()}>重试</Button></Notice>;

  return (
    <>
      <div className="text-12 muted" style={{ fontWeight: 600, marginBottom: 8 }}>
        我的服务资质
      </div>
      <div className="table-wrap">
        <Table<ProviderApplication>
          rowKey="id"
          pagination={false}
          size="middle"
          dataSource={items}
          locale={{
            emptyText: <EmptyState icon={<InboxOutlined aria-hidden />} text="尚未提交备案申请。" />,
          }}
          columns={[
            {
              title: "服务类型",
              dataIndex: "providerType",
              render: (value: string, row: ProviderApplication) => (
                <div>
                  {providerTypeBadge(value)}
                  {String(row.serviceItems || "")
                    .split(",")
                    .filter(Boolean).length ? (
                    <div className="text-12 muted" style={{ marginTop: 4 }}>
                      {`承接细项：${String(row.serviceItems || "")
                        .split(",")
                        .filter(Boolean)
                        .map((key) => SUBITEM_LABELS[key] || key)
                        .join("、")}`}
                    </div>
                  ) : null}
                </div>
              ),
            },
            {
              title: "状态",
              dataIndex: "status",
              width: 100,
              render: (value: string) => <StatusBadge status={value} />,
            },
            {
              title: "机构名称",
              dataIndex: "orgName",
              render: (value: string, row: ProviderApplication) => (
                <span>
                  <span style={{ fontWeight: 600 }}>{value}</span>
                  {row.subjectType === "PERSONAL" ? (
                    <span
                      className="badge badge-gray"
                      style={{ marginLeft: 6 }}
                    >
                      个人主体
                    </span>
                  ) : null}
                </span>
              ),
            },
            {
              title: "联系方式",
              width: 190,
              render: (_: unknown, row: ProviderApplication) => (
                <div className="text-12">
                  <div>
                    {[row.contactName, row.contactPhone]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </div>
                  <div className="muted">{row.contactEmail || "—"}</div>
                </div>
              ),
            },
            {
              title: "审核时间",
              width: 150,
              render: (_: unknown, row: ProviderApplication) => (
                <span className="text-12 muted">
                  {String(row.auditedAt || row.createdAt || "").slice(0, 16)}
                </span>
              ),
            },
            {
              title: "审核意见",
              width: 150,
              render: (_: unknown, row: ProviderApplication) => (
                <span className="text-12 muted">
                  {row.auditNote ||
                    (["PENDING", "APPROVED"].includes(row.status)
                      ? "—"
                      : "可重新申请")}
                </span>
              ),
            },
            {
              title: "操作",
              width: 140,
              render: (_: unknown, row: ProviderApplication) =>
                ["PENDING", "APPROVED"].includes(row.status) ? (
                  <div style={{ display: "flex", gap: 6 }}>
                    <Button onClick={() => openEdit(row)}>
                      编辑
                    </Button>
                    <Button danger onClick={() => removeApplication(row)}>
                      删除
                    </Button>
                  </div>
                ) : (
                  <span className="text-12 muted">—</span>
                ),
            },
          ]}
        />
      </div>

      {selectable.length ? (
        <Notice variant={personal || types.length ? "info" : "warn"}>
          申请后将注册为：<b>{kindLabel}</b>
          <div className="text-12" style={{ marginTop: 4 }}>
            {kindHint}
          </div>
        </Notice>
      ) : null}

      {selectable.length ? (
        <Form
          form={form}
          layout="vertical"
          initialValues={{ subject_type: "COMPANY" }}
          style={{ marginTop: 16 }}
          onValuesChange={(changed) => {
            if (changed.provider_types) {
              setTypes(changed.provider_types as string[]);
            }
          }}
          onFinish={async (values) => {
            const isPersonal = values.subject_type === "PERSONAL";
            // 个人主体即小微服务商：备案落 MICRO（本人即唯一职员）；公司主体按所选服务类型备案
            const picked = isPersonal
              ? ["MICRO"]
              : ((values.provider_types || []) as string[]);
            const pickedItems: Record<string, string[]> = {};
            for (const field of Object.keys(FIELD_BEARING_TYPES)) {
              pickedItems[field] = (values[field] || []) as string[];
            }
            if (!picked.length) {
              message.warning("请至少勾选一项服务类型");
              return;
            }
            const serviceItems = groupServiceItems(picked, pickedItems);
            for (const type of picked) {
              const bearing = BEARING_CATEGORIES[type];
              if (bearing && !serviceItems[type]?.length) {
                message.warning(`请至少勾选一项${bearing.label}（可多选）`);
                return;
              }
            }
            const uscc = String(values.uscc || "").trim();
            if (!isPersonal && !uscc) {
              message.warning("统一社会信用代码必填");
              return;
            }
            if (isPersonal && !/^\d{17}[\dXx]$/.test(uscc)) {
              message.warning("身份证号格式不正确（18 位，末位可为 X）");
              return;
            }
            try {
              const result = await actions.submitProvider.mutateAsync({
                  provider_types: picked,
                  org_name: String(values.org_name || "").trim(),
                  uscc: isPersonal ? "" : uscc,
                  id_card: isPersonal ? uscc : "",
                  subject_type: isPersonal ? "PERSONAL" : "COMPANY",
                  province: String(values.province || "").trim(),
                  city: String(values.city || "").trim(),
                  qualification: String(values.qualification || "").trim(),
                  contact_name: String(values.contact_name || "").trim(),
                  contact_phone: String(values.contact_phone || "").trim(),
                  contact_email: String(values.contact_email || "").trim(),
                  intro: String(values.intro || "").trim(),
                  service_items: serviceItems,
                  attachments: files,
              });
              const submitted = result?.submitted || [];
              const skipped = (result?.skipped || []).length;
              message.success(
                `已提交 ${submitted.length} 项备案申请${
                  skipped ? `（${skipped} 项已存在被跳过）` : ""
                }，等待平台管理员审核`,
              );
              onSaved();
            } catch { /* 统一 Mutation Hook 已展示错误。 */ }
          }}
        >
          <div
            className="text-12 muted"
            style={{ fontWeight: 600, marginBottom: 8 }}
          >
            {items.length ? "申请其他服务类型（可多选）" : "选择服务类型（可多选）"}
          </div>
          <Form.Item
            name="provider_types"
            label="服务类型"
            rules={[{ required: true, message: "请至少选择一项服务类型" }]}
          >
            <Select
              mode="multiple"
              placeholder="可多选"
              options={selectable.map(([value, label]) => ({ value, label }))}
            />
          </Form.Item>

          {bearingGroupsOf(personal ? ["MICRO"] : types).map(
            ({ field, spec }) => (
              <Form.Item
                key={field}
                name={field}
                label={spec.label}
                rules={[
                  {
                    required: true,
                    message: `请至少勾选一项${spec.label}（可多选）`,
                  },
                ]}
                extra={spec.extra}
              >
                <Select
                  mode="multiple"
                  placeholder="可多选，精确到具体小分类"
                  options={spec.items.map(([value, label]) => ({
                    value,
                    label,
                  }))}
                />
              </Form.Item>
            ),
          )}

          <Form.Item
            name="subject_type"
            label="主体类型"
            rules={[{ required: true, message: "请选择主体类型" }]}
            extra="个人主体＝小微服务商（本人即唯一职员）：提交姓名与身份证号，免填统一社会信用代码"
          >
            <Select options={SUBJECT_OPTIONS} />
          </Form.Item>

          <div className="form-2col">
            <Form.Item
              name="org_name"
              label={personal ? "姓名" : "机构名称"}
              rules={[
                {
                  required: true,
                  message: personal ? "姓名必填" : "机构名称必填",
                },
              ]}
            >
              <Input
                placeholder={
                  personal
                    ? "个人姓名（对外展示）"
                    : "服务机构/公司全称（个人可填姓名）"
                }
              />
            </Form.Item>
            <Form.Item
              name="uscc"
              label={personal ? "身份证号" : "统一社会信用代码"}
              rules={[{ required: personal, message: "个人主体需填写身份证号" }]}
            >
              <Input
                placeholder={
                  personal
                    ? "18 位公民身份号码（末位可为 X）"
                    : "18 位代码（公司主体必填）"
                }
              />
            </Form.Item>
            <Form.Item name="qualification" label="资质材料说明">
              <Input
                placeholder={
                  personal
                    ? "身份证信息说明（如：身份证正反面扫描件，附件上传）"
                    : "如：代理记账许可证、专利代理机构执业许可证等"
                }
              />
            </Form.Item>
            <Form.Item
              name="contact_name"
              label="联系人"
              rules={[{ required: true, message: "联系人必填" }]}
            >
              <Input placeholder="姓名" />
            </Form.Item>
            <Form.Item
              name="contact_phone"
              label="联系电话"
              rules={[{ required: true, message: "联系电话必填" }]}
            >
              <Input placeholder="手机号" />
            </Form.Item>
            <Form.Item
              name="contact_email"
              label="联系邮箱"
              rules={[
                { required: true, message: "联系邮箱必填" },
                { type: "email", message: "联系邮箱格式不正确" },
              ]}
            >
              <Input placeholder="name@company.com（详情页对外展示）" />
            </Form.Item>
          </div>

          <LocationFields extra="所在省市为必填：企业与用户在名录按省市筛选服务商，你所在的地域决定展示分区与可承接范围" />

          <Form.Item
            name="intro"
            label="机构简介与优势"
            rules={[
              {
                required: true,
                message: "机构简介必填（将随服务商详情对外展示）",
              },
            ]}
          >
            <Input.TextArea
              rows={3}
              placeholder="介绍机构规模、服务能力、成功案例等"
            />
          </Form.Item>

          <Form.Item
            label="业务人员"
            extra="业务人员不再随备案填写：请在「职员 / 代理人管理」中发起添加（不限数量，对方确认后生效）；签约生效后再从名录中指定对接人。"
          >
            <div className="text-12 muted" style={{ padding: "8px 10px" }}>
              备案无需登记业务人员，前往「职员 / 代理人管理」添加即可。
            </div>
          </Form.Item>

          <Form.Item
            label="资质附件（最多 10 个，上传至 OSS）"
            extra="支持多选；默认上传到平台统一的 OSS 目录（单次与累计合计不超过 10 个）"
          >
            <input
              id="provider-application-files"
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
              style={{ display: "none" }}
              onChange={(event) => {
                const picked = Array.from(event.target.files || []);
                event.target.value = "";
                void registerFiles(picked);
              }}
            />
            <Button
              loading={uploading}
              onClick={() =>
                document
                  .getElementById("provider-application-files")
                  ?.click()
              }
            >
              ＋ 选择文件上传
            </Button>
            <div style={{ marginTop: 8 }}>
              {files.length ? (
                files.map((file, index) => (
                  <div
                    key={`${file.id || file.name}-${index}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "6px 0",
                    }}
                  >
                    <span className="text-12" style={{ flex: 1 }}>
                      {`${index + 1}. ${file.name}`}
                    </span>
                    <span className="text-12 muted">{fmtSize(file.size)}</span>
                    {file.url ? (
                      <a
                        className="text-12"
                        href={file.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        OSS 链接
                      </a>
                    ) : null}
                    <Button
                      onClick={() =>
                        setFiles((current) =>
                          current.filter((_, i) => i !== index),
                        )
                      }
                    >
                      删除
                    </Button>
                  </div>
                ))
              ) : (
                <div className="text-12 muted" style={{ padding: "8px 10px" }}>
                  尚未上传资质附件（如：代理记账许可证、营业执照、行业许可证等扫描件）
                </div>
              )}
            </div>
          </Form.Item>

          <Button type="primary" htmlType="submit" loading={submitting}>
            提交备案申请
          </Button>
        </Form>
      ) : (
        <div className="muted" style={{ marginTop: 16 }}>
          全部服务类型均已开通或正在审核中。如需变更信息，请在上方「我的服务资质」台账中编辑对应记录。
        </div>
      )}

      <Modal
        open={Boolean(editing)}
        title={`修改备案 · ${PROVIDER_TYPE_LABEL[editing?.providerType || ""] || ""}`}
        width={720}
        confirmLoading={editSaving}
        onCancel={() => setEditing(null)}
        okText="保存修改（需密码）"
        onOk={() => void saveEdit()}
      >
        {editing ? (
          <Form form={editForm} layout="vertical">
            <Notice variant="warn">
              联系方式 / 资质说明 / 简介 / 附件修改后立即生效；变更机构名称、证件号或服务细项会重置为「待平台复审」，复审通过前该类目不可被签约。
            </Notice>
            <div className="form-2col">
              <Form.Item
                name="org_name"
                label={editing.subjectType === "PERSONAL" ? "姓名" : "机构名称"}
                rules={[
                  {
                    required: true,
                    message:
                      editing.subjectType === "PERSONAL" ? "姓名必填" : "机构名称必填",
                  },
                ]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="id_or_uscc"
                label={
                  editing.subjectType === "PERSONAL"
                    ? "身份证号"
                    : "统一社会信用代码"
                }
                rules={[
                  {
                    required: editing.subjectType === "PERSONAL",
                    message: "个人主体需填写身份证号",
                  },
                ]}
              >
                <Input
                  placeholder={
                    editing.subjectType === "PERSONAL"
                      ? "18 位公民身份号码（末位可为 X）"
                      : "18 位统一社会信用代码"
                  }
                />
              </Form.Item>
              <Form.Item name="qualification" label="资质材料说明">
                <Input placeholder="如：代理记账许可证、专利代理机构执业许可证等" />
              </Form.Item>
              <Form.Item
                name="contact_name"
                label="联系人"
                rules={[{ required: true, message: "联系人必填" }]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="contact_phone"
                label="联系电话"
                rules={[{ required: true, message: "联系电话必填" }]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="contact_email"
                label="联系邮箱"
                rules={[
                  { required: true, message: "联系邮箱必填" },
                  { type: "email", message: "联系邮箱格式不正确" },
                ]}
              >
                <Input />
              </Form.Item>
            </div>
            <LocationFields extra="所在省市：名录页企业与用户按省市筛选服务商" />
            {BEARING_CATEGORIES[editing.providerType] ? (
              <Form.Item
                name="service_items"
                label={BEARING_CATEGORIES[editing.providerType].label}
                rules={[
                  {
                    required: true,
                    message: `请至少勾选一项${BEARING_CATEGORIES[editing.providerType].label}`,
                  },
                ]}
                extra="变更细项会重置为待平台复审"
              >
                <Select
                  mode="multiple"
                  options={BEARING_CATEGORIES[editing.providerType].items.map(
                    ([value, label]) => ({ value, label }),
                  )}
                />
              </Form.Item>
            ) : null}
            <Form.Item
              name="intro"
              label="机构简介与优势"
              rules={[{ required: true, message: "机构简介必填" }]}
            >
              <Input.TextArea rows={3} />
            </Form.Item>
            <Form.Item label="资质附件（最多 10 个）">
              <input
                id="provider-application-edit-files"
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                style={{ display: "none" }}
                onChange={(event) => {
                  const picked = Array.from(event.target.files || []);
                  event.target.value = "";
                  void registerEditFiles(picked);
                }}
              />
              <Button
                loading={uploading}
                onClick={() =>
                  document.getElementById("provider-application-edit-files")?.click()
                }
              >
                ＋ 选择文件上传
              </Button>
              <div style={{ marginTop: 8 }}>
                {editFiles.length ? (
                  editFiles.map((file, index) => (
                    <div
                      key={`${file.id || file.name}-${index}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "6px 0",
                      }}
                    >
                      <span className="text-12" style={{ flex: 1 }}>
                        {`${index + 1}. ${file.name}`}
                      </span>
                      <span className="text-12 muted">{fmtSize(file.size)}</span>
                      {file.url ? (
                        <a
                          className="text-12"
                          href={file.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          OSS 链接
                        </a>
                      ) : null}
                      <Button
                        onClick={() =>
                          setEditFiles((current) =>
                            current.filter((_, i) => i !== index),
                          )
                        }
                      >
                        删除
                      </Button>
                    </div>
                  ))
                ) : (
                  <div className="text-12 muted" style={{ padding: "8px 10px" }}>
                    尚未上传资质附件
                  </div>
                )}
              </div>
            </Form.Item>
          </Form>
        ) : null}
      </Modal>

      {passwordModal}
    </>
  );
}
