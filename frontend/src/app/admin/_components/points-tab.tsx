"use client";

import { useEffect, useState } from "react";
import {
  App,
  Button,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
  Table,
} from "antd";
import { WalletOutlined } from "@ant-design/icons";
import { EmptyState, Notice, Panel, PanelTabs } from "@/components/ui/panel";
import {
  pointsAdminApi,
  type AiUsageModuleRow,
  type PointsAccountRow,
  type PointTxRow,
  type PricingRow,
  type RechargeOrderRow,
  type UsageEventRow,
} from "@/api/points";
import { billingRuleApi, type BillingRule } from "@/api/governance";
import { CardSpecPane } from "./card-spec-pane";
import { GapsPromoPanel } from "@/app/points/_components/gaps-promo";
import {
  AI_MODULE_LABELS,
  BILLING_SUBJECT_LABELS,
  aiModuleLabel,
  billingSubjectLabel,
  fmtTokens,
  txSceneLabel,
} from "@/lib/ai-usage";
import { useSiteBase } from "@/lib/site-brand";
import { joinSiteUrl, SITE_BASE_PLACEHOLDER } from "@/lib/site-url";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";
import { PermissionNotice, fmtTime, useAdminData } from "./common";

/* ============================================================
   平台管理后台「积分与充值」：计费设置 / 微信支付 / 价目与用量 /
   账户与调整 / 充值订单。赚分花分数量都在这改，后端点一次保存
   全量白名单落库（point_settings 键值表）。
   ============================================================ */

const TX_TYPE_LABEL: Record<string, string> = {
  RECHARGE: "充值",
  RECHARGE_BONUS: "充值赠送",
  EARN: "赚取",
  SPEND: "消费",
  TRANSFER_IN: "收到赠送",
  TRANSFER_OUT: "赠送转出",
  REFUND: "退款",
  ADMIN_ADJUST: "管理员调整",
};

const ORDER_STATUS: Record<string, { label: string; cls: string }> = {
  CREATED: { label: "待支付", cls: "badge-sky" },
  PAID: { label: "已支付", cls: "badge-green" },
  CLOSED: { label: "已关闭", cls: "badge-gray" },
  FAILED: { label: "失败", cls: "badge-red" },
};

const ACCOUNT_STATUS: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: "正常", cls: "badge-green" },
  ARREARS: { label: "欠费冻结", cls: "badge-red" },
};

function fmtPoints(value: number | null | undefined) {
  if (value === null || value === undefined) return "0";
  return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 4 });
}

function fmtYuan(cents: number | null | undefined) {
  return `¥${((Number(cents) || 0) / 100).toFixed(2)}`;
}

function stateBadge(map: Record<string, { label: string; cls: string }>, key: string) {
  const meta = map[key] || { label: key || "—", cls: "badge-gray" };
  return <span className={`badge ${meta.cls}`}>{meta.label}</span>;
}

/** 板块入口：五个页签同屏切换。 */
export function PointsTab() {
  const [tab, setTab] = useState("settings");
  return (
    <PanelTabs
      value={tab}
      onChange={setTab}
      items={[
        { key: "settings", label: "计费设置", children: <SettingsPane /> },
        { key: "wechat", label: "微信支付", children: <WechatPane /> },
        { key: "pricing", label: "价目与用量", children: <PricingPane /> },
        { key: "billing", label: "用量计费", children: <BillingRulesPane /> },
        { key: "accounts", label: "账户与调整", children: <AccountsPane /> },
        { key: "orders", label: "充值订单", children: <OrdersPane /> },
        { key: "cardSpec", label: "时长卡规格", children: <CardSpecPane /> },
        { key: "redeem", label: "兑换码", children: <GapsPromoPanel /> },
      ]}
    />
  );
}

/* ---------------------------------------------------------------- 计费设置 */

type TierDraft = { yuan: number; bonusPercent: number };

function SettingsPane() {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const { data, denied, loading, reload } = useAdminData("points-settings", (signal) =>
    pointsAdminApi.settings({ signal }),
  );
  const [tiers, setTiers] = useState<TierDraft[]>([]);

  useEffect(() => {
    if (!data) return;
    form.setFieldsValue({
      rate: data.rate,
      rechargeMinYuan: data.rechargeMinCents / 100,
      signupBonus: data.signupBonus,
      inviteRewardSignup: data.inviteRewardSignup,
      inviteRechargePercent: data.inviteRechargePercent,
      inviteRechargeCap: data.inviteRechargeCap,
      inviteDailyCount: data.inviteDailyCount,
      rewardDailyCap: data.rewardDailyCap,
      transferEnabled: data.transferEnabled,
      transferMin: data.transferMin,
      transferDailyCount: data.transferDailyCount,
      transferDailyPoints: data.transferDailyPoints,
      transferFeePercent: data.transferFeePercent,
      arrearsGraceDays: data.arrearsGraceDays,
    });
    setTiers(data.rechargeTiers.map((t) => ({ yuan: t.cents / 100, bonusPercent: t.bonusPercent })));
  }, [data, form]);

  const save = useOperationMutation(
    (body: Record<string, unknown>) => pointsAdminApi.saveSettings(body),
    ["points-settings", "points-pricing", "*"],
  );

  const onSubmit = async (values: Record<string, number | boolean>) => {
    if (!tiers.length || tiers.some((t) => !(Number(t.yuan) > 0))) {
      message.error("充值档位至少保留一档，且每档金额必须大于 0");
      return;
    }
    try {
      await save.mutateAsync({
        rate: Number(values.rate),
        recharge_min_cents: Math.max(1, Math.round(Number(values.rechargeMinYuan) * 100)),
        recharge_tiers: tiers.map((t) => ({
          cents: Math.max(1, Math.round(Number(t.yuan) * 100)),
          bonusPercent: Math.max(0, Number(t.bonusPercent) || 0),
        })),
        signup_bonus: Number(values.signupBonus),
        invite_reward_signup: Number(values.inviteRewardSignup),
        invite_recharge_percent: Number(values.inviteRechargePercent),
        invite_recharge_cap: Number(values.inviteRechargeCap),
        invite_daily_count: Number(values.inviteDailyCount),
        reward_daily_cap: Number(values.rewardDailyCap),
        // 开关以 '1'/'0' 字符串落库（后端按 !== '0' 判定）
        transfer_enabled: values.transferEnabled ? "1" : "0",
        transfer_min: Number(values.transferMin),
        transfer_daily_count: Number(values.transferDailyCount),
        transfer_daily_points: Number(values.transferDailyPoints),
        transfer_fee_percent: Number(values.transferFeePercent),
        arrears_grace_days: Number(values.arrearsGraceDays),
      });
      message.success("积分与计费设置已保存，即时生效");
      await reload();
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  return (
    <>
      <PermissionNotice denied={denied} />

      <Panel
        title="汇率、充值档位与赚分奖励"
        titleBadge={<span className="text-12 muted">改完保存即时生效（只影响新订单，不追溯已充积分）</span>}
        extra={<Button onClick={() => void reload()}>重新载入</Button>}
      >
        <Notice variant="info">
          <WalletOutlined aria-hidden /> 这里配置的是「赚分、花分」的全部数量口径：汇率、充值档位赠送、
          注册/邀请奖励、赠送限额与风控（欠费宽限）。
        </Notice>
        <Form
          form={form}
          layout="vertical"
          disabled={loading}
          onFinish={onSubmit}
          style={{ marginTop: 12, maxWidth: 960 }}
        >
          <Divider titlePlacement="start">汇率与充值</Divider>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
            <Form.Item name="rate" label="积分汇率（1 元 = N 积分）">
              <InputNumber min={0.01} step={0.5} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="rechargeMinYuan" label="最低充值金额（元）">
              <InputNumber min={0.01} step={1} style={{ width: "100%" }} />
            </Form.Item>
          </div>
          <Form.Item label="充值档位（金额 / 赠送百分比）" style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {tiers.map((tier, index) => (
                <div key={index} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <InputNumber
                    min={0.01}
                    step={10}
                    prefix="¥"
                    style={{ width: 140 }}
                    value={tier.yuan}
                    onChange={(value) =>
                      setTiers((rows) =>
                        rows.map((row, i) => (i === index ? { ...row, yuan: Number(value) || 0 } : row)),
                      )
                    }
                  />
                  <InputNumber
                    min={0}
                    max={100}
                    suffix="% 赠送"
                    style={{ width: 150 }}
                    value={tier.bonusPercent}
                    onChange={(value) =>
                      setTiers((rows) =>
                        rows.map((row, i) =>
                          i === index ? { ...row, bonusPercent: Number(value) || 0 } : row,
                        ),
                      )
                    }
                  />
                  <Button danger size="small" onClick={() => setTiers((rows) => rows.filter((_, i) => i !== index))}>
                    删除
                  </Button>
                </div>
              ))}
              <Button
                size="small"
                onClick={() => setTiers((rows) => [...rows, { yuan: 100, bonusPercent: 0 }])}
                style={{ alignSelf: "flex-start" }}
              >
                添加一档
              </Button>
            </div>
          </Form.Item>

          <Divider titlePlacement="start">赚分：注册与邀请奖励</Divider>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
            <Form.Item name="signupBonus" label="新用户注册赠分" extra="0 = 关闭注册赠分">
              <InputNumber min={0} step={10} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="inviteRewardSignup" label="邀请好友注册奖励" extra="给邀请人；0 = 关闭">
              <InputNumber min={0} step={10} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="inviteRechargePercent" label="被邀人首充返佣（%）" extra="按首充实付积分百分比给邀请人">
              <InputNumber min={0} max={100} step={0.5} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="inviteRechargeCap" label="首充返佣单人上限（积分）">
              <InputNumber min={0} step={50} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="inviteDailyCount" label="每人每日可获邀请奖励人数" extra="0 = 不限">
              <InputNumber min={0} step={1} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="rewardDailyCap" label="全站奖励日预算帽（积分）" extra="0 = 不限">
              <InputNumber min={0} step={1000} style={{ width: "100%" }} />
            </Form.Item>
          </div>

          <Divider titlePlacement="start">赠送与风控</Divider>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
            <Form.Item name="transferEnabled" label="积分赠送开关" valuePropName="checked">
              <Switch checkedChildren="开" unCheckedChildren="关" />
            </Form.Item>
            <Form.Item name="transferMin" label="单次赠送最低积分">
              <InputNumber min={0} step={1} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="transferDailyCount" label="每日赠送笔数上限" extra="0 = 不限">
              <InputNumber min={0} step={1} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="transferDailyPoints" label="每日赠送额度上限（积分）" extra="0 = 不限">
              <InputNumber min={0} step={100} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="transferFeePercent" label="赠送手续费率（%）" extra="预留防套利，默认 0">
              <InputNumber min={0} max={100} step={0.5} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="arrearsGraceDays" label="欠费宽限天数" extra="宽限内资产只读不可新增，永不删除数据">
              <InputNumber min={0} max={90} step={1} style={{ width: "100%" }} />
            </Form.Item>
          </div>

          <Button type="primary" htmlType="submit" loading={save.isPending}>
            保存计费设置
          </Button>
        </Form>
      </Panel>
    </>
  );
}

/* ---------------------------------------------------------------- 微信支付 */

function WechatPane() {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  // 支付回调地址按本站域名给出建议值（微信要求公网 HTTPS，实际仍需管理员确认）
  const siteBase = useSiteBase();
  const notifyHint = joinSiteUrl(
    siteBase || SITE_BASE_PLACEHOLDER,
    "/api/pay/wechat/notify",
  );
  const { data, denied, loading, reload } = useAdminData("points-settings", (signal) =>
    pointsAdminApi.settings({ signal }),
  );

  useEffect(() => {
    if (!data) return;
    form.setFieldsValue({
      appId: data.wechatAppId,
      mchId: data.wechatMchId,
      notifyUrl: data.wechatNotifyUrl,
    });
  }, [data, form]);

  const save = useOperationMutation(
    (body: Record<string, string>) => pointsAdminApi.saveWechat(body),
    ["points-settings", "*"],
  );
  const test = useOperationMutation(
    () => pointsAdminApi.testWechat(),
    ["points-settings"],
  );

  const onSubmit = async (values: Record<string, string>) => {
    // 敏感项（APIv3 密钥 / 证书序列号 / 商户私钥）留空 = 保持不变；填写则覆盖
    const body: Record<string, string> = {
      appId: values.appId || "",
      mchId: values.mchId || "",
      notifyUrl: values.notifyUrl || "",
    };
    if (values.apiv3Key) body.apiv3Key = values.apiv3Key;
    if (values.certSerial) body.certSerial = values.certSerial;
    if (values.privateKey) body.privateKey = values.privateKey;
    try {
      await save.mutateAsync(body);
      message.success("微信支付配置已保存（敏感项密文入库，不回显）");
      form.setFieldsValue({ apiv3Key: "", certSerial: "", privateKey: "" });
      await reload();
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const onTest = async () => {
    try {
      await test.mutateAsync();
      message.success("微信支付商户配置连接正常");
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  return (
    <>
      <PermissionNotice denied={denied} />
      <Panel
        title="微信支付商户配置（APIv3）"
        titleBadge={
          <span className={`badge ${data?.wechatConfigured ? "badge-green" : "badge-orange"}`}>
            {data?.wechatConfigured ? "已配齐，可下单" : "未配齐，充值不可用"}
          </span>
        }
        extra={
          <Button onClick={() => void onTest()} loading={test.isPending}>
            测试连接
          </Button>
        }
      >
        <Notice variant="info">
          五项（AppID / 商户号 / APIv3 密钥 / 证书序列号 / 商户私钥）配齐后才允许用户充值下单；
          敏感项加密落库、任何接口永不回显明文。留空保存表示保持原值。
        </Notice>
        <Form
          form={form}
          layout="vertical"
          disabled={loading}
          onFinish={onSubmit}
          style={{ marginTop: 12, maxWidth: 720 }}
        >
          <Form.Item name="appId" label="AppID（公众号/小程序/APP 的 AppID）">
            <Input placeholder="wx1234567890abcdef" maxLength={64} />
          </Form.Item>
          <Form.Item name="mchId" label="商户号 mchid">
            <Input placeholder="1900000001" maxLength={64} />
          </Form.Item>
          <Form.Item name="apiv3Key" label="APIv3 密钥" extra="留空保持不变；填写则覆盖">
            <Input.Password placeholder="32 位 APIv3 密钥" maxLength={128} autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="certSerial" label="商户证书序列号" extra="留空保持不变；填写则覆盖">
            <Input placeholder="证书序列号" maxLength={128} />
          </Form.Item>
          <Form.Item name="privateKey" label="商户私钥（PEM）" extra="留空保持不变；填写则覆盖">
            <Input.TextArea rows={4} placeholder="-----BEGIN PRIVATE KEY-----" maxLength={16384} />
          </Form.Item>
          <Form.Item
            name="notifyUrl"
            label="支付回调地址"
            extra={
              siteBase
                ? `必须是公网 HTTPS；按当前站点域名为 ${notifyHint}（在「站点设置 → 站点域名」可改域名）`
                : `必须是公网 HTTPS：${notifyHint}`
            }
          >
            <Input placeholder={notifyHint} maxLength={512} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={save.isPending}>
            保存微信支付配置
          </Button>
        </Form>
      </Panel>
    </>
  );
}

/* ---------------------------------------------------------------- 价目与用量 */

type PricingDraft = Pick<
  PricingRow,
  "mode" | "unit" | "unitPriceAmount" | "freeQuotaAmount" | "minChargeAmount" | "enabled"
>;

function PricingPane() {
  const { message } = App.useApp();
  const { data, denied, loading, reload } = useAdminData("points-pricing", (signal) =>
    pointsAdminApi.pricing({ signal }),
  );
  const [drafts, setDrafts] = useState<Record<string, PricingDraft>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [addForm] = Form.useForm();

  useEffect(() => {
    if (!data) return;
    setDrafts(
      Object.fromEntries(
        data.map((row) => [
          row.code,
          {
            mode: row.mode,
            unit: row.unit,
            unitPriceAmount: row.unitPriceAmount,
            freeQuotaAmount: row.freeQuotaAmount,
            minChargeAmount: row.minChargeAmount,
            enabled: row.enabled,
          },
        ]),
      ),
    );
  }, [data]);

  const save = useOperationMutation(
    (input: { code: string; body: PricingDraft }) =>
      pointsAdminApi.updatePricing(input.code, input.body),
    ["points-pricing", "points-usage", "*"],
  );

  const patch = (code: string, part: Partial<PricingDraft>) =>
    setDrafts((rows) => ({ ...rows, [code]: { ...rows[code], ...part } }));

  const saveRow = async (code: string) => {
    try {
      await save.mutateAsync({ code, body: drafts[code] });
      message.success(`模块「${billingSubjectLabel(code)}」价目已更新`);
      await reload();
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const addModule = async (values: Record<string, unknown>) => {
    const code = String(values.code || "").trim();
    if (!code) return;
    try {
      await save.mutateAsync({
        code,
        body: {
          mode: String(values.mode || "FREE"),
          unit: String(values.unit || ""),
          unitPriceAmount: Number(values.unitPriceAmount) || 0,
          freeQuotaAmount: Number(values.freeQuotaAmount) || 0,
          minChargeAmount: Number(values.minChargeAmount) || 0.01,
          enabled: values.enabled !== false,
        },
      });
      message.success(`模块「${code}」已创建`);
      setAddOpen(false);
      addForm.resetFields();
      await reload();
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  return (
    <>
      <PermissionNotice denied={denied} />

      <Panel
        title="模块价目（花分的具体数量）"
        titleBadge={<span className="text-12 muted">METERED 才扣费；免费额按自然月抵扣，超出才计费</span>}
        extra={
          <div style={{ display: "flex", gap: 8 }}>
            <Button onClick={() => setAddOpen(true)}>新增模块</Button>
            <Button onClick={() => void reload()}>刷新</Button>
          </div>
        }
      >
        <div className="table-wrap">
          <Table<PricingRow>
            rowKey="code"
            loading={loading}
            dataSource={data ?? []}
            pagination={false}
            size="middle"
            locale={{ emptyText: <EmptyState text="暂无价目，点右上角新增模块" /> }}
            columns={[
              {
                title: "模块",
                width: 170,
                render: (_, row) => (
                  <div>
                    <div style={{ fontWeight: 600 }}>{billingSubjectLabel(row.code)}</div>
                    <span className="mono text-12 muted">{row.code}</span>
                  </div>
                ),
              },
              {
                title: "模式",
                width: 120,
                render: (_, row) => (
                  <Select
                    size="small"
                    value={drafts[row.code]?.mode ?? row.mode}
                    style={{ width: 100 }}
                    onChange={(value) => patch(row.code, { mode: value })}
                    options={[
                      { value: "FREE", label: "免费" },
                      { value: "METERED", label: "计量" },
                    ]}
                  />
                ),
              },
              {
                title: "计量单位",
                width: 120,
                render: (_, row) => (
                  <Input
                    size="small"
                    value={drafts[row.code]?.unit ?? row.unit}
                    onChange={(event) => patch(row.code, { unit: event.target.value })}
                    placeholder="次 / 席月 / GB·天"
                  />
                ),
              },
              {
                title: "单价（积分）",
                width: 130,
                render: (_, row) => (
                  <InputNumber
                    size="small"
                    min={0}
                    step={0.1}
                    value={drafts[row.code]?.unitPriceAmount ?? row.unitPriceAmount}
                    onChange={(value) => patch(row.code, { unitPriceAmount: Number(value) || 0 })}
                    style={{ width: "100%" }}
                  />
                ),
              },
              {
                title: "月免费额",
                width: 120,
                render: (_, row) => (
                  <InputNumber
                    size="small"
                    min={0}
                    value={drafts[row.code]?.freeQuotaAmount ?? row.freeQuotaAmount}
                    onChange={(value) => patch(row.code, { freeQuotaAmount: Number(value) || 0 })}
                    style={{ width: "100%" }}
                  />
                ),
              },
              {
                title: "最低起扣",
                width: 110,
                render: (_, row) => (
                  <InputNumber
                    size="small"
                    min={0}
                    step={0.01}
                    value={drafts[row.code]?.minChargeAmount ?? row.minChargeAmount}
                    onChange={(value) => patch(row.code, { minChargeAmount: Number(value) || 0 })}
                    style={{ width: "100%" }}
                  />
                ),
              },
              {
                title: "启用",
                width: 80,
                render: (_, row) => (
                  <Switch
                    size="small"
                    checked={drafts[row.code]?.enabled ?? row.enabled}
                    onChange={(checked) => patch(row.code, { enabled: checked })}
                  />
                ),
              },
              {
                title: "操作",
                width: 90,
                render: (_, row) => (
                  <Button size="small" type="primary" onClick={() => void saveRow(row.code)}>
                    保存
                  </Button>
                ),
              },
            ]}
          />
        </div>
      </Panel>

      <UsagePanel />

      <Modal
        title="新增计费模块"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={() => addForm.submit()}
        okText="创建"
        cancelText="取消"
        confirmLoading={save.isPending}
      >
        <Form form={addForm} layout="vertical" onFinish={addModule} initialValues={{ mode: "FREE", enabled: true, minChargeAmount: 0.01 }}>
          <Form.Item name="code" label="模块编码" rules={[{ required: true, message: "请输入模块编码" }]}>
            <Input placeholder="如 ai_customer / bi / oa" maxLength={32} />
          </Form.Item>
          <Form.Item name="mode" label="计费模式">
            <Select
              options={[
                { value: "FREE", label: "免费" },
                { value: "METERED", label: "按量计量" },
              ]}
            />
          </Form.Item>
          <Form.Item name="unit" label="计量单位">
            <Input placeholder="次 / 席月 / GB·天" maxLength={32} />
          </Form.Item>
          <Form.Item name="unitPriceAmount" label="单价（积分 / 单位）">
            <InputNumber min={0} step={0.1} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="freeQuotaAmount" label="月免费额（0 = 无免费额）">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="minChargeAmount" label="单次最低起扣（积分）">
            <InputNumber min={0} step={0.01} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="enabled" label="立即启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function UsagePanel() {
  const [module, setModule] = useState("");
  const [code, setCode] = useState("");
  const [userId, setUserId] = useState("");
  const [page, setPage] = useState(1);
  const detailParams = {
    module: module || undefined,
    code: code || undefined,
    userId: userId || undefined,
    page,
    size: 20,
  };
  const summaryParams = { userId: userId || undefined };
  const {
    data: summary,
    denied,
    loading: summaryLoading,
    reload,
  } = useAdminData(
    "points-ai-usage",
    (signal) => pointsAdminApi.aiUsageSummary(summaryParams, { signal }),
    summaryParams,
  );
  const { data, loading } = useAdminData(
    "points-usage",
    (signal) => pointsAdminApi.usage(detailParams, { signal }),
    detailParams,
  );

  return (
    <>
      <PermissionNotice denied={denied} />
      <Panel
        title="AI 用量汇总"
        titleBadge={
          <span className="text-12 muted">
            近 30 天 · {fmtPoints(summary?.totals.calls ?? 0)} 次调用 /{" "}
            {fmtTokens(summary?.totals.tokenInAmount ?? 0)} 输入 token /{" "}
            {fmtTokens(summary?.totals.tokenOutAmount ?? 0)} 输出 token /{" "}
            {fmtPoints(summary?.totals.pointsAmount ?? 0)} 积分
          </span>
        }
        extra={<Button onClick={() => void reload()}>刷新</Button>}
      >
        <div className="table-wrap">
          <Table<AiUsageModuleRow>
            rowKey={(row) => `${row.module}·${row.code}`}
            loading={summaryLoading}
            dataSource={summary?.modules ?? []}
            size="middle"
            pagination={false}
            locale={{ emptyText: <EmptyState text="暂无 AI 用量记录" /> }}
            columns={[
              {
                title: "板块",
                width: 150,
                render: (_, row) => aiModuleLabel(row.module),
              },
              {
                title: "科目",
                width: 170,
                render: (_, row) => billingSubjectLabel(row.code),
              },
              { title: "调用次数", width: 110, render: (_, row) => fmtPoints(row.calls) },
              {
                title: "输入 token",
                width: 130,
                render: (_, row) => fmtTokens(row.tokenInAmount),
              },
              {
                title: "输出 token",
                width: 130,
                render: (_, row) => fmtTokens(row.tokenOutAmount),
              },
              { title: "消耗积分", width: 120, render: (_, row) => fmtPoints(row.pointsAmount) },
              {
                title: "洞察产出",
                width: 120,
                render: (_, row) => {
                  const hit = summary?.insights.find((item) => item.scope === row.module);
                  return hit ? `${fmtPoints(hit.count)} 条` : "—";
                },
              },
            ]}
          />
        </div>
      </Panel>
      <Panel
        title="用量明细"
        titleBadge={<span className="text-12 muted">计量事件流水：免费额内也记行（billed=否），供对账</span>}
        extra={
          <div style={{ display: "flex", gap: 8 }}>
            <Select
              allowClear
              placeholder="全部板块"
              style={{ width: 150 }}
              value={module || undefined}
              onChange={(value) => {
                setModule(value || "");
                setPage(1);
              }}
              options={Object.entries(AI_MODULE_LABELS).map(([value, label]) => ({ value, label }))}
            />
            <Select
              allowClear
              placeholder="全部科目"
              style={{ width: 160 }}
              value={code || undefined}
              onChange={(value) => {
                setCode(value || "");
                setPage(1);
              }}
              options={Object.entries(BILLING_SUBJECT_LABELS).map(([value, label]) => ({ value, label }))}
            />
            <Input
              allowClear
              placeholder="按用户 ID 过滤"
              style={{ width: 150 }}
              value={userId}
              onChange={(event) => {
                setUserId(event.target.value.trim());
                setPage(1);
              }}
            />
          </div>
        }
      >
        <div className="table-wrap">
          <Table<UsageEventRow>
            rowKey="id"
            loading={loading}
            dataSource={data?.list ?? []}
            size="middle"
            pagination={{
              current: page,
              pageSize: 20,
              total: data?.total ?? 0,
              showSizeChanger: false,
              onChange: setPage,
            }}
            locale={{ emptyText: <EmptyState text="暂无用量事件" /> }}
            columns={[
              {
                title: "时间",
                width: 160,
                render: (_, row) => <span className="text-12 muted">{fmtTime(row.occurredAt)}</span>,
              },
              { title: "板块", width: 130, render: (_, row) => aiModuleLabel(row.module) },
              {
                title: "动作",
                width: 140,
                render: (_, row) => (
                  <span className="text-12" title={row.model ? `模型：${row.model}` : undefined}>
                    {row.operation || "—"}
                  </span>
                ),
              },
              { title: "科目", width: 150, render: (_, row) => billingSubjectLabel(row.code) },
              {
                title: "用户",
                width: 200,
                render: (_, row) => <span className="mono text-12">{row.userId}</span>,
              },
              { title: "数量", width: 90, render: (_, row) => fmtPoints(row.quantityAmount) },
              {
                title: "token 入/出",
                width: 140,
                render: (_, row) =>
                  row.tokenInAmount || row.tokenOutAmount
                    ? `${fmtTokens(row.tokenInAmount)} / ${fmtTokens(row.tokenOutAmount)}`
                    : "—",
              },
              {
                title: "积分",
                width: 90,
                render: (_, row) => (row.pointsAmount ? fmtPoints(row.pointsAmount) : "—"),
              },
              {
                title: "计费",
                width: 90,
                render: (_, row) => (
                  <span className={`badge ${row.billed ? "badge-green" : "badge-gray"}`}>
                    {row.billed ? "已扣费" : "未扣分"}
                  </span>
                ),
              },
              { title: "说明", render: (_, row) => <span className="text-12">{row.remark || "—"}</span> },
            ]}
          />
        </div>
      </Panel>
    </>
  );
}

/* ---------------------------------------------------------------- 账户与调整 */

function AccountsPane() {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const params = { keyword: keyword || undefined, page, size: 20 };
  const { data, denied, loading, reload } = useAdminData(
    "points-accounts",
    (signal) => pointsAdminApi.accounts(params, { signal }),
    params,
  );

  const [adjustTarget, setAdjustTarget] = useState<PointsAccountRow | null>(null);
  const [adjustForm] = Form.useForm();
  const [txTarget, setTxTarget] = useState<PointsAccountRow | null>(null);

  const adjust = useOperationMutation(
    (input: { userId: string; delta: number; remark?: string }) => pointsAdminApi.adjust(input),
    ["points-accounts", "points-tx", "*"],
  );

  const onAdjust = async (values: Record<string, unknown>) => {
    if (!adjustTarget) return;
    try {
      await adjust.mutateAsync({
        userId: adjustTarget.userId,
        delta: Number(values.delta),
        remark: String(values.remark || ""),
      });
      message.success("积分已调整");
      setAdjustTarget(null);
      adjustForm.resetFields();
      await reload();
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  return (
    <>
      <PermissionNotice denied={denied} />
      <Panel
        title="积分账户"
        titleBadge={<span className="text-12 muted">共 {data?.total ?? 0} 个账户</span>}
        extra={
          <div style={{ display: "flex", gap: 8 }}>
            <Input
              allowClear
              placeholder="用户名 / 邀请码"
              style={{ width: 180 }}
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value.trim());
                setPage(1);
              }}
            />
            <Button onClick={() => void reload()}>刷新</Button>
          </div>
        }
      >
        <div className="table-wrap">
          <Table<PointsAccountRow>
            rowKey="userId"
            loading={loading}
            dataSource={data?.list ?? []}
            size="middle"
            pagination={{
              current: page,
              pageSize: 20,
              total: data?.total ?? 0,
              showSizeChanger: false,
              onChange: setPage,
            }}
            locale={{ emptyText: <EmptyState text="暂无积分账户（用户首次触发入账或查询时自动建户）" /> }}
            columns={[
              {
                title: "用户",
                width: 180,
                render: (_, row) => (
                  <div>
                    <div style={{ fontWeight: 600 }}>{row.username || row.userId}</div>
                    <span className="mono text-12 muted">{row.inviteCode || "—"}</span>
                  </div>
                ),
              },
              { title: "余额", width: 110, render: (_, row) => fmtPoints(row.balance) },
              { title: "累计充值", width: 110, render: (_, row) => fmtPoints(row.totalRecharge) },
              { title: "累计赚取", width: 110, render: (_, row) => fmtPoints(row.totalEarn) },
              { title: "累计消费", width: 110, render: (_, row) => fmtPoints(row.totalSpend) },
              {
                title: "状态",
                width: 100,
                render: (_, row) => stateBadge(ACCOUNT_STATUS, row.status),
              },
              {
                title: "操作",
                width: 160,
                render: (_, row) => (
                  <div style={{ display: "flex", gap: 8 }}>
                    <Button size="small" onClick={() => setAdjustTarget(row)}>
                      调整
                    </Button>
                    <Button size="small" onClick={() => setTxTarget(row)}>
                      流水
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        </div>
      </Panel>

      <Modal
        title={`调整积分${adjustTarget ? `：${adjustTarget.username || adjustTarget.userId}` : ""}`}
        open={Boolean(adjustTarget)}
        onCancel={() => setAdjustTarget(null)}
        onOk={() => adjustForm.submit()}
        okText="确认调整"
        cancelText="取消"
        confirmLoading={adjust.isPending}
      >
        <Notice variant="info">
          当前余额 {fmtPoints(adjustTarget?.balance)} 积分。正数加分、负数扣分，调整会落入流水（类型：管理员调整）。
        </Notice>
        <Form form={adjustForm} layout="vertical" onFinish={onAdjust} style={{ marginTop: 12 }}>
          <Form.Item name="delta" label="调整数量（正加负减）" rules={[{ required: true, message: "请输入调整数量" }]}>
            <InputNumber step={1} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input placeholder="如：补偿发放 / 违规扣减" maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`积分流水${txTarget ? `：${txTarget.username || txTarget.userId}` : ""}`}
        open={Boolean(txTarget)}
        onCancel={() => setTxTarget(null)}
        footer={null}
        width={900}
      >
        {txTarget ? <TransactionsTable userId={txTarget.userId} /> : null}
      </Modal>
    </>
  );
}

function TransactionsTable({ userId }: { userId: string }) {
  const [page, setPage] = useState(1);
  const params = { page, size: 10 };
  const { data, loading } = useAdminData(
    "points-tx",
    (signal) => pointsAdminApi.transactions(userId, params, { signal }),
    { userId, ...params },
  );

  return (
    <Table<PointTxRow>
      rowKey="id"
      loading={loading}
      dataSource={data?.list ?? []}
      size="small"
      pagination={{
        current: page,
        pageSize: 10,
        total: data?.total ?? 0,
        showSizeChanger: false,
        onChange: setPage,
      }}
      columns={[
        {
          title: "时间",
          width: 150,
          render: (_, row) => <span className="text-12 muted">{fmtTime(row.createdAt)}</span>,
        },
        { title: "类型", width: 100, render: (_, row) => TX_TYPE_LABEL[row.type] || row.type },
        { title: "场景", width: 100, render: (_, row) => txSceneLabel(row.scene) },
        {
          title: "积分",
          width: 100,
          render: (_, row) => (
            <span style={{ color: row.amount >= 0 ? "#1a7f37" : "#c62828", fontWeight: 600 }}>
              {row.amount > 0 ? "+" : ""}
              {fmtPoints(row.amount)}
            </span>
          ),
        },
        { title: "余额", width: 90, render: (_, row) => fmtPoints(row.balanceAmount) },
        { title: "说明", render: (_, row) => <span className="text-12">{row.remark || "—"}</span> },
      ]}
    />
  );
}

/* ---------------------------------------------------------------- 充值订单 */

function OrdersPane() {
  const [status, setStatus] = useState("");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const params = {
    status: status || undefined,
    keyword: keyword || undefined,
    page,
    size: 20,
  };
  const { data, denied, loading, reload } = useAdminData(
    "points-orders",
    (signal) => pointsAdminApi.orders(params, { signal }),
    params,
  );

  return (
    <>
      <PermissionNotice denied={denied} />
      <Panel
        title="充值订单"
        titleBadge={<span className="text-12 muted">共 {data?.total ?? 0} 单</span>}
        extra={
          <div style={{ display: "flex", gap: 8 }}>
            <Select
              allowClear
              placeholder="全部状态"
              style={{ width: 130 }}
              value={status || undefined}
              onChange={(value) => {
                setStatus(value || "");
                setPage(1);
              }}
              options={Object.entries(ORDER_STATUS).map(([value, meta]) => ({
                value,
                label: meta.label,
              }))}
            />
            <Input
              allowClear
              placeholder="订单号 / 用户名 / 邀请码"
              style={{ width: 220 }}
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value.trim());
                setPage(1);
              }}
            />
            <Button onClick={() => void reload()}>刷新</Button>
          </div>
        }
      >
        <div className="table-wrap">
          <Table<RechargeOrderRow>
            rowKey="orderNo"
            loading={loading}
            dataSource={data?.list ?? []}
            size="middle"
            pagination={{
              current: page,
              pageSize: 20,
              total: data?.total ?? 0,
              showSizeChanger: false,
              onChange: setPage,
            }}
            locale={{ emptyText: <EmptyState text="暂无充值订单" /> }}
            columns={[
              {
                title: "订单号",
                width: 200,
                render: (_, row) => <span className="mono text-12">{row.orderNo}</span>,
              },
              {
                title: "用户",
                width: 150,
                render: (_, row) => row.username || row.userId,
              },
              { title: "金额", width: 100, render: (_, row) => fmtYuan(row.amountCents) },
              {
                title: "到账积分",
                width: 130,
                render: (_, row) => (
                  <span>
                    {fmtPoints(row.pointsAmount)}
                    {row.bonusPointsAmount > 0 ? (
                      <span className="text-12" style={{ color: "#1a7f37" }}>
                        {" "}
                        +{fmtPoints(row.bonusPointsAmount)} 赠送
                      </span>
                    ) : null}
                  </span>
                ),
              },
              { title: "状态", width: 100, render: (_, row) => stateBadge(ORDER_STATUS, row.status) },
              {
                title: "微信交易号",
                width: 200,
                render: (_, row) => <span className="mono text-12">{row.transactionId || "—"}</span>,
              },
              {
                title: "创建时间",
                width: 160,
                render: (_, row) => <span className="text-12 muted">{fmtTime(row.createdAt)}</span>,
              },
              {
                title: "支付时间",
                width: 160,
                render: (_, row) => (
                  <span className="text-12 muted">{row.paidAt ? fmtTime(row.paidAt) : "—"}</span>
                ),
              },
            ]}
          />
        </div>
      </Panel>
    </>
  );
}

/* ---------------------------------------------------------------- 用量计费（§5.12） */

const BILLING_METRIC_LABEL: Record<string, string> = {
  token_in: "输入token",
  token_out: "输出token",
  call: "次数",
  byte: "字节",
  page: "页",
};

const BILLING_SCOPE_LABEL: Record<string, string> = {
  PLATFORM: "平台默认",
  ORG: "企业覆盖",
  PLAN: "套餐覆盖",
};

function fmtAmount(value: string | number | null | undefined) {
  return (Number(value) || 0).toLocaleString("zh-CN", { maximumFractionDigits: 4 });
}

/** upsert body 与契约 upsertBillingRuleBodySchema 输出同构（含 default 补齐后的必填字段）。 */
type BillingRuleUpsertBody = {
  code: string;
  scope: "PLATFORM" | "ORG" | "PLAN";
  orgUserId: string;
  metric: "token_in" | "token_out" | "call" | "byte" | "page";
  unitPriceAmount: number;
  baseFeeAmount: number;
  multiplier: number;
  minChargeAmount: number;
  maxChargeAmount: number;
  budgetCapMonthly: number;
  freeQuotaMonthly: number;
  enabled: boolean;
};

/**
 * BillingRule 按用量计费规则（方案 §5.12）：扣分 = baseFee + Σ(用量 × unitPrice × multiplier)。
 * PLATFORM 默认行由种子维护（skill_review 等 AI 科目），ORG/PLAN 为覆盖行；
 * 无任何规则行的科目自动回落旧 ModulePricing 按次口径（两路径互斥不双扣）。
 */
function BillingRulesPane() {
  const { message } = App.useApp();
  const { data, denied, loading, reload } = useAdminData("points-billing-rules", (signal) =>
    billingRuleApi.list({}, { signal }),
  );
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<BillingRule | null>(null);
  const [form] = Form.useForm();

  const upsert = useOperationMutation(
    (body: BillingRuleUpsertBody) => billingRuleApi.upsert({ body }),
    ["points-billing-rules", "*"],
  );
  const remove = useOperationMutation(
    (id: number) => billingRuleApi.remove({ body: { id } }),
    ["points-billing-rules", "*"],
  );

  const openEdit = (row: BillingRule) => {
    setEditing(row);
    form.setFieldsValue({
      code: row.code,
      scope: row.scope,
      orgUserId: row.orgUserId,
      metric: row.metric,
      unitPriceAmount: Number(row.unitPriceAmount),
      baseFeeAmount: Number(row.baseFeeAmount),
      multiplier: Number(row.multiplier),
      minChargeAmount: Number(row.minChargeAmount),
      maxChargeAmount: Number(row.maxChargeAmount),
      budgetCapMonthly: Number(row.budgetCapMonthly),
      freeQuotaMonthly: Number(row.freeQuotaMonthly),
      enabled: row.enabled,
    });
    setEditOpen(true);
  };

  const onSubmit = async (values: Record<string, unknown>) => {
    try {
      await upsert.mutateAsync({
        code: String(values.code || "").trim(),
        scope: (String(values.scope || "PLATFORM") as BillingRuleUpsertBody["scope"]),
        orgUserId: String(values.orgUserId || "").trim(),
        metric: (String(values.metric || "call") as BillingRuleUpsertBody["metric"]),
        unitPriceAmount: Number(values.unitPriceAmount) || 0,
        baseFeeAmount: Number(values.baseFeeAmount) || 0,
        multiplier: Number(values.multiplier) || 0,
        minChargeAmount: Number(values.minChargeAmount) || 0,
        maxChargeAmount: Number(values.maxChargeAmount) || 0,
        budgetCapMonthly: Number(values.budgetCapMonthly) || 0,
        freeQuotaMonthly: Number(values.freeQuotaMonthly) || 0,
        enabled: values.enabled !== false,
      });
      message.success("计费规则已保存，即时生效（版本自增、审计留痕）");
      setEditOpen(false);
      await reload();
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const toggleEnabled = async (row: BillingRule) => {
    try {
      await upsert.mutateAsync({
        code: row.code,
        scope: row.scope,
        orgUserId: row.orgUserId,
        metric: row.metric,
        unitPriceAmount: Number(row.unitPriceAmount),
        baseFeeAmount: Number(row.baseFeeAmount),
        multiplier: Number(row.multiplier),
        minChargeAmount: Number(row.minChargeAmount),
        maxChargeAmount: Number(row.maxChargeAmount),
        budgetCapMonthly: Number(row.budgetCapMonthly),
        freeQuotaMonthly: Number(row.freeQuotaMonthly),
        enabled: !row.enabled,
      });
      message.success(`科目「${billingSubjectLabel(row.code)}」规则已${row.enabled ? "停用" : "启用"}`);
      await reload();
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const onDelete = async (row: BillingRule) => {
    try {
      await remove.mutateAsync(row.id);
      message.success("覆盖行已删除，回落平台默认价");
      await reload();
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  return (
    <>
      <PermissionNotice denied={denied} />
      <Panel
        title="Agent 按用量计费规则（BillingRule）"
        titleBadge={<span className="text-12 muted">扣分 = 基础费 + Σ(用量 × 单价 × 倍率)；免费额整额免、预算帽超限本笔不计费</span>}
        extra={<Button onClick={() => void reload()}>刷新</Button>}
      >
        <Notice variant="info">
          1 元 = 10 积分口径下 AI 科目的 token/次数单价在这里配置（§8.4）；没有规则行的科目自动回落上方
          「模块价目」的按次口径，两条路径互斥不会双扣。ORG/PLAN 覆盖行优先于平台默认行，删除覆盖行即回落默认价。
        </Notice>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <Table<BillingRule>
            rowKey="id"
            loading={loading}
            dataSource={data ?? []}
            pagination={false}
            size="middle"
            locale={{ emptyText: <EmptyState text="暂无计费规则（播种未执行）" /> }}
            columns={[
              {
                title: "科目",
                width: 170,
                render: (_, row) => (
                  <div>
                    <div style={{ fontWeight: 600 }}>{billingSubjectLabel(row.code)}</div>
                    <span className="mono text-12 muted">{row.code}</span>
                  </div>
                ),
              },
              {
                title: "作用域",
                width: 140,
                render: (_, row) => (
                  <div>
                    <span className={`badge ${row.scope === "PLATFORM" ? "badge-blue" : "badge-orange"}`}>
                      {BILLING_SCOPE_LABEL[row.scope] || row.scope}
                    </span>
                    {row.orgUserId ? (
                      <div className="mono text-12 muted">{row.orgUserId}</div>
                    ) : null}
                  </div>
                ),
              },
              {
                title: "计量",
                width: 100,
                render: (_, row) => BILLING_METRIC_LABEL[row.metric] || row.metric,
              },
              { title: "基础费", width: 80, render: (_, row) => fmtAmount(row.baseFeeAmount) },
              { title: "单价", width: 90, render: (_, row) => fmtAmount(row.unitPriceAmount) },
              { title: "倍率", width: 70, render: (_, row) => fmtAmount(row.multiplier) },
              { title: "最低起扣", width: 90, render: (_, row) => fmtAmount(row.minChargeAmount) },
              {
                title: "单笔上限",
                width: 90,
                render: (_, row) => (Number(row.maxChargeAmount) > 0 ? fmtAmount(row.maxChargeAmount) : "不限"),
              },
              {
                title: "月预算帽",
                width: 90,
                render: (_, row) => (Number(row.budgetCapMonthly) > 0 ? fmtAmount(row.budgetCapMonthly) : "不限"),
              },
              {
                title: "月免费额",
                width: 90,
                render: (_, row) => (Number(row.freeQuotaMonthly) > 0 ? fmtAmount(row.freeQuotaMonthly) : "0"),
              },
              {
                title: "启用",
                width: 70,
                render: (_, row) => (
                  <Switch size="small" checked={row.enabled} loading={upsert.isPending} onChange={() => void toggleEnabled(row)} />
                ),
              },
              {
                title: "版本/更新",
                width: 150,
                render: (_, row) => (
                  <div>
                    <span className="text-12">v{row.version} · {row.updatedBy || "—"}</span>
                    <div className="text-12 muted">{fmtTime(row.updatedAt)}</div>
                  </div>
                ),
              },
              {
                title: "操作",
                width: 140,
                render: (_, row) => (
                  <div style={{ display: "flex", gap: 8 }}>
                    <Button size="small" onClick={() => openEdit(row)}>
                      编辑
                    </Button>
                    {row.scope !== "PLATFORM" ? (
                      <Button size="small" danger loading={remove.isPending} onClick={() => void onDelete(row)}>
                        删除
                      </Button>
                    ) : null}
                  </div>
                ),
              },
            ]}
          />
        </div>
      </Panel>

      <Modal
        title={`编辑计费规则${editing ? `：${billingSubjectLabel(editing.code)}` : ""}`}
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={() => form.submit()}
        okText="保存"
        cancelText="取消"
        confirmLoading={upsert.isPending}
        width={640}
      >
        <Notice variant="warn">
          科目 / 作用域 / 计量三项定位规则行本身，编辑时不可改（改它们等于新建另一行覆盖）；金额单位是积分。
        </Notice>
        <Form form={form} layout="vertical" onFinish={onSubmit} style={{ marginTop: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
            <Form.Item name="code" label="科目编码">
              <Input disabled />
            </Form.Item>
            <Form.Item name="scope" label="作用域">
              <Select disabled options={Object.entries(BILLING_SCOPE_LABEL).map(([value, label]) => ({ value, label }))} />
            </Form.Item>
            <Form.Item name="orgUserId" label="企业用户 ID">
              <Input disabled />
            </Form.Item>
            <Form.Item name="metric" label="计量指标">
              <Select disabled options={Object.entries(BILLING_METRIC_LABEL).map(([value, label]) => ({ value, label }))} />
            </Form.Item>
            <Form.Item name="baseFeeAmount" label="基础费（积分/次）">
              <InputNumber min={0} step={0.01} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="unitPriceAmount" label="单价（积分/计量单位）">
              <InputNumber min={0} step={0.001} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="multiplier" label="倍率">
              <InputNumber min={0} max={1000} step={0.1} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="minChargeAmount" label="最低起扣（积分）">
              <InputNumber min={0} step={0.01} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="maxChargeAmount" label="单笔上限（0 = 不限）">
              <InputNumber min={0} step={1} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="budgetCapMonthly" label="月预算帽（0 = 不限）">
              <InputNumber min={0} step={10} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="freeQuotaMonthly" label="月免费额（整额免）">
              <InputNumber min={0} step={1} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="enabled" label="启用" valuePropName="checked">
              <Switch checkedChildren="计费" unCheckedChildren="停用" />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </>
  );
}
