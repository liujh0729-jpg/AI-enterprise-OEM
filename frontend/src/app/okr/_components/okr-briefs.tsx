"use client";

import { App, Button, Input, InputNumber, Modal, Select, Table, Tag } from "antd";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import {
  OKR_BRIEF_STATUS_LABELS,
  type OkrBriefView,
} from "@enterprise/contracts";
import { okrApi } from "@/api/okr";
import { Panel } from "@/components/ui/panel";
import {
  Toolbar,
  cycleName,
  fmtRange,
  okrError,
  type OkrContextData,
} from "./okr-common";

type ListKey =
  | "deliverables"
  | "labor"
  | "materials"
  | "equipment"
  | "externalServices";

type BriefDraft = {
  id: number;
  cycleId: number;
  title: string;
  businessGoal: string;
  scopeWhat: string;
  scopeTarget: string;
  startDate: string;
  endDate: string;
  budgetAmount: number;
  budgetHours: number;
  currency: string;
  constraints: string;
  deliverables: OkrBriefView["deliverables"];
  labor: OkrBriefView["labor"];
  materials: OkrBriefView["materials"];
  equipment: OkrBriefView["equipment"];
  externalServices: OkrBriefView["externalServices"];
};

const blankBrief = (cycleId: number): BriefDraft => ({
  id: 0,
  cycleId,
  title: "",
  businessGoal: "",
  scopeWhat: "",
  scopeTarget: "",
  startDate: "",
  endDate: "",
  budgetAmount: 0,
  budgetHours: 0,
  currency: "CNY",
  constraints: "",
  deliverables: [],
  labor: [],
  materials: [],
  equipment: [],
  externalServices: [],
});

const externalKinds = [
  { value: "VENDOR", label: "供应商" },
  { value: "OPC", label: "OPC" },
  { value: "PERSON", label: "外部个人" },
  { value: "PARTNER", label: "合作伙伴" },
];

function statusTag(status: string) {
  const color =
    status === "COMMITTED"
      ? "green"
      : status === "READY"
        ? "blue"
        : status === "CLOSED"
          ? "default"
          : "gold";
  return (
    <Tag color={color}>{OKR_BRIEF_STATUS_LABELS[status] || status}</Tag>
  );
}

function ReadinessCell({ row }: { row: OkrBriefView }) {
  const { blockers, warnings } = row.readiness;
  if (!blockers.length && !warnings.length) {
    return <span className="muted text-12">信息齐全</span>;
  }
  return (
    <div className="text-12">
      {blockers.length ? (
        <div style={{ color: "var(--danger, #cf1322)" }}>
          待补 {blockers.length}：{blockers[0]}
        </div>
      ) : null}
      {warnings.length ? (
        <div className="muted">提醒 {warnings.length}：{warnings[0]}</div>
      ) : null}
    </div>
  );
}

function RowShell({
  children,
  onRemove,
}: {
  children: ReactNode;
  onRemove: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        alignItems: "center",
        marginBottom: 6,
      }}
    >
      {children}
      <Button size="small" danger type="text" onClick={onRemove}>
        删除
      </Button>
    </div>
  );
}

function SubTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <div style={{ margin: "12px 0 6px" }}>
      <span style={{ fontWeight: 600 }}>{title}</span>
      <span className="muted text-12" style={{ marginLeft: 8 }}>
        {hint}
      </span>
    </div>
  );
}

export function OkrBriefsTab({
  ctx,
  onDecompose,
}: {
  ctx: OkrContextData;
  onDecompose: (briefId: number) => void;
}) {
  const { message, modal } = App.useApp();
  const [rows, setRows] = useState<OkrBriefView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<BriefDraft>(() =>
    blankBrief(ctx.cycle?.id || 0),
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = (await okrApi.briefs({ query: {} })) ?? [];
      setRows(data);
      setError("");
    } catch (err) {
      setError(okrError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setField = <K extends keyof BriefDraft>(
    key: K,
    value: BriefDraft[K],
  ) => setDraft((prev) => ({ ...prev, [key]: value }));

  const setList = <T,>(key: ListKey, list: T[]) =>
    setDraft((prev) => ({ ...prev, [key]: list }) as BriefDraft);

  const openCreate = () => {
    setDraft(blankBrief(ctx.cycle?.id || ctx.cycles[0]?.id || 0));
    setEditorOpen(true);
  };

  const openEdit = (row: OkrBriefView) => {
    setDraft({
      id: row.id,
      cycleId: row.cycleId,
      title: row.title,
      businessGoal: row.businessGoal,
      scopeWhat: row.scopeWhat,
      scopeTarget: row.scopeTarget,
      startDate: row.startDate,
      endDate: row.endDate,
      budgetAmount: row.budgetAmount,
      budgetHours: row.budgetHours,
      currency: row.currency,
      constraints: row.constraints,
      deliverables: row.deliverables,
      labor: row.labor,
      materials: row.materials,
      equipment: row.equipment,
      externalServices: row.externalServices,
    });
    setEditorOpen(true);
  };

  const save = async () => {
    if (!draft.title.trim()) {
      message.warning("请填写目标书标题");
      return;
    }
    setSaving(true);
    try {
      await okrApi.saveBrief({
        body: {
          id: draft.id,
          cycleId: draft.cycleId,
          title: draft.title.trim(),
          businessGoal: draft.businessGoal,
          scopeWhat: draft.scopeWhat,
          scopeTarget: draft.scopeTarget,
          deliverables: draft.deliverables,
          startDate: draft.startDate,
          endDate: draft.endDate,
          budgetAmount: draft.budgetAmount,
          budgetHours: draft.budgetHours,
          currency: draft.currency,
          labor: draft.labor,
          materials: draft.materials,
          equipment: draft.equipment,
          externalServices: draft.externalServices,
          constraints: draft.constraints,
        },
      });
      message.success("目标书已保存");
      setEditorOpen(false);
      await load();
    } catch (err) {
      message.error(okrError(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = (row: OkrBriefView) => {
    modal.confirm({
      title: "删除目标书",
      content: `确认删除「${row.title}」？已生成但未确认的拆解方案会一并删除。`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          await okrApi.removeBrief({ params: { id: String(row.id) } });
          message.success("已删除");
          await load();
        } catch (err) {
          message.error(okrError(err));
        }
      },
    });
  };

  const columns = [
    {
      title: "目标书",
      dataIndex: "title",
      render: (value: string, row: OkrBriefView) => (
        <div>
          <div style={{ fontWeight: 600 }}>{value}</div>
          <div className="muted text-12">
            {row.businessGoal || "未填写总体业务目标"}
          </div>
        </div>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 96,
      render: (value: string) => statusTag(value),
    },
    {
      title: "周期",
      dataIndex: "cycleId",
      width: 150,
      render: (value: number) =>
        cycleName(ctx.cycles.find((item) => item.id === value)),
    },
    {
      title: "工期",
      width: 170,
      render: (_: unknown, row: OkrBriefView) => fmtRange(row.startDate, row.endDate),
    },
    {
      title: "预算",
      width: 110,
      render: (_: unknown, row: OkrBriefView) =>
        row.budgetAmount > 0 ? `${row.budgetAmount} ${row.currency}` : "未填",
    },
    {
      title: "前置检查",
      width: 240,
      render: (_: unknown, row: OkrBriefView) => <ReadinessCell row={row} />,
    },
    {
      title: "操作",
      width: 220,
      render: (_: unknown, row: OkrBriefView) => (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <Button size="small" onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Button
            size="small"
            type="primary"
            disabled={row.status === "CLOSED"}
            onClick={() => onDecompose(row.id)}
          >
            AI 拆解
          </Button>
          <Button size="small" danger type="text" onClick={() => remove(row)}>
            删除
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Panel
      title="目标书"
      titleExtra={
        <span className="muted text-12">
          总体业务目标 + 项目铁三角（范围 / 时间 / 成本），是 AI 拆解的输入
        </span>
      }
      extra={
        <Button type="primary" onClick={openCreate}>
          新建目标书
        </Button>
      }
    >
      {error ? (
        <div style={{ marginBottom: 8 }}>
          <span style={{ color: "var(--danger, #cf1322)" }}>{error}</span>
          <Button size="small" style={{ marginLeft: 8 }} onClick={() => void load()}>
            重试
          </Button>
        </div>
      ) : null}
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={rows}
        columns={columns}
        pagination={false}
        locale={{ emptyText: "还没有目标书：先写清目标、范围、工期与预算" }}
      />

      <Modal
        title={draft.id ? "编辑目标书" : "新建目标书"}
        open={editorOpen}
        width={920}
        onCancel={() => setEditorOpen(false)}
        onOk={() => void save()}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        destroyOnHidden
        styles={{ body: { maxHeight: "64vh", overflowY: "auto", paddingRight: 8 } }}
      >
        <Toolbar hint="缺信息不阻断分析，但会阻断依赖它的确认落库">
          <Select
            style={{ width: 220 }}
            value={draft.cycleId || undefined}
            placeholder="选择目标周期"
            options={ctx.cycles.map((cycle) => ({
              value: cycle.id,
              label: cycleName(cycle),
            }))}
            onChange={(value) => setField("cycleId", Number(value))}
          />
          <Input
            style={{ width: 320 }}
            placeholder="目标书标题，例如：2027 华东区新签增长"
            value={draft.title}
            maxLength={200}
            onChange={(event) => setField("title", event.target.value)}
          />
        </Toolbar>

        <Input.TextArea
          rows={2}
          placeholder="总体业务目标：例如 2027 年华东区新签合同额增长 40%"
          value={draft.businessGoal}
          maxLength={5000}
          onChange={(event) => setField("businessGoal", event.target.value)}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <Input.TextArea
            rows={3}
            placeholder="范围：做什么"
            value={draft.scopeWhat}
            maxLength={3000}
            onChange={(event) => setField("scopeWhat", event.target.value)}
          />
          <Input.TextArea
            rows={3}
            placeholder="范围：达到什么目标"
            value={draft.scopeTarget}
            maxLength={3000}
            onChange={(event) => setField("scopeTarget", event.target.value)}
          />
        </div>

        <SubTitle title="时间" hint="工期决定容量与关键路径校验" />
        <div style={{ display: "flex", gap: 8 }}>
          <Input
            type="date"
            style={{ width: 180 }}
            value={draft.startDate}
            onChange={(event) => setField("startDate", event.target.value)}
          />
          <Input
            type="date"
            style={{ width: 180 }}
            value={draft.endDate}
            onChange={(event) => setField("endDate", event.target.value)}
          />
        </div>

        <SubTitle title="成本" hint="预算用于超支校验；人力按组织费率折算" />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <InputNumber
            style={{ width: 180 }}
            min={0}
            value={draft.budgetAmount}
            placeholder="预算金额"
            onChange={(value) => setField("budgetAmount", Number(value) || 0)}
          />
          <Input
            style={{ width: 90 }}
            value={draft.currency}
            maxLength={8}
            onChange={(event) => setField("currency", event.target.value)}
          />
          <InputNumber
            style={{ width: 180 }}
            min={0}
            value={draft.budgetHours}
            placeholder="预算工时"
            onChange={(value) => setField("budgetHours", Number(value) || 0)}
          />
        </div>

        <SubTitle title="交付物" hint="逐条添加；交付物决定任务与验收清单" />
        {draft.deliverables.map((row, index) => (
          <RowShell
            key={`d-${index}`}
            onRemove={() =>
              setList(
                "deliverables",
                draft.deliverables.filter((_, item) => item !== index),
              )
            }
          >
            <Input
              style={{ width: 220 }}
              placeholder="交付物名称"
              value={row.name}
              onChange={(event) =>
                setList(
                  "deliverables",
                  draft.deliverables.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, name: event.target.value }
                      : item,
                  ),
                )
              }
            />
            <Input
              placeholder="说明"
              value={row.description}
              onChange={(event) =>
                setList(
                  "deliverables",
                  draft.deliverables.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, description: event.target.value }
                      : item,
                  ),
                )
              }
            />
            <Input
              style={{ width: 240 }}
              placeholder="验收标准"
              value={row.acceptance}
              onChange={(event) =>
                setList(
                  "deliverables",
                  draft.deliverables.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, acceptance: event.target.value }
                      : item,
                  ),
                )
              }
            />
          </RowShell>
        ))}
        <Button
          size="small"
          onClick={() =>
            setList("deliverables", [
              ...draft.deliverables,
              { name: "", description: "", acceptance: "" },
            ])
          }
        >
          添加交付物
        </Button>

        <SubTitle title="人力" hint="角色 + 人数 + 工时；可指定组织成员" />
        {draft.labor.map((row, index) => (
          <RowShell
            key={`l-${index}`}
            onRemove={() =>
              setList(
                "labor",
                draft.labor.filter((_, item) => item !== index),
              )
            }
          >
            <Input
              style={{ width: 180 }}
              placeholder="角色，例如 交付经理"
              value={row.role}
              onChange={(event) =>
                setList(
                  "labor",
                  draft.labor.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, role: event.target.value }
                      : item,
                  ),
                )
              }
            />
            <InputNumber
              style={{ width: 110 }}
              min={0}
              value={row.headcount}
              placeholder="人数"
              onChange={(value) =>
                setList(
                  "labor",
                  draft.labor.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, headcount: Number(value) || 0 }
                      : item,
                  ),
                )
              }
            />
            <InputNumber
              style={{ width: 130 }}
              min={0}
              value={row.hours}
              placeholder="工时"
              onChange={(value) =>
                setList(
                  "labor",
                  draft.labor.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, hours: Number(value) || 0 }
                      : item,
                  ),
                )
              }
            />
            <Select
              style={{ width: 200 }}
              allowClear
              value={row.memberUserId || undefined}
              placeholder="指定成员（可选）"
              options={ctx.members.map((member) => ({
                value: member.memberUserId,
                label: member.name || member.memberUserId,
              }))}
              onChange={(value) =>
                setList(
                  "labor",
                  draft.labor.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, memberUserId: String(value || "") }
                      : item,
                  ),
                )
              }
            />
          </RowShell>
        ))}
        <Button
          size="small"
          onClick={() =>
            setList("labor", [
              ...draft.labor,
              { role: "", headcount: 1, hours: 0, memberUserId: "" },
            ])
          }
        >
          添加人力
        </Button>

        <SubTitle title="物力" hint="物料数量 × 单价" />
        {draft.materials.map((row, index) => (
          <RowShell
            key={`m-${index}`}
            onRemove={() =>
              setList(
                "materials",
                draft.materials.filter((_, item) => item !== index),
              )
            }
          >
            <Input
              style={{ width: 260 }}
              placeholder="物料名称"
              value={row.name}
              onChange={(event) =>
                setList(
                  "materials",
                  draft.materials.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, name: event.target.value }
                      : item,
                  ),
                )
              }
            />
            <InputNumber
              style={{ width: 120 }}
              min={0}
              value={row.qty}
              placeholder="数量"
              onChange={(value) =>
                setList(
                  "materials",
                  draft.materials.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, qty: Number(value) || 0 }
                      : item,
                  ),
                )
              }
            />
            <InputNumber
              style={{ width: 140 }}
              min={0}
              value={row.unitCost}
              placeholder="单价"
              onChange={(value) =>
                setList(
                  "materials",
                  draft.materials.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, unitCost: Number(value) || 0 }
                      : item,
                  ),
                )
              }
            />
          </RowShell>
        ))}
        <Button
          size="small"
          onClick={() =>
            setList("materials", [
              ...draft.materials,
              { name: "", qty: 1, unitCost: 0 },
            ])
          }
        >
          添加物料
        </Button>

        <SubTitle title="设备" hint="数量 × 单价 × 天数" />
        {draft.equipment.map((row, index) => (
          <RowShell
            key={`e-${index}`}
            onRemove={() =>
              setList(
                "equipment",
                draft.equipment.filter((_, item) => item !== index),
              )
            }
          >
            <Input
              style={{ width: 240 }}
              placeholder="设备名称"
              value={row.name}
              onChange={(event) =>
                setList(
                  "equipment",
                  draft.equipment.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, name: event.target.value }
                      : item,
                  ),
                )
              }
            />
            <InputNumber
              style={{ width: 110 }}
              min={0}
              value={row.qty}
              placeholder="数量"
              onChange={(value) =>
                setList(
                  "equipment",
                  draft.equipment.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, qty: Number(value) || 0 }
                      : item,
                  ),
                )
              }
            />
            <InputNumber
              style={{ width: 130 }}
              min={0}
              value={row.unitCost}
              placeholder="单价"
              onChange={(value) =>
                setList(
                  "equipment",
                  draft.equipment.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, unitCost: Number(value) || 0 }
                      : item,
                  ),
                )
              }
            />
            <InputNumber
              style={{ width: 110 }}
              min={0}
              value={row.days}
              placeholder="天数"
              onChange={(value) =>
                setList(
                  "equipment",
                  draft.equipment.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, days: Number(value) || 0 }
                      : item,
                  ),
                )
              }
            />
          </RowShell>
        ))}
        <Button
          size="small"
          onClick={() =>
            setList("equipment", [
              ...draft.equipment,
              { name: "", qty: 1, unitCost: 0, days: 0 },
            ])
          }
        >
          添加设备
        </Button>

        <SubTitle
          title="外部服务"
          hint="供应商 / OPC / 外部个人；关联主体后才能进入合作与结算"
        />
        {draft.externalServices.map((row, index) => (
          <RowShell
            key={`x-${index}`}
            onRemove={() =>
              setList(
                "externalServices",
                draft.externalServices.filter((_, item) => item !== index),
              )
            }
          >
            <Select
              style={{ width: 150 }}
              value={row.kind}
              options={externalKinds}
              onChange={(value) =>
                setList(
                  "externalServices",
                  draft.externalServices.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, kind: value } : item,
                  ),
                )
              }
            />
            <Input
              placeholder="合作范围"
              value={row.scope}
              onChange={(event) =>
                setList(
                  "externalServices",
                  draft.externalServices.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, scope: event.target.value }
                      : item,
                  ),
                )
              }
            />
            <InputNumber
              style={{ width: 140 }}
              min={0}
              value={row.budget}
              placeholder="预算"
              onChange={(value) =>
                setList(
                  "externalServices",
                  draft.externalServices.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, budget: Number(value) || 0 }
                      : item,
                  ),
                )
              }
            />
            <InputNumber
              style={{ width: 160 }}
              min={0}
              value={row.partyId || undefined}
              placeholder="外部主体 ID（可选）"
              onChange={(value) =>
                setList(
                  "externalServices",
                  draft.externalServices.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, partyId: Number(value) || 0 }
                      : item,
                  ),
                )
              }
            />
          </RowShell>
        ))}
        <Button
          size="small"
          onClick={() =>
            setList("externalServices", [
              ...draft.externalServices,
              { kind: "VENDOR", scope: "", budget: 0, partyId: 0 },
            ])
          }
        >
          添加外部服务
        </Button>

        <SubTitle title="约束与假设" hint="合规、场地、供应商档期、依赖前提等" />
        <Input.TextArea
          rows={3}
          value={draft.constraints}
          maxLength={3000}
          onChange={(event) => setField("constraints", event.target.value)}
        />
        {draft.startDate && draft.endDate && draft.endDate < draft.startDate ? (
          <div className="text-12" style={{ color: "var(--danger, #cf1322)", marginTop: 8 }}>
            结束日期不能早于开始日期
          </div>
        ) : null}
        <div className="muted text-12" style={{ marginTop: 8 }}>
          保存时会自动检查：目标、范围、交付物、周期、工期；缺口只提示，不拦保存。
        </div>
      </Modal>
    </Panel>
  );
}
