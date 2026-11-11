"use client";

import { useEffect, useRef, useState } from "react";
import {
  App,
  Button,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
} from "antd";
import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import {
  CARD_BILLING_UNITS,
  type CardSpecMultiplier,
} from "@enterprise/contracts";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { adminCardApi, type CardTemplate } from "@/api/gaps";
import { modelPlazaAdminApi } from "@/api/model-plaza";
import { gapError } from "@/app/gaps/_components/gaps-common";
import { PermissionNotice, useAdminData } from "./common";

/* ============================================================
   平台管理后台「积分与计费 → 时长卡规格」：一张卡 = 一个模型 + 一个额度
   + 一个有效期。规格先建好，兑换码 / 积分兑换 / 现金购买都只引用 code。
   ============================================================ */

const UNIT_LABEL: Record<string, string> = {
  token: "tokens",
  image: "张",
  second: "秒",
};

/** 倍率行的档位字段：与模型广场分档上下文同一套键名，resolution 与 video_resolution 互为别名。 */
const SPEC_KEYS = ["video_resolution", "resolution", "size", "quality"];

const DAY_PRESETS = [1, 7, 30, 90];

function quotaHint(unit: string) {
  if (unit === "token") return "填 tokens 个数，例如 10000000 表示 1000 万 tokens";
  if (unit === "image") return "填张数，1 张恒扣 1 额度，与分辨率无关";
  if (unit === "second") return "填秒数；视频按秒扣，规格倍率在本页「规格倍率」里配";
  return "额度单位跟随所选模型";
}

export function CardSpecPane() {
  const { message, modal } = App.useApp();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [form] = Form.useForm();
  const [revokeForm] = Form.useForm();
  const initialRef = useRef<Record<string, unknown>>({});

  const specsQuery = useAdminData("card-templates", (signal) =>
    adminCardApi.templates({}, { signal }),
  );
  const modelsQuery = useAdminData("card-catalog-options", (signal) =>
    modelPlazaAdminApi.catalog({ query: { page: 1, pageSize: 200 } }, { signal }),
  );

  // 只放可建卡的已上架模型：call（按次）没有「量」可表达，不允许建卡
  const modelOptions = (modelsQuery.data?.list ?? [])
    .filter((model) => (CARD_BILLING_UNITS as readonly string[]).includes(model.billingUnit))
    .map((model) => ({
      value: model.id,
      label: `${model.displayName}｜${model.provider}｜按${
        UNIT_LABEL[model.billingUnit] || model.billingUnit
      }计费${model.enabled ? "" : "（未上架）"}`,
      unit: model.billingUnit,
      disabled: !model.enabled,
    }));

  const catalogId = Form.useWatch("catalogId", form);
  const selectedUnit = modelOptions.find((option) => option.value === catalogId)?.unit || "";

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue(initialRef.current);
  }, [open, form]);

  const openEditor = (row?: CardTemplate) => {
    initialRef.current = row
      ? {
          id: row.id,
          code: row.code,
          name: row.name,
          catalogId: row.catalogId,
          quotaTotal: row.quotaTotal,
          validDays: row.validDays,
          specMultipliers: fromSpecRows(row.specMultipliers),
          pointsPrice: row.pointsPrice,
          cashCents: row.cashCents,
          perUserLimit: row.perUserLimit,
          status: row.status,
          sortOrder: row.sortOrder,
          remark: row.remark,
        }
      : {
          id: 0,
          status: "ACTIVE",
          validDays: 1,
          sortOrder: 0,
          specMultipliers: [],
          perUserLimit: 0,
        };
    setEditingId(row?.id ?? null);
    setOpen(true);
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      await adminCardApi.saveTemplate({
        body: {
          ...values,
          // 表单里倍率是平铺的 key/value/multiplier，提交前还原成契约的 match 形状
          specMultipliers:
            selectedUnit === "second" ? toSpecRows(values.specMultipliers) : [],
        },
      });
      message.success("卡规格已保存");
      setOpen(false);
      await specsQuery.reload();
    } catch (error) {
      if (error && typeof error === "object" && "errorFields" in error) return;
      message.error(gapError(error));
    }
  };

  const revoke = async () => {
    try {
      const values = await revokeForm.validateFields();
      const result = await adminCardApi.revokeCard({
        params: { cardId: String(values.cardId).trim() },
        body: { password: values.password, compensate: Boolean(values.compensate) },
      });
      if (!result) throw new Error("撤销返回为空");
      message.success(
        `已撤销 ${result.card.name}：${
          result.compensatedPoints > 0
            ? `按剩余比例补偿 ${result.compensatedPoints} 积分，当前余额 ${result.balance}`
            : "未用额度不补偿，已消耗部分不退"
        }`,
      );
      setRevokeOpen(false);
      revokeForm.resetFields();
      await specsQuery.reload();
    } catch (error) {
      if (error && typeof error === "object" && "errorFields" in error) return;
      message.error(gapError(error));
    }
  };

  const columns: ColumnsType<CardTemplate> = [
    { title: "编码", dataIndex: "code", width: 140 },
    { title: "卡名", dataIndex: "name", width: 160 },
    {
      title: "绑定模型",
      width: 240,
      render: (_, row) => (
        <div>
          <div>{row.modelName}</div>
          <div className="text-12 muted">
            {row.provider}·{row.modelKey}
          </div>
        </div>
      ),
    },
    {
      title: "额度",
      width: 150,
      render: (_, row) => (
        <div>
          <div>{row.quotaLabel}</div>
          <div className="text-12 muted">按{row.billingUnitLabel}扣</div>
        </div>
      ),
    },
    {
      title: "有效期",
      width: 90,
      render: (_, row) => `${row.validDays} 天`,
    },
    {
      title: "规格倍率",
      width: 200,
      render: (_, row) =>
        row.billingUnit !== "second" ? (
          <span className="text-12 muted">1 倍</span>
        ) : row.specMultipliers.length ? (
          <Space size={4} wrap>
            {row.specMultipliers.map((row2, index) => (
              <Tag key={index}>
                {Object.entries(row2.match)
                  .map(([key, value]) => `${key}=${value}`)
                  .join("&")}{" "}
                ×{row2.multiplier}
              </Tag>
            ))}
          </Space>
        ) : (
          <span className="text-12 muted">未填，全部按 1 倍计</span>
        ),
    },
    {
      title: "积分价",
      width: 110,
      render: (_, row) =>
        row.pointsPrice > 0 ? `${row.pointsPrice} 积分` : <span className="text-12 muted">不支持</span>,
    },
    {
      title: "现金价",
      width: 100,
      render: (_, row) =>
        row.cashCents > 0 ? `¥${(row.cashCents / 100).toFixed(2)}` : <span className="text-12 muted">不支持</span>,
    },
    {
      title: "每人上限",
      width: 100,
      render: (_, row) =>
        row.perUserLimit > 0 ? (
          `${row.perUserLimit} 张`
        ) : (
          <span className="text-12 muted">不限</span>
        ),
    },
    {
      title: "状态",
      width: 90,
      render: (_, row) => (
        <Tag color={row.status === "ACTIVE" ? "green" : "default"}>{row.statusLabel}</Tag>
      ),
    },
    {
      title: "操作",
      width: 140,
      render: (_, row) => (
        <>
          <Button size="small" type="link" onClick={() => openEditor(row)}>
            编辑
          </Button>
          {row.status === "ACTIVE" ? (
            <Button
              size="small"
              type="link"
              danger
              onClick={() =>
                modal.confirm({
                  title: `停用 ${row.name}？`,
                  content:
                    "停用后不再出现在兑换码与积分兑换的可选规格里；已发出去的卡不受影响，继续按快照额度与有效期消耗。",
                  okText: "停用",
                  onOk: async () => {
                    try {
                      await adminCardApi.removeTemplate({ params: { code: row.code } });
                      message.success("已停用");
                      await specsQuery.reload();
                    } catch (error) {
                      message.error(gapError(error));
                    }
                  },
                })
              }
            >
              停用
            </Button>
          ) : null}
        </>
      ),
    },
  ];

  return (
    <>
      <PermissionNotice denied={specsQuery.denied} />
      <Panel
        title="时长卡规格"
        titleBadge={<span className="text-12 muted">共 {specsQuery.data?.length ?? 0} 个规格</span>}
        extra={
          <Space>
            <Button onClick={() => setRevokeOpen(true)}>撤销用户的卡</Button>
            <Button type="primary" onClick={() => openEditor()}>
              新建规格
            </Button>
          </Space>
        }
      >
        <Notice variant="info">
          一张卡只绑一个模型、一个额度单位，卡之间不能互转、也不能折成积分；有效期从激活那一刻起按
          validDays × 24 小时计算（精确到秒，不按自然日）。规格改额度或有效期不影响已发出的卡。
        </Notice>
        <div className="table-wrap">
          <Table<CardTemplate>
            rowKey="id"
            size="middle"
            loading={specsQuery.loading}
            columns={columns}
            dataSource={specsQuery.data ?? []}
            scroll={{ x: 1500 }}
            pagination={false}
            locale={{
              emptyText: (
                <EmptyState text="还没有卡规格：先建一个「DeepSeek 日卡」这类规格，再去「兑换码」发码或让用户用积分兑换" />
              ),
            }}
          />
        </div>
      </Panel>

      <Modal
        open={open}
        title={editingId ? "编辑卡规格" : "新建卡规格"}
        onCancel={() => setOpen(false)}
        onOk={() => void save()}
        width={720}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>
          <Space style={{ display: "flex" }} wrap>
            <Form.Item
              name="code"
              label="规格编码"
              rules={[{ required: true, message: "请填写至少 2 位编码" }]}
              style={{ width: 200 }}
              extra="兑换码与积分兑换都引用这个编码，例如 DAY_DEEPSEEK"
            >
              <Input maxLength={32} placeholder="DAY_DEEPSEEK" />
            </Form.Item>
            <Form.Item
              name="name"
              label="卡名"
              rules={[{ required: true, message: "请填写卡名" }]}
              style={{ width: 260 }}
            >
              <Input maxLength={80} placeholder="DeepSeek 日卡" />
            </Form.Item>
          </Space>
          <Form.Item
            name="catalogId"
            label="绑定模型"
            rules={[{ required: true, message: "请选择卡绑定的模型" }]}
            extra="下拉只列按 tokens / 张 / 秒计费的模型；按次计费的模型无法表达「量」，不能建卡"
          >
            <Select
              showSearch
              optionFilterProp="label"
              placeholder={modelsQuery.loading ? "模型加载中…" : "选择模型"}
              options={modelOptions}
              notFoundContent={
                <span className="text-12">
                  模型广场还没有可建卡的已上架模型，请先在「模型广场」上架
                </span>
              }
            />
          </Form.Item>
          <Space style={{ display: "flex" }} wrap>
            <Form.Item
              name="quotaTotal"
              label="额度"
              rules={[{ required: true, message: "请填写大于 0 的额度" }]}
              style={{ width: 260 }}
              extra={quotaHint(selectedUnit)}
            >
              <InputNumber
                min={1}
                style={{ width: "100%" }}
                addonAfter={selectedUnit ? UNIT_LABEL[selectedUnit] : "未选模型"}
                placeholder="10000000"
              />
            </Form.Item>
            <Form.Item
              name="validDays"
              label="有效期（天）"
              rules={[{ required: true, message: "请填写有效期天数" }]}
              style={{ width: 200 }}
              extra="从激活时刻起算，1 天 = 24 小时"
            >
              <InputNumber min={1} max={3650} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label=" " style={{ width: 220 }}>
              <Space size={4} wrap>
                {DAY_PRESETS.map((days) => (
                  <Button key={days} size="small" onClick={() => form.setFieldValue("validDays", days)}>
                    {days} 天
                  </Button>
                ))}
              </Space>
            </Form.Item>
          </Space>
          {selectedUnit === "second" ? (
            <>
              <Divider titlePlacement="start" plain>
                规格倍率（不填＝全部按 1 倍计）
              </Divider>
              <div className="text-12 muted" style={{ marginBottom: 8 }}>
                本次扣的秒数 = 实际秒数 × 命中档位的倍率；未命中任何档位时回落 1 倍并在明细里标注。
              </div>
              <Form.List name="specMultipliers">
                {(fields, { add, remove }) => (
                  <>
                    {fields.map((field) => (
                      <Space key={field.key} align="baseline" wrap>
                        <Form.Item name={[field.name, "key"]} initialValue="video_resolution" style={{ width: 170 }}>
                          <Select
                            options={SPEC_KEYS.map((key) => ({ value: key, label: key }))}
                          />
                        </Form.Item>
                        <Form.Item
                          name={[field.name, "value"]}
                          style={{ width: 140 }}
                          rules={[{ required: true, message: "填档位值" }]}
                        >
                          <Input placeholder="480p" />
                        </Form.Item>
                        <Form.Item
                          name={[field.name, "multiplier"]}
                          style={{ width: 130 }}
                          rules={[{ required: true, message: "填倍率" }]}
                        >
                          <InputNumber min={0.001} max={1000} step={0.5} addonBefore="×" />
                        </Form.Item>
                        <Button
                          size="small"
                          type="text"
                          icon={<MinusCircleOutlined aria-hidden />}
                          onClick={() => remove(field.name)}
                        >
                          删除
                        </Button>
                      </Space>
                    ))}
                    <Button
                      size="small"
                      type="dashed"
                      icon={<PlusOutlined aria-hidden />}
                      onClick={() => add({ key: "video_resolution", value: "", multiplier: 1 })}
                    >
                      增加档位
                    </Button>
                  </>
                )}
              </Form.List>
            </>
          ) : null}
          <Space style={{ display: "flex", marginTop: 16 }} wrap>
            <Form.Item name="pointsPrice" label="积分价（0＝不支持积分兑换）" style={{ width: 200 }}>
              <InputNumber min={0} style={{ width: "100%" }} placeholder="例如 200" />
            </Form.Item>
            <Form.Item name="cashCents" label="现金价（分，0＝不支持购买）" style={{ width: 200 }}>
              <InputNumber min={0} step={100} style={{ width: "100%" }} placeholder="例如 990" />
            </Form.Item>
            <Form.Item
              name="perUserLimit"
              label="每人最多兑换（张，0＝不限）"
              tooltip="同一用户在该规格下最多持有几张；兑换码、积分兑换、现金购买三入口合计计数，防止低价日卡被同一个人靠多张码囤积。已发出的卡用完或到期后即可再次兑换。"
              style={{ width: 220 }}
            >
              <InputNumber min={0} max={100} precision={0} style={{ width: "100%" }} placeholder="0＝不限" />
            </Form.Item>
            <Form.Item name="sortOrder" label="排序" style={{ width: 100 }}>
              <InputNumber min={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="status" label="状态" style={{ width: 120 }}>
              <Select
                options={[
                  { value: "ACTIVE", label: "启用" },
                  { value: "DISABLED", label: "停用" },
                ]}
              />
            </Form.Item>
          </Space>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={200} showCount />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={revokeOpen}
        title="撤销时长卡"
        onCancel={() => setRevokeOpen(false)}
        onOk={() => void revoke()}
        width={520}
        destroyOnHidden
      >
        <Notice variant="warn">
          撤销后卡立即不可用；已消耗部分不退，未用额度默认不补偿。勾选补偿时按剩余比例折积分入账，
          兑换记录本身保留，订单行显示「已撤销」。
        </Notice>
        <Form form={revokeForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item
            name="cardId"
            label="卡 ID"
            rules={[{ required: true, message: "请填写要撤销的卡 ID" }]}
            extra="用户在「积分中心 → 兑换订单」或接口返回里能看到卡 ID"
          >
            <Input placeholder="例如 12" />
          </Form.Item>
          <Form.Item name="compensate" label="按剩余比例补偿积分" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item
            name="password"
            label="管理员密码"
            rules={[{ required: true, message: "敏感操作需确认密码" }]}
          >
            <Input.Password autoComplete="current-password" maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

/** 倍率行在表单里用平铺的 key/value，提交前还原成契约的 match 形状。 */
function toSpecRows(rows: unknown): CardSpecMultiplier[] {
  return (Array.isArray(rows) ? rows : [])
    .map((raw) => {
      const row = (raw || {}) as { key?: string; value?: string; multiplier?: number };
      const key = (row.key || "video_resolution").trim();
      const value = (row.value || "").trim();
      if (!key || !value) return null;
      return {
        match: { [key]: value },
        multiplier: Number(row.multiplier) || 1,
      } satisfies CardSpecMultiplier;
    })
    .filter((row): row is CardSpecMultiplier => Boolean(row));
}

/** 契约形状 → 表单平铺行；一个档位行只维护单键匹配，多键组合由后端命中算法兜住。 */
function fromSpecRows(rows: CardSpecMultiplier[]) {
  return (rows || []).map((row) => {
    const [key, value] = Object.entries(row.match || {})[0] || ["video_resolution", ""];
    return { key, value: String(value ?? ""), multiplier: row.multiplier };
  });
}
