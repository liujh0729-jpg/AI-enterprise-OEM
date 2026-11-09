"use client";

import { CopyOutlined, TableOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { App, Button, Card, Checkbox, Col, Form, Input, Modal, Row, Select, Space, Table, Tag } from "antd";
import { useState } from "react";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { EmptyState, Panel } from "@/components/ui/panel";
import { fmtTime } from "@/lib/datetime";
import {
  FIELD_TYPE_OPTIONS,
  permissionSummary,
  tableApi,
  type DataTableTable,
  type PlanField,
} from "./common";

type TableForm = { name: string; description: string };

type TemplateField = {
  name: string;
  fieldKey: string;
  fieldType: string;
  required?: boolean;
  options?: { choices?: string[] };
};

type Template = {
  key: string;
  name: string;
  description: string;
  fields: TemplateField[];
};

const TEMPLATES: Template[] = [
  {
    key: "customer",
    name: "客户跟进表",
    description: "记录客户信息、跟进状态和联系历史",
    fields: [
      { name: "客户名称", fieldKey: "customer_name", fieldType: "text", required: true },
      { name: "联系人", fieldKey: "contact_person", fieldType: "text" },
      { name: "联系电话", fieldKey: "phone", fieldType: "text" },
      { name: "邮箱", fieldKey: "email", fieldType: "email" },
      { name: "公司名称", fieldKey: "company", fieldType: "text" },
      { name: "跟进状态", fieldKey: "status", fieldType: "select", options: { choices: ["潜在客户", "跟进中", "已成交", "已流失"] } },
      { name: "最后跟进时间", fieldKey: "last_contact", fieldType: "date" },
      { name: "备注", fieldKey: "notes", fieldType: "text" },
    ],
  },
  {
    key: "leads",
    name: "线索台账",
    description: "管理销售线索、状态和转化情况",
    fields: [
      { name: "线索名称", fieldKey: "lead_name", fieldType: "text", required: true },
      { name: "来源", fieldKey: "source", fieldType: "select", options: { choices: ["网站", "电话", "转介绍", "展会", "其他"] } },
      { name: "联系人", fieldKey: "contact", fieldType: "text" },
      { name: "联系方式", fieldKey: "contact_info", fieldType: "text" },
      { name: "需求描述", fieldKey: "requirement", fieldType: "text" },
      { name: "状态", fieldKey: "status", fieldType: "select", options: { choices: ["新建", "已联系", "意向确认", "已转化", "无效"] } },
      { name: "负责人", fieldKey: "owner", fieldType: "text" },
      { name: "创建时间", fieldKey: "created_at", fieldType: "date" },
    ],
  },
  {
    key: "project",
    name: "项目清单",
    description: "跟踪项目进度、负责人和截止日期",
    fields: [
      { name: "项目名称", fieldKey: "project_name", fieldType: "text", required: true },
      { name: "负责人", fieldKey: "owner", fieldType: "text" },
      { name: "状态", fieldKey: "status", fieldType: "select", options: { choices: ["未开始", "进行中", "已完成", "已暂停", "已取消"] } },
      { name: "优先级", fieldKey: "priority", fieldType: "select", options: { choices: ["低", "中", "高", "紧急"] } },
      { name: "开始日期", fieldKey: "start_date", fieldType: "date" },
      { name: "截止日期", fieldKey: "due_date", fieldType: "date" },
      { name: "进度(%)", fieldKey: "progress", fieldType: "number" },
      { name: "说明", fieldKey: "description", fieldType: "text" },
    ],
  },
  {
    key: "inventory",
    name: "库存管理",
    description: "记录商品库存、入库出库和预警",
    fields: [
      { name: "商品名称", fieldKey: "product_name", fieldType: "text", required: true },
      { name: "商品编码", fieldKey: "sku", fieldType: "text" },
      { name: "分类", fieldKey: "category", fieldType: "text" },
      { name: "当前库存", fieldKey: "stock", fieldType: "number" },
      { name: "预警值", fieldKey: "alert_threshold", fieldType: "number" },
      { name: "单价", fieldKey: "price", fieldType: "number" },
      { name: "仓库位置", fieldKey: "location", fieldType: "text" },
      { name: "最后更新时间", fieldKey: "updated_at", fieldType: "date" },
    ],
  },
  {
    key: "employee",
    name: "员工信息表",
    description: "管理员工基本信息、部门和入职时间",
    fields: [
      { name: "姓名", fieldKey: "name", fieldType: "text", required: true },
      { name: "工号", fieldKey: "employee_id", fieldType: "text", required: true },
      { name: "部门", fieldKey: "department", fieldType: "select", options: { choices: ["技术部", "销售部", "市场部", "财务部", "人事部", "运营部"] } },
      { name: "职位", fieldKey: "position", fieldType: "text" },
      { name: "手机号", fieldKey: "phone", fieldType: "text" },
      { name: "邮箱", fieldKey: "email", fieldType: "email" },
      { name: "入职日期", fieldKey: "join_date", fieldType: "date" },
      { name: "状态", fieldKey: "status", fieldType: "select", options: { choices: ["在职", "离职", "试用期"] } },
    ],
  },
  {
    key: "attendance",
    name: "考勤记录表",
    description: "记录员工每日考勤和请假情况",
    fields: [
      { name: "员工姓名", fieldKey: "employee_name", fieldType: "text", required: true },
      { name: "日期", fieldKey: "date", fieldType: "date", required: true },
      { name: "上班打卡", fieldKey: "clock_in", fieldType: "text" },
      { name: "下班打卡", fieldKey: "clock_out", fieldType: "text" },
      { name: "工时(小时)", fieldKey: "work_hours", fieldType: "number" },
      { name: "状态", fieldKey: "status", fieldType: "select", options: { choices: ["正常", "迟到", "早退", "缺勤", "请假"] } },
      { name: "备注", fieldKey: "notes", fieldType: "text" },
    ],
  },
  {
    key: "meeting",
    name: "会议纪要表",
    description: "记录会议内容和待办事项",
    fields: [
      { name: "会议主题", fieldKey: "topic", fieldType: "text", required: true },
      { name: "会议时间", fieldKey: "meeting_time", fieldType: "date", required: true },
      { name: "参会人员", fieldKey: "attendees", fieldType: "text" },
      { name: "会议地点", fieldKey: "location", fieldType: "text" },
      { name: "会议内容", fieldKey: "content", fieldType: "text" },
      { name: "决议事项", fieldKey: "decisions", fieldType: "text" },
      { name: "待办事项", fieldKey: "action_items", fieldType: "text" },
      { name: "负责人", fieldKey: "owner", fieldType: "text" },
    ],
  },
  {
    key: "expense",
    name: "费用报销表",
    description: "管理员工费用报销申请和审批",
    fields: [
      { name: "报销人", fieldKey: "applicant", fieldType: "text", required: true },
      { name: "报销日期", fieldKey: "apply_date", fieldType: "date", required: true },
      { name: "费用类型", fieldKey: "expense_type", fieldType: "select", options: { choices: ["交通费", "餐饮费", "住宿费", "办公用品", "差旅费", "其他"] } },
      { name: "金额", fieldKey: "amount", fieldType: "number", required: true },
      { name: "费用说明", fieldKey: "description", fieldType: "text" },
      { name: "发票张数", fieldKey: "receipt_count", fieldType: "number" },
      { name: "审批状态", fieldKey: "approval_status", fieldType: "select", options: { choices: ["待审批", "已批准", "已驳回", "已打款"] } },
      { name: "审批人", fieldKey: "approver", fieldType: "text" },
    ],
  },
  {
    key: "contract",
    name: "合同管理表",
    description: "跟踪合同签署、到期和续签情况",
    fields: [
      { name: "合同名称", fieldKey: "contract_name", fieldType: "text", required: true },
      { name: "合同编号", fieldKey: "contract_no", fieldType: "text", required: true },
      { name: "对方单位", fieldKey: "partner", fieldType: "text" },
      { name: "合同金额", fieldKey: "amount", fieldType: "number" },
      { name: "签署日期", fieldKey: "sign_date", fieldType: "date" },
      { name: "到期日期", fieldKey: "expire_date", fieldType: "date" },
      { name: "状态", fieldKey: "status", fieldType: "select", options: { choices: ["执行中", "已到期", "已续签", "已终止"] } },
      { name: "负责人", fieldKey: "owner", fieldType: "text" },
    ],
  },
  {
    key: "asset",
    name: "资产管理表",
    description: "管理公司固定资产和分配情况",
    fields: [
      { name: "资产名称", fieldKey: "asset_name", fieldType: "text", required: true },
      { name: "资产编号", fieldKey: "asset_id", fieldType: "text", required: true },
      { name: "资产类型", fieldKey: "asset_type", fieldType: "select", options: { choices: ["电脑", "手机", "办公家具", "车辆", "其他"] } },
      { name: "购买日期", fieldKey: "purchase_date", fieldType: "date" },
      { name: "购买金额", fieldKey: "purchase_price", fieldType: "number" },
      { name: "使用人", fieldKey: "user", fieldType: "text" },
      { name: "部门", fieldKey: "department", fieldType: "text" },
      { name: "状态", fieldKey: "status", fieldType: "select", options: { choices: ["在用", "闲置", "维修中", "已报废"] } },
    ],
  },
  {
    key: "training",
    name: "培训记录表",
    description: "记录员工培训情况和效果评估",
    fields: [
      { name: "培训主题", fieldKey: "training_topic", fieldType: "text", required: true },
      { name: "培训时间", fieldKey: "training_date", fieldType: "date", required: true },
      { name: "培训师", fieldKey: "trainer", fieldType: "text" },
      { name: "参训人员", fieldKey: "attendees", fieldType: "text" },
      { name: "培训时长(小时)", fieldKey: "duration", fieldType: "number" },
      { name: "培训内容", fieldKey: "content", fieldType: "text" },
      { name: "效果评估", fieldKey: "evaluation", fieldType: "select", options: { choices: ["优秀", "良好", "一般", "较差"] } },
      { name: "备注", fieldKey: "notes", fieldType: "text" },
    ],
  },
  {
    key: "performance",
    name: "绩效考核表",
    description: "管理员工绩效评估和考核结果",
    fields: [
      { name: "员工姓名", fieldKey: "employee_name", fieldType: "text", required: true },
      { name: "考核周期", fieldKey: "period", fieldType: "select", options: { choices: ["2024年Q1", "2024年Q2", "2024年Q3", "2024年Q4", "2024年度"] } },
      { name: "考核日期", fieldKey: "review_date", fieldType: "date" },
      { name: "工作业绩(分)", fieldKey: "performance_score", fieldType: "number" },
      { name: "工作能力(分)", fieldKey: "ability_score", fieldType: "number" },
      { name: "工作态度(分)", fieldKey: "attitude_score", fieldType: "number" },
      { name: "总分", fieldKey: "total_score", fieldType: "number" },
      { name: "评级", fieldKey: "rating", fieldType: "select", options: { choices: ["A-优秀", "B-良好", "C-合格", "D-待改进"] } },
      { name: "考核人", fieldKey: "reviewer", fieldType: "text" },
    ],
  },
  {
    key: "complaint",
    name: "客户投诉表",
    description: "记录和处理客户投诉及反馈",
    fields: [
      { name: "投诉客户", fieldKey: "customer_name", fieldType: "text", required: true },
      { name: "投诉时间", fieldKey: "complaint_date", fieldType: "date", required: true },
      { name: "投诉类型", fieldKey: "complaint_type", fieldType: "select", options: { choices: ["产品质量", "服务态度", "物流配送", "售后问题", "其他"] } },
      { name: "投诉内容", fieldKey: "content", fieldType: "text" },
      { name: "紧急程度", fieldKey: "urgency", fieldType: "select", options: { choices: ["低", "中", "高", "紧急"] } },
      { name: "处理人", fieldKey: "handler", fieldType: "text" },
      { name: "处理状态", fieldKey: "status", fieldType: "select", options: { choices: ["待处理", "处理中", "已解决", "已关闭"] } },
      { name: "解决方案", fieldKey: "solution", fieldType: "text" },
    ],
  },
  {
    key: "supplier",
    name: "供应商管理表",
    description: "管理供应商信息和合作情况",
    fields: [
      { name: "供应商名称", fieldKey: "supplier_name", fieldType: "text", required: true },
      { name: "联系人", fieldKey: "contact_person", fieldType: "text" },
      { name: "联系电话", fieldKey: "phone", fieldType: "text" },
      { name: "邮箱", fieldKey: "email", fieldType: "email" },
      { name: "供应品类", fieldKey: "category", fieldType: "text" },
      { name: "合作开始日期", fieldKey: "start_date", fieldType: "date" },
      { name: "评级", fieldKey: "rating", fieldType: "select", options: { choices: ["A-优秀", "B-良好", "C-一般", "D-较差"] } },
      { name: "状态", fieldKey: "status", fieldType: "select", options: { choices: ["合作中", "已暂停", "已终止"] } },
    ],
  },
  {
    key: "purchase",
    name: "采购订单表",
    description: "管理采购申请和订单跟踪",
    fields: [
      { name: "订单编号", fieldKey: "order_no", fieldType: "text", required: true },
      { name: "采购日期", fieldKey: "order_date", fieldType: "date", required: true },
      { name: "供应商", fieldKey: "supplier", fieldType: "text" },
      { name: "采购物品", fieldKey: "items", fieldType: "text" },
      { name: "数量", fieldKey: "quantity", fieldType: "number" },
      { name: "单价", fieldKey: "unit_price", fieldType: "number" },
      { name: "总金额", fieldKey: "total_amount", fieldType: "number" },
      { name: "状态", fieldKey: "status", fieldType: "select", options: { choices: ["待审批", "已审批", "已下单", "已收货", "已完成"] } },
      { name: "申请人", fieldKey: "applicant", fieldType: "text" },
    ],
  },
  {
    key: "task",
    name: "任务跟踪表",
    description: "管理日常任务和完成情况",
    fields: [
      { name: "任务名称", fieldKey: "task_name", fieldType: "text", required: true },
      { name: "负责人", fieldKey: "owner", fieldType: "text", required: true },
      { name: "优先级", fieldKey: "priority", fieldType: "select", options: { choices: ["低", "中", "高", "紧急"] } },
      { name: "状态", fieldKey: "status", fieldType: "select", options: { choices: ["待办", "进行中", "已完成", "已取消"] } },
      { name: "开始日期", fieldKey: "start_date", fieldType: "date" },
      { name: "截止日期", fieldKey: "due_date", fieldType: "date" },
      { name: "完成日期", fieldKey: "complete_date", fieldType: "date" },
      { name: "任务描述", fieldKey: "description", fieldType: "text" },
    ],
  },
  {
    key: "document",
    name: "文档管理表",
    description: "管理公司文档和资料归档",
    fields: [
      { name: "文档名称", fieldKey: "doc_name", fieldType: "text", required: true },
      { name: "文档类型", fieldKey: "doc_type", fieldType: "select", options: { choices: ["合同", "报告", "方案", "制度", "规范", "其他"] } },
      { name: "所属部门", fieldKey: "department", fieldType: "text" },
      { name: "创建人", fieldKey: "creator", fieldType: "text" },
      { name: "创建日期", fieldKey: "create_date", fieldType: "date" },
      { name: "最后修改", fieldKey: "update_date", fieldType: "date" },
      { name: "文档链接", fieldKey: "doc_url", fieldType: "url" },
      { name: "备注", fieldKey: "notes", fieldType: "text" },
    ],
  },
];

/**
 * 表格清单（卡片）：建表免密，改表名/说明与删表需密码。
 * 点卡片进入该表的「列定义 + 数据行」。
 */
export function TableCards({
  tables,
  onOpen,
  onChanged,
}: {
  tables: DataTableTable[];
  onOpen: (id: number) => void;
  onChanged: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const { request, modal } = usePasswordConfirm();
  const [form] = Form.useForm<TableForm>();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DataTableTable | null>(null);
  const [busy, setBusy] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [templateFields, setTemplateFields] = useState<TemplateField[]>([]);
  /** 模版建表时的表名：进模版页先按模版名预填，用户可以改成自己想要的名字。 */
  const [templateName, setTemplateName] = useState("");
  /** 一句话建表：模型先给草稿（不落库），用户改完再确认建表。 */
  const [planOpen, setPlanOpen] = useState(false);
  const [planText, setPlanText] = useState("");
  const [planName, setPlanName] = useState("");
  const [planFields, setPlanFields] = useState<PlanField[]>([]);
  const [planGenerated, setPlanGenerated] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({ name: "", description: "" });
    setOpen(true);
  };

  const openEdit = (table: DataTableTable) => {
    setEditing(table);
    form.setFieldsValue({ name: table.name, description: table.description });
    setOpen(true);
  };

  const copyId = async (id: number) => {
    try {
      await navigator.clipboard.writeText(String(id));
      message.success(`表格 ID 已复制：${id}`);
    } catch {
      message.warning(`请手动记录表格 ID：${id}`);
    }
  };

  const submit = async () => {
    const values = await form.validateFields();
    const body = {
      name: values.name.trim(),
      description: (values.description || "").trim(),
    };
    if (editing) {
      const target = editing;
      request({
        title: "修改表格（需密码）",
        content: `确认修改表格「${target.name}」的名称与说明？`,
        okText: "保存修改",
        onOk: async () => {
          await tableApi.update(target.id, body);
          setOpen(false);
          setEditing(null);
          await onChanged();
        },
      });
      return;
    }
    setBusy(true);
    try {
      const created = await tableApi.create(body);
      setOpen(false);
      await onChanged();
      onOpen(created.id);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openTemplate = (template: Template) => {
    setSelectedTemplate(template);
    setTemplateName(template.name);
    // 确保所有字段都有有效的类型
    setTemplateFields(
      template.fields.map((f) => ({
        ...f,
        fieldType: f.fieldType || "text",
      }))
    );
    setTemplateOpen(true);
  };

  const submitTemplate = async () => {
    if (!selectedTemplate) return;
    const targetName = templateName.trim();
    if (!targetName) {
      message.warning("请填写表格名称");
      return;
    }

    // 类型只来自 FIELD_TYPE_OPTIONS，合不合法由后端一处判定（列名/列键/候选项同理）
    setBusy(true);
    let createdId: number | null = null;
    try {
      const created = await tableApi.create({
        name: targetName,
        description: selectedTemplate.description,
      });
      createdId = created.id;
      await tableApi.addFields(
        created.id,
        templateFields.map((field) => ({
          name: field.name,
          fieldKey: field.fieldKey,
          fieldType: field.fieldType,
          required: field.required || false,
          options: field.options || null,
        })),
      );
      setTemplateOpen(false);
      setSelectedTemplate(null);
      setTemplateFields([]);
      setTemplateName("");
      await onChanged();
      onOpen(created.id);
      message.success(`已创建表格并添加 ${templateFields.length} 个列`);
    } catch (error) {
      // 表已经建出来了（列可能没配齐）：不刷新清单，用户看到的是一个「凭空消失」的半截表
      if (createdId !== null) {
        await onChanged();
        message.warning(
          `表格「${targetName}」已创建，但列没建全：${(error as Error).message}`,
        );
        onOpen(createdId);
      } else {
        message.error((error as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  const removeTemplateField = (index: number) => {
    setTemplateFields((prev) => prev.filter((_, i) => i !== index));
  };

  const openPlan = () => {
    setPlanText("");
    setPlanName("");
    setPlanFields([]);
    setPlanGenerated(false);
    setPlanOpen(true);
  };

  const runPlan = async () => {
    const text = planText.trim();
    if (!text) {
      message.warning("请用一句话描述这张表要存什么");
      return;
    }
    setPlanBusy(true);
    try {
      const plan = await tableApi.aiPlanTable(text);
      setPlanName(plan.name);
      setPlanFields(plan.fields);
      setPlanGenerated(true);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setPlanBusy(false);
    }
  };

  const submitPlan = async () => {
    const name = planName.trim();
    if (!name) {
      message.warning("请填写表格名称");
      return;
    }
    if (!planFields.length) {
      message.warning("至少保留一列");
      return;
    }
    setPlanBusy(true);
    let createdId: number | null = null;
    try {
      const created = await tableApi.create({ name, description: planText.trim() });
      createdId = created.id;
      await tableApi.addFields(
        created.id,
        planFields.map((field) => ({
          name: field.name,
          fieldKey: field.field_key,
          fieldType: field.field_type,
          required: field.required,
          choices: field.choices,
          ai: field.ai,
        })),
      );
      setPlanOpen(false);
      await onChanged();
      onOpen(created.id);
      message.success(`已创建表格并添加 ${planFields.length} 个列`);
    } catch (error) {
      if (createdId !== null) {
        await onChanged();
        message.warning(`表格「${name}」已创建，但列没建全：${(error as Error).message}`);
        onOpen(createdId);
      } else {
        message.error((error as Error).message);
      }
    } finally {
      setPlanBusy(false);
    }
  };

  const updatePlanField = (index: number, updates: Partial<PlanField>) => {
    setPlanFields((prev) =>
      prev.map((field, i) => (i === index ? { ...field, ...updates } : field)),
    );
  };

  const updateTemplateField = (index: number, updates: Partial<TemplateField>) => {
    setTemplateFields((prev) =>
      prev.map((field, i) => {
        if (i !== index) return field;
        // 确保 fieldType 始终有效
        const nextField = { ...field, ...updates };
        if (!nextField.fieldType) {
          nextField.fieldType = "text";
        }
        return nextField;
      })
    );
  };

  const removeTable = (table: DataTableTable) => {
    request({
      title: "删除表格",
      content: (
        <span>
          删除「{table.name}」会连同 <b>{table.fields.length}</b> 列与{" "}
          <b>{table.rowCount}</b> 行数据一起清除，且不可恢复。确定删除吗？
        </span>
      ),
      danger: true,
      okText: "确认删除",
      onOk: async () => {
        await tableApi.remove(table.id);
        await onChanged();
      },
    });
  };

  return (
    <Panel
      title="表格清单"
      titleBadge={`${tables.length} 张`}
      extra={
        <Space>
          <Button icon={<ThunderboltOutlined />} onClick={openPlan}>
            一句话建表
          </Button>
          <Button onClick={() => setTemplateOpen(true)}>使用模版创建多维表格</Button>
          <Button type="primary" onClick={openCreate}>
            新建空白表格
          </Button>
        </Space>
      }
    >
      {tables.length ? (
        <Row gutter={[16, 16]}>
          {tables.map((table) => (
            <Col key={table.id} xs={24} sm={12} xl={8} xxl={6}>
              <Card
                className="data-table-card"
                hoverable
                title={
                  <Space size={8}>
                    <TableOutlined />
                    <span>{table.name}</span>
                  </Space>
                }
                extra={
                  <Space size={4}>
                    {!table.owner ? (
                      <Tag color="blue" style={{ marginRight: 0 }}>
                        共享
                      </Tag>
                    ) : null}
                    <Tag>#{table.id}</Tag>
                  </Space>
                }
                actions={[
                  ...(table.owner
                    ? [
                        <Button
                          key="edit"
                          type="link"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEdit(table);
                          }}
                        >
                          改
                        </Button>,
                        <Button
                          key="delete"
                          type="link"
                          danger
                          onClick={(e) => {
                            e.stopPropagation();
                            removeTable(table);
                          }}
                        >
                          删
                        </Button>,
                      ]
                    : []),
                  <Button
                    key="copy"
                    type="link"
                    icon={<CopyOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      void copyId(table.id);
                    }}
                  >
                    复制 ID
                  </Button>,
                ]}
                onClick={() => onOpen(table.id)}
              >
                <div className="data-table-card-desc">
                  {table.description || "（无说明）"}
                </div>
                <div className="text-12 muted">
                  {table.fields.length} 列 · {table.rowCount} 行
                </div>
                <div className="text-12 muted" style={{ marginTop: 2 }}>
                  创建于 {fmtTime(table.createdAt)} · 更新于 {fmtTime(table.updatedAt)}
                </div>
                {!table.owner ? (
                  <div className="text-12 muted" style={{ marginTop: 4 }}>
                    我的权限：{permissionSummary(table.can)}
                  </div>
                ) : null}
              </Card>
            </Col>
          ))}
        </Row>
      ) : (
        <EmptyState text="还没有多维表格，点击右上角「使用模版创建多维表格」快速开始，或「新建空白表格」从零开始" />
      )}

      <Modal
        open={open}
        title={editing ? "修改表格" : "新建表格"}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        okText={busy ? "提交中" : editing ? "下一步（密码确认）" : "创建"}
        cancelText="取消"
        confirmLoading={busy}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="表格名称"
            rules={[{ required: true, message: "请填写表格名称" }]}
          >
            <Input placeholder="如 客户跟进台账" maxLength={200} />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea
              rows={2}
              placeholder="这张表存什么、给谁用（可选）"
              maxLength={500}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={templateOpen}
        title={selectedTemplate ? `使用模版创建多维表格：${selectedTemplate.name}` : "选择模版"}
        onCancel={() => {
          setTemplateOpen(false);
          setSelectedTemplate(null);
          setTemplateFields([]);
        }}
        footer={
          selectedTemplate ? (
            <Space>
              <Button
                onClick={() => {
                  setSelectedTemplate(null);
                  setTemplateFields([]);
                }}
              >
                重新选择模版
              </Button>
              <Button
                type="primary"
                loading={busy}
                onClick={() => void submitTemplate()}
              >
                创建表格并添加 {templateFields.length} 个列
              </Button>
            </Space>
          ) : null
        }
        width={800}
        destroyOnHidden
      >
        {!selectedTemplate ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, 1fr)",
              gap: 12,
            }}
          >
            {TEMPLATES.map((template) => (
              <Card
                key={template.key}
                hoverable
                size="small"
                onClick={() => openTemplate(template)}
                style={{ height: "100%", minWidth: 0 }}
              >
                <Card.Meta
                  title={template.name}
                  description={
                    <>
                      <div style={{ marginBottom: 8 }}>{template.description}</div>
                      <div className="text-12 muted">
                        {template.fields.length} 个预设列
                      </div>
                    </>
                  }
                />
              </Card>
            ))}
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 12, maxWidth: 420 }}>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>
                表格名称<b style={{ color: "var(--danger)" }}> *</b>
              </div>
              <Input
                value={templateName}
                maxLength={200}
                placeholder="这张表叫什么，可保留模版名或改成自己的"
                onChange={(e) => setTemplateName(e.target.value)}
              />
            </div>
            <div className="text-12 muted" style={{ marginBottom: 12 }}>
              以下是该模版预设的列，您可以调整或删除不需要的列
            </div>
            <Table
              rowKey="fieldKey"
              size="small"
              pagination={false}
              dataSource={templateFields}
              columns={[
                {
                  title: "列名称",
                  dataIndex: "name",
                  key: "name",
                  width: 150,
                  render: (value: string, _, index) => (
                    <Input
                      value={value}
                      onChange={(e) =>
                        updateTemplateField(index, { name: e.target.value })
                      }
                    />
                  ),
                },
                {
                  title: "列键",
                  dataIndex: "fieldKey",
                  key: "fieldKey",
                  width: 150,
                  render: (value: string, _, index) => (
                    <Input
                      value={value}
                      onChange={(e) =>
                        updateTemplateField(index, { fieldKey: e.target.value })
                      }
                    />
                  ),
                },
                {
                  title: "类型",
                  dataIndex: "fieldType",
                  key: "fieldType",
                  width: 120,
                  render: (value: string, _, index) => (
                    <Select
                      value={value}
                      options={FIELD_TYPE_OPTIONS}
                      onChange={(value) =>
                        updateTemplateField(index, { fieldType: value })
                      }
                      style={{ width: "100%" }}
                    />
                  ),
                },
                {
                  title: "必填",
                  dataIndex: "required",
                  key: "required",
                  width: 80,
                  render: (value: boolean, _, index) => (
                    <Checkbox
                      checked={value}
                      onChange={(e) =>
                        updateTemplateField(index, { required: e.target.checked })
                      }
                    />
                  ),
                },
                {
                  title: "操作",
                  key: "actions",
                  width: 80,
                  render: (_, __, index) => (
                    <Button
                      type="link"
                      danger
                      onClick={() => removeTemplateField(index)}
                    >
                      删除
                    </Button>
                  ),
                },
              ]}
            />
          </>
        )}
      </Modal>
      <Modal
        open={planOpen}
        title="一句话建表"
        onCancel={() => setPlanOpen(false)}
        footer={
          planGenerated ? (
            <Space>
              <Button onClick={() => setPlanGenerated(false)}>重新描述</Button>
              <Button type="primary" loading={planBusy} onClick={() => void submitPlan()}>
                创建表格并添加 {planFields.length} 个列
              </Button>
            </Space>
          ) : (
            <Space>
              <Button onClick={() => setPlanOpen(false)}>取消</Button>
              <Button type="primary" loading={planBusy} onClick={() => void runPlan()}>
                生成草稿
              </Button>
            </Space>
          )
        }
        width={800}
        destroyOnHidden
      >
        <div className="text-12 muted" style={{ marginBottom: 8 }}>
          用一句话说明这张表要存什么、怎么用，模型会给出表结构与列（含可选的 AI 列），确认后再建。
        </div>
        <Input.TextArea
          rows={2}
          maxLength={500}
          value={planText}
          onChange={(event) => setPlanText(event.target.value)}
          placeholder="如：记录客户跟进，含客户名称、行业、联系人、跟进状态、下次跟进日期，并给一句客户画像"
        />
        {planGenerated ? (
          <>
            <div style={{ margin: "12px 0", maxWidth: 420 }}>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>
                表格名称
              </div>
              <Input
                value={planName}
                maxLength={200}
                onChange={(event) => setPlanName(event.target.value)}
              />
            </div>
            <Table
              rowKey="field_key"
              size="small"
              pagination={false}
              dataSource={planFields}
              columns={[
                {
                  title: "列名称",
                  dataIndex: "name",
                  key: "name",
                  width: 150,
                  render: (value: string, _, index) => (
                    <Input
                      value={value}
                      onChange={(event) =>
                        updatePlanField(index, { name: event.target.value })
                      }
                    />
                  ),
                },
                {
                  title: "列键",
                  dataIndex: "field_key",
                  key: "field_key",
                  width: 150,
                  render: (value: string, _, index) => (
                    <Input
                      value={value}
                      onChange={(event) =>
                        updatePlanField(index, { field_key: event.target.value })
                      }
                    />
                  ),
                },
                {
                  title: "类型",
                  dataIndex: "field_type",
                  key: "field_type",
                  width: 110,
                  render: (value: string, _, index) => (
                    <Select
                      value={value}
                      options={FIELD_TYPE_OPTIONS}
                      style={{ width: "100%" }}
                      onChange={(next) => updatePlanField(index, { field_type: next })}
                    />
                  ),
                },
                {
                  title: "必填",
                  dataIndex: "required",
                  key: "required",
                  width: 70,
                  render: (value: boolean, _, index) => (
                    <Checkbox
                      checked={value}
                      onChange={(event) =>
                        updatePlanField(index, { required: event.target.checked })
                      }
                    />
                  ),
                },
                {
                  title: "AI 列",
                  key: "ai",
                  width: 90,
                  render: (_, field: PlanField) =>
                    field.ai ? <Tag color="purple">AI</Tag> : <span className="muted">—</span>,
                },
                {
                  title: "操作",
                  key: "actions",
                  width: 70,
                  render: (_, __, index) => (
                    <Button
                      type="link"
                      danger
                      onClick={() =>
                        setPlanFields((prev) => prev.filter((_, i) => i !== index))
                      }
                    >
                      删除
                    </Button>
                  ),
                },
              ]}
            />
          </>
        ) : null}
      </Modal>
      {modal}
    </Panel>
  );
}
