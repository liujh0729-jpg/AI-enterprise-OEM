"use client";

import { App, Button, Input, Modal, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { EmptyState, Panel } from "@/components/ui/panel";
import { fmtTime } from "@/lib/datetime";
import {
  DEVICE_OPTIONS,
  SCRIPT_STATUS_LABEL,
  SCRIPT_STATUS_OPTIONS,
  aiFileTypesForDevice,
  defaultFileTypeForDevice,
  deviceLabel,
  fileTypesForDevice,
  fileTypeLabel,
  paramLines,
  parseParamLines,
  rpaApi,
  type GenerateResult,
  type LlmSetting,
  type RpaScript,
} from "./common";

type ScriptForm = {
  name: string;
  description: string;
  category: string;
  deviceType: string;
  fileType: string;
  vendorFlowId: string;
  status: string;
  paramText: string;
  content: string;
};

const EMPTY: ScriptForm = {
  name: "",
  description: "",
  category: "",
  deviceType: "pc",
  fileType: "automa_json",
  vendorFlowId: "",
  status: "draft",
  paramText: "",
  content: "",
};

const CONTENT_PLACEHOLDER: Record<string, string> = {
  automa_json:
    "粘贴 Automa 导出的工作流 JSON（顶层要有 name / version / drawflow / settings）",
  bitbrowser_rpa:
    "比特浏览器客户端里画好的 RPA 流程正文（执行端拿下面的任务 ID 调 POST /rpa/run 触发，云端只存档）",
  bitphone_json:
    "比特客户端「RPA 自动化 - 云手机环境」导出的 .json 流程文件正文（只支持云手机 RPA 导出的流程）",
  javascript: "粘贴 JS 脚本正文（本地执行端按 run(params) 调用）",
  python: "粘贴 Python 3 脚本正文（本地执行端从环境变量 RPA_PARAMS 取参数）",
};

/** 内容超过一屏时列表里只留摘要，正文按 id 单取。 */
function paramSummary(script: RpaScript): string {
  const entries = Object.entries(script.paramsSchema || {});
  if (!entries.length) return "无";
  return entries.map(([key, spec]) => spec?.label || key).join("、");
}

const STATUS_COLOR: Record<string, string> = {
  draft: "default",
  testing: "warning",
  published: "success",
  archived: "error",
};

/**
 * RPA 脚本：先选目标设备（PC 比特浏览器 / 安卓云手机 / iPhone 云手机），再选该设备能吃的脚本类型，
 * 正文（Automa JSON / 比特流程导出 / JS / Python）＋运行参数定义，按账号归属。
 * 「AI 写脚本」按需求 + 设备 + 类型 + AIPDD 文字模型生成，先预览再生成后保存到脚本清单；
 * 客户端导出的 RPA 流程模型写不出来，只能导出正文后在这里登记（比特流程还要填客户端任务 ID）。
 * 被任务引用的脚本删不掉（云端任务认领时要按 scriptId 取正文）。
 */
export function ScriptPanel({
  scripts,
  reload,
}: {
  scripts: RpaScript[];
  reload: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const { request, modal } = usePasswordConfirm();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RpaScript | null>(null);
  const [form, setForm] = useState<ScriptForm>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<RpaScript | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [genForm, setGenForm] = useState({
    requirement: "",
    deviceType: "pc",
    fileType: "automa_json",
    model: "",
  });
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [saveName, setSaveName] = useState("");
  const [llm, setLlm] = useState<LlmSetting | null>(null);
  const [models, setModels] = useState<string[]>([]);

  const patch = (next: Partial<ScriptForm>) =>
    setForm((prev) => ({ ...prev, ...next }));

  /** 换设备＝换可选脚本类型：类型不在该设备白名单里就落到该设备的第一种，流程 ID 也一并清掉。 */
  const patchDevice = (nextDevice: string) =>
    setForm((prev) => {
      const allowed = fileTypesForDevice(nextDevice).map((item) => item.value);
      const fileType = allowed.includes(prev.fileType)
        ? prev.fileType
        : defaultFileTypeForDevice(nextDevice);
      return {
        ...prev,
        deviceType: nextDevice,
        fileType,
        vendorFlowId: fileType === "bitbrowser_rpa" ? prev.vendorFlowId : "",
      };
    });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setOpen(true);
  };

  /** 编辑要先按 id 取正文：列表接口不返回 content（正文可达上百 KB）。 */
  const openEdit = async (script: RpaScript) => {
    const detail = await rpaApi.script(script.id);
    if (detail.message) {
      message.error(detail.message);
      return;
    }
    const row = detail.data;
    if (!row) return;
    setEditing(script);
    setForm({
      name: row.name,
      description: row.description,
      category: row.category,
      deviceType: row.deviceType,
      fileType: row.fileType,
      vendorFlowId: row.vendorFlowId || "",
      status: row.status,
      paramText: paramLines(row.paramsSchema || {}),
      content: row.content || "",
    });
    setOpen(true);
  };

  const view = async (script: RpaScript) => {
    const detail = await rpaApi.script(script.id);
    if (detail.message) {
      message.error(detail.message);
      return;
    }
    setViewing(detail.data);
  };

  const body = (): Record<string, unknown> => ({
    name: form.name.trim(),
    description: form.description.trim(),
    category: form.category.trim(),
    deviceType: form.deviceType,
    fileType: form.fileType,
    vendorFlowId: form.vendorFlowId.trim(),
    status: form.status,
    paramsSchema: parseParamLines(form.paramText),
    content: form.content,
  });

  const submit = async () => {
    if (!form.name.trim()) {
      message.warning("请填写脚本名称");
      return;
    }
    if (!form.content.trim()) {
      message.warning("请填写脚本内容");
      return;
    }
    if (form.fileType === "bitbrowser_rpa" && !form.vendorFlowId.trim()) {
      message.warning(
        "比特浏览器 RPA 流程要填写客户端里的 RPA 任务 ID，执行端拿它触发流程",
      );
      return;
    }
    if (editing) {
      const target = editing;
      request({
        title: "修改 RPA 脚本（需密码）",
        content: `确认修改「${target.name}」？`,
        okText: "保存修改",
        onOk: async () => {
          await rpaApi.updateScript(target.id, body());
          close();
          await reload();
        },
      });
      return;
    }
    setBusy(true);
    try {
      await rpaApi.createScript(body());
      close();
      await reload();
      message.success("已保存 1 个脚本");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setOpen(false);
    setEditing(null);
    setForm(EMPTY);
  };

  const remove = (script: RpaScript) => {
    request({
      title: "删除 RPA 脚本",
      content: `确认删除「${script.name}」？${
        script.taskCount
          ? `该脚本被 ${script.taskCount} 个任务引用，需先调整任务。`
          : "删除后不可恢复。"
      }`,
      danger: true,
      okText: "确认删除",
      onOk: async () => {
        await rpaApi.deleteScript(script.id);
        await reload();
      },
    });
  };

  /** AI 写脚本：只回预览，不落库；用户确认后才保存进脚本清单。 */
  const generate = async () => {
    if (genForm.requirement.trim().length < 8) {
      message.warning(
        "请把需求写具体一些（打开哪个网站、做什么操作、取什么数据、存到哪里）",
      );
      return;
    }
    setBusy(true);
    try {
      const data = await rpaApi.generate({
        requirement: genForm.requirement.trim(),
        deviceType: genForm.deviceType,
        fileType: genForm.fileType,
        model: genForm.model,
      });
      setResult(data);
      setSaveName(data.suggestedName);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveGenerated = async () => {
    if (!result) return;
    setBusy(true);
    try {
      await rpaApi.createScript({
        name: saveName.trim() || result.suggestedName,
        description: result.model
          ? `由 ${result.model} 按需求生成（${deviceLabel(result.deviceType)}）`
          : `由 AI 按需求生成（${deviceLabel(result.deviceType)}）`,
        deviceType: result.deviceType,
        fileType: result.fileType,
        status: "draft",
        content: result.content,
        paramsSchema: result.paramsSchema || {},
      });
      setGenOpen(false);
      setResult(null);
      setGenForm({
        requirement: "",
        deviceType: "pc",
        fileType: "automa_json",
        model: "",
      });
      await reload();
      message.success("已保存到 RPA 脚本");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const loadLlmInfo = async () => {
    const setting = await rpaApi.llmSetting();
    if (!setting.message) {
      setLlm(setting.data);
    }
    const modelsData = await rpaApi.llmModels();
    if (!modelsData.message) {
      setModels(modelsData.data?.models ?? []);
    }
  };

  const modelOptions = Array.from(
    new Set([...models, llm?.model || "", genForm.model].filter(Boolean)),
  ).map((value) => ({ value, label: value }));

  const columns: ColumnsType<RpaScript> = [
    {
      title: "脚本名称",
      dataIndex: "name",
      key: "name",
      width: 220,
      render: (value: string) => <b>{value}</b>,
    },
    {
      title: "目标设备",
      dataIndex: "deviceType",
      key: "deviceType",
      width: 150,
      render: (value: string) => <Tag color="geekblue">{deviceLabel(value)}</Tag>,
    },
    {
      title: "类型",
      dataIndex: "fileType",
      key: "fileType",
      width: 150,
      render: (value: string) => (
        <Tag color="blue">{fileTypeLabel(value)}</Tag>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 90,
      render: (value: string) => (
        <Tag color={STATUS_COLOR[value] || "default"}>
          {SCRIPT_STATUS_LABEL[value] || value}
        </Tag>
      ),
    },
    {
      title: "运行参数",
      key: "params",
      width: 180,
      ellipsis: true,
      render: (_, row) => paramSummary(row),
    },
    {
      title: "分类",
      dataIndex: "category",
      key: "category",
      width: 120,
      render: (value: string) => value || "—",
    },
    {
      title: "引用任务",
      dataIndex: "taskCount",
      key: "taskCount",
      width: 90,
      render: (value: number) => `${value} 个`,
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: 150,
      render: (value: string) => fmtTime(value),
    },
    {
      title: "操作",
      key: "actions",
      width: 190,
      render: (_, row) => (
        <Button.Group>
          <Button onClick={() => void view(row)}>
            查看
          </Button>
          <Button onClick={() => void openEdit(row)}>
            改
          </Button>
          <Button danger onClick={() => remove(row)}>
            删
          </Button>
        </Button.Group>
      ),
    },
  ];

  return (
    <Panel
      title="RPA 脚本"
      titleBadge={`${scripts.length} 个`}
      extra={
        <Space>
          <Button
            type="primary"
            onClick={() => {
              void loadLlmInfo();
              setGenForm({
                requirement: "",
                deviceType: "pc",
                fileType: "automa_json",
                model: llm?.model || "",
              });
              setResult(null);
              setGenOpen(true);
            }}
          >
            AI 写脚本
          </Button>
          <Button onClick={openCreate}>新建脚本</Button>
        </Space>
      }
    >
      {scripts.length ? (
        <Table<RpaScript>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={scripts}
          scroll={{ x: "max-content" }}
          pagination={false}
        />
      ) : (
        <EmptyState text="还没有 RPA 脚本：可以点「AI 写脚本」按需求生成，也可以直接粘贴本地导出的脚本" />
      )}

      <Modal
        open={open}
        title={editing ? `修改脚本（${editing.name}）` : "新建 RPA 脚本"}
        onCancel={close}
        onOk={() => void submit()}
        okText={busy ? "提交中" : editing ? "下一步（密码确认）" : "保存"}
        cancelText="取消"
        confirmLoading={busy}
        width={860}
        destroyOnHidden
      >
        <div className="data-table-form">
          <label className="data-table-form-item">
            <span className="data-table-form-label">
              脚本名称<b style={{ color: "var(--danger)" }}> *</b>
            </span>
            <Input
              value={form.name}
              maxLength={200}
              placeholder="如 竞品价格采集"
              onChange={(event) => patch({ name: event.target.value })}
            />
          </label>
          <label className="data-table-form-item">
            <span className="data-table-form-label">
              目标设备<b style={{ color: "var(--danger)" }}> *</b>
            </span>
            <Select
              value={form.deviceType}
              options={DEVICE_OPTIONS}
              onChange={(value) => patchDevice(value)}
            />
          </label>
          <label className="data-table-form-item">
            <span className="data-table-form-label">脚本类型</span>
            <Select
              value={form.fileType}
              options={fileTypesForDevice(form.deviceType)}
              onChange={(value) =>
                patch({
                  fileType: value,
                  vendorFlowId: value === "bitbrowser_rpa" ? form.vendorFlowId : "",
                })
              }
            />
          </label>
          {form.fileType === "bitbrowser_rpa" ? (
            <label className="data-table-form-item">
              <span className="data-table-form-label">
                客户端 RPA 任务 ID<b style={{ color: "var(--danger)" }}> *</b>
              </span>
              <Input
                value={form.vendorFlowId}
                maxLength={64}
                placeholder="比特浏览器 RPA 管理界面里编辑任务时复制的 ID"
                onChange={(event) => patch({ vendorFlowId: event.target.value })}
              />
            </label>
          ) : null}
          <label className="data-table-form-item">
            <span className="data-table-form-label">状态</span>
            <Select
              value={form.status}
              options={SCRIPT_STATUS_OPTIONS}
              onChange={(value) => patch({ status: value })}
            />
          </label>
          <label className="data-table-form-item">
            <span className="data-table-form-label">分类</span>
            <Input
              value={form.category}
              maxLength={64}
              placeholder="如 电商采集"
              onChange={(event) => patch({ category: event.target.value })}
            />
          </label>
          <label className="data-table-form-item" style={{ gridColumn: "1 / -1" }}>
            <span className="data-table-form-label">说明</span>
            <Input
              value={form.description}
              maxLength={500}
              placeholder="这个脚本做什么、产出什么"
              onChange={(event) => patch({ description: event.target.value })}
            />
          </label>
          <label className="data-table-form-item" style={{ gridColumn: "1 / -1" }}>
            <span className="data-table-form-label">运行参数定义</span>
            <Input.TextArea
              rows={3}
              value={form.paramText}
              placeholder={
                "一行一个，写成 参数键: 中文名，例如\nkeyword: 搜索关键词\ncity: 城市"
              }
              onChange={(event) => patch({ paramText: event.target.value })}
            />
          </label>
          <label className="data-table-form-item" style={{ gridColumn: "1 / -1" }}>
            <span className="data-table-form-label">
              脚本内容<b style={{ color: "var(--danger)" }}> *</b>
            </span>
            <Input.TextArea
              rows={12}
              value={form.content}
              placeholder={CONTENT_PLACEHOLDER[form.fileType]}
              onChange={(event) => patch({ content: event.target.value })}
            />
          </label>
        </div>
      </Modal>

      <Modal
        open={Boolean(viewing)}
        title={viewing ? `脚本正文（${viewing.name}）` : "脚本正文"}
        onCancel={() => setViewing(null)}
        footer={
          <Button onClick={() => setViewing(null)}>关闭</Button>
        }
        width={860}
        destroyOnHidden
      >
        {viewing ? (
          <div style={{ marginBottom: 8 }}>
            <Space wrap size={8}>
              <Tag color="geekblue">{deviceLabel(viewing.deviceType)}</Tag>
              <Tag color="blue">{fileTypeLabel(viewing.fileType)}</Tag>
              {viewing.vendorFlowId ? (
                <Tag>{`客户端任务 ID ${viewing.vendorFlowId}`}</Tag>
              ) : null}
              <span className="text-12 muted">
                {`运行参数：${paramSummary(viewing)}`}
              </span>
            </Space>
          </div>
        ) : null}
        <Input.TextArea
          rows={18}
          readOnly
          value={viewing?.content || ""}
          style={{ fontFamily: "monospace" }}
        />
      </Modal>

      <Modal
        open={genOpen}
        title="AI 写脚本（AIPDD 文字模型）"
        onCancel={() => setGenOpen(false)}
        footer={
          result ? (
            <Space>
              <Button onClick={() => setGenOpen(false)}>取消</Button>
              <Button
                loading={busy}
                onClick={() => void generate()}
              >
                重新生成
              </Button>
              <Button type="primary" loading={busy} onClick={() => void saveGenerated()}>
                保存到 RPA 脚本
              </Button>
            </Space>
          ) : (
            <Space>
              <Button onClick={() => setGenOpen(false)}>取消</Button>
              <Button type="primary" loading={busy} onClick={() => void generate()}>
                生成脚本
              </Button>
            </Space>
          )
        }
        width={900}
        destroyOnHidden
      >
        <div className="data-table-form">
          <label className="data-table-form-item" style={{ gridColumn: "1 / -1" }}>
            <span className="data-table-form-label">
              需求描述<b style={{ color: "var(--danger)" }}> *</b>
            </span>
            <Input.TextArea
              rows={4}
              value={genForm.requirement}
              placeholder="要打开哪个网站、用什么账号做什么操作、取哪些数据、结果存到哪里"
              onChange={(event) =>
                setGenForm((prev) => ({
                  ...prev,
                  requirement: event.target.value,
                }))
              }
            />
          </label>
          <label className="data-table-form-item">
            <span className="data-table-form-label">
              目标设备<b style={{ color: "var(--danger)" }}> *</b>
            </span>
            <Select
              value={genForm.deviceType}
              options={DEVICE_OPTIONS}
              onChange={(value) =>
                setGenForm((prev) => {
                  const allowed = aiFileTypesForDevice(value).map(
                    (item) => item.value,
                  );
                  return {
                    ...prev,
                    deviceType: value,
                    fileType: allowed.includes(prev.fileType)
                      ? prev.fileType
                      : allowed[0],
                  };
                })
              }
            />
          </label>
          <label className="data-table-form-item">
            <span className="data-table-form-label">脚本类型</span>
            <Select
              value={genForm.fileType}
              options={aiFileTypesForDevice(genForm.deviceType)}
              onChange={(value) =>
                setGenForm((prev) => ({ ...prev, fileType: value }))
              }
            />
          </label>
          <div className="text-12 muted" style={{ gridColumn: "1 / -1" }}>
            {`${deviceLabel(genForm.deviceType)}的说明：`}
            {genForm.deviceType === "pc"
              ? "AI 写的是 Automa 工作流 / 浏览器内 JS / Python，本地比特浏览器窗口里跑；客户端画好的「比特浏览器 RPA 流程」要导出来后自己登记。"
              : genForm.deviceType === "android"
                ? "AI 写的是走比特浏览器云手机接口的 JS / Python（开机、装应用、拉起应用、上传文件这些动作都要用接口驱动）；客户端「RPA 自动化-云手机环境」导出的流程文件要导出来后自己登记。"
                : "iPhone 云手机在比特浏览器只有环境管理、没有控制接口也没有 RPA，AI 只能写通用 JS / Python，执行端要自备 iOS 工具链。"}
          </div>
          <label className="data-table-form-item">
            <span className="data-table-form-label">文字模型</span>
            <Select
              value={genForm.model || undefined}
              placeholder="用配置里的默认模型"
              options={modelOptions}
              onChange={(value) =>
                setGenForm((prev) => ({ ...prev, model: value || "" }))
              }
              allowClear
            />
          </label>
          {result ? (
            <>
              <label className="data-table-form-item">
                <span className="data-table-form-label">脚本名称</span>
                <Input
                  value={saveName}
                  maxLength={200}
                  onChange={(event) => setSaveName(event.target.value)}
                />
              </label>
              <label className="data-table-form-item">
                <span className="data-table-form-label">生成信息</span>
                <div className="text-12 muted">
                  {`${deviceLabel(result.deviceType)} · ${fileTypeLabel(
                    result.fileType,
                  )} · ${result.model} · ${result.content.length} 字符 · ${(
                    result.elapsedMs / 1000
                  ).toFixed(1)} 秒`}
                </div>
              </label>
              <label
                className="data-table-form-item"
                style={{ gridColumn: "1 / -1" }}
              >
                <span className="data-table-form-label">
                  生成结果（保存前可继续编辑）
                </span>
                <Input.TextArea
                  rows={16}
                  value={result.content}
                  style={{ fontFamily: "monospace" }}
                  onChange={(event) =>
                    setResult((prev) =>
                      prev ? { ...prev, content: event.target.value } : prev,
                    )
                  }
                />
              </label>
            </>
          ) : null}
        </div>
      </Modal>
      {modal}
    </Panel>
  );
}
