"use client";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";
import { taxApi } from "@/api/tax";

import {
  BookOutlined,
  CalculatorOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import { App, Button, Form, Input, Modal, Select, Space, Table } from "antd";
import { useCallback, useEffect, useState } from "react";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import {
  useTaxMeta,
  useTaxRecords,
  useTaxTrial,
  useSaveTaxRecord,
} from "@/query/tax";

import { declFormFields, fmtTime, money } from "./common";
import { RecordSnapshotView } from "./tax-tools-more";

/** 填报记录类型（对齐后端 RECORD_KINDS） */
const REC_KINDS: Record<string, { variant: string; label: string }> = {
  CALC: { variant: "sky", label: "申报表试算" },
  INSPECT: { variant: "blue", label: "工商年检" },
  LEGACY: { variant: "orange", label: "旧账导入" },
  REPORT: { variant: "green", label: "报表导出" },
};

type TaxRecord = NonNullable<
  import("@enterprise/contracts").EndpointResponse<"Tax_records">["data"]
>[number];

/** 🧮 纳税申报工具（国标申报表在线试算） */
export function TaxCalcTools({
  enterprise,
}: {
  /** 企业档案：纳税人名称 / 识别号预填（demo basicHeader） */
  enterprise?: Record<string, unknown> | null;
}) {
  const { save: saveTaxRecord } = useSaveTaxRecord();

  const { message } = App.useApp();
  const metaQuery = useTaxMeta();
  const forms = metaQuery.data?.forms ?? [];
  const [open, setOpen] = useState(false);
  const [taxType, setTaxType] = useState("vat_general");
  const [form] = Form.useForm();
  const [trialForm, setTrialForm] = useState<Record<string, number>>({});
  const [debouncedForm, setDebouncedForm] = useState<Record<string, number>>(
    {},
  );
  const trialQuery = useTaxTrial(taxType, debouncedForm, open);
  const waiting = trialForm !== debouncedForm || trialQuery.isFetching;
  const amount = trialQuery.data?.tax_amount;
  const [saving, setSaving] = useState(false);
  /** 申报表基础信息（纳税人名称 / 识别号 / 税款所属期） */
  const [basic, setBasic] = useState({
    taxpayerName: "",
    uscc: "",
    period: "",
  });
  useEffect(() => {
    if (metaQuery.data?.forms[0]) setTaxType(metaQuery.data.forms[0].type);
  }, [metaQuery.data]);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedForm(trialForm), 300);
    return () => clearTimeout(timer);
  }, [trialForm]);
  const recalc = (values: Record<string, unknown>) =>
    setTrialForm(
      Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key, Number(value) || 0]),
      ),
    );

  const fields = declFormFields(taxType);
  const template = forms.find((item) => item.type === taxType);
  const formLabel = template?.label || taxType;
  /** 未在模板清单内的税种（demo：「未找到该申报表模板」） */
  const templateFound = Boolean(template);

  return (
    <Panel
      title={
        <>
          <CalculatorOutlined aria-hidden /> 纳税申报工具（国标申报表在线试算）
        </>
      }
    >
      {metaQuery.isError ? (
        <Notice variant="error">
          {metaQuery.error.message}{" "}
          <Button onClick={() => void metaQuery.refetch()}>重试</Button>
        </Notice>
      ) : null}
      <div className="tool-group">
        <button
          type="button"
          className="tool-card"
          onClick={() => {
            form.resetFields();
            setTrialForm({});
            setDebouncedForm({});
            // 预填企业档案基础信息（纳税人名称 / 识别号）
            setBasic({
              taxpayerName: String(enterprise?.name || ""),
              uscc: String(enterprise?.uscc || ""),
              period: "",
            });
            setOpen(true);
          }}
        >
          <span className="tool-name">{formLabel}</span>
          <span className="tool-hint">在线试算</span>
        </button>
      </div>
      <div className="text-12 muted" style={{ marginTop: 10 }}>
        在线试算工具：填写数据实时测算应缴税费，填写内容通过工作台接口计算；点击「留存试算记录」可将本次填报内容存入「填报记录」台账，正式申报由签约服务商在平台创建申报单完成。
      </div>

      <Modal
        open={open}
        title={`${formLabel} · 在线试算`}
        width={620}
        footer={
          <Space>
            <span className="text-12 muted">
              应纳税（费）额合计：¥
              <span className="mono">
                {waiting
                  ? "计算中"
                  : amount === undefined
                    ? "暂不可用"
                    : money(amount)}
              </span>
            </span>
            <Button
              type="primary"
              loading={saving}
              disabled={
                !templateFound ||
                waiting ||
                trialQuery.isError ||
                amount === undefined
              }
              onClick={async () => {
                if (amount === undefined || waiting || trialQuery.isError)
                  return;
                const values = trialForm;
                setSaving(true);
                try {
                  await saveTaxRecord(
                    "CALC",
                    formLabel,
                    `应纳税（费）额合计 ¥${money(amount)}`,
                    {
                      tax_type: taxType,
                      form: values,
                      tax_amount: amount,
                      // 留存字段对齐 demo：申报表模板/纳税人名称/识别号/所属期/合计
                      fields: [
                        { label: "申报表模板", value: formLabel },
                        {
                          label: "纳税人名称",
                          value: basic.taxpayerName || "",
                        },
                        {
                          label: "纳税人识别号",
                          value: basic.uscc || "",
                        },
                        { label: "税款所属期", value: basic.period || "" },
                        {
                          label: "应纳税（费）额合计（元）",
                          value: money(amount),
                        },
                      ],
                    },
                  );
                  message.success("填报内容已留存，可在「填报记录」台账回看");
                  setOpen(false);
                } catch (error) {
                  if (error instanceof Error)
                    presentMutationError(error, (text) => message.error(text));
                } finally {
                  setSaving(false);
                }
              }}
            >
              <SaveOutlined aria-hidden /> 留存试算记录
            </Button>
            <Button onClick={() => setOpen(false)}>关闭</Button>
          </Space>
        }
        onCancel={() => setOpen(false)}
      >
        {trialQuery.isError ? (
          <Notice variant="error">
            试算失败：{trialQuery.error.message}{" "}
            <Button onClick={() => void trialQuery.refetch()}>重试</Button>
          </Notice>
        ) : null}
        <Form
          form={form}
          layout="vertical"
          onValuesChange={(_changed, values) => recalc(values)}
        >
          <Form.Item label="申报表模板">
            <Select
              value={taxType}
              options={forms.map((item) => ({
                value: item.type,
                label: item.label,
              }))}
              onChange={(value) => {
                setTaxType(String(value));
                form.resetFields();
                setTrialForm({});
                setDebouncedForm({});
              }}
            />
          </Form.Item>
          {templateFound ? (
            <>
              <div className="form-2col">
                <Form.Item label="纳税人名称">
                  <Input
                    value={basic.taxpayerName}
                    placeholder="企业名称"
                    onChange={(event) =>
                      setBasic((current) => ({
                        ...current,
                        taxpayerName: event.target.value,
                      }))
                    }
                  />
                </Form.Item>
                <Form.Item label="纳税人识别号">
                  <Input
                    value={basic.uscc}
                    placeholder="统一社会信用代码"
                    onChange={(event) =>
                      setBasic((current) => ({
                        ...current,
                        uscc: event.target.value,
                      }))
                    }
                  />
                </Form.Item>
                <Form.Item label="税款所属期">
                  <Input
                    value={basic.period}
                    placeholder="如 2026-10-01 至 2026-12-31"
                    onChange={(event) =>
                      setBasic((current) => ({
                        ...current,
                        period: event.target.value,
                      }))
                    }
                  />
                </Form.Item>
              </div>
              <div className="form-2col">
                {fields.map((field) => (
                  <Form.Item
                    key={field.name}
                    name={field.name}
                    label={field.label}
                  >
                    <Input type="number" placeholder="0.00" />
                  </Form.Item>
                ))}
              </div>
            </>
          ) : (
            <div className="text-13 muted" style={{ padding: "8px 0" }}>
              未找到该申报表模板
            </div>
          )}
        </Form>
      </Modal>
    </Panel>
  );
}

/** 📒 填报记录（企业填报台账） */
export function TaxRecordsPanel() {
  const tax_deleteRecordMutation = useOperationMutation(taxApi.deleteRecord, [
    "tax",
    "dashboard",
  ]);

  const { message } = App.useApp();
  const { request: requestPassword, modal: passwordModal } =
    usePasswordConfirm();
  const [kind, setKind] = useState("");

  const [detail, setDetail] = useState<TaxRecord | null>(null);

  const [page, setPage] = useState(1);
  const recordsQuery = useTaxRecords(kind, page);
  const rows = recordsQuery.data?.list ?? [];
  const loading = recordsQuery.isPending;
  const { refetch } = recordsQuery;
  const load = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const remove = (row: TaxRecord) => {
    requestPassword({
      title: "删除填报记录",
      danger: true,
      okText: "确认删除",
      content: `删除后不可恢复，确定删除「${row.title}」这条记录吗？`,
      onOk: async () => {
        await tax_deleteRecordMutation.mutateAsync({
          params: { id: String(row.id) },
        });

        message.success("已删除");
      },
    });
  };

  return (
    <Panel
      title={
        <>
          <BookOutlined aria-hidden /> 填报记录（企业填报台账）
        </>
      }
      titleBadge={`${recordsQuery.data?.total ?? 0} 条`}
      extra={
        <Select
          size="small"
          style={{ width: 150 }}
          value={kind}
          onChange={(value) => {
            setKind(value);
            setPage(1);
          }}
          options={[
            { value: "", label: "全部类型" },
            ...Object.keys(REC_KINDS).map((key) => ({
              value: key,
              label: REC_KINDS[key].label,
            })),
          ]}
        />
      }
    >
      {recordsQuery.isError ? (
        <Notice variant="error">
          {recordsQuery.error.message}{" "}
          <Button onClick={() => void load()}>重试</Button>
        </Notice>
      ) : null}
      <div className="text-12 muted" style={{ marginBottom: 10 }}>
        试算、工商年检、旧账导入与报表导出的填报内容自动留痕，可随时回看
      </div>
      <div className="table-wrap">
        <Table<TaxRecord>
          rowKey="id"
          loading={loading}
          pagination={{
            current: page,
            pageSize: 20,
            total: recordsQuery.data?.total ?? 0,
            showSizeChanger: false,
            onChange: setPage,
          }}
          dataSource={rows}
          locale={{
            emptyText: (
              <EmptyState
                icon={<BookOutlined aria-hidden />}
                text="暂无填报记录。使用下方财税工具完成试算、工商年检、旧账导入或报表导出后，内容将自动留存于此"
              />
            ),
          }}
          columns={[
            {
              title: "填报时间",
              dataIndex: "createdAt",
              width: 170,
              render: (value: string) => (
                <span className="text-12">{fmtTime(value)}</span>
              ),
            },
            {
              title: "类型",
              dataIndex: "kind",
              width: 120,
              render: (value: string) => (
                <span
                  className={`badge badge-${REC_KINDS[value]?.variant || "gray"}`}
                >
                  {REC_KINDS[value]?.label || value || "—"}
                </span>
              ),
            },
            { title: "填报内容", dataIndex: "title" },
            {
              title: "摘要",
              render: (_, row) => {
                const snapshot = row.snapshot || {};
                const summary =
                  (snapshot.summary as string) ||
                  (snapshot.tax_amount !== undefined
                    ? `应纳税（费）额合计 ¥${money(snapshot.tax_amount)}`
                    : "—");
                return <span className="text-12 muted">{summary}</span>;
              },
            },
            {
              title: "操作",
              width: 140,
              render: (_, row) => (
                <Space size={6}>
                  <Button onClick={() => setDetail(row)}>查看</Button>
                  <Button danger onClick={() => remove(row)}>
                    删除
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </div>

      <Modal
        open={Boolean(detail)}
        title={`填报记录详情 · ${detail?.title || ""}`}
        width={720}
        footer={<Button onClick={() => setDetail(null)}>关闭</Button>}
        onCancel={() => setDetail(null)}
      >
        <div className="text-12 muted" style={{ marginBottom: 10 }}>
          填报时间：{fmtTime(detail?.createdAt)}　·　类型：
          {REC_KINDS[detail?.kind || ""]?.label || detail?.kind || "—"}
        </div>
        <RecordSnapshotView snapshot={detail?.snapshot} />
      </Modal>

      {passwordModal}
    </Panel>
  );
}
