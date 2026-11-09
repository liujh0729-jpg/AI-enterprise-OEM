"use client";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";
import { taxApi } from "@/api/tax";
import { aiApi, type AiTaxCheck } from "@/api/ai";
import { AiList, AiResultModal } from "@/components/ai-result";

import {
  BankOutlined,
  FileTextOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { App, Button, Select, Space } from "antd";
import { useMemo, useState } from "react";
import {
  RowListEditor,
  type EditorRow,
  type RowField,
} from "@/components/row-list-editor";
import { StatusBadge } from "@/components/status-badge";
import { Notice, Panel } from "@/components/ui/panel";
import { useCurrentMaterialPack } from "@/query/tax";

import { money } from "./common";
import { InvoiceOcrButton } from "./invoice-ocr";

type Section = "payroll" | "invoices" | "bank";

const SECTION_FIELDS: Record<Section, RowField[]> = {
  payroll: [
    { name: "name", label: "姓名", required: true, placeholder: "员工姓名" },
    { name: "idCard", label: "身份证号", placeholder: "15 / 18 位" },
    { name: "salary", label: "月工资(元)", type: "number" },
    { name: "socialSecurity", label: "社保(元)", type: "number" },
    { name: "housingFund", label: "公积金(元)", type: "number" },
  ],
  invoices: [
    {
      name: "kind",
      label: "类型",
      type: "select",
      options: [
        { label: "销项发票", value: "销项" },
        { label: "进项发票", value: "进项" },
        { label: "费用小票", value: "费用" },
        { label: "无票收入", value: "无票" },
      ],
    },
    { name: "invoiceNo", label: "发票号码", required: true },
    { name: "counterparty", label: "对方" },
    { name: "amount", label: "金额(元)", type: "number" },
    { name: "tax", label: "税额(元)", type: "number" },
    { name: "date", label: "日期", placeholder: "YYYY-MM-DD" },
  ],
  bank: [
    { name: "date", label: "日期", required: true, placeholder: "YYYY-MM-DD" },
    {
      name: "direction",
      label: "收支",
      type: "select",
      options: [
        { label: "收入", value: "收入" },
        { label: "支出", value: "支出" },
      ],
    },
    { name: "amount", label: "金额(元)", type: "number" },
    { name: "counterparty", label: "对方" },
    { name: "summary", label: "摘要" },
  ],
};

const SECTION_COLUMNS: Record<
  Section,
  {
    title: string;
    dataIndex?: string;
    render?: (row: EditorRow) => React.ReactNode;
  }[]
> = {
  payroll: [
    { title: "姓名", dataIndex: "name" },
    {
      title: "身份证号",
      dataIndex: "idCard",
      render: (row) => (
        <span className="mono text-12">{String(row.idCard || "—")}</span>
      ),
    },
    {
      title: "月工资(元)",
      render: (row) => <span className="mono">{money(row.salary)}</span>,
    },
    {
      title: "社保(元)",
      render: (row) => (
        <span className="mono">{money(row.socialSecurity)}</span>
      ),
    },
    {
      title: "公积金(元)",
      render: (row) => <span className="mono">{money(row.housingFund)}</span>,
    },
  ],
  invoices: [
    { title: "类型", dataIndex: "kind" },
    {
      title: "发票号码",
      dataIndex: "invoiceNo",
      render: (row) => (
        <span className="mono text-12">{String(row.invoiceNo || "—")}</span>
      ),
    },
    { title: "对方", dataIndex: "counterparty" },
    {
      title: "金额(元)",
      render: (row) => <span className="mono">{money(row.amount)}</span>,
    },
    {
      title: "税额(元)",
      render: (row) => <span className="mono">{money(row.tax)}</span>,
    },
    { title: "日期", dataIndex: "date" },
  ],
  bank: [
    { title: "日期", dataIndex: "date" },
    { title: "收支", dataIndex: "direction" },
    {
      title: "金额(元)",
      render: (row) => <span className="mono">{money(row.amount)}</span>,
    },
    { title: "对方", dataIndex: "counterparty" },
    { title: "摘要", dataIndex: "summary" },
  ],
};

function recentPeriods(count = 6) {
  const out: { label: string; value: string }[] = [];
  const now = new Date();
  for (let i = 0; i < count; i += 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    out.push({ label: `${value} 属期`, value });
  }
  return out;
}

/**
 * 企业报税工作台的材料录入：三步（员工与工资 / 发票 / 银行流水）全部逐条添加。
 * 每添加一条立即落库，列表可见、可单条编辑与删除。
 */
export function MaterialPackPanel() {
  const tax_addMaterialRowMutation = useOperationMutation(
    taxApi.addMaterialRow,
    ["tax", "dashboard"],
  );
  const tax_updateMaterialRowMutation = useOperationMutation(
    taxApi.updateMaterialRow,
    ["tax", "dashboard"],
  );
  const tax_submitMaterialPackMutation = useOperationMutation(
    taxApi.submitMaterialPack,
    ["tax", "dashboard"],
  );

  const { message } = App.useApp();
  const periods = useMemo(() => recentPeriods(), []);
  const [period, setPeriod] = useState(periods[0].value);
  const packQuery = useCurrentMaterialPack(period);
  const pack = packQuery.data;
  const loading = packQuery.isPending;
  const load = async () => {
    await packQuery.refetch();
  };
  /** 发票 OCR 识别结果：预填「＋ 添加发票」表单后立即清空 */
  const [pendingInvoice, setPendingInvoice] = useState<EditorRow | null>(null);
  const [aiCheck, setAiCheck] = useState<AiTaxCheck | null>(null);
  const [aiCheckOpen, setAiCheckOpen] = useState(false);
  const [aiCheckLoading, setAiCheckLoading] = useState(false);

  const runAiCheck = async () => {
    if (!pack) {
      message.warning("请先录入材料再体检");
      return;
    }
    const text = JSON.stringify(pack.payload || {});
    if (text.length < 10) {
      message.warning("材料还是空的，先逐条录入员工、发票或流水");
      return;
    }
    setAiCheckOpen(true);
    setAiCheckLoading(true);
    setAiCheck(null);
    try {
      setAiCheck(await aiApi.taxCheck({ body: { text, region: "中国" } }));
    } catch (error) {
      presentMutationError(error, (text) => message.error(text));
      setAiCheckOpen(false);
    } finally {
      setAiCheckLoading(false);
    }
  };

  const rowsOf = (section: Section) => pack?.payload?.[section] || [];

  const addRow = async (section: Section, row: EditorRow) => {
    try {
      if (!pack) return;
      await tax_addMaterialRowMutation.mutateAsync({
        params: { id: String(pack.id) },
        body: { section, row },
      });
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const updateRow = async (
    section: Section,
    rowId: string,
    patch: EditorRow,
  ) => {
    try {
      if (!pack) return;
      await tax_updateMaterialRowMutation.mutateAsync({
        params: { id: String(pack.id), rowId: String(rowId) },
        body: { section, patch },
      });
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const removeRowMutation = useOperationMutation(taxApi.removeMaterialRow, [
    "tax",
  ]);
  const removeRow = async (section: Section, rowId: string) => {
    if (!pack) return;
    await removeRowMutation.mutateAsync({
      params: { id: String(pack.id), rowId },
      query: { section },
    });
  };

  const submit = async () => {
    try {
      if (!pack) return;
      const payload = await tax_submitMaterialPackMutation.mutateAsync({
        params: { id: String(pack.id) },
        body: {},
      });

      const tip = payload?.tip || "报税材料已提交";
      message.success(tip);
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  if (packQuery.isError)
    return (
      <Notice variant="error">
        {packQuery.error.message}{" "}
        <Button onClick={() => void load()}>重试</Button>
      </Notice>
    );
  return (
    <>
      <Panel
        title="报税材料录入（三步 · 逐条添加）"
        extra={
          <Space>
            <Select
              size="small"
              value={period}
              options={periods}
              style={{ width: 130 }}
              onChange={setPeriod}
            />
            {pack ? (
              <Button onClick={() => void runAiCheck()}>AI 材料体检</Button>
            ) : null}
            {pack ? (
              <Button
                type="primary"
                disabled={pack.status !== "DRAFT"}
                onClick={submit}
              >
                提交报税材料
              </Button>
            ) : null}
          </Space>
        }
      >
        <Notice variant="info">
          三步材料都逐条添加：点「＋
          添加…」一次只填一条，保存后进入下方列表，可单条编辑或删除；
          适合按人、按张发票、按笔流水逐一录入。
        </Notice>
        {pack ? (
          <div className="text-12 muted">
            材料编号 <span className="mono">{pack.packNo}</span> · 属期{" "}
            {pack.period} · 状态{" "}
            <StatusBadge domain="taxMaterial" status={pack.status} />
          </div>
        ) : (
          <div className="text-12 muted">
            选好属期后，点任意「＋ 添加…」即自动建立该属期材料档案。
          </div>
        )}
      </Panel>

      <RowListEditor
        title="1 员工与工资"
        tip="按人逐条添加本月发薪员工与工资数据；AI 据此测算工资薪金个人所得税扣缴申报。"
        addText="＋ 添加员工"
        emptyText="尚未录入员工工资。点「＋ 添加员工」一位一位添加。"
        emptyIcon={<TeamOutlined aria-hidden />}
        fields={SECTION_FIELDS.payroll}
        columns={SECTION_COLUMNS.payroll}
        rows={rowsOf("payroll")}
        loading={loading}
        onAdd={(row) => addRow("payroll", row)}
        onUpdate={(rowId, patch) => updateRow("payroll", rowId, patch)}
        onRemove={(rowId) => removeRow("payroll", rowId)}
      />

      <RowListEditor
        title="2 获取发票"
        tip="两种录入方式：逐张手工填写，或用「上传发票识别」拍照/上传由企享云 OCR 识别后预填（仍需人工核对逐条保存）；AI 据此测算增值税、附加税与印花税。"
        addText="＋ 添加发票"
        emptyText="尚未录入发票。点「＋ 添加发票」一张一张添加，或点「上传发票识别」自动识别。"
        emptyIcon={<FileTextOutlined aria-hidden />}
        fields={SECTION_FIELDS.invoices}
        columns={SECTION_COLUMNS.invoices}
        rows={rowsOf("invoices")}
        loading={loading}
        extra={
          pack ? (
            <InvoiceOcrButton
              packId={pack.id}
              onRecognized={(row) => setPendingInvoice(row)}
            />
          ) : null
        }
        pendingRow={pendingInvoice}
        onPendingConsumed={() => setPendingInvoice(null)}
        onAdd={(row) => addRow("invoices", row)}
        onUpdate={(rowId, patch) => updateRow("invoices", rowId, patch)}
        onRemove={(rowId) => removeRow("invoices", rowId)}
      />

      <RowListEditor
        title="3 上传流水"
        tip="逐笔添加本期银行流水（或从网银导出后逐笔录入）；AI 结合发票交叉核对经营数据。"
        addText="＋ 添加流水"
        emptyText="尚未录入银行流水。点「＋ 添加流水」一笔一笔添加。"
        emptyIcon={<BankOutlined aria-hidden />}
        fields={SECTION_FIELDS.bank}
        columns={SECTION_COLUMNS.bank}
        rows={rowsOf("bank")}
        loading={loading}
        onAdd={(row) => addRow("bank", row)}
        onUpdate={(rowId, patch) => updateRow("bank", rowId, patch)}
        onRemove={(rowId) => removeRow("bank", rowId)}
      />

      <AiResultModal
        open={aiCheckOpen}
        title="AI 材料体检"
        loading={aiCheckLoading}
        mode={aiCheck?.mode}
        model={aiCheck?.model}
        onClose={() => setAiCheckOpen(false)}
      >
        {aiCheck ? (
          <>
            <div>{aiCheck.summary}</div>
            <AiList title="发现的问题" items={aiCheck.issues} />
            <AiList title="建议" items={aiCheck.suggestions} />
          </>
        ) : null}
      </AiResultModal>
    </>
  );
}
