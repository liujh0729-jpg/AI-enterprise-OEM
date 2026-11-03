"use client";

import {
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  TableOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Checkbox,
  Input,
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
import {
  MAX_VARIABLES,
  PREVIEW_STATUS,
  RECEIVER_CAPACITY,
  VARIABLE_KEY_PATTERN,
  aliyunMailApi,
  emptyMapping,
  type AliyunMailMapping,
  type AliyunMailPreview,
  type AliyunMailReceiver,
  type AliyunMailSettings,
  type AliyunMailSourceTable,
} from "./aliyun-mail-common";

const EMAIL_HINTS = ["邮箱", "邮件", "email", "mail", "e-mail"];
const NAME_HINTS = ["姓名", "名字", "联系人", "name"];

function guessField(
  fields: AliyunMailSourceTable["fields"],
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

/** 模板变量名只允许英文字母；这里做一次前端校验，避免整表读完才报错。 */
function variableError(mapping: AliyunMailMapping): string {
  const seen = new Set<string>();
  for (const item of mapping.variables) {
    if (!item.key && !item.fieldKey) continue;
    if (!item.key) return "变量名不能为空";
    if (!VARIABLE_KEY_PATTERN.test(item.key)) {
      return `变量名「${item.key}」不合法（只能用英文字母，如 UserName）`;
    }
    if (!item.fieldKey) return `变量 ${item.key} 还没选来源列`;
    if (seen.has(item.key)) return `变量名「${item.key}」重复`;
    seen.add(item.key);
  }
  return "";
}

/**
 * 同步名单：选多维表格 → 映射邮箱列与模板变量 → 选收件人列表（新建 / 追加）→
 * 预览校验 → 开始同步。预览与提交读同一套映射；改动映射/目标后旧预览失效。
 */
export function AliyunMailImport({
  settings,
  onGoSettings,
  onImported,
}: {
  settings: AliyunMailSettings;
  onGoSettings: () => void;
  onImported: (importId: number) => void;
}) {
  const { message } = App.useApp();

  const [tables, setTables] = useState<AliyunMailSourceTable[] | null>(null);
  const [tablesLoading, setTablesLoading] = useState(true);
  const [tablesError, setTablesError] = useState("");
  const [tableId, setTableId] = useState(0);

  const [mapping, setMapping] = useState<AliyunMailMapping>(emptyMapping());

  const [mode, setMode] = useState<"new" | "append">("new");
  const [receiverName, setReceiverName] = useState("");
  const [receiverAlias, setReceiverAlias] = useState("");
  const [description, setDescription] = useState("");

  const [lists, setLists] = useState<AliyunMailReceiver[]>([]);
  const [listsLoading, setListsLoading] = useState(false);
  const [listsError, setListsError] = useState("");
  const [receiverId, setReceiverId] = useState("");

  const [previewing, setPreviewing] = useState(false);
  const [previewed, setPreviewed] = useState<{
    key: string;
    data: AliyunMailPreview;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const table = tables?.find((item) => item.id === tableId) || null;

  const reloadTables = useCallback(async () => {
    setTablesLoading(true);
    const result = await aliyunMailApi.tables();
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

  const reloadLists = useCallback(async () => {
    if (!settings.configured) return;
    setListsLoading(true);
    const result = await aliyunMailApi.receiverLists("");
    if (result.data) {
      setLists(result.data);
      setListsError("");
    } else {
      setListsError(result.message || "收件人列表读取失败");
    }
    setListsLoading(false);
  }, [settings.configured]);

  useEffect(() => {
    if (mode !== "append") return;
    void reloadLists();
  }, [mode, reloadLists]);

  useEffect(() => {
    if (mode !== "append" || receiverId) return;
    const preferred =
      lists.find((item) => item.receiverId === settings.defaultReceiverId) ||
      lists[0];
    if (preferred) setReceiverId(preferred.receiverId);
  }, [mode, lists, receiverId, settings.defaultReceiverId]);

  const selectTable = useCallback(
    (id: number) => {
      setTableId(id);
      const target = (tables || []).find((item) => item.id === id);
      if (!target) return;
      const emailFieldKey = guessField(target.fields, EMAIL_HINTS);
      const nameFieldKey = guessField(target.fields, NAME_HINTS);
      setMapping({
        emailFieldKey,
        variables: nameFieldKey ? [{ key: "UserName", fieldKey: nameFieldKey }] : [],
        writeBack: true,
      });
      setReceiverName(target.name);
      setReceiverAlias("");
      setDescription("");
      setPreviewed(null);
    },
    [tables],
  );

  useEffect(() => {
    if (!tables || tables.length !== 1 || tableId) return;
    selectTable(tables[0].id);
  }, [tables, tableId, selectTable]);

  const selectedReceiver = lists.find((item) => item.receiverId === receiverId);
  const targetKey =
    mode === "append"
      ? receiverId
      : `${receiverName.trim()}|${receiverAlias.trim()}|${description.trim()}`;
  // 回写开关不影响校验结果，不进指纹，避免勾选后旧预览失效
  const fingerprint = JSON.stringify({
    tableId,
    emailFieldKey: mapping.emailFieldKey,
    variables: mapping.variables,
    mode,
    targetKey,
  });
  const preview = previewed?.key === fingerprint ? previewed.data : null;
  const previewValid =
    !!preview && preview.errors.length === 0 && preview.validRows > 0 && !!table;

  const patchMapping = (patch: Partial<AliyunMailMapping>) =>
    setMapping((prev) => ({ ...prev, ...patch }));

  const setVariable = (
    index: number,
    patch: Partial<AliyunMailMapping["variables"][number]>,
  ) =>
    setMapping((prev) => ({
      ...prev,
      variables: prev.variables.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    }));

  const addVariable = () =>
    setMapping((prev) => ({
      ...prev,
      variables: [...prev.variables, { key: "", fieldKey: "" }],
    }));

  const removeVariable = (index: number) =>
    setMapping((prev) => ({
      ...prev,
      variables: prev.variables.filter((_, i) => i !== index),
    }));

  const runPreview = async () => {
    if (!tableId) {
      message.warning("请先选择多维表格");
      return;
    }
    if (!mapping.emailFieldKey) {
      message.warning("请选择邮箱列");
      return;
    }
    const bad = variableError(mapping);
    if (bad) {
      message.warning(bad);
      return;
    }
    if (mode === "append" && !receiverId) {
      message.warning("请选择要追加的收件人列表");
      return;
    }
    if (mode === "new") {
      if (!receiverName.trim()) {
        message.warning("请填写收件人列表名称");
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(receiverAlias.trim())) {
        message.warning("列表别称必须是邮箱地址");
        return;
      }
    }
    setPreviewing(true);
    try {
      const data = await aliyunMailApi.preview({
        tableId,
        mapping,
        mode,
        receiverId: mode === "append" ? receiverId : "",
        receiverName: mode === "new" ? receiverName.trim() : "",
        receiverAlias: mode === "new" ? receiverAlias.trim() : "",
        description: mode === "new" ? description.trim() : "",
      });
      setPreviewed({ key: fingerprint, data });
      if (!data.errors.length) {
        message.success(
          `校验完成：${data.validRows} 个邮箱可同步` +
            (data.invalidRows ? `，${data.invalidRows} 行无效` : "") +
            (data.duplicateRows ? `，${data.duplicateRows} 行表内重复` : "") +
            (data.existingRows ? `，${data.existingRows} 行已推送过` : ""),
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
    setSubmitting(true);
    try {
      const created = await aliyunMailApi.createImport({
        tableId,
        mapping,
        mode,
        receiverId: mode === "append" ? receiverId : "",
        receiverName: mode === "new" ? receiverName.trim() : "",
        receiverAlias: mode === "new" ? receiverAlias.trim() : "",
        description: mode === "new" ? description.trim() : "",
      });
      message.success(`已建批次 #${created.id}，正在分批同步到阿里云`);
      onImported(created.id);
    } catch (error) {
      message.error((error as Error).message || "同步失败");
    } finally {
      setSubmitting(false);
    }
  };

  const fieldOptions = (table?.fields || []).map((field) => ({
    value: field.fieldKey,
    label: field.name,
  }));

  if (!settings.configured) {
    return (
      <Notice variant="warn">
        先到「邮件设置」完成阿里云账号（AccessKey / 地域）配置，才能同步联系人。
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
        名单只提交给你自己的阿里云账号；系统只做联系人同步，不负责发信。
        邮件模板、发信域名与真正群发都在阿里云邮件推送控制台完成，模板里引用变量用{" "}
        <code>{"${UserName}"}</code> 这种写法。预览只读不写：会查询账号下的收件人列表，但不会向阿里云写入任何数据。
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
              该表还没有数据行，先去多维表格补齐联系人再回来同步。
            </Notice>
          </div>
        ) : null}
      </section>

      {/* ② 字段映射 */}
      <section>
        <StepTitle index={2} title="字段映射（邮箱 + 模板变量）" />
        {!table ? (
          <div className="text-12 muted">选择数据表后，这里会列出可映射的列。</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ maxWidth: 420 }}>
              <FieldLabel>邮箱列（必填）</FieldLabel>
              <Select
                style={{ width: "100%" }}
                value={mapping.emailFieldKey || undefined}
                placeholder="选择存放邮箱地址的列"
                onChange={(value) => patchMapping({ emailFieldKey: value })}
                options={fieldOptions}
              />
            </div>

            <div>
              <FieldLabel>
                {"模板变量（变量名 → 来源列，最多 " +
                  MAX_VARIABLES +
                  " 个，可选）"}
              </FieldLabel>
              {mapping.variables.length ? (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  {mapping.variables.map((item, index) => (
                    <Space key={`variable-${index}`} size={6} wrap>
                      <Input
                        style={{ width: 180 }}
                        placeholder="变量名，如 UserName"
                        value={item.key}
                        maxLength={40}
                        status={
                          item.key && !VARIABLE_KEY_PATTERN.test(item.key)
                            ? "error"
                            : undefined
                        }
                        onChange={(event) =>
                          setVariable(index, { key: event.target.value })
                        }
                      />
                      <Select
                        style={{ width: 280 }}
                        value={item.fieldKey || undefined}
                        placeholder="来源列"
                        onChange={(value) =>
                          setVariable(index, { fieldKey: value })
                        }
                        options={fieldOptions}
                      />
                      <Button
                        icon={<DeleteOutlined aria-hidden />}
                        aria-label="删除这个变量"
                        onClick={() => removeVariable(index)}
                      />
                    </Space>
                  ))}
                </div>
              ) : (
                <div className="text-12 muted">
                  不需要模板变量时可以留空；邮件正文里只有固定内容即可。
                </div>
              )}
              <div style={{ marginTop: 6 }}>
                <Button
                  type="dashed"
                  icon={<PlusOutlined aria-hidden />}
                  disabled={mapping.variables.length >= MAX_VARIABLES}
                  onClick={addVariable}
                >
                  添加变量
                </Button>
              </div>
              <div className="text-12 muted" style={{ marginTop: 6 }}>
                变量名只能用英文字母（如 UserName），要和阿里云模板里的{" "}
                <code>{"${UserName}"}</code> 完全一致；单元格为空时该变量传空字符串。
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ③ 目标列表 */}
      <section>
        <StepTitle index={3} title="收件人列表（同步到哪里）" />
        <Radio.Group
          value={mode}
          onChange={(event) => {
            setMode(event.target.value);
            setPreviewed(null);
          }}
          options={[
            { value: "new", label: "新建收件人列表" },
            { value: "append", label: "追加到已有列表" },
          ]}
        />

        {mode === "new" ? (
          <div
            style={{
              marginTop: 12,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 12,
              maxWidth: 980,
            }}
          >
            <div>
              <FieldLabel>列表名称（1–30 个字符）</FieldLabel>
              <Input
                value={receiverName}
                maxLength={30}
                showCount
                placeholder="如 2026 秋季老客户"
                onChange={(event) => setReceiverName(event.target.value)}
              />
            </div>
            <div>
              <FieldLabel>列表别称（必须是邮箱地址，少于 30 个字符）</FieldLabel>
              <Input
                value={receiverAlias}
                maxLength={29}
                placeholder="如 autumn2026@example.com"
                onChange={(event) => setReceiverAlias(event.target.value)}
              />
            </div>
            <div>
              <FieldLabel>描述（可选）</FieldLabel>
              <Input
                value={description}
                maxLength={100}
                placeholder="方便以后在控制台辨认"
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 12 }}>
            <Space size={8} wrap>
              <Select
                style={{ width: 420 }}
                showSearch
                optionFilterProp="label"
                loading={listsLoading}
                value={receiverId || undefined}
                placeholder={
                  listsLoading
                    ? "收件人列表读取中…"
                    : listsError
                      ? "收件人列表读取失败"
                      : lists.length
                        ? "选择要追加的收件人列表"
                        : "该账号下还没有收件人列表"
                }
                onChange={(value) => setReceiverId(value)}
                options={lists.map((item) => ({
                  value: item.receiverId,
                  label: `${item.receiverName} · ${item.count} 人`,
                }))}
              />
              <Button
                icon={<ReloadOutlined aria-hidden />}
                loading={listsLoading}
                onClick={() => void reloadLists()}
              >
                刷新列表
              </Button>
            </Space>
            {listsError ? (
              <div style={{ marginTop: 8 }}>
                <Notice variant="warn">{listsError}</Notice>
              </div>
            ) : null}
            {selectedReceiver ? (
              <div className="text-12 muted" style={{ marginTop: 6 }}>
                {`当前 ${selectedReceiver.count} 人 / 单列表上限 ${RECEIVER_CAPACITY}；已推送过的邮箱按本地台账跳过。`}
              </div>
            ) : null}
          </div>
        )}
        {mode === "new" ? (
          <div className="text-12 muted" style={{ marginTop: 8 }}>
            {`新建的列表会在开始同步时到阿里云创建；单列表上限 ${RECEIVER_CAPACITY} 个地址，账号下最多 10 个列表。`}
          </div>
        ) : null}

        <div style={{ marginTop: 12 }}>
          <Checkbox
            checked={mapping.writeBack}
            onChange={(event) =>
              patchMapping({ writeBack: event.target.checked })
            }
          >
            把批次号 / 列表名 / 同步状态 / 失败原因回写到这张表的末尾新增列（仅表归属账号生效）
          </Checkbox>
        </div>
      </section>

      {/* ④ 预览校验 */}
      <section>
        <StepTitle index={4} title="预览并校验（只读，不写入阿里云）" />
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
              {`将按「${
                mapping.emailFieldKey
                  ? table.fields.find((f) => f.fieldKey === mapping.emailFieldKey)
                      ?.name || "已选列"
                  : "未选邮箱列"
              }」逐行校验，最多显示前 20 行`}
            </span>
          ) : null}
        </Space>

        {preview ? (
          <div
            style={{
              marginTop: 12,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <Space size={8} wrap>
              <Tag color="blue">{`共 ${preview.totalRows} 行`}</Tag>
              <Tag color="success">{`可同步 ${preview.validRows}`}</Tag>
              <Tag color="warning">{`表内重复 ${preview.duplicateRows}`}</Tag>
              <Tag color="default">{`已推送跳过 ${preview.existingRows}`}</Tag>
              <Tag color="warning">{`超出容量 ${preview.overflowRows}`}</Tag>
              <Tag color="error">{`邮箱无效 ${preview.invalidRows}`}</Tag>
              <Tag color="default">
                {`列表容量 ${preview.currentCount} / ${preview.capacity}`}
              </Tag>
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
                {
                  title: "行号",
                  dataIndex: "sourceRowId",
                  key: "sourceRowId",
                  width: 80,
                },
                {
                  title: "邮箱（打码）",
                  dataIndex: "emailMasked",
                  key: "emailMasked",
                  width: 190,
                },
                {
                  title: "模板变量",
                  key: "variables",
                  ellipsis: true,
                  render: (
                    _: unknown,
                    row: AliyunMailPreview["sample"][number],
                  ) =>
                    row.variables.length
                      ? row.variables
                          .map((item) => `${item.key}=${item.value}`)
                          .join(" · ")
                      : "—",
                },
                {
                  title: "校验结果",
                  key: "status",
                  width: 240,
                  render: (
                    _: unknown,
                    row: AliyunMailPreview["sample"][number],
                  ) => {
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

      {/* ⑤ 确认同步 */}
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
            {`即将把 ${preview.validRows} 个邮箱同步到阿里云`}
          </div>
          <div className="text-12 muted" style={{ lineHeight: 1.9 }}>
            <div>
              {`目标：${
                mode === "new"
                  ? `新建列表「${receiverName.trim() || "未填"}」`
                  : `追加到「${selectedReceiver?.receiverName || ""}」`
              }`}
            </div>
            <div>
              {`变量：${
                mapping.variables.length
                  ? mapping.variables.map((item) => item.key).join("、")
                  : "无（仅邮箱地址）"
              }`}
            </div>
            <div>{`回写原表：${mapping.writeBack ? "是" : "否"}`}</div>
          </div>
          <div>
            <Button
              type="primary"
              icon={<ThunderboltOutlined aria-hidden />}
              loading={submitting}
              onClick={() => void submit()}
            >
              开始同步
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
