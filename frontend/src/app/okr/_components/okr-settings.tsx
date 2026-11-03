"use client";

import {
  App,
  Button,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Table,
  Tag,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import {
  OKR_VISIBILITIES,
  OKR_VISIBILITY_LABELS,
} from "@enterprise/contracts";
import { okrApi } from "@/api/okr";
import { contentApi } from "@/api/content";
import { Panel } from "@/components/ui/panel";
import { MemberSelect, okrError } from "./okr-common";

type SettingsData = NonNullable<Awaited<ReturnType<typeof okrApi.settings>>>;

type DimensionDraft = { key: string; label: string; weight: number };

type SettingsDraft = {
  managers: string[];
  defaultVisibility: string;
  weekStart: number;
  autoDraftEnabled: boolean;
  metricRefreshHour: number;
  scoreDimensions: DimensionDraft[];
  reportSchedules: Record<string, number>;
};

const WEEK_STARTS = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 0, label: "周日" },
];

const HOURS = Array.from({ length: 24 }, (_, hour) => ({
  value: hour,
  label: `${String(hour).padStart(2, "0")}:00`,
}));

const REPORT_KINDS = [
  { key: "daily", label: "日报", preset: "daily_report", time: "18:00", instruction: "请生成今天的工作日报。\n步骤：\n1. 从长期记忆与「最近在这个系统里的操作」里提取今天的 OKR 记录（目标、KR 进展、计划完成情况）。\n2. 调用 okr 工具读取我在本组织当前周期的目标与计划，按「今日完成 / 数据变化 / 问题与阻塞 / 下一步」四段整理。\n3. 调用 okr 工具把结果写成今天的日报草稿（不提交），缺少记录时如实说明。\n输出 Markdown，300 字以内。" },
  { key: "weekly", label: "周报", preset: "weekly_report", time: "17:30", instruction: "请生成本周 OKR 周报。\n步骤：\n1. 从长期记忆与「最近在这个系统里的操作」里提取本周的 OKR 记录（目标进展、KR 变化、计划完成与逾期）。\n2. 调用 okr 工具读取当前周期的目标、KR 与本周期全部计划，按「本周完成 / 数据变化 / 问题与阻塞 / 下一步」四段整理。\n3. 调用 okr 工具把结果写成本周周报草稿（不提交），缺少记录时如实说明。\n输出 Markdown，600 字以内。" },
];

function toDraft(data: SettingsData): SettingsDraft {
  return {
    managers: [...data.managers],
    defaultVisibility: data.defaultVisibility,
    weekStart: data.weekStart,
    autoDraftEnabled: data.autoDraftEnabled,
    metricRefreshHour: data.metricRefreshHour,
    scoreDimensions: data.scoreDimensions.map((item) => ({ ...item })),
    reportSchedules: Object.fromEntries(
      Object.entries(data.reportSchedules || {})
        .map(([key, value]) => [key, Number(value) || 0])
        .filter(([, value]) => Number(value) > 0),
    ),
  };
}

const sameList = (left: string[], right: string[]) =>
  left.length === right.length && left.every((item, index) => item === right[index]);

export function OkrSettingsTab({
  reload,
}: {
  reload: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const [data, setData] = useState<SettingsData | null>(null);
  const [saved, setSaved] = useState<SettingsDraft | null>(null);
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [scheduleBusy, setScheduleBusy] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const next = await okrApi.settings();
      if (!next) throw new Error("设置加载失败");
      setData(next);
      setSaved(toDraft(next));
      setDraft(toDraft(next));
      setError("");
    } catch (err) {
      setError(okrError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const isOwner = data?.isOwner ?? false;
  const editable = isOwner;

  const weightTotal = useMemo(
    () => Math.round(((draft?.scoreDimensions || []).reduce((sum, item) => sum + (Number(item.weight) || 0), 0)) * 100) / 100,
    [draft],
  );

  const changed = useMemo(() => {
    if (!draft || !saved) return {} as Partial<SettingsDraft>;
    const patch: Partial<SettingsDraft> = {};
    if (!sameList(draft.managers, saved.managers)) patch.managers = draft.managers;
    if (draft.defaultVisibility !== saved.defaultVisibility) patch.defaultVisibility = draft.defaultVisibility;
    if (draft.weekStart !== saved.weekStart) patch.weekStart = draft.weekStart;
    if (draft.autoDraftEnabled !== saved.autoDraftEnabled) patch.autoDraftEnabled = draft.autoDraftEnabled;
    if (draft.metricRefreshHour !== saved.metricRefreshHour) patch.metricRefreshHour = draft.metricRefreshHour;
    if (JSON.stringify(draft.scoreDimensions) !== JSON.stringify(saved.scoreDimensions)) {
      patch.scoreDimensions = draft.scoreDimensions;
    }
    if (JSON.stringify(draft.reportSchedules) !== JSON.stringify(saved.reportSchedules)) {
      patch.reportSchedules = draft.reportSchedules;
    }
    return patch;
  }, [draft, saved]);

  const dirty = Object.keys(changed).length > 0;

  const save = async () => {
    if (!draft) return;
    if (weightTotal !== 100) {
      message.warning(`评分维度权重合计需为 100%（当前 ${weightTotal}%）`);
      return;
    }
    if (draft.scoreDimensions.some((item) => !item.key.trim() || !item.label.trim())) {
      message.warning("评分维度需要名称与标识");
      return;
    }
    setBusy(true);
    try {
      await okrApi.saveSettings({
        body: {
          managers: changed.managers,
          defaultVisibility: changed.defaultVisibility as
            | (typeof OKR_VISIBILITIES)[number]
            | undefined,
          weekStart: changed.weekStart,
          autoDraftEnabled: changed.autoDraftEnabled,
          metricRefreshHour: changed.metricRefreshHour,
          scoreDimensions: changed.scoreDimensions,
          reportSchedules: changed.reportSchedules,
        },
      });
      message.success("设置已保存");
      await load();
      await reload();
    } catch (err) {
      message.error(okrError(err));
    } finally {
      setBusy(false);
    }
  };

  const createSchedule = async (kind: "daily" | "weekly") => {
    const preset = REPORT_KINDS.find((item) => item.key === kind);
    if (!preset || !draft) return;
    setScheduleBusy(kind);
    try {
      const created = await contentApi.saveSchedule({
        body: {
          preset: preset.preset,
          title: `OKR ${preset.label}草稿`,
          instruction: preset.instruction,
          scheduleType: "recurring",
          scheduleConfig:
            kind === "daily"
              ? { freq: "daily", time: preset.time }
              : { freq: "weekly", weekdays: [5], time: preset.time },
        },
      });
      if (!created) throw new Error("定时任务创建失败");
      setDraft({
        ...draft,
        reportSchedules: { ...draft.reportSchedules, [kind]: created.id },
      });
      message.success(
        `已创建「OKR ${preset.label}草稿」定时任务，点右下角「保存设置」完成关联`,
      );
    } catch (err) {
      message.error(okrError(err));
    } finally {
      setScheduleBusy("");
    }
  };

  const updateDimension = (index: number, patch: Partial<DimensionDraft>) => {
    if (!draft) return;
    const next = draft.scoreDimensions.map((item, at) =>
      at === index ? { ...item, ...patch } : item,
    );
    setDraft({ ...draft, scoreDimensions: next });
  };

  const addDimension = () => {
    if (!draft) return;
    let index = draft.scoreDimensions.length + 1;
    let key = `dim_${index}`;
    while (draft.scoreDimensions.some((item) => item.key === key)) {
      index += 1;
      key = `dim_${index}`;
    }
    setDraft({
      ...draft,
      scoreDimensions: [...draft.scoreDimensions, { key, label: "", weight: 0 }],
    });
  };

  const removeDimension = (index: number) => {
    if (!draft) return;
    setDraft({
      ...draft,
      scoreDimensions: draft.scoreDimensions.filter((_, at) => at !== index),
    });
  };

  if (loading && !data) {
    return (
      <div className="panel">
        <div className="panel-body muted">正在加载设置…</div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <Panel title="设置加载失败">
        <div className="muted">{error}</div>
        <Button style={{ marginTop: 8 }} onClick={() => void load()}>
          重试
        </Button>
      </Panel>
    );
  }

  if (!draft || !saved || !data) return null;

  return (
    <>
      {!editable ? (
        <div className="panel" style={{ marginBottom: 12 }}>
          <div className="panel-body muted">
            只有账号所有者可以修改 OKR 设置；以下为当前生效的配置。
          </div>
        </div>
      ) : null}

      <Panel title="基础设置">
        <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 720 }}>
          <div>
            <div className="muted text-12" style={{ marginBottom: 4 }}>
              管理者名单（可看全账号目标与汇报、下发目标、点评汇报、给成员打分）
            </div>
            <MemberSelect
              mode="multiple"
              members={data.members}
              includeOwner={false}
              value={draft.managers}
              disabled={!editable}
              onChange={(value) =>
                setDraft({ ...draft, managers: Array.isArray(value) ? value : [] })
              }
            />
          </div>
          <div>
            <div className="muted text-12" style={{ marginBottom: 4 }}>
              新建目标的默认可见性
            </div>
            <Select
              style={{ width: 240 }}
              disabled={!editable}
              value={draft.defaultVisibility}
              options={OKR_VISIBILITIES.map((item) => ({
                value: item,
                label: OKR_VISIBILITY_LABELS[item] || item,
              }))}
              onChange={(value: string) => setDraft({ ...draft, defaultVisibility: value })}
            />
          </div>
          <div>
            <div className="muted text-12" style={{ marginBottom: 4 }}>
              周起始日（只影响周计划与周报的归集）
            </div>
            <Select
              style={{ width: 240 }}
              disabled={!editable}
              value={draft.weekStart}
              options={WEEK_STARTS}
              onChange={(value: number) => setDraft({ ...draft, weekStart: value })}
            />
          </div>
          <div>
            <div className="muted text-12" style={{ marginBottom: 4 }}>
              自动指标刷新（每天该时刻重算自动型 KR，凌晨低谷执行）
            </div>
            <Select
              style={{ width: 240 }}
              disabled={!editable}
              value={draft.metricRefreshHour}
              options={HOURS}
              onChange={(value: number) => setDraft({ ...draft, metricRefreshHour: value })}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Switch
              disabled={!editable}
              checked={draft.autoDraftEnabled}
              onChange={(checked) => setDraft({ ...draft, autoDraftEnabled: checked })}
            />
            <span>
              自动草稿
              <span className="muted text-12">
                （开启后，汇报页可一键按系统记录生成草稿）
              </span>
            </span>
          </div>
        </div>
      </Panel>

      <Panel
        title="评分维度"
        titleExtra={
          <span className={weightTotal === 100 ? "muted text-12" : "text-12"} style={weightTotal === 100 ? undefined : { color: "#cf1322" }}>
            {`权重合计 ${weightTotal}%（需为 100%）`}
          </span>
        }
        extra={
          editable ? (
            <Button onClick={addDimension}>添加维度</Button>
          ) : null
        }
      >
        <Table
          size="small"
          rowKey={(row: DimensionDraft) => row.key}
          pagination={false}
          dataSource={draft.scoreDimensions}
          locale={{ emptyText: "还没有评分维度" }}
          columns={[
            {
              title: "名称",
              dataIndex: "label",
              render: (value: string, _row: DimensionDraft, index: number) => (
                <Input
                  size="small"
                  value={value}
                  disabled={!editable}
                  maxLength={32}
                  onChange={(event) => updateDimension(index, { label: event.target.value })}
                />
              ),
            },
            {
              title: "标识",
              dataIndex: "key",
              width: 160,
              render: (value: string, _row: DimensionDraft, index: number) => (
                <Input
                  size="small"
                  value={value}
                  disabled={!editable}
                  maxLength={32}
                  onChange={(event) =>
                    updateDimension(index, { key: event.target.value.trim() })
                  }
                />
              ),
            },
            {
              title: "权重（%）",
              dataIndex: "weight",
              width: 140,
              render: (value: number, _row: DimensionDraft, index: number) => (
                <InputNumber
                  size="small"
                  min={0}
                  max={100}
                  precision={1}
                  disabled={!editable}
                  value={value}
                  onChange={(next) => updateDimension(index, { weight: Number(next) || 0 })}
                />
              ),
            },
            {
              title: "",
              width: 80,
              render: (_: unknown, _row: DimensionDraft, index: number) =>
                editable ? (
                  <Button type="link" size="small" danger onClick={() => removeDimension(index)}>
                    删除
                  </Button>
                ) : null,
            },
          ]}
        />
      </Panel>

      <Panel
        title="日报 / 周报草稿定时任务"
        titleExtra={
          <span className="muted text-12">
            在「工作台 → Agent → 定时任务」里可改时间与指令；这里只做创建与关联
          </span>
        }
      >
        <Table
          size="small"
          rowKey="key"
          pagination={false}
          dataSource={REPORT_KINDS}
          columns={[
            { title: "汇报", dataIndex: "label", width: 100 },
            {
              title: "建议时间",
              dataIndex: "time",
              width: 120,
            },
            {
              title: "关联状态",
              width: 200,
              render: (_: unknown, row: (typeof REPORT_KINDS)[number]) => {
                const id = draft.reportSchedules[row.key] || 0;
                return id > 0 ? (
                  <Tag color="green">{`已关联定时任务 #${id}`}</Tag>
                ) : (
                  <Tag>未关联</Tag>
                );
              },
            },
            {
              title: "操作",
              width: 200,
              render: (_: unknown, row: (typeof REPORT_KINDS)[number]) => {
                const id = draft.reportSchedules[row.key] || 0;
                return editable ? (
                  <Space size={4}>
                    <Button
                      type="link"
                      size="small"
                      loading={scheduleBusy === row.key}
                      disabled={id > 0}
                      onClick={() => void createSchedule(row.key as "daily" | "weekly")}
                    >
                      {id > 0 ? "已创建" : `创建${row.label}定时任务`}
                    </Button>
                    {id > 0 ? (
                      <Button
                        type="link"
                        size="small"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            reportSchedules: Object.fromEntries(
                              Object.entries(draft.reportSchedules).filter(
                                ([key]) => key !== row.key,
                              ),
                            ),
                          })
                        }
                      >
                        取消关联
                      </Button>
                    ) : null}
                  </Space>
                ) : null;
              },
            },
          ]}
        />
        <div className="muted text-12" style={{ marginTop: 8 }}>
          定时任务到点由 Agent 生成草稿并调用 OKR 工具写入，不会自动提交；生成后会在通知中心提醒。
        </div>
      </Panel>

      <Panel title="成员与岗位能力" titleExtra={<span className="muted text-12">岗位与能力在「职员与代理人」里维护</span>}>
        <Table
          size="small"
          rowKey="memberUserId"
          pagination={false}
          dataSource={data.members}
          locale={{ emptyText: "本账号还没有成员" }}
          columns={[
            {
              title: "成员",
              dataIndex: "name",
              render: (value: string, row: SettingsData["members"][number]) => (
                <div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span>{value || row.memberUserId}</span>
                    {row.dualKind ? <Tag color="blue">双身份</Tag> : null}
                    {draft.managers.includes(row.memberUserId) ? (
                      <Tag color="gold">管理者</Tag>
                    ) : null}
                  </div>
                  {row.department ? (
                    <div className="muted text-12">{row.department}</div>
                  ) : null}
                </div>
              ),
            },
            {
              title: "岗位",
              dataIndex: "positions",
              render: (value: SettingsData["members"][number]["positions"]) =>
                value?.length ? (
                  <Space size={4} wrap>
                    {value.map((item) => (
                      <Tag key={item.name}>{item.name}</Tag>
                    ))}
                  </Space>
                ) : (
                  "—"
                ),
            },
            {
              title: "能力说明",
              dataIndex: "capabilities",
              render: (value: string) =>
                value ? (
                  <span title={value}>
                    {value.length > 60 ? `${value.slice(0, 60)}…` : value}
                  </span>
                ) : (
                  "—"
                ),
            },
          ]}
        />
      </Panel>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        {dirty ? (
          <Button onClick={() => setDraft(saved)} disabled={busy}>
            还原
          </Button>
        ) : null}
        <Button
          type="primary"
          loading={busy}
          disabled={!editable || !dirty}
          onClick={() => void save()}
        >
          保存设置
        </Button>
      </div>
    </>
  );
}
