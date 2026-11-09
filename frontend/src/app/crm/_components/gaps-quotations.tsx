"use client";

import { Button, Form, Input, Modal, Select, Space, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { gapsApi, type QuotationTracking } from "@/api/gaps";
import { Notice, Panel } from "@/components/ui/panel";
import { gapError, zhTime } from "@/app/gaps/_components/gaps-common";

const TEMPLATE_LABELS: Record<string, string> = {
  CLASSIC: "经典版",
  MODERN: "现代版",
  MINIMAL: "极简版",
};

const money = (value: number | null | undefined) =>
  `¥${(Number(value) || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const downloadBase64 = (fileName: string, contentType: string, base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const blob = new Blob([bytes], { type: contentType || "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName || "quotation.pdf";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 3000);
};

/** B3#18 报价单 PDF 与发送跟踪：生成 PDF、生成公开免登录链接、记录打开次数与首次阅读时间。 */
export function GapsQuotationsTab() {
  const [rows, setRows] = useState<QuotationTracking[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState<QuotationTracking | null>(null);
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await gapsApi.quotationTracking({ query: { page, pageSize: 20 } });
      setRows(data?.list || []);
      setTotal(data?.total || 0);
      setError("");
    } catch (err) {
      setError(gapError(err));
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const download = async (row: QuotationTracking) => {
    try {
      const doc = await gapsApi.quotationDocument({ params: { id: String(row.id) } });
      if (!doc) throw new Error("报价单文档生成失败，请稍后重试");
      downloadBase64(doc.fileName, doc.contentType, doc.base64);
    } catch (err) {
      message.error(gapError(err));
    }
  };

  const openSend = (row: QuotationTracking) => {
    setActive(row);
    form.setFieldsValue({
      customerName: row.customerName,
      note: "",
      templateCode: "CLASSIC",
    });
  };

  const send = async () => {
    if (!active) return;
    try {
      const values = await form.validateFields();
      setBusy(true);
      const result = await gapsApi.sendQuotation({
        params: { id: String(active.id) },
        body: values,
      });
      const url = `${window.location.origin}${result?.publicUrl || ""}`;
      try {
        await navigator.clipboard.writeText(url);
        message.success("报价单已生成并复制公开链接");
      } catch {
        message.success("报价单已生成，可在「公开链接」列打开");
      }
      setActive(null);
      await load();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(gapError(err));
    } finally {
      setBusy(false);
    }
  };

  const columns: ColumnsType<QuotationTracking> = [
    { title: "报价单", dataIndex: "name" },
    { title: "客户", dataIndex: "customerName", width: 150 },
    { title: "金额", width: 140, render: (_, row) => money(row.amount) },
    {
      title: "发送时间",
      width: 150,
      render: (_, row) => (row.sentAt ? zhTime(row.sentAt) : <Tag>未发送</Tag>),
    },
    {
      title: "首次阅读",
      width: 150,
      render: (_, row) => (row.readAt ? zhTime(row.readAt) : "—"),
    },
    {
      title: "打开次数",
      width: 100,
      render: (_, row) => `${row.viewCount} 次`,
    },
    {
      title: "公开链接",
      width: 120,
      render: (_, row) =>
        row.publicUrl ? (
          <a href={row.publicUrl} target="_blank" rel="noreferrer">
            查看 PDF
          </a>
        ) : (
          "—"
        ),
    },
    {
      title: "操作",
      width: 190,
      render: (_, row) => (
        <>
          <Button size="small" type="link" onClick={() => void download(row)}>
            下载 PDF
          </Button>
          <Button size="small" type="link" onClick={() => openSend(row)}>
            {row.publicUrl ? "重新发送" : "发送"}
          </Button>
        </>
      ),
    },
  ];

  return (
    <Panel
      title="报价跟踪"
      titleExtra="报价单生成 PDF 与免登录公开链接；客户每次打开都累计次数并记录首次阅读时间"
    >
      {error ? <Notice variant="error">{error}</Notice> : null}
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1160 }}
        pagination={{
          current: page,
          pageSize: 20,
          total,
          showSizeChanger: false,
          onChange: setPage,
        }}
      />

      <Modal
        open={Boolean(active)}
        title={`发送报价单 · ${active?.name || ""}`}
        onCancel={() => setActive(null)}
        onOk={() => void send()}
        confirmLoading={busy}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item name="customerName" label="客户名称">
            <Input maxLength={120} />
          </Form.Item>
          <Form.Item name="templateCode" label="PDF 版式">
            <Select
              options={Object.entries(TEMPLATE_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </Form.Item>
          <Form.Item name="note" label="附言">
            <Input.TextArea rows={3} maxLength={1000} placeholder="会显示在报价单页眉下方" />
          </Form.Item>
          <Space className="text-12 muted">发送后会生成 /book 之外的公开链接，客户无需登录即可查看。</Space>
        </Form>
      </Modal>
    </Panel>
  );
}
