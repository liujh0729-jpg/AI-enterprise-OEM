"use client";

import { App, Button, Form, Input, Modal, Select, Switch, Upload } from "antd";
import {
  MinusCircleOutlined,
  PlusOutlined,
  ThunderboltOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { useEffect, useState } from "react";
import { communityApi } from "@/api/community";
import { Notice } from "@/components/ui/panel";
import {
  COMMUNITY_CATEGORIES,
  COMMUNITY_CATEGORY_LABELS,
  COMMUNITY_DESCRIPTION_MAX,
  COMMUNITY_SLOT_TYPES,
  COMMUNITY_SUMMARY_MAX,
  COMMUNITY_TAGS_MAX,
  COMMUNITY_TITLE_MAX,
  type CommunitySlot,
  type CommunityWorkflowDetail,
} from "@enterprise/contracts";

/** 槽位类型 → 界面文案（与契约枚举同序，别漏项）。 */
const SLOT_TYPE_LABELS: Record<string, string> = {
  text: "单行文本",
  longtext: "多行文本",
  int: "整数",
  float: "小数",
  enum: "单选",
  seed: "随机种子",
  image: "图片",
};

const CATEGORY_OPTIONS = COMMUNITY_CATEGORIES.map((item) => ({
  value: item,
  label: COMMUNITY_CATEGORY_LABELS[item] || item,
}));

/** 常见可开放参数：字段名 → 槽位类型。命中才推荐，宁缺毋滥（推荐错了作者还得手改）。 */
const SUGGEST_FIELDS: Record<string, CommunitySlot["type"]> = {
  text: "longtext",
  prompt: "longtext",
  value: "longtext",
  seed: "seed",
  noise_seed: "seed",
  width: "int",
  height: "int",
  steps: "int",
  cfg: "float",
  denoise: "float",
};

type GraphShape = Record<string, { class_type?: string; inputs?: Record<string, unknown> }>;

/**
 * 从粘贴进来的 API 格式 JSON 里挑几个「一眼就该给用户改」的输入生成槽位候选。
 * 只做推荐：节点 id 与字段名都是原样带出的，作者自己删掉不想开放的即可。
 * 引用了别的节点输出的字段一律跳过（那种值不能让人填）。
 */
export function suggestSlots(graph: GraphShape): CommunitySlot[] {
  const slots: CommunitySlot[] = [];
  for (const [nodeId, node] of Object.entries(graph)) {
    if (!node || typeof node !== "object" || !node.inputs) continue;
    for (const [field, value] of Object.entries(node.inputs)) {
      const type = SUGGEST_FIELDS[field.toLowerCase()];
      if (!type) continue;
      if (Array.isArray(value) || value === null || typeof value === "object") continue;
      if (type === "seed" && typeof value !== "number") continue;
      if ((type === "int" || type === "float") && typeof value !== "number") continue;
      if ((type === "text" || type === "longtext") && typeof value !== "string") continue;
      slots.push({
        key: `${field}_${nodeId}`.slice(0, 40),
        label: field,
        type,
        nodeId,
        field,
        defaultValue: type === "longtext" || type === "text" ? String(value) : Number(value),
        options: [],
        min: type === "int" || type === "float" ? 0 : null,
        max: null,
        required: false,
      });
      if (slots.length >= 12) return slots;
    }
  }
  return slots;
}

/** 上游只收 API 格式：带 nodes/links 的是 ComfyUI 界面（save）格式，提交上去必被拒 422。 */
function looksLikeUiFormat(graph: Record<string, unknown>) {
  return Array.isArray(graph.nodes) || Array.isArray(graph.links);
}

/** 与后端 COMMUNITY_JSON_LIMIT 同口径：超过 2MB 的图提交上去也会被拒，先在本地拦住。 */
const JSON_FILE_MAX_BYTES = 2 * 1024 * 1024;

/**
 * 校验一段工作流文本：粘贴与上传共用同一套提示，避免两条路给出不一样的错误。
 * 返回的对象要么带 graph，要么带 error。
 */
function readGraph(raw: string): { graph: Record<string, unknown> } | { error: string } {
  if (!raw) return { error: "请粘贴工作流 JSON" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "工作流 JSON 解析失败，请检查是不是复制完整了" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "工作流 JSON 必须是一个对象" };
  }
  const value = parsed as Record<string, unknown>;
  if (looksLikeUiFormat(value)) {
    return {
      error:
        "这是 ComfyUI 界面（save）格式：带 nodes / links 的 JSON 上游不接受。请在 ComfyUI 里用「Save (API Format)」导出后再上传。",
    };
  }
  return { graph: value };
}

/** 表单里都是字符串输入，交给契约前要收敛成槽位本来的类型（空串与 NaN 一律当「没填」）。 */
function normalizeSlots(raw: unknown): CommunitySlot[] {
  const list = Array.isArray(raw) ? raw : [];
  const num = (value: unknown) => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return list.map((item) => {
    const slot = (item || {}) as Record<string, unknown>;
    return {
      key: String(slot.key || "").trim().slice(0, 40),
      label: String(slot.label || "").trim().slice(0, 40),
      nodeId: String(slot.nodeId || "").trim().slice(0, 40),
      field: String(slot.field || "").trim().slice(0, 60),
      type: (COMMUNITY_SLOT_TYPES as readonly string[]).includes(String(slot.type))
        ? (slot.type as CommunitySlot["type"])
        : "text",
      defaultValue:
        slot.defaultValue === null || slot.defaultValue === undefined || slot.defaultValue === ""
          ? null
          : typeof slot.defaultValue === "number"
            ? slot.defaultValue
            : String(slot.defaultValue),
      options: Array.isArray(slot.options) ? slot.options.map((one) => String(one)) : [],
      min: num(slot.min),
      max: num(slot.max),
      required: Boolean(slot.required),
    };
  });
}

/**
 * 发布 / 编辑工作流：正文只收 Comfy 的 API 格式 JSON，参数槽位决定别人能改什么。
 * 改正文或改槽位都会重新进审核队列（后端判定），所以这里如实把这句话写在表单上。
 */
export function PublishModal({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** 有值＝编辑自己已发布的条目；null＝新发布 */
  editing: CommunityWorkflowDetail | null;
  onClose: () => void;
  onSaved: (code: string) => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    form.setFieldsValue({
      title: editing?.title || "",
      summary: editing?.summary || "",
      description: editing?.description || "",
      category: editing?.category || "image",
      groupLabel: editing?.groupLabel || "",
      tags: editing?.tags || [],
      mediaType: editing?.mediaType || "image",
      workflowText: editing
        ? JSON.stringify(editing.workflowJson, null, 2)
        : "",
      slots: editing?.slots || [],
    });
  }, [open, editing, form]);

  const parseGraph = (): Record<string, unknown> | null => {
    const result = readGraph(String(form.getFieldValue("workflowText") || "").trim());
    if ("error" in result) {
      setError(result.error);
      return null;
    }
    return result.graph;
  };

  /** 直接读本地 .json 文件填进文本框：不用再手动打开文件复制粘贴。 */
  const uploadJson = async (file: File) => {
    if (!/\.json$/i.test(file.name)) {
      setError("请上传 .json 后缀的工作流文件");
      return;
    }
    if (file.size > JSON_FILE_MAX_BYTES) {
      setError("JSON 文件超过 2MB，请精简节点与内联数据后再上传");
      return;
    }
    let raw = "";
    try {
      raw = await file.text();
    } catch {
      setError("文件读取失败，请重试");
      return;
    }
    if (!raw.trim()) {
      setError("这个文件是空的");
      return;
    }
    const result = readGraph(raw.trim());
    if ("error" in result) {
      setError(result.error);
      return;
    }
    form.setFieldValue("workflowText", JSON.stringify(result.graph, null, 2));
    setError("");
    message.success(`已读取「${file.name}」，可点「识别可开放参数」生成槽位`);
  };

  const autoFill = () => {
    const graph = parseGraph();
    if (!graph) return;
    const slots = suggestSlots(graph as GraphShape);
    if (!slots.length) {
      message.info("没有识别出常见的可开放参数，可以手工添加槽位");
      return;
    }
    form.setFieldValue("slots", slots);
    setError("");
    message.success(`已推荐 ${slots.length} 个可修改参数，请删掉不想开放的`);
  };

  const submit = async () => {
    const values = await form.validateFields();
    const graph = parseGraph();
    if (!graph) return;
    const slots = normalizeSlots(values.slots);
    const bad = slots.find((slot) => !slot.key || !slot.label || !slot.nodeId || !slot.field);
    if (bad) {
      setError("每个槽位都要填齐「显示名 / 参数标识 / 节点 id / 输入字段名」");
      return;
    }
    const body = {
      title: String(values.title || "").trim(),
      summary: String(values.summary || "").trim(),
      description: String(values.description || ""),
      category: values.category,
      groupLabel: String(values.groupLabel || "").trim(),
      tags: Array.isArray(values.tags) ? values.tags : [],
      mediaType: values.mediaType,
      workflowJson: graph,
      slots,
    };
    setBusy(true);
    setError("");
    try {
      const saved = editing
        ? await communityApi.updateWorkflow({
            params: { code: editing.code },
            body,
          })
        : await communityApi.publish({ body });
      if (!saved) throw new Error(editing ? "保存失败" : "发布失败");
      message.success(
        editing ? "已保存并重新提交审核" : "已提交审核：通过后社区里就能看到了",
      );
      onSaved(saved.code);
      onClose();
    } catch (caught) {
      setError((caught as Error).message || "发布失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={editing ? "编辑工作流" : "发布工作流到创意社区"}
      width={860}
      confirmLoading={busy}
      okText={editing ? "保存并重新提交审核" : "提交审核"}
      onCancel={onClose}
      onOk={() => void submit()}
    >
      <Notice variant="info">
        运行永远在每个人的 Comfy Cloud 账号上发生：你发布的是工作流本身，别人用的是自己的
        API Key 和自己的积分，本站不代付、也不从你的账号扣算力费。管理员审核通过并推荐进市场后，
        积分奖励会按后台规则发给你。
      </Notice>
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        <div className="form-2col">
          <Form.Item
            name="title"
            label="标题"
            rules={[{ required: true, message: "请填写工作流标题" }]}
          >
            <Input maxLength={COMMUNITY_TITLE_MAX} showCount placeholder="例如：写实人像文生图（flux dev）" />
          </Form.Item>
          <Form.Item name="category" label="分类">
            <Select options={CATEGORY_OPTIONS} />
          </Form.Item>
        </div>
        <Form.Item name="summary" label="一句话简介">
          <Input maxLength={COMMUNITY_SUMMARY_MAX} showCount placeholder="列表卡片上显示" />
        </Form.Item>
        <Form.Item name="description" label="详细说明">
          <Input.TextArea rows={4} maxLength={COMMUNITY_DESCRIPTION_MAX} showCount placeholder="适合什么、需要什么模型、效果注意点" />
        </Form.Item>
        <div className="form-2col">
          <Form.Item name="groupLabel" label="场景分组" extra="对应官方场景分类，如「产品与广告」「人物与时尚」">
            <Input maxLength={64} placeholder="可留空" />
          </Form.Item>
          <Form.Item name="mediaType" label="产物类型">
            <Select
              options={[
                { value: "image", label: "图片" },
                { value: "video", label: "视频" },
                { value: "audio", label: "音频" },
                { value: "file", label: "文件" },
              ]}
            />
          </Form.Item>
        </div>
        <Form.Item
          name="tags"
          label="标签"
          extra={`回车添加，最多 ${COMMUNITY_TAGS_MAX} 个`}
        >
          <Select mode="tags" maxCount={COMMUNITY_TAGS_MAX} placeholder="文生图、人像、写实" open={false} />
        </Form.Item>
        <Form.Item
          name="workflowText"
          label="工作流 JSON（Comfy 的 API 格式）"
          extra="可直接上传 .json 文件；带 nodes / links 的界面格式会被上游拒收，也过不了本站校验"
        >
          <Input.TextArea rows={8} placeholder='{"3": {"class_type": "KSampler", "inputs": {"seed": 0, ...}}}' />
        </Form.Item>
        <div style={{ marginTop: -8, marginBottom: 16 }}>
          <Upload
            accept=".json,application/json"
            showUploadList={false}
            beforeUpload={(file) => {
              void uploadJson(file as File);
              return false;
            }}
          >
            <Button icon={<UploadOutlined />}>上传 JSON 文件</Button>
          </Upload>
          <Button
            icon={<ThunderboltOutlined />}
            onClick={autoFill}
            style={{ marginLeft: 8 }}
          >
            识别可开放参数
          </Button>
          <span className="text-12 muted" style={{ marginLeft: 8 }}>
            上传后直接填入上面的框；「识别可开放参数」会从 JSON 里挑出提示词 / 尺寸 / 步数 / 种子这类常见输入，生成下面的槽位候选。
          </span>
        </div>
        <Form.List name="slots">
          {(fields, { add, remove }) => (
            <div>
              <div className="text-12" style={{ marginBottom: 8 }}>
                <strong>运行参数槽位（{fields.length} 个）</strong>
                <span className="muted">
                  ：只有列在这里的输入，别人运行时才能改；没列出的按你保存的原值执行。
                </span>
              </div>
              {fields.map((field, index) => (
                <div
                  key={field.key}
                  style={{
                    border: "1px solid var(--line, #f0f0f0)",
                    borderRadius: 10,
                    padding: "10px 12px 0",
                    marginBottom: 10,
                  }}
                >
                  <div className="form-2col">
                    <Form.Item
                      name={[index, "label"]}
                      label="显示名"
                      rules={[{ required: true, message: "请填写显示名" }]}
                    >
                      <Input maxLength={40} placeholder="提示词" />
                    </Form.Item>
                    <Form.Item
                      name={[index, "key"]}
                      label="参数标识"
                      rules={[{ required: true, message: "请填写参数标识" }]}
                    >
                      <Input maxLength={40} placeholder="prompt" />
                    </Form.Item>
                    <Form.Item
                      name={[index, "nodeId"]}
                      label="节点 id"
                      rules={[{ required: true, message: "请填写节点 id" }]}
                    >
                      <Input maxLength={40} placeholder="6" />
                    </Form.Item>
                    <Form.Item
                      name={[index, "field"]}
                      label="输入字段名"
                      rules={[{ required: true, message: "请填写输入字段名" }]}
                    >
                      <Input maxLength={60} placeholder="text" />
                    </Form.Item>
                    <Form.Item
                      name={[index, "type"]}
                      label="控件类型"
                      rules={[{ required: true, message: "请选择控件类型" }]}
                    >
                      <Select
                        options={COMMUNITY_SLOT_TYPES.map((item) => ({
                          value: item,
                          label: SLOT_TYPE_LABELS[item] || item,
                        }))}
                      />
                    </Form.Item>
                    <Form.Item name={[index, "defaultValue"]} label="默认值">
                      <Input maxLength={200} placeholder="留空＝用工作流里的原值" />
                    </Form.Item>
                    <Form.Item name={[index, "min"]} label="最小值">
                      <Input type="number" placeholder="仅数字类型" />
                    </Form.Item>
                    <Form.Item name={[index, "max"]} label="最大值">
                      <Input type="number" placeholder="仅数字类型" />
                    </Form.Item>
                  </div>
                  <Form.Item
                    name={[index, "options"]}
                    label="候选值（单选类型用，回车分隔）"
                  >
                    <Select mode="tags" open={false} placeholder="nearest / bilinear / lancis" />
                  </Form.Item>
                  <Form.Item name={[index, "required"]} valuePropName="checked" label="必填">
                    <Switch size="small" />
                  </Form.Item>
                  <div style={{ marginBottom: 10 }}>
                    <Button
                      size="small"
                      danger
                      icon={<MinusCircleOutlined />}
                      onClick={() => remove(field.name)}
                    >
                      删除该槽位
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                block
                icon={<PlusOutlined />}
                onClick={() =>
                  add({ type: "text", required: false, options: [], min: null, max: null })
                }
              >
                添加参数槽位
              </Button>
            </div>
          )}
        </Form.List>
      </Form>
      {error ? (
        <div style={{ marginTop: 12 }}>
          <Notice variant="error">{error}</Notice>
        </div>
      ) : null}
    </Modal>
  );
}
