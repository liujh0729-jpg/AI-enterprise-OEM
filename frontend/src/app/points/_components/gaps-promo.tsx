"use client";

import {
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import { useCallback, useEffect, useRef, useState } from "react";
import { cardApi, gapsApi, type PromoCode } from "@/api/gaps";
import { Notice } from "@/components/ui/panel";
import { HelpTopicButton } from "@/components/ui/help-topic-button";
import { useBusinessQuery } from "@/query/business";
import { useSession } from "@/lib/session";
import { gapError, gapStatusTag, zhTime } from "@/app/gaps/_components/gaps-common";

type RedeemResult = Awaited<ReturnType<typeof gapsApi.redeemPromoCode>>;

/**
 * 兑换码：平台管理员维护码目录，企业用户 / 个人 / 服务商只能输入兑换码兑换。
 * 管理入口按「当前身份」判断，管理员切到业务身份浏览时同样只看兑换框。
 *
 * 同一个码框既能兑积分也能兑时长卡：分流在后端按码目录行的 assetType 完成，
 * 这里只负责「兑的是什么」的录入（积分值 / 卡规格）与结果文案。
 */
export function GapsPromoPanel() {
  const { me } = useSession();
  const isAdmin =
    me?.currentIdentity === "PLATFORM_ADMIN" &&
    Boolean(me?.identities?.includes("PLATFORM_ADMIN"));
  const [rows, setRows] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [needAmount, setNeedAmount] = useState(false);
  const [busy, setBusy] = useState(false);
  const [redeemed, setRedeemed] = useState<RedeemResult | null>(null);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form] = Form.useForm();
  const assetType = Form.useWatch("assetType", form);
  // 卡规格下拉只列启用中的规格（后端对非管理侧已过滤），管理员同样走这个口径
  const specQuery = useBusinessQuery(
    "points",
    "card-templates",
    {},
    (signal) => cardApi.templates({}, { signal }),
    "all",
    isAdmin,
  );
  const specOptions = (specQuery.data ?? []).map((spec) => ({
    value: spec.code,
    label: `${spec.name}｜${spec.modelName}｜${spec.quotaLabel}｜${spec.validDays} 天`,
  }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await gapsApi.promoCodes()) ?? []);
      setError("");
    } catch (err) {
      setError(gapError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const redeem = async () => {
    if (!code.trim()) {
      message.error("请输入兑换码");
      return;
    }
    setBusy(true);
    try {
      const result = await gapsApi.redeemPromoCode({
        body: { code: code.trim(), amount: Number(amount) || 0 },
      });
      setRedeemed(result);
      setCode("");
      setAmount(null);
      setNeedAmount(false);
      if (isAdmin) await load();
    } catch (err) {
      const text = gapError(err);
      if (/金额/.test(text)) {
        setNeedAmount(true);
        message.warning("该兑换码按订单金额返积分，请填写订单金额后再兑换");
      } else {
        message.error(text);
      }
    } finally {
      setBusy(false);
    }
  };

  const initialRef = useRef<Record<string, unknown>>({});
  const openEditor = (row?: PromoCode) => {
    initialRef.current = row
      ? {
          id: row.id,
          code: row.code,
          name: row.name,
          kind: row.kind,
          value: row.value,
          assetType: row.assetType || "POINTS",
          cardCode: row.cardCode || undefined,
          maxRedemptions: row.maxRedemptions,
          perUserLimit: row.perUserLimit,
          startsAt: row.startsAt ? dayjs(row.startsAt) : null,
          endsAt: row.endsAt ? dayjs(row.endsAt) : null,
          status: row.status,
        }
      : {
          kind: "FIXED",
          assetType: "POINTS",
          status: "ACTIVE",
          perUserLimit: 1,
          maxRedemptions: 0,
        };
    setEditingId(row?.id ?? null);
    setOpen(true);
  };

  // 弹窗按需挂载：等 Form 连上实例后再回填，避免在未连接时调用 form 方法触发告警
  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue(initialRef.current);
  }, [open, form]);

  const save = async () => {
    try {
      const values = await form.validateFields();
      const isCard = values.assetType === "CARD";
      await gapsApi.savePromoCode({
        body: {
          ...values,
          // 兑卡时积分维度全部由规格行决定：kind/value 归零，避免留下可读但无意义的比例值
          kind: isCard ? "FIXED" : values.kind,
          value: isCard ? 0 : values.value,
          cardCode: isCard ? values.cardCode : "",
          minAmount: 0,
          startsAt: values.startsAt ? (values.startsAt as Dayjs).toISOString() : "",
          endsAt: values.endsAt ? (values.endsAt as Dayjs).toISOString() : "",
        },
      });
      message.success("兑换码已保存");
      setOpen(false);
      await load();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(gapError(err));
    }
  };

  const columns: ColumnsType<PromoCode> = [
    { title: "兑换码", dataIndex: "code", width: 150 },
    { title: "名称", dataIndex: "name" },
    {
      title: "兑付内容",
      width: 230,
      render: (_, row) =>
        row.assetType === "CARD" ? (
          <Tag color="purple">
            时长卡 · {row.cardName || row.cardCode || "未绑规格"}
          </Tag>
        ) : row.kind === "PERCENT" ? (
          `订单金额 ${row.value}%`
        ) : (
          `${row.value} 积分`
        ),
    },
    {
      title: "使用情况",
      width: 130,
      render: (_, row) =>
        `${row.redeemedCount}${row.maxRedemptions ? ` / ${row.maxRedemptions}` : ""} 次`,
    },
    {
      title: "有效期",
      width: 200,
      render: (_, row) =>
        `${row.startsAt ? zhTime(row.startsAt) : "—"} ~ ${row.endsAt ? zhTime(row.endsAt) : "长期"}`,
    },
    { title: "状态", width: 80, render: (_, row) => gapStatusTag(row.status) },
    ...(isAdmin
      ? [
          {
            title: "操作",
            width: 130,
            render: (_: unknown, row: PromoCode) => (
              <>
                <Button size="small" type="link" onClick={() => openEditor(row)}>
                  编辑
                </Button>
                <Button
                  size="small"
                  type="link"
                  danger
                  onClick={async () => {
                    try {
                      await gapsApi.removePromoCode({ body: { id: row.id } });
                      message.success("已删除");
                      await load();
                    } catch (err) {
                      message.error(gapError(err));
                    }
                  }}
                >
                  删除
                </Button>
              </>
            ),
          } satisfies ColumnsType<PromoCode>[number],
        ]
      : []),
  ];

  return (
    <div>
      <div className="points-tab-head">
        <div>
          <div className="points-block-title">兑换码</div>
          <div className="points-tab-desc">
            {isAdmin
              ? "平台管理员维护兑换码；企业用户、个人、服务商只能输入兑换码兑换积分或时长卡"
              : "输入兑换码即可兑换：积分码直接到账，时长卡码当场激活"}
          </div>
        </div>
        {isAdmin ? (
          <Button type="primary" onClick={() => openEditor()}>
            新建兑换码
          </Button>
        ) : null}
      </div>
      {error ? <Notice variant="error">{error}</Notice> : null}
      <div className="points-inline-form">
        <Input
          value={code}
          onChange={(event) => {
            setCode(event.target.value.toUpperCase());
            setNeedAmount(false);
            setAmount(null);
          }}
          placeholder="兑换码"
          maxLength={32}
          style={{ width: 220 }}
        />
        {needAmount ? (
          <InputNumber
            min={0}
            value={amount ?? undefined}
            onChange={(value) => setAmount(typeof value === "number" ? value : null)}
            prefix="¥"
            placeholder="订单金额"
            style={{ width: 200 }}
          />
        ) : null}
        <Button type="primary" loading={busy} onClick={() => void redeem()}>
          兑换
        </Button>
      </div>
      {needAmount ? (
        <div className="text-12 muted" style={{ marginBottom: 12 }}>
          该兑换码按订单金额返积分，请填写订单金额（元）后再次点击兑换。
        </div>
      ) : null}
      {redeemed ? (
        redeemed.assetType === "CARD" && redeemed.card ? (
          <Notice variant="success">
            <div>
              兑换成功：{redeemed.card.name} 已激活，额度立即生效。
            </div>
            <div className="text-12" style={{ marginTop: 4 }}>
              {redeemed.card.modelName}（{redeemed.card.modelKey}）·{" "}
              {redeemed.card.quotaLabel} · 有效期至{" "}
              {zhTime(redeemed.card.expiresAt)}
            </div>
            <Space style={{ marginTop: 8 }}>
              <Button size="small" type="primary" href="/model-plaza">
                去使用
              </Button>
              <span className="text-12 muted">
                同一模型才能扣这张卡的额度；到期未用完的额度不结转。
              </span>
            </Space>
          </Notice>
        ) : (
          <Notice variant="success">
            兑换成功：{redeemed.promoName} 返 {redeemed.points} 积分，当前余额{" "}
            {redeemed.balance}。
          </Notice>
        )
      ) : null}
      {!isAdmin ? (
        <div className="text-12 muted" style={{ marginBottom: 12 }}>
          不确定码是哪种、卡怎么用？
          <HelpTopicButton topic="in-card-codes" />
        </div>
      ) : null}
      {isAdmin ? (
        <div className="table-wrap">
          <Table
            rowKey="id"
            size="middle"
            loading={loading}
            columns={columns}
            dataSource={rows}
            scroll={{ x: 1000 }}
            pagination={false}
          />
        </div>
      ) : null}

      <Modal
        open={open}
        title={editingId ? "编辑兑换码" : "新建兑换码"}
        onCancel={() => setOpen(false)}
        onOk={() => void save()}
        width={620}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>
          <Space style={{ display: "flex" }} wrap>
            <Form.Item name="code" label="兑换码" rules={[{ required: true, message: "请填写兑换码" }]} style={{ width: 200 }}>
              <Input maxLength={32} placeholder="WELCOME2026" />
            </Form.Item>
            <Form.Item name="name" label="名称" rules={[{ required: true, message: "请填写名称" }]} style={{ width: 300 }}>
              <Input maxLength={80} />
            </Form.Item>
          </Space>
          <Form.Item name="assetType" label="兑换内容" rules={[{ required: true }]}>
            <Radio.Group
              options={[
                { value: "POINTS", label: "积分" },
                { value: "CARD", label: "时长卡（日卡、30 天卡）" },
              ]}
            />
          </Form.Item>
          {assetType === "CARD" ? (
            <Space style={{ display: "flex" }} wrap>
              <Form.Item
                name="cardCode"
                label="卡规格"
                rules={[{ required: true, message: "请选择要发放的时长卡规格" }]}
                style={{ width: 340 }}
                extra="一张卡只绑一个模型；额度与有效期都取自规格，发放后不可改"
              >
                <Select
                  showSearch
                  loading={specQuery.isPending}
                  options={specOptions}
                  optionFilterProp="label"
                  placeholder={specQuery.isPending ? "规格加载中…" : "选择时长卡规格"}
                  notFoundContent={
                    <span className="text-12">
                      还没有启用中的卡规格，请先在「平台管理 → 积分与计费 → 时长卡规格」新建
                    </span>
                  }
                />
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
          ) : (
            <Space style={{ display: "flex" }} wrap>
              <Form.Item name="kind" label="类型" style={{ width: 160 }}>
                <Select
                  options={[
                    { value: "FIXED", label: "固定积分" },
                    { value: "PERCENT", label: "按比例返积分" },
                  ]}
                />
              </Form.Item>
              <Form.Item name="value" label="返积分值" rules={[{ required: true, message: "请填写返积分值" }]} style={{ width: 160 }}>
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
          )}
          <Space style={{ display: "flex" }} wrap>
            <Form.Item name="maxRedemptions" label="总核销上限（0 不限）" style={{ width: 180 }}>
              <InputNumber min={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="perUserLimit" label="每人上限" style={{ width: 120 }}>
              <InputNumber min={1} max={100} style={{ width: "100%" }} />
            </Form.Item>
          </Space>
          <Space style={{ display: "flex" }} wrap>
            <Form.Item name="startsAt" label="开始时间" style={{ width: 220 }}>
              <DatePicker showTime style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="endsAt" label="结束时间" style={{ width: 220 }}>
              <DatePicker showTime style={{ width: "100%" }} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
