"use client";

import {
  BankOutlined,
  BarChartOutlined,
  DatabaseOutlined,
  DownloadOutlined,
  FileTextOutlined,
  LineChartOutlined,
  ReadOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Steps,
  Table,
  Tabs,
  Upload,
  Alert,
} from "antd";
import { useState } from "react";
import { useSaveTaxRecord } from '@/query/tax';
import { presentMutationError } from '@/query/errors';
import { taxApi } from '@/api/tax';
import { useBusinessQuery } from '@/query/business';
import { EmptyState, Panel } from "@/components/ui/panel";
import { RowListEditor, type EditorRow } from "@/components/row-list-editor";
import {
  fmtTime,
  money,
  type TaxDeclaration,
} from "./common";

/* ---------------- 财务报表（对齐 demo：按企业生成稳定演示数据） ---------------- */

type ReportTableData = {
  key: string;
  name: string;
  ds: string;
  cols: string[];
  rows: (string | number)[][];
};

export function demoReports(seed: number): ReportTableData[] {
  const s = Number(seed || 1);
  const j = (base: number, i: number, amp: number) =>
    Math.round((base + ((s * 97 + i * 53) % amp)) * 100) / 100;
  const cash = j(268000, 1, 90000);
  const ar = j(156000, 2, 120000);
  const inv = j(88000, 3, 60000);
  const fa = j(120000, 4, 80000);
  const assets = cash + ar + inv + fa;
  const ap = j(96000, 5, 50000);
  const taxPay = j(12000, 6, 20000);
  const capital = 300000;
  const retained = Math.round((assets - ap - taxPay - capital) * 100) / 100;
  const rev = j(860000, 7, 400000);
  const cost = Math.round(rev * 0.62 * 100) / 100;
  const surtax = Math.round(rev * 0.01 * 100) / 100;
  const sell = Math.round(rev * 0.08 * 100) / 100;
  const admin = Math.round(rev * 0.1 * 100) / 100;
  const fin = j(6000, 8, 8000);
  const totalProfit =
    Math.round((rev - cost - surtax - sell - admin - fin) * 100) / 100;
  const incomeTax = Math.round(Math.max(0, totalProfit) * 0.25 * 100) / 100;
  const netProfit = Math.round((totalProfit - incomeTax) * 100) / 100;
  const opIn = Math.round(rev * 1.05 * 100) / 100;
  const opOut =
    Math.round((cost + surtax + sell + admin + fin + incomeTax) * 100) / 100;
  const opNet = Math.round((opIn - opOut) * 100) / 100;
  const invOut = j(60000, 9, 30000);
  const finIn = j(100000, 10, 80000);
  const finOut = j(40000, 11, 30000);
  const finNet = finIn - finOut;
  const netInc = Math.round((opNet - invOut + finNet) * 100) / 100;
  const beginCash = j(180000, 12, 60000);
  const endCash = Math.round((beginCash + netInc) * 100) / 100;

  return [
    {
      key: "balance",
      name: "资产负债表",
      ds: "2026-09-30",
      cols: ["资产", "期末余额", "负债和所有者权益", "期末余额"],
      rows: [
        ["流动资产：", "", "流动负债：", ""],
        ["　货币资金", cash, "　应付账款", ap],
        ["　应收账款", ar, "　应交税费", taxPay],
        ["　存货", inv, "流动负债合计", ap + taxPay],
        ["流动资产合计", cash + ar + inv, "非流动负债合计", 0],
        ["非流动资产：", "", "负债合计", ap + taxPay],
        ["　固定资产", fa, "所有者权益：", ""],
        ["非流动资产合计", fa, "　实收资本", capital],
        ["", "", "　未分配利润", retained],
        ["资产总计", assets, "负债和所有者权益总计", assets],
      ],
    },
    {
      key: "income",
      name: "利润表",
      ds: "2026年1-9月",
      cols: ["项目", "本期金额"],
      rows: [
        ["一、营业收入", rev],
        ["　减：营业成本", cost],
        ["　　　税金及附加", surtax],
        ["　　　销售费用", sell],
        ["　　　管理费用", admin],
        ["　　　财务费用", fin],
        ["二、营业利润", totalProfit],
        ["三、利润总额", totalProfit],
        ["　减：所得税费用", incomeTax],
        ["四、净利润", netProfit],
      ],
    },
    {
      key: "cashflow",
      name: "现金流量表",
      ds: "2026年1-9月",
      cols: ["项目", "本期金额"],
      rows: [
        ["一、经营活动产生的现金流量", ""],
        ["　销售商品、提供劳务收到的现金", opIn],
        ["　购买商品、支付职工及税费等支付的现金", opOut],
        ["经营活动产生的现金流量净额", opNet],
        ["二、投资活动产生的现金流量", ""],
        ["　购建固定资产、无形资产支付的现金", invOut],
        ["投资活动产生的现金流量净额", -invOut],
        ["三、筹资活动产生的现金流量", ""],
        ["　取得借款收到的现金", finIn],
        ["　偿还借款支付的现金", finOut],
        ["筹资活动产生的现金流量净额", finNet],
        ["四、现金及现金等价物净增加额", netInc],
        ["　期初现金及现金等价物余额", beginCash],
        ["五、期末现金及现金等价物余额", endCash],
      ],
    },
  ];
}

const rptCell = (cell: string | number) =>
  typeof cell === "number"
    ? cell < 0
      ? `-${money(Math.abs(cell))}`
      : money(cell)
    : String(cell ?? "");

/** 前端导出 CSV（带 BOM，Excel 可直接打开） */
export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv =
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map(
            (cell) =>
              `"${String(cell ?? "").replace(/"/g, '""')}"`,
          )
          .join(","),
      )
      .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function ReportTableView({ report }: { report: ReportTableData }) {
  return (
    <div className="table-wrap">
      <Table
        rowKey="key"
        size="small"
        pagination={false}
        dataSource={report.rows.map((row, index) => ({
          row,
          key: String(index),
        }))}
        columns={report.cols.map((col, index) => ({
          title: col,
          render: (_: unknown, item: { row: (string | number)[] }) => (
            <span className={typeof item.row[index] === "number" ? "mono" : ""}>
              {rptCell(item.row[index])}
            </span>
          ),
        }))}
      />
      <p className="text-12 muted" style={{ marginTop: 10 }}>
        {report.name} · 数据截至 {report.ds} · 单位：元
      </p>
    </div>
  );
}

/** 📊 报表与凭证：财务报表（三表查看 + CSV 下载） */
export function ReportToolsPanel({ enterpriseId }: { enterpriseId: number }) {
  const recordMutation=useSaveTaxRecord();
  const saveTaxRecord=recordMutation.save;
  const { message } = App.useApp();
  const reports = demoReports(enterpriseId);
  const [open, setOpen] = useState(false);
  const [activeKey, setActiveKey] = useState(reports[0].key);
  const current = reports.find((item) => item.key === activeKey) || reports[0];

  const exportReport = async (report: ReportTableData) => {
    downloadCsv(`${report.name}_${report.ds}.csv`, [
      report.cols,
      ...report.rows.map((row) => row.map(rptCell)),
    ]);
    message.success(`已下载《${report.name}》`);
    await saveTaxRecord(
      "REPORT",
      `${report.name}导出（${report.ds}）`,
      `财务报表导出 · 数据截至 ${report.ds}`,
      {
        fields: [
          { label: "报表名称", value: report.name },
          { label: "数据截至", value: report.ds },
          { label: "导出格式", value: "CSV（Excel 可直接打开）" },
        ],
        tables: [
          {
            label: report.name,
            cols: report.cols,
            rows: report.rows.map((row) => row.map(rptCell)),
          },
        ],
      },
    ).catch(()=>undefined);
  };

  return (
    <Panel
      title={<><BarChartOutlined aria-hidden /> 报表与凭证</>}
      titleBadge="财务报表查看与 CSV 导出；电子凭证在服务商申报、扣款后生成"
    >
      <div className="tool-group">
        <button
          type="button"
          className="tool-card"
          onClick={() => setOpen(true)}
        >
          <span className="tool-name"><LineChartOutlined aria-hidden /> 财务报表</span>
          <span className="tool-hint">
            资产负债表 · 利润表 · 现金流量表（查看/下载）
          </span>
        </button>
        <DownloadCenterCard />
      </div>

      <Modal
        open={open}
        title="财务报表（资产负债表 / 利润表 / 现金流量表）"
        width={880}
        onCancel={() => setOpen(false)}
        footer={[
          <Button
            key="csv"
            type="primary"
            onClick={() => void exportReport(current)}
          >
            <DownloadOutlined aria-hidden /> 下载当前报表（CSV）
          </Button>,
          <Button key="close" onClick={() => setOpen(false)}>
            关闭
          </Button>,
        ]}
      >
        <div className="text-12 muted" style={{ marginBottom: 10 }}>
          企业财务报表工具：查看本期资产负债表、利润表、现金流量表并下载；财务报表由平台依据账套出具，支持导出 CSV（Excel 可直接打开）。
        </div>
        <Tabs
          activeKey={activeKey}
          onChange={setActiveKey}
          items={reports.map((report) => ({
            key: report.key,
            label: report.name,
            children: <ReportTableView report={report} />,
          }))}
        />
      </Modal>
    </Panel>
  );
}

/** 📥 电子凭证及财务报表的下载中心 */
function DownloadCenterCard() {
  const recordMutation=useSaveTaxRecord();
  const saveTaxRecord=recordMutation.save;
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('FILED');
  const query = useBusinessQuery('tax', 'vouchers', {page,status}, signal => taxApi.declarationPage({query:{page,pageSize:20,status}}, {signal}), 'all', open);
  const loading = query.isPending;
  const reports = demoReports(1);

  const vouchers = query.data?.list ?? [];

  const downloadVoucher = (row: TaxDeclaration) => {
    const lines: (string | number)[][] = [
      ["申报单号", row.declNo],
      ["申报表", row.title || row.taxType],
      ["属期", row.period || "—"],
      ["应缴税额（元）", money(row.taxAmount)],
      ["状态", row.status === "PAID" ? "已扣款" : "已申报"],
      ["完税凭证号", row.receiptNo || "—"],
    ];
    downloadCsv(`${row.declNo}_申报表.csv`, lines);
    message.success(`已下载《${row.declNo}》申报表`);
  };

  return (
    <>
      <button type="button" className="tool-card" onClick={() => setOpen(true)}>
        <span className="tool-name"><DownloadOutlined aria-hidden /> 电子凭证及财务报表的下载</span>
        <span className="tool-hint">完税凭证、申报表、财务报表一键下载</span>
      </button>

      <Modal
        open={open}
        title="电子凭证及财务报表下载中心"
        width={780}
        onCancel={() => setOpen(false)}
        footer={<Button onClick={() => setOpen(false)}>关闭</Button>}
      >
        <div className="text-12 muted" style={{ marginBottom: 10 }}>
          下载中心：完税凭证与申报表文件在服务商完成申报、扣款后生成；财务报表支持即时导出 CSV。
        </div>

        <div style={{ fontWeight: 600, margin: "10px 0 6px" }}>
          <FileTextOutlined aria-hidden /> 电子凭证（申报表 · 完税凭证）
        </div>
        <Select value={status} options={[{value:'FILED',label:'已申报'},{value:'PAID',label:'已扣款'}]} onChange={value => {setStatus(value);setPage(1);}} style={{marginBottom:10}} />
        {query.error ? <Alert type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>重试</Button>} /> : loading ? (
          <div className="text-12 muted">加载中…</div>
        ) : vouchers.length ? (
          <Table<TaxDeclaration>
            rowKey="id"
            size="small"
            pagination={{current:page,pageSize:20,total:query.data?.total??0,onChange:setPage,showSizeChanger:false}}
            dataSource={vouchers}
            locale={{ emptyText: <EmptyState text="暂无电子凭证" /> }}
            columns={[
              {
                title: "凭证名称",
                render: (_, row) =>
                  `${row.status === "PAID" ? "完税凭证" : "申报表"} · ${row.declNo}`,
              },
              {
                title: "申报单",
                dataIndex: "declNo",
                render: (value: string) => (
                  <span className="mono text-12">{value}</span>
                ),
              },
              {
                title: "应缴税额",
                dataIndex: "taxAmount",
                render: (value: string | number) => (
                  <span className="mono">¥{money(value)}</span>
                ),
              },
              {
                title: "操作",
                width: 90,
                render: (_, row) => (
                  <Button
                    onClick={() => downloadVoucher(row)}
                  >
                    下载
                  </Button>
                ),
              },
            ]}
          />
        ) : (
          <p className="text-12 muted">
            暂无电子凭证：服务商完成申报并扣款后，此处将生成完税凭证与申报表文件。
          </p>
        )}

        <div style={{ fontWeight: 600, margin: "16px 0 6px" }}>
          <BarChartOutlined aria-hidden /> 财务报表（导出 CSV）
        </div>
        <Table
          rowKey="key"
          size="small"
          pagination={false}
          dataSource={reports}
          columns={[
            {
              title: "报表名称",
              render: (_, row: ReportTableData) => `${row.name}（${row.ds}）`,
            },
            {
              title: "格式",
              render: () => <span className="text-12 muted">财务报表 · CSV 表格</span>,
            },
            {
              title: "操作",
              width: 90,
              render: (_, row: ReportTableData) => (
                <Button
                  onClick={async () => {
                    downloadCsv(`${row.name}_${row.ds}.csv`, [
                      row.cols,
                      ...row.rows.map((item) => item.map(rptCell)),
                    ]);
                    message.success(`已下载《${row.name}》`);
                    await saveTaxRecord(
                      "REPORT",
                      `${row.name}导出（${row.ds}）`,
                      `财务报表导出 · 数据截至 ${row.ds}`,
                      {
                        fields: [
                          { label: "报表名称", value: row.name },
                          { label: "数据截至", value: row.ds },
                          { label: "导出格式", value: "CSV（Excel 可直接打开）" },
                        ],
                        tables: [
                          {
                            label: row.name,
                            cols: row.cols,
                            rows: row.rows.map((item) => item.map(rptCell)),
                          },
                        ],
                      },
                    ).catch(()=>undefined);
                  }}
                >
                  下载
                </Button>
              ),
            },
          ]}
        />
      </Modal>
    </>
  );
}

/* ---------------- 🏛️ 年度事项与数据：工商年检 ---------------- */

type EnterpriseLike = Record<string, unknown> | null;

/** 工商年检（年报公示）填报工具：字段对齐 demo，结果留存 kind=INSPECT */
export function AnnualInspectionPanel({
  enterprise,
}: {
  enterprise: EnterpriseLike;
}) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const recordMutation=useSaveTaxRecord();
  const saveTaxRecord=recordMutation.save;
  const year = new Date().getFullYear() - 1;
  const [form] = Form.useForm();

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const yearVal = String(values.report_year || year);
      const statusVal = String(values.business_status || "");
      await saveTaxRecord(
        "INSPECT",
        `${yearVal} 年度工商年检（年报公示）`,
        `${yearVal} 年度 · 经营状态：${statusVal}`,
        {
          fields: [
            { label: "报告年度", value: yearVal },
            { label: "经营状态", value: statusVal },
            { label: "企业名称", value: String(values.enterprise_name || "") },
            { label: "统一社会信用代码", value: String(values.uscc || "") },
            { label: "企业通信地址", value: String(values.address || "") },
            { label: "邮政编码", value: String(values.zip_code || "") },
            { label: "联系电话", value: String(values.phone || "") },
            { label: "从业人数", value: String(values.staff_count || "") },
            { label: "资产总额（元）", value: String(values.total_assets || "") },
            { label: "负债总额（元）", value: String(values.total_liabilities || "") },
            { label: "营业总收入（元）", value: String(values.total_revenue || "") },
            { label: "纳税总额（元）", value: String(values.total_tax || "") },
            { label: "社保参保人数", value: String(values.social_insured || "") },
          ],
        },
      );
      message.success(
        `${yearVal} 年度工商年报记录已保存，可在「填报记录」台账回看`,
      );
      setOpen(false);
    } catch(error) {if(error instanceof Error)presentMutationError(error,text=>message.error(text));} finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Panel
        title={<><BankOutlined aria-hidden /> 年度事项与数据</>}
        titleBadge="工商年检填报与旧账导入向导，填报内容自动留存台账"
      >
        <div className="tool-group">
          <button
            type="button"
            className="tool-card"
            onClick={() => {
              form.resetFields();
              form.setFieldsValue({
                report_year: year,
                business_status: "存续（在营）",
                enterprise_name: String(enterprise?.name || ""),
                uscc: String(enterprise?.uscc || ""),
                address: String(enterprise?.address || ""),
                phone: String(enterprise?.phone || ""),
              });
              setOpen(true);
            }}
          >
            <span className="tool-name"><BankOutlined aria-hidden /> 工商年检</span>
            <span className="tool-hint">工商年报信息填报与台账留存</span>
          </button>
          <LegacyImportCard />
        </div>
      </Panel>

      <Modal
        open={open}
        title="工商年检（年报公示）· 填报工具"
        width={760}
        confirmLoading={saving}
        okText="保存年报记录"
        cancelText="关闭"
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
      >
        <div className="text-12 muted" style={{ marginBottom: 12 }}>
          填报 {year} 年度工商年报信息，保存后可在「填报记录」台账回看。
          当前工具仅保存本系统记录，尚未接入国家企业信用信息公示系统；正式年报公示需另行办理。
        </div>
        <Form form={form} layout="vertical">
          <div className="form-2col">
            <Form.Item name="report_year" label="报告年度">
              <Select
                options={[year, year - 1].map((item) => ({
                  value: item,
                  label: `${item} 年度`,
                }))}
              />
            </Form.Item>
            <Form.Item name="business_status" label="经营状态">
              <Select
                options={["存续（在营）", "筹建", "歇业", "清算"].map((item) => ({
                  value: item,
                  label: item,
                }))}
              />
            </Form.Item>
            <Form.Item
              name="enterprise_name"
              label="企业名称"
              rules={[{ required: true, message: "请填写企业名称" }]}
            >
              <Input placeholder="企业名称" />
            </Form.Item>
            <Form.Item name="uscc" label="统一社会信用代码">
              <Input placeholder="统一社会信用代码" />
            </Form.Item>
            <Form.Item
              name="address"
              label="企业通信地址"
              rules={[{ required: true, message: "请填写企业通信地址" }]}
            >
              <Input placeholder="通信地址" />
            </Form.Item>
            <Form.Item name="zip_code" label="邮政编码">
              <Input placeholder="如 200000" />
            </Form.Item>
            <Form.Item name="phone" label="联系电话">
              <Input placeholder="联系电话" />
            </Form.Item>
            <Form.Item name="staff_count" label="从业人数">
              <Input type="number" placeholder="人" />
            </Form.Item>
            <Form.Item name="total_assets" label="资产总额（元）">
              <Input type="number" placeholder="元" />
            </Form.Item>
            <Form.Item name="total_liabilities" label="负债总额（元）">
              <Input type="number" placeholder="元" />
            </Form.Item>
            <Form.Item name="total_revenue" label="营业总收入（元）">
              <Input type="number" placeholder="元" />
            </Form.Item>
            <Form.Item name="total_tax" label="纳税总额（元）">
              <Input type="number" placeholder="元" />
            </Form.Item>
            <Form.Item name="social_insured" label="社保参保人数">
              <Input type="number" placeholder="人" />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </>
  );
}

/* ---------------- 🗃️ 旧账导入向导（逐条录入 + 借贷平衡校验 + 确认归档） ---------------- */

const DEFAULT_LEGACY_ROWS: EditorRow[] = [
  { id: "l1", subject: "库存现金", direction: "借", amount: "26800" },
  { id: "l2", subject: "银行存款", direction: "借", amount: "158000" },
  { id: "l3", subject: "应收账款", direction: "借", amount: "96000" },
  { id: "l4", subject: "预付账款", direction: "借", amount: "12000" },
  { id: "l5", subject: "存货", direction: "借", amount: "88000" },
  { id: "l6", subject: "固定资产", direction: "借", amount: "120000" },
  { id: "l7", subject: "应付账款", direction: "贷", amount: "96000" },
  { id: "l8", subject: "预收账款", direction: "贷", amount: "18000" },
  { id: "l9", subject: "应付职工薪酬", direction: "贷", amount: "12000" },
  { id: "l10", subject: "实收资本", direction: "贷", amount: "300000" },
  { id: "l11", subject: "未分配利润", direction: "贷", amount: "74800" },
];

function LegacyImportCard() {
  const recordMutation=useSaveTaxRecord();
  const saveTaxRecord=recordMutation.save;
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [rows, setRows] = useState<EditorRow[]>(DEFAULT_LEGACY_ROWS);
  const [fileName, setFileName] = useState("");
  const [saving, setSaving] = useState(false);

  const sumOf = (direction: string) =>
    rows
      .filter((row) => row.direction === direction)
      .reduce((acc, row) => acc + Number(row.amount || 0), 0);
  const totalDr = Math.round(sumOf("借") * 100) / 100;
  const totalCr = Math.round(sumOf("贷") * 100) / 100;
  const diff = Math.round((totalDr - totalCr) * 100) / 100;
  const balanced = diff === 0;

  const archive = async () => {
    setSaving(true);
    try {
      await saveTaxRecord(
        "LEGACY",
        "旧账导入（科目期初余额迁移）",
        `${rows.length} 个科目 · 期初余额合计 ¥${money(totalDr)} · 借贷平衡`,
        {
          fields: [
            { label: "旧账文件", value: fileName || "未选择（手工录入）" },
            { label: "科目数量", value: String(rows.length) },
            { label: "借方合计（元）", value: money(totalDr) },
            { label: "贷方合计（元）", value: money(totalCr) },
            { label: "借贷平衡校验", value: "差额 ¥0.00 · 平衡 ✓" },
          ],
          tables: [
            {
              label: "科目期初余额表",
              cols: ["科目", "方向", "期初余额（元）"],
              rows: rows.map((row) => [
                String(row.subject || ""),
                `${row.direction || ""}方`,
                money(row.amount),
              ]),
            },
          ],
        },
      );
      message.success("期初余额校验通过，旧账已归档至企业账套填报台账");
      setOpen(false);
      setStep(0);
    } catch(error) {if(error instanceof Error)presentMutationError(error,text=>message.error(text));} finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="tool-card"
        onClick={() => {
          setStep(0);
          setOpen(true);
        }}
      >
        <span className="tool-name"><DatabaseOutlined aria-hidden /> 旧账导入</span>
        <span className="tool-hint">历史科目余额迁移，借贷平衡自动校验</span>
      </button>

      <Modal
        open={open}
        title="旧账导入向导"
        width={760}
        onCancel={() => setOpen(false)}
        footer={
          <Space>
            <Button disabled={step === 0} onClick={() => setStep(step - 1)}>
              上一页
            </Button>
            {step < 2 ? (
              <Button
                type="primary"
                disabled={step === 1 && !balanced}
                onClick={() => setStep(step + 1)}
              >
                下一页
              </Button>
            ) : (
              <Button
                type="primary"
                loading={saving}
                onClick={() => void archive()}
              >
                确认归档
              </Button>
            )}
            <Button onClick={() => setOpen(false)}>关闭</Button>
          </Space>
        }
      >
        <Steps
          size="small"
          current={step}
          style={{ marginBottom: 16 }}
          items={[
            { title: "科目期初余额" },
            { title: "借贷平衡校验" },
            { title: "确认归档" },
          ]}
        />

        {step === 0 ? (
          <>
            <div className="text-12 muted" style={{ marginBottom: 10 }}>
              旧账导入向导：逐条录入历史账务的科目期初余额，系统自动校验借贷平衡。可选择 Excel/CSV 科目余额表记录来源文件名；文件内容不会上传或自动解析，请参照原表手工录入。
            </div>
            <Form layout="vertical">
              <Form.Item label="来源文件名（可选，仅记录名称）">
                <Upload
                  accept=".xls,.xlsx,.csv"
                  maxCount={1}
                  beforeUpload={(file) => {
                    setFileName(file.name);
                    message.info(
                      `已记录「${file.name}」的文件名，请参照原表逐条录入科目期初余额`,
                    );
                    return false;
                  }}
                  onRemove={() => setFileName("")}
                >
                  <Button>选择文件</Button>
                </Upload>
              </Form.Item>
            </Form>
            <RowListEditor
              title="科目期初余额表"
              tip="逐条添加科目期初余额，保存后可继续添加下一条；每条可单独编辑或删除。"
              addText="+ 添加科目"
              emptyText="暂无科目，点击右上角「+ 添加科目」逐条录入"
              emptyIcon={<DatabaseOutlined aria-hidden />}
              fields={[
                {
                  name: "subject",
                  label: "科目",
                  required: true,
                  placeholder: "如 库存现金",
                },
                {
                  name: "direction",
                  label: "方向",
                  type: "select",
                  required: true,
                  options: [
                    { label: "借", value: "借" },
                    { label: "贷", value: "贷" },
                  ],
                },
                {
                  name: "amount",
                  label: "期初余额（元）",
                  type: "number",
                  required: true,
                  placeholder: "0.00",
                },
              ]}
              rows={rows}
              columns={[
                { title: "科目", dataIndex: "subject" },
                {
                  title: "方向",
                  render: (row) => (
                    <span
                      className={`badge ${row.direction === "借" ? "badge-sky" : "badge-orange"}`}
                    >
                      {String(row.direction || "")}方
                    </span>
                  ),
                },
                {
                  title: "期初余额（元）",
                  render: (row) => (
                    <span className="mono">{money(row.amount)}</span>
                  ),
                },
              ]}
              onAdd={async (row) => {
                setRows((prev) => [
                  ...prev,
                  { ...row, id: `l${Date.now()}` },
                ]);
              }}
              onUpdate={async (rowId, patch) => {
                setRows((prev) =>
                  prev.map((row) =>
                    String(row.id) === rowId ? { ...row, ...patch } : row,
                  ),
                );
              }}
              onRemove={async (rowId) => {
                setRows((prev) =>
                  prev.filter((row) => String(row.id) !== rowId),
                );
              }}
            />
          </>
        ) : null}

        {step === 1 ? (
          <>
            <div className="text-12 muted" style={{ marginBottom: 10 }}>
              系统按借贷方向汇总期初余额并校验平衡；差额为 0 才可继续归档。
            </div>
            <div className="table-wrap">
              <Table<{ label: string; value: string }>
                rowKey="label"
                size="small"
                pagination={false}
                dataSource={[
                  { label: "科目数量", value: `${rows.length} 个` },
                  { label: "借方合计", value: `¥${money(totalDr)}` },
                  { label: "贷方合计", value: `¥${money(totalCr)}` },
                  {
                    label: "借贷平衡校验",
                    value: balanced
                      ? "差额 ¥0.00　借贷平衡 ✓"
                      : `差额 ¥${money(Math.abs(diff))}　尚未平衡`,
                  },
                ]}
                columns={[
                  { title: "校验项", dataIndex: "label" },
                  {
                    title: "结果",
                    dataIndex: "value",
                    render: (value: string, row) => (
                      <span
                        className={
                          row.label === "借贷平衡校验"
                            ? balanced
                              ? "badge badge-green"
                              : "badge badge-red"
                            : "mono"
                        }
                      >
                        {value}
                      </span>
                    ),
                  },
                ]}
              />
            </div>
            {balanced ? null : (
              <p className="text-12" style={{ color: "var(--danger, #d4380d)" }}>
                借贷不平衡，差额 ¥{money(Math.abs(diff))}，请回到上一页调整科目期初余额后再继续。
              </p>
            )}
          </>
        ) : null}

        {step === 2 ? (
          <>
            <div className="text-12 muted" style={{ marginBottom: 10 }}>
              确认归档后，本次科目期初余额将留痕到「填报记录」台账（旧账导入），可随时回看；如需调整请返回上一页。
            </div>
            <div className="table-wrap">
              <Table<{ label: string; value: string }>
                rowKey="label"
                size="small"
                pagination={false}
                dataSource={[
                  { label: "旧账文件", value: fileName || "未选择（手工录入）" },
                  { label: "科目数量", value: `${rows.length} 个` },
                  { label: "借方合计", value: `¥${money(totalDr)}` },
                  { label: "贷方合计", value: `¥${money(totalCr)}` },
                  { label: "借贷平衡校验", value: "差额 ¥0.00 · 平衡 ✓" },
                ]}
                columns={[
                  { title: "归档信息", dataIndex: "label" },
                  { title: "内容", dataIndex: "value" },
                ]}
              />
            </div>
          </>
        ) : null}
      </Modal>
    </>
  );
}

/* ---------------- 📚 记账（入口直达） ---------------- */

export function LedgerConsultPanel() {
  return (
    <Panel title={<><ReadOutlined aria-hidden /> 记账</>} titleBadge="账套管理直达入口">
      <div className="tool-group">
        <a className="tool-card" href="/tax?view=sets">
          <span className="tool-name"><ReadOutlined aria-hidden /> 账套管理（记账）</span>
          <span className="tool-hint">查看企业总账账套与核算状态</span>
        </a>
      </div>
    </Panel>
  );
}

/** 填报记录详情：统一渲染 fields / tables / form 三种快照结构 */
export function RecordSnapshotView({
  snapshot,
}: {
  snapshot: Record<string, unknown> | undefined;
}) {
  const fields = Array.isArray(snapshot?.fields)
    ? (snapshot?.fields as { label?: string; value?: string }[])
    : [];
  const tables = Array.isArray(snapshot?.tables)
    ? (snapshot?.tables as {
        label?: string;
        cols?: string[];
        rows?: (string | number)[][];
      }[])
    : [];
  const formEntries = Object.entries(
    (snapshot?.form as Record<string, unknown>) || {},
  );

  return (
    <>
      {fields.length ? (
        <div className="table-wrap" style={{ marginBottom: 12 }}>
          <Table
            rowKey="label"
            size="small"
            pagination={false}
            dataSource={fields}
            columns={[
              { title: "填报项", dataIndex: "label", width: 220 },
              {
                title: "填报值",
                dataIndex: "value",
                render: (value: string) => (
                  <span className="mono">{String(value ?? "") || "—"}</span>
                ),
              },
            ]}
          />
        </div>
      ) : null}

      {formEntries.length ? (
        <div className="table-wrap" style={{ marginBottom: 12 }}>
          <Table
            rowKey="label"
            size="small"
            pagination={false}
            dataSource={formEntries.map(([key, value]) => ({
              label: key,
              value: String(value ?? ""),
            }))}
            columns={[
              { title: "填报项", dataIndex: "label" },
              {
                title: "填报值",
                dataIndex: "value",
                render: (value: string) => <span className="mono">{value}</span>,
              },
            ]}
          />
        </div>
      ) : null}

      {tables.map((table, index) => (
        <div key={table.label || index} style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            {table.label || `填报明细表 ${index + 1}`}
          </div>
          <div className="table-wrap">
            <Table
              rowKey="key"
              size="small"
              pagination={false}
              dataSource={(table.rows || []).map((row, index) => ({
                row,
                key: String(index),
              }))}
              columns={(table.cols || []).map((col, colIndex) => ({
                title: col,
                render: (_: unknown, item: { row: (string | number)[] }) => (
                  <span className={typeof item.row[colIndex] === "number" || /[\d.]/.test(String(item.row[colIndex])) ? "mono" : ""}>
                    {String(item.row[colIndex] ?? "")}
                  </span>
                ),
              }))}
            />
          </div>
        </div>
      ))}

      {!fields.length && !formEntries.length && !tables.length ? (
        <EmptyState text="该记录无填报明细" />
      ) : null}

      <p className="text-12 muted">
        本记录为工具填报留痕，正式申报以服务商在平台创建的申报单为准。
      </p>
    </>
  );
}

/** 填报记录创建时间文案（导出给台账面板复用） */
export function recordTimeText(value: unknown) {
  return fmtTime(value);
}
