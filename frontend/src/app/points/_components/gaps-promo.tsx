"use client";

import {
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import { useCallback, useEffect, useRef, useState } from "react";
import { gapsApi, type PromoCode } from "@/api/gaps";
import { Notice } from "@/components/ui/panel";
import { useSession } from "@/lib/session";
import { gapError, gapStatusTag, zhTime } from "@/app/gaps/_components/gaps-common";

/**
 * 积分兑换码：平台管理员维护码目录，企业用户 / 个人 / 服务商只能输入兑换码换积分。
 * 管理入口按「当前身份」判断，管理员切到业务身份浏览时同样只看兑换框。
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
  const [redeemed, setRedeemed] = useState<{ points: number; balance: number; promoName: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form] = Form.useForm();

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
          maxRedemptions: row.maxRedemptions,
          perUserLimit: row.perUserLimit,
          startsAt: row.startsAt ? dayjs(row.startsAt) : null,
          endsAt: row.endsAt ? dayjs(row.endsAt) : null,
          status: row.status,
        }
      : { kind: "FIXED", status: "ACTIVE", perUserLimit: 1, maxRedemptions: 0 };
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
      await gapsApi.savePromoCode({
        body: {
          ...values,
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
    { title: "类型", dataIndex: "kindLabel", width: 110 },
    {
      title: "返积分",
      width: 110,
      render: (_, row) => (row.kind === "PERCENT" ? `${row.value}%` : `${row.value} 积分`),
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
          <div className="points-block-title">积分兑换码</div>
          <div className="points-tab-desc">
            {isAdmin
              ? "平台管理员维护兑换码；企业用户、个人、服务商只能输入兑换码兑换积分"
              : "输入兑换码直接兑换积分"}
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
        <Notice variant="success">
          兑换成功：{redeemed.promoName} 返 {redeemed.points} 积分，当前余额 {redeemed.balance}。
        </Notice>
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
