"use client";

import {
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  TableOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Checkbox,
  DatePicker,
  Input,
  InputNumber,
  Radio,
  Select,
  Space,
  Table,
  Tag,
} from "antd";
import Link from "next/link";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { Notice } from "@/components/ui/panel";
import { fmtTime } from "@/lib/datetime";
import {
  CONSOLE_URL,
  JOB_STATUS_COLOR,
  JOB_STATUS_LABEL,
  aliyunCallApi,
  defaultJobGroupName,
  defaultStrategy,
  emptyMapping,
  type AliyunCallInstance,
  type AliyunCallNumber,
  type AliyunCallScript,
  type AliyunCallSettings,
  type AliyunHonorificMode,
  type AliyunJobGroup,
  type AliyunMapping,
  type AliyunPreview,
  type AliyunSourceTable,
  type AliyunStrategy,
} from "./aliyun-call-common";

const PHONE_HINTS = ["手机", "电话", "号码", "phone", "mobile", "tel"];
const NAME_HINTS = ["姓名", "名字", "联系人", "name"];
const ROLE_HINTS = ["角色", "职位", "身份", "role", "title"];
const GENDER_HINTS = ["性别", "gender", "sex"];

const HONORIFIC_OPTIONS = [
  { value: "none", label: "不指定（空值统一补「客户」）" },
  { value: "field", label: "取某一列" },
  { value: "gender", label: "按性别生成（男→先生 / 女→女士）" },
  { value: "fixed", label: "固定称谓" },
];

const PREVIEW_STATUS: Record<string, { label: string; color: string }> = {
  ok: { label: "可提交", color: "success" },
  invalid: { label: "号码无效", color: "error" },
  duplicate: { label: "重复跳过", color: "warning" },
  existing: { label: "已导入跳过", color: "processing" },
};

function guessField(
  fields: AliyunSourceTable["fields"],
  hints: string[],
): string {
  const hit = fields.find((field) =>
    hints.some((hint) => field.name.toLowerCase().includes(hint)),
  );
  return hit?.fieldKey || "";
}

function StepTitle({
  index,
  title,
  extra,
}: {
  index: number;
  title: string;
  extra?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="panel-badge">{index}</span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
      </div>
      {extra}
    </div>
  );
}

function FieldLabel({ children }: { children: string }) {
  return (
    <div className="text-12 muted" style={{ marginBottom: 4 }}>
      {children}
    </div>
  );
}

/**
 * 导入名单：选多维表格 → 映射列 → 选外呼目标（新建 / 追加）→ 预览校验 → 确认导入。
 * 预览与提交读同一套映射；任何映射/目标改动都会让旧预览失效（按钮重新校验）。
 */
export function AliyunCallImport({
  settings,
  onGoSettings,
  onImported,
}: {
  settings: AliyunCallSettings;
  onGoSettings: () => void;
  onImported: (importId: number) => void;
}) {
  const { message } = App.useApp();

  const [tables, setTables] = useState<AliyunSourceTable[] | null>(null);
  const [tablesLoading, setTablesLoading] = useState(true);
  const [tablesError, setTablesError] = useState("");
  const [tableId, setTableId] = useState(0);

  const [mapping, setMapping] = useState<AliyunMapping>(emptyMapping());
  const [instances, setInstances] = useState<AliyunCallInstance[]>([]);
  const [instancesError, setInstancesError] = useState("");
  const [instanceId, setInstanceId] = useState(settings.instanceId);

  const [mode, setMode] = useState<"new" | "append">("new");
  const [scripts, setScripts] = useState<AliyunCallScript[]>([]);
  const [scriptsLoading, setScriptsLoading] = useState(false);
  const [scriptsError, setScriptsError] = useState("");
  const [scriptId, setScriptId] = useState("");
  const [jobGroupName, setJobGroupName] = useState("");
  const [strategy, setStrategy] = useState<AliyunStrategy>(defaultStrategy);
  const [numbers, setNumbers] = useState<AliyunCallNumber[]>([]);
  const [numbersError, setNumbersError] = useState("");
  const [callingNumbers, setCallingNumbers] = useState<string[]>([]);

  const [groups, setGroups] = useState<AliyunJobGroup[]>([]);
  const [groupTotal, setGroupTotal] = useState(0);
  const [groupPage, setGroupPage] = useState(1);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsError, setGroupsError] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<AliyunJobGroup | null>(
    null,
  );

  const [skipExisting, setSkipExisting] = useState(true);
  const [writeBack, setWriteBack] = useState(true);

  const [previewing, setPreviewing] = useState(false);
  const [previewed, setPreviewed] = useState<{
    key: string;
    data: AliyunPreview;
  } | null>(null);
  const [confirmCost, setConfirmCost] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const table = tables?.find((item) => item.id === tableId) || null;

  const reloadTables = useCallback(async () => {
    setTablesLoading(true);
    const result = await aliyunCallApi.tables();
    if (result.data) {
      setTables(result.data.filter((item) => item.can.read));
      setTablesError("");
    } else {
      setTablesError(result.message || "多维表格读取失败");
    }
    setTablesLoading(false);
  }, []);

  useEffect(() => {
    void reloadTables();
  }, [reloadTables]);

  useEffect(() => {
    if (!settings.configured) return;
    void aliyunCallApi.instances().then((result) => {
      if (result.data) {
        setInstances(result.data);
        setInstancesError("");
      } else {
        setInstancesError(result.message || "业务实例读取失败");
      }
    });
  }, [settings.configured, settings.updatedAt]);

  useEffect(() => {
    if (instanceId) return;
    const fallback = settings.instanceId || instances[0]?.instanceId || "";
    if (fallback) setInstanceId(fallback);
  }, [instances, instanceId, settings.instanceId]);

  const selectTable = useCallback(
    (id: number) => {
      setTableId(id);
      const target = (tables || []).find((item) => item.id === id);
      if (!target) return;
      setMapping((prev) => ({
        ...emptyMapping(),
        phoneFieldKey: guessField(target.fields, PHONE_HINTS),
        nameFieldKey: guessField(target.fields, NAME_HINTS),
        roleFieldKey: guessField(target.fields, ROLE_HINTS),
        genderFieldKey: guessField(target.fields, GENDER_HINTS),
        honorificMode: prev.honorificMode,
      }));
      setJobGroupName(defaultJobGroupName(target.name));
      setSelectedGroup(null);
      setPreviewed(null);
      setConfirmCost(false);
    },
    [tables],
  );

  useEffect(() => {
    if (!tables || tables.length !== 1 || tableId) return;
    selectTable(tables[0].id);
  }, [tables, tableId, selectTable]);

  useEffect(() => {
    if (!instanceId) {
      setScripts([]);
      setScriptsError("");
      setScriptsLoading(false);
      setNumbers([]);
      setNumbersError("");
      return;
    }
    let alive = true;
    setScriptsLoading(true);
    void aliyunCallApi.scripts(instanceId).then((result) => {
      if (!alive) return;
      if (result.data) {
        setScripts(result.data);
        setScriptsError("");
      } else {
        setScriptsError(result.message || "已发布话术读取失败");
      }
      setScriptsLoading(false);
    });
    void aliyunCallApi.callingNumbers(instanceId).then((result) => {
      if (!alive) return;
      if (result.data) {
        setNumbers(result.data);
        setNumbersError("");
      } else {
        setNumbersError(result.message || "主叫号码读取失败");
      }
    });
    setScriptId("");
    setCallingNumbers([]);
    return () => {
      alive = false;
    };
  }, [instanceId]);

  const reloadGroups = useCallback(
    async (page: number, search: string) => {
      if (!instanceId) {
        setGroups([]);
        setGroupTotal(0);
        return;
      }
      setGroupsLoading(true);
      const result = await aliyunCallApi.jobGroups({
        instanceId,
        search,
        page,
        pageSize: 20,
      });
      if (result.data) {
        setGroups(result.data.list);
        setGroupTotal(result.data.total);
        setGroupsError("");
      } else {
        setGroupsError(result.message || "任务组读取失败");
      }
      setGroupsLoading(false);
    },
    [instanceId],
  );

  useEffect(() => {
    if (mode !== "append") return;
    setSelectedGroup(null);
    setGroupPage(1);
    void reloadGroups(1, "");
  }, [mode, reloadGroups]);

  const fingerprint = JSON.stringify({
    tableId,
    mapping,
    mode,
    jobGroupId: mode === "append" ? selectedGroup?.jobGroupId || "" : "",
    skipExisting,
  });
  const preview = previewed?.key === fingerprint ? previewed.data : null;
  const previewValid =
    !!preview &&
    preview.errors.length === 0 &&
    preview.validRows > 0 &&
    !!table &&
    !!instanceId;

  const patchMapping = (patch: Partial<AliyunMapping>) =>
    setMapping((prev) => ({ ...prev, ...patch }));

  const setExtra = (index: number, patch: Partial<AliyunMapping["extras"][number]>) =>
    setMapping((prev) => ({
      ...prev,
      extras: prev.extras.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    }));

  const addExtra = () =>
    setMapping((prev) => ({
      ...prev,
      extras: [
        ...prev.extras,
        { key: "", sourceType: "field", fieldKey: "", value: "" },
      ],
    }));

  const removeExtra = (index: number) =>
    setMapping((prev) => ({
      ...prev,
      extras: prev.extras.filter((_, i) => i !== index),
    }));

  const setWindow = (
    index: number,
    patch: { beginTime?: string; endTime?: string },
  ) =>
    setStrategy((prev) => ({
      ...prev,
      workingTimes: prev.workingTimes.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    }));

  const runPreview = async () => {
    if (!tableId) {
      message.warning("请先选择多维表格");
      return;
    }
    if (!mapping.phoneFieldKey) {
      message.warning("请选择被叫号码列");
      return;
    }
    if (mode === "append" && !selectedGroup) {
      message.warning("请选择要追加号码的任务组");
      return;
    }
    setPreviewing(true);
    try {
      const data = await aliyunCallApi.preview({
        tableId,
        mapping,
        mode,
        jobGroupId: mode === "append" ? selectedGroup?.jobGroupId || "" : "",
        skipExisting,
      });
      setPreviewed({ key: fingerprint, data });
      if (!data.errors.length) {
        message.success(
          `校验完成：${data.validRows} 个号码可提交` +
            (data.duplicateRows ? `，${data.duplicateRows} 行重复` : "") +
            (data.invalidRows ? `，${data.invalidRows} 行无效` : "") +
            (data.existingRows ? `，${data.existingRows} 行已导入` : ""),
        );
      }
    } catch (error) {
      setPreviewed(null);
      message.error((error as Error).message || "预览失败");
    } finally {
      setPreviewing(false);
    }
  };

  const submit = async () => {
    if (!preview || !previewValid) return;
    if (mode === "new") {
      if (!scriptId) {
        message.warning("请选择已发布的话术（草稿话术不能发起外呼）");
        return;
      }
      if (!jobGroupName.trim()) {
        message.warning("请填写任务组名称");
        return;
      }
      if (strategy.startMode === "scheduled" && !strategy.startTime) {
        message.warning("请选择开始时间");
        return;
      }
      for (const window of strategy.workingTimes) {
        if (!window.beginTime || !window.endTime) {
          message.warning("外呼时段的开始与结束时间都要填写");
          return;
        }
        if (window.beginTime >= window.endTime) {
          message.warning("外呼时段的开始时间要早于结束时间");
          return;
        }
      }
    }
    if (mode === "append" && !selectedGroup) {
      message.warning("请选择要追加号码的任务组");
      return;
    }
    if (!confirmCost) {
      message.warning("请先勾选「会产生真实通话费用」");
      return;
    }
    setSubmitting(true);
    try {
      const created = await aliyunCallApi.createImport({
        tableId,
        mapping,
        mode,
        jobGroupId: mode === "append" ? selectedGroup?.jobGroupId || "" : "",
        skipExisting,
        instanceId,
        scriptId: mode === "new" ? scriptId : "",
        jobGroupName: mode === "new" ? jobGroupName.trim() : "",
        strategy,
        callingNumbers,
        writeBack,
        confirmCost: true,
      });
      setConfirmCost(false);
      message.success(`已建批次 #${created.id}，正在分批提交到阿里云`);
      onImported(created.id);
    } catch (error) {
      message.error((error as Error).message || "导入失败");
    } finally {
      setSubmitting(false);
    }
  };

  const fieldOptions = (table?.fields || []).map((field) => ({
    value: field.fieldKey,
    label: field.name,
  }));

  const groupColumns = [
    {
      title: "任务组",
      dataIndex: "jobGroupName",
      key: "jobGroupName",
      ellipsis: true,
    },
    {
      title: "状态",
      dataIndex: "jobGroupStatus",
      key: "jobGroupStatus",
      width: 110,
      render: (value: string) => (
        <Tag color={JOB_STATUS_COLOR[value] || "default"}>
          {JOB_STATUS_LABEL[value] || value}
        </Tag>
      ),
    },
    {
      title: "进度",
      key: "progress",
      width: 120,
      render: (_: unknown, row: AliyunJobGroup) =>
        `${row.completedJobs} / ${row.totalJobs}`,
    },
    {
      title: "话术",
      dataIndex: "scriptName",
      key: "scriptName",
      ellipsis: true,
      render: (value: string) => value || "—",
    },
    {
      title: "创建时间",
      dataIndex: "creationTime",
      key: "creationTime",
      width: 170,
      render: (value: number) => fmtTime(value),
    },
  ];

  if (!settings.configured) {
    return (
      <Notice variant="warn">
        先到「外呼设置」完成阿里云账号（AccessKey / 实例）配置，才能导入名单。
        <Button
          type="link"
          onClick={onGoSettings}
          style={{ paddingInline: 6 }}
        >
          去配置
        </Button>
      </Notice>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Notice variant="info">
        名单只提交给你自己的阿里云账号；真实通话会产生费用，首次建议先导 20–50
        条试跑。预览不会调用阿里云，只有「确认导入」才会建任务组并提交号码。
      </Notice>

      {/* ① 选择数据表 */}
      <section>
        <StepTitle
          index={1}
          title="选择多维表格（名单来源）"
          extra={
            <Link href="/data-table" className="text-12">
              去多维表格维护名单
            </Link>
          }
        />
        <Space size={8} wrap>
          <Select
            style={{ width: 380 }}
            showSearch
            optionFilterProp="label"
            loading={tablesLoading}
            value={tableId || undefined}
            placeholder={
              tablesLoading
                ? "多维表格读取中…"
                : tablesError
                  ? "多维表格读取失败，请刷新重试"
                  : tables?.length
                    ? "选择名单来源表"
                    : "没有可读的多维表格"
            }
            onChange={(value) => selectTable(Number(value))}
            options={(tables || []).map((item) => ({
              value: item.id,
              label: `${item.name} · ${item.rowCount} 行`,
            }))}
          />
          <Button
            icon={<ReloadOutlined aria-hidden />}
            onClick={() => void reloadTables()}
          >
            刷新
          </Button>
          {table ? (
            <span className="text-12 muted">
              {`${table.fields.length} 列 · ${table.rowCount} 行${
                table.owner ? "" : "（非本人表，结果不会回写）"
              }`}
            </span>
          ) : null}
        </Space>
        {tablesError ? (
          <div style={{ marginTop: 8 }}>
            <Notice variant="warn">{tablesError}</Notice>
          </div>
        ) : null}
        {table && table.rowCount === 0 ? (
          <div style={{ marginTop: 8 }}>
            <Notice variant="warn">
              该表还没有数据行，先去多维表格补齐名单再回来导入。
            </Notice>
          </div>
        ) : null}
      </section>

      {/* ② 字段映射 */}
      <section>
        <StepTitle index={2} title="字段映射（表列 → 外呼字段）" />
        {!table ? (
          <div className="text-12 muted">选择数据表后，这里会列出可映射的列。</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 12,
              }}
            >
              <div>
                <FieldLabel>被叫号码（必填）</FieldLabel>
                <Select
                  style={{ width: "100%" }}
                  value={mapping.phoneFieldKey || undefined}
                  placeholder="选择存放手机号的列"
                  onChange={(value) => patchMapping({ phoneFieldKey: value })}
                  options={fieldOptions}
                />
              </div>
              <div>
                <FieldLabel>姓名</FieldLabel>
                <Select
                  style={{ width: "100%" }}
                  allowClear
                  value={mapping.nameFieldKey || undefined}
                  placeholder="不选则统一用「客户」"
                  onChange={(value) =>
                    patchMapping({ nameFieldKey: value || "" })
                  }
                  options={fieldOptions}
                />
              </div>
              <div>
                <FieldLabel>角色</FieldLabel>
                <Select
                  style={{ width: "100%" }}
                  allowClear
                  value={mapping.roleFieldKey || undefined}
                  placeholder="不选则不传"
                  onChange={(value) =>
                    patchMapping({ roleFieldKey: value || "" })
                  }
                  options={fieldOptions}
                />
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 12,
              }}
            >
              <div>
                <FieldLabel>称谓</FieldLabel>
                <Select
                  style={{ width: "100%" }}
                  value={mapping.honorificMode}
                  onChange={(value) =>
                    patchMapping({ honorificMode: value as AliyunHonorificMode })
                  }
                  options={HONORIFIC_OPTIONS}
                />
              </div>
              {mapping.honorificMode === "field" ? (
                <div>
                  <FieldLabel>称谓列</FieldLabel>
                  <Select
                    style={{ width: "100%" }}
                    value={mapping.honorificFieldKey || undefined}
                    placeholder="选择称谓列"
                    onChange={(value) =>
                      patchMapping({ honorificFieldKey: value })
                    }
                    options={fieldOptions}
                  />
                </div>
              ) : null}
              {mapping.honorificMode === "gender" ? (
                <div>
                  <FieldLabel>性别列</FieldLabel>
                  <Select
                    style={{ width: "100%" }}
                    value={mapping.genderFieldKey || undefined}
                    placeholder="选择性别列（男 / 女）"
                    onChange={(value) =>
                      patchMapping({ genderFieldKey: value })
                    }
                    options={fieldOptions}
                  />
                </div>
              ) : null}
              {mapping.honorificMode === "fixed" ? (
                <div>
                  <FieldLabel>固定称谓内容</FieldLabel>
                  <Input
                    value={mapping.honorificValue}
                    placeholder="如：客户"
                    onChange={(event) =>
                      patchMapping({ honorificValue: event.target.value })
                    }
                  />
                </div>
              ) : null}
            </div>

            <div>
              <FieldLabel>自定义变量（可选）</FieldLabel>
              <div className="text-12 muted" style={{ marginBottom: 6 }}>
                变量名必须与话术里引用的变量同名（如 ${"{gender}"}
                ）。只有话术引用了这个变量才会生效；性别、城市等都可以这样传。
              </div>
              {mapping.extras.map((extra, index) => (
                <Space
                  key={`extra-${index}`}
                  size={6}
                  wrap
                  style={{ marginBottom: 6 }}
                >
                  <Input
                    style={{ width: 160 }}
                    value={extra.key}
                    placeholder="变量名，如 gender"
                    onChange={(event) =>
                      setExtra(index, { key: event.target.value })
                    }
                  />
                  <Select
                    style={{ width: 110 }}
                    value={extra.sourceType}
                    onChange={(value) =>
                      setExtra(index, {
                        sourceType: value === "fixed" ? "fixed" : "field",
                      })
                    }
                    options={[
                      { value: "field", label: "取列值" },
                      { value: "fixed", label: "固定值" },
                    ]}
                  />
                  {extra.sourceType === "fixed" ? (
                    <Input
                      style={{ width: 200 }}
                      value={extra.value}
                      placeholder="固定值"
                      onChange={(event) =>
                        setExtra(index, { value: event.target.value })
                      }
                    />
                  ) : (
                    <Select
                      style={{ width: 200 }}
                      value={extra.fieldKey || undefined}
                      placeholder="选择来源列"
                      onChange={(value) =>
                        setExtra(index, { fieldKey: value })
                      }
                      options={fieldOptions}
                    />
                  )}
                  <Button
                    icon={<DeleteOutlined aria-hidden />}
                    onClick={() => removeExtra(index)}
                    aria-label="删除这个变量"
                  />
                </Space>
              ))}
              <div>
                <Button
                  type="dashed"
                  icon={<PlusOutlined aria-hidden />}
                  onClick={addExtra}
                >
                  添加自定义变量
                </Button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ③ 外呼目标 */}
      <section>
        <StepTitle index={3} title="外呼目标" />
        <Space size={8} wrap style={{ marginBottom: 10 }}>
          <Select
            style={{ width: 320 }}
            value={instanceId || undefined}
            placeholder={
              instancesError
                ? "业务实例读取失败，请到「外呼设置」检查 AccessKey"
                : "选择阿里云业务实例"
            }
            onChange={(value) => setInstanceId(value)}
            options={instances.map((item) => ({
              value: item.instanceId,
              label: `${item.name || "未命名实例"} · ${item.instanceId}`,
            }))}
          />
          <Radio.Group
            value={mode}
            onChange={(event) =>
              setMode(event.target.value === "append" ? "append" : "new")
            }
            options={[
              { value: "new", label: "新建任务组" },
              { value: "append", label: "追加到已有任务组" },
            ]}
          />
        </Space>
        {instancesError ? (
          <div style={{ marginBottom: 10 }}>
            <Notice variant="warn">{instancesError}</Notice>
          </div>
        ) : null}

        {mode === "new" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                gap: 12,
              }}
            >
              <div>
                <FieldLabel>话术（只列已发布）</FieldLabel>
                <Select
                  style={{ width: "100%" }}
                  loading={scriptsLoading}
                  value={scriptId || undefined}
                  placeholder={
                    !instanceId
                      ? "先选择业务实例"
                      : scriptsError
                        ? "已发布话术读取失败"
                        : scripts.length
                          ? "选择话术"
                          : "该实例下没有已发布话术"
                  }
                  onChange={(value) => setScriptId(value)}
                  options={scripts.map((item) => ({
                    value: item.scriptId,
                    label: item.name || item.scriptId,
                  }))}
                />
              </div>
              <div>
                <FieldLabel>任务组名称</FieldLabel>
                <Input
                  maxLength={60}
                  value={jobGroupName}
                  placeholder="默认「营销-表名-时间」"
                  onChange={(event) => setJobGroupName(event.target.value)}
                />
              </div>
            </div>
            {scriptsError ? <Notice variant="warn">{scriptsError}</Notice> : null}
            {instanceId && !scriptsLoading && !scriptsError && !scripts.length ? (
              <Notice variant="warn">
                该实例下没有已发布的话术，草稿话术不能发起外呼。
                <a
                  href={CONSOLE_URL}
                  target="_blank"
                  rel="noreferrer"
                  style={{ marginLeft: 6 }}
                >
                  去阿里云控制台发布话术
                </a>
              </Notice>
            ) : null}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                gap: 12,
              }}
            >
              <div>
                <FieldLabel>执行方式</FieldLabel>
                <Space size={8} wrap>
                  <Radio.Group
                    value={strategy.startMode}
                    onChange={(event) =>
                      setStrategy((prev) => ({
                        ...prev,
                        startMode:
                          event.target.value === "scheduled"
                            ? "scheduled"
                            : "now",
                      }))
                    }
                    options={[
                      { value: "now", label: "立即开始" },
                      { value: "scheduled", label: "指定开始时间" },
                    ]}
                  />
                  {strategy.startMode === "scheduled" ? (
                    <DatePicker
                      showTime
                      format="YYYY-MM-DD HH:mm"
                      placeholder="选择开始时间"
                      onChange={(value) =>
                        setStrategy((prev) => ({
                          ...prev,
                          startTime: value
                            ? value.format("YYYY-MM-DD HH:mm:ss")
                            : "",
                        }))
                      }
                    />
                  ) : null}
                </Space>
              </div>
              <div>
                <FieldLabel>每日最多拨打次数</FieldLabel>
                <InputNumber
                  min={1}
                  max={5}
                  value={strategy.maxAttemptsPerDay}
                  onChange={(value) =>
                    setStrategy((prev) => ({
                      ...prev,
                      maxAttemptsPerDay: Number(value) || 1,
                    }))
                  }
                />
                <span className="text-12 muted" style={{ marginLeft: 8 }}>
                  阿里云侧单号每日上限 ≤5
                </span>
              </div>
              <div>
                <FieldLabel>重拨间隔（分钟）</FieldLabel>
                <InputNumber
                  min={1}
                  max={1440}
                  value={strategy.minAttemptInterval}
                  onChange={(value) =>
                    setStrategy((prev) => ({
                      ...prev,
                      minAttemptInterval: Number(value) || 60,
                    }))
                  }
                />
              </div>
            </div>

            <div>
              <FieldLabel>外呼时段</FieldLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {strategy.workingTimes.map((window, index) => (
                  <Space key={`window-${index}`} size={6} wrap>
                    <Input
                      type="time"
                      style={{ width: 130 }}
                      value={window.beginTime}
                      onChange={(event) =>
                        setWindow(index, { beginTime: event.target.value })
                      }
                    />
                    <span className="text-12 muted">至</span>
                    <Input
                      type="time"
                      style={{ width: 130 }}
                      value={window.endTime}
                      onChange={(event) =>
                        setWindow(index, { endTime: event.target.value })
                      }
                    />
                    {strategy.workingTimes.length > 1 ? (
                      <Button
                        icon={<DeleteOutlined aria-hidden />}
                        aria-label="删除这个时段"
                        onClick={() =>
                          setStrategy((prev) => ({
                            ...prev,
                            workingTimes: prev.workingTimes.filter(
                              (_, i) => i !== index,
                            ),
                          }))
                        }
                      />
                    ) : null}
                  </Space>
                ))}
                <div>
                  <Button
                    type="dashed"
                    icon={<PlusOutlined aria-hidden />}
                    onClick={() =>
                      setStrategy((prev) => ({
                        ...prev,
                        workingTimes: [
                          ...prev.workingTimes,
                          { beginTime: "09:00", endTime: "18:00" },
                        ],
                      }))
                    }
                  >
                    添加时段
                  </Button>
                </div>
              </div>
              <div className="text-12 muted" style={{ marginTop: 4 }}>
                默认 09:00–12:00、14:00–20:00；阿里云全局可外呼时段还会再约束一次。
              </div>
            </div>

            <div>
              <FieldLabel>主叫号码（可多选，不选＝实例下全部已绑定号码）</FieldLabel>
              <Select
                mode="multiple"
                style={{ width: "100%", maxWidth: 620 }}
                value={callingNumbers}
                placeholder={
                  !instanceId
                    ? "先选择业务实例"
                    : numbersError
                      ? "主叫号码读取失败"
                      : numbers.length
                        ? "不选＝使用全部已绑定号码"
                        : "该实例下没有已绑定主叫号码"
                }
                onChange={(value) => setCallingNumbers(value)}
                options={numbers.map((item) => ({
                  value: item.number,
                  label: `${item.number}${item.bound ? "" : "（未绑定）"}`,
                }))}
              />
              {numbersError ? (
                <div style={{ marginTop: 6 }}>
                  <Notice variant="warn">{numbersError}</Notice>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Space size={8} wrap>
              <Input.Search
                allowClear
                style={{ width: 320 }}
                placeholder="按任务组名称搜索"
                enterButton={<SearchOutlined aria-hidden />}
                onSearch={(value) => {
                  setGroupPage(1);
                  setSelectedGroup(null);
                  void reloadGroups(1, value.trim());
                }}
              />
              <Button
                icon={<ReloadOutlined aria-hidden />}
                loading={groupsLoading}
                onClick={() => void reloadGroups(groupPage, "")}
              >
                刷新
              </Button>
              <span className="text-12 muted">
                只能追加到未结束的任务组；已完成 / 失败 / 已取消请新建。
              </span>
            </Space>
            {groupsError ? <Notice variant="warn">{groupsError}</Notice> : null}
            <Table
              size="small"
              rowKey="jobGroupId"
              loading={groupsLoading}
              columns={groupColumns}
              dataSource={groups}
              pagination={{
                current: groupPage,
                pageSize: 20,
                total: groupTotal,
                showSizeChanger: false,
                onChange: (next) => {
                  setGroupPage(next);
                  void reloadGroups(next, "");
                },
                showTotal: (count) => `共 ${count} 个任务组`,
              }}
              rowSelection={{
                type: "radio",
                selectedRowKeys: selectedGroup ? [selectedGroup.jobGroupId] : [],
                getCheckboxProps: (row) => ({ disabled: !row.appendable }),
                onChange: (_keys, rows) => setSelectedGroup(rows[0] || null),
              }}
              onRow={(row) => ({
                style: row.appendable ? undefined : { opacity: 0.55 },
              })}
            />
            {selectedGroup ? (
              <Notice variant="success">
                {`已选择「${selectedGroup.jobGroupName}」（${
                  JOB_STATUS_LABEL[selectedGroup.jobGroupStatus] ||
                  selectedGroup.jobGroupStatus
                }），追加号码会沿用该任务组原有策略，不覆盖。`}
              </Notice>
            ) : null}
            <div>
              <Checkbox
                checked={skipExisting}
                onChange={(event) => setSkipExisting(event.target.checked)}
              >
                跳过该任务组已导入过的号码（按号码哈希去重，防止重复拨打）
              </Checkbox>
            </div>
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <Checkbox
            checked={writeBack}
            onChange={(event) => setWriteBack(event.target.checked)}
          >
            把批次号 / 任务组 ID / 提交状态 / 失败原因回写到这张表的末尾新增列（仅表归属账号生效）
          </Checkbox>
        </div>
      </section>

      {/* ④ 预览校验 */}
      <section>
        <StepTitle index={4} title="预览并校验（不会调用阿里云）" />
        <Space size={8} wrap>
          <Button
            type="primary"
            ghost
            icon={<TableOutlined aria-hidden />}
            loading={previewing}
            onClick={() => void runPreview()}
          >
            预览并校验
          </Button>
          {table ? (
            <span className="text-12 muted">
              {`将按「${mapping.phoneFieldKey ? table.fields.find((f) => f.fieldKey === mapping.phoneFieldKey)?.name || "已选列" : "未选号码列"}」逐行校验，最多显示前 20 行`}
            </span>
          ) : null}
        </Space>

        {preview ? (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            <Space size={8} wrap>
              <Tag color="blue">{`共 ${preview.totalRows} 行`}</Tag>
              <Tag color="success">{`可提交 ${preview.validRows}`}</Tag>
              <Tag color="warning">{`表内重复 ${preview.duplicateRows}`}</Tag>
              <Tag color="default">{`已导入跳过 ${preview.existingRows}`}</Tag>
              <Tag color="error">{`号码无效 ${preview.invalidRows}`}</Tag>
            </Space>
            {preview.errors.length ? (
              <Notice variant="error">
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {preview.errors.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </Notice>
            ) : null}
            <Table
              size="small"
              rowKey="sourceRowId"
              pagination={false}
              scroll={{ x: 900 }}
              dataSource={preview.sample}
              columns={[
                { title: "行号", dataIndex: "sourceRowId", key: "sourceRowId", width: 80 },
                { title: "姓名", dataIndex: "name", key: "name", width: 120, ellipsis: true },
                { title: "号码（打码）", dataIndex: "phoneMasked", key: "phoneMasked", width: 150 },
                { title: "称谓", dataIndex: "honorific", key: "honorific", width: 90 },
                { title: "角色", dataIndex: "role", key: "role", width: 110, ellipsis: true },
                {
                  title: "自定义变量",
                  key: "extras",
                  ellipsis: true,
                  render: (_: unknown, row: AliyunPreview["sample"][number]) =>
                    row.extras.length
                      ? row.extras.map((item) => `${item.key}=${item.value}`).join(" · ")
                      : "—",
                },
                {
                  title: "校验结果",
                  key: "status",
                  width: 200,
                  render: (_: unknown, row: AliyunPreview["sample"][number]) => {
                    const meta = PREVIEW_STATUS[row.status] || {
                      label: row.status,
                      color: "default",
                    };
                    return (
                      <Space size={4}>
                        <Tag color={meta.color}>{meta.label}</Tag>
                        {row.message ? (
                          <span className="text-12 muted">{row.message}</span>
                        ) : null}
                      </Space>
                    );
                  },
                },
              ]}
            />
          </div>
        ) : null}
      </section>

      {/* ⑤ 确认导入 */}
      {preview && previewValid ? (
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 14,
            background: "var(--card)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {`即将把 ${preview.validRows} 个号码交给阿里云`}
          </div>
          <div className="text-12 muted" style={{ lineHeight: 1.9 }}>
            <div>
              {`目标：${
                mode === "new"
                  ? `新建任务组「${jobGroupName || "未填"}」`
                  : `追加到「${selectedGroup?.jobGroupName || ""}」`
              }`}
            </div>
            <div>
              {`实例：${
                instances.find((item) => item.instanceId === instanceId)?.name ||
                instanceId ||
                "未选择"
              }`}
            </div>
            {mode === "new" ? (
              <>
                <div>
                  {`话术：${
                    scripts.find((item) => item.scriptId === scriptId)?.name ||
                    "未选择"
                  }`}
                </div>
                <div>
                  {`时段：${strategy.workingTimes
                    .map((item) => `${item.beginTime}-${item.endTime}`)
                    .join(" / ")} · 每日 ${strategy.maxAttemptsPerDay} 次 · 间隔 ${strategy.minAttemptInterval} 分钟`}
                </div>
                <div>
                  {`主叫号码：${
                    callingNumbers.length
                      ? callingNumbers.join("、")
                      : "实例下全部已绑定号码"
                  }`}
                </div>
              </>
            ) : (
              <div>
                {`沿用原任务组策略，不覆盖；${
                  skipExisting ? "已导入过的号码会跳过" : "不按历史批次去重"
                }。`}
              </div>
            )}
            <div>{`回写原表：${writeBack ? "是" : "否"}`}</div>
          </div>
          <Checkbox
            checked={confirmCost}
            onChange={(event) => setConfirmCost(event.target.checked)}
          >
            我确认导入后阿里云会向这些号码发起外呼，会产生真实通话费用
          </Checkbox>
          <div>
            <Button
              type="primary"
              icon={<ThunderboltOutlined aria-hidden />}
              loading={submitting}
              disabled={!confirmCost}
              onClick={() => void submit()}
            >
              确认导入
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
