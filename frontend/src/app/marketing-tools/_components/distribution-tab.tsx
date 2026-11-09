"use client";

import {
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  FileTextOutlined,
  PlusOutlined,
  ReloadOutlined,
  DeleteOutlined,
  SendOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Checkbox,
  Collapse,
  Descriptions,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Steps,
  Switch,
  Table,
  Tag,
  Upload,
} from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DistributionContent,
  DistributionDetail,
  DistributionLog,
  DistributionMeta,
} from "@enterprise/contracts";
import {
  DISTRIBUTION_CONTENT_STATUSES,
  DISTRIBUTION_LOG_STATUSES,
  DISTRIBUTION_MEDIA_TYPES,
} from "@enterprise/contracts";
import {
  DISTRIBUTION_CONTENT_VISIBLE_MAX,
  DISTRIBUTION_IMAGES_MAX,
  DISTRIBUTION_TITLE_MAX,
  richTextVisibleLength,
  sanitizeRichTextHtml,
} from "@enterprise/contracts";
import { Notice, Panel } from "@/components/ui/panel";
import { RawImg } from "@/components/ui/raw-img";
import { uploadContentMedia } from "@/api/content";
import { aiApi, type AiDistributionRewrite } from "@/api/ai";
import { AiResultModal } from "@/components/ai-result";
import { fmtTime } from "@/lib/datetime";
import { RichTextEditor } from "./rich-text-editor";
import {
  distributeViaExtension,
  distributionApi,
  onExtensionResult,
  pingExtension,
} from "./distribution-common";
import { useSeoActions, useSeoProjects } from "@/query/seo";
import { presentMutationError } from "@/query/errors";
import { domainOf } from "./seo-common";

/**
 * 多平台内容分发（营销工具）：内容台账在本系统落库，点「分发」把内容推给
 * AIPDD Enterprise 浏览器插件，由插件在用户本机已登录的各平台创作页填充发布
 * （微博/小红书/抖音/快手/视频号/知识星球/知乎/头条/百家号/B站/公众号/简书/豆瓣），
 * 结果逐平台回写台账；也可人工补记。
 * 账号凭据始终留在浏览器里，服务器不接触任何平台密码。
 */

const LOG_STATUS_COLOR: Record<string, string> = {
  FILLED: "processing",
  SUCCESS: "success",
  FAILED: "error",
};

const LOG_STATUS_OPTIONS = [
  { value: "FILLED", label: "已填充待确认" },
  { value: "SUCCESS", label: "已发布" },
  { value: "FAILED", label: "失败" },
];

/** 新建时的表单初值：靠 Form 的 initialValues 落地，与 geo 系列台账弹窗同一口径。 */
const EMPTY_CONTENT = {
  title: "",
  mediaType: "MOMENT",
  content: "",
  platformCodes: [] as string[],
  autoPublish: false,
  tags: "",
};

const htmlToText = (html: string) => {
  if (typeof document === "undefined") return html.replace(/<[^>]+>/g, " ");
  const box = document.createElement("div");
  box.innerHTML = html || "";
  return (box.textContent || "").trim();
};

export function DistributionTab() {
  const { message } = App.useApp();
  const [meta, setMeta] = useState<DistributionMeta | null>(null);
  const [extensionVersion, setExtensionVersion] = useState<string | null>(null);

  const [rows, setRows] = useState<DistributionContent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<(typeof DISTRIBUTION_MEDIA_TYPES)[number] | "">("");
  const [filterStatus, setFilterStatus] = useState<
    (typeof DISTRIBUTION_CONTENT_STATUSES)[number] | ""
  >("");
  const [keyword, setKeyword] = useState("");

  /** 编辑弹窗：null＝关闭，0＝新建，其他＝编辑中的台账 id。 */
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [images, setImages] = useState<{ name: string; url: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [rewrite, setRewrite] = useState<AiDistributionRewrite | null>(null);
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [rewriteLoading, setRewriteLoading] = useState(false);

  /** 详情抽屉与人工补记。 */
  const [detail, setDetail] = useState<DistributionDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [manualStatus, setManualStatus] = useState<(typeof DISTRIBUTION_LOG_STATUSES)[number]>("SUCCESS");
  const [manualSaving, setManualSaving] = useState(false);

  /** 分发进行中的台账 id：插件结果消息回来后据此写 reportLogs。 */
  const [distributingId, setDistributingId] = useState(0);
  /** jobId → 台账 id：并发多次分发时用 jobId 精确关联结果，避免单槽串号。 */
  const pendingMapRef = useRef<Map<string, number>>(new Map());
  /** jobId → 兜底定时器：插件结果迟迟不回（MV3 Service Worker 被回收）时复位按钮。 */
  const fallbackTimerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await distributionApi.page({
        query: {
          page,
          pageSize,
          ...(filterType ? { mediaType: filterType } : {}),
          ...(filterStatus ? { status: filterStatus } : {}),
          ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
        },
      });
      setRows(result?.list ?? []);
      setTotal(result?.total ?? 0);
    } catch (error) {
      message.error((error as Error).message || "台账读取失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filterType, filterStatus, keyword, message]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    distributionApi
      .meta()
      .then(setMeta)
      .catch(() => message.error("分发平台清单读取失败"));
    // pingExtension 只 resolve 不 reject（收不到 pong 就是超时空值），这里不关心失败。
    void pingExtension().then((pong) => setExtensionVersion(pong?.version ?? null));
  }, [message]);

  /** 插件发布结果 → reportLogs 落库（按 jobId 关联到对应台账；页面开着才收得到，关了就走人工补记）。 */
  useEffect(() => {
    return onExtensionResult(async (logs, jobId) => {
      const contentId = pendingMapRef.current.get(jobId);
      if (!contentId || !logs.length) return;
      pendingMapRef.current.delete(jobId);
      const timer = fallbackTimerRef.current[jobId];
      if (timer) {
        clearTimeout(timer);
        delete fallbackTimerRef.current[jobId];
      }
      setDistributingId((cur) => (cur === contentId ? 0 : cur));
      try {
        await distributionApi.reportLogs({
          params: { id: String(contentId) },
          body: {
            source: "EXTENSION",
            logs: logs.map((log) => ({
              platformCode: log.platformCode,
              status: DISTRIBUTION_LOG_STATUSES.find((item) => item === log.status) ?? "FILLED",
              publishedUrl: log.publishedUrl || "",
              errorMsg: log.errorMsg || "",
            })),
          },
        });
        message.success("插件已回传逐平台发布结果");
        void reload();
      } catch (error) {
        message.error((error as Error).message || "发布结果回写失败，请人工补记");
      }
    });
  }, [message, reload]);

  // 离开本页时清掉兜底定时器并解除等待中的关联（页面关了本来就收不到插件回传），
  // 避免卸载后 setTimeout 继续挂念并触发 setState。
  useEffect(() => {
    const timers = fallbackTimerRef.current;
    const pending = pendingMapRef.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  // ---------- 编辑 ----------

  const openEditor = (row: DistributionContent | null) => {
    setEditingId(row ? row.id : 0);
    setImages(row ? [...row.images] : []);
    setImageUrl("");
    if (row) {
      form.setFieldsValue({
        title: row.title,
        mediaType: row.mediaType,
        content: row.content,
        platformCodes: row.platformCodes,
        autoPublish: row.autoPublish,
        tags: row.tags,
      });
    } else {
      // 新建不灌值：Form 卸载重挂后由 initialValues 回到空态（与 geo-views 同写法）。
      form.resetFields();
    }
  };

  const runRewrite = async () => {
    const values = form.getFieldsValue(["title", "content", "platformCodes"]);
    const text = htmlToText(String(values.content || ""));
    const platformCodes = (values.platformCodes || []) as string[];
    if (!text) {
      message.warning("请先填写正文");
      return;
    }
    if (!platformCodes.length) {
      message.warning("请先勾选要分发的平台，AI 会按平台分别改写");
      return;
    }
    setRewriteOpen(true);
    setRewriteLoading(true);
    setRewrite(null);
    try {
      setRewrite(
        await aiApi.distributionRewrite({
          body: {
            contentId: editingId || undefined,
            title: String(values.title || "").trim() || undefined,
            text,
            platformCodes,
          },
        }),
      );
    } catch (error) {
      presentMutationError(error, (text) => message.error(text));
      setRewriteOpen(false);
    } finally {
      setRewriteLoading(false);
    }
  };

  const applyVersion = (version: NonNullable<AiDistributionRewrite>["versions"][number]) => {
    form.setFieldValue("title", version.title || form.getFieldValue("title"));
    form.setFieldValue("content", version.content);
    if (version.tags.length) {
      form.setFieldValue("tags", version.tags.join("、"));
    }
    setRewriteOpen(false);
    message.success("已应用到正文");
  };

  const saveContent = async () => {
    const values = await form.validateFields();
    // meta 没加载成功时不能拿空清单过滤：否则会把用户勾好的平台全部洗掉还提示保存成功。
    if (!meta) {
      message.error("分发平台清单未加载成功，请刷新页面后重试，避免已勾选平台被误清空");
      return;
    }
    // 切了内容类型但没重新勾选时，丢弃与新类型不匹配的平台（否则后端按类型校验直接拒写）。
    const allowedCodes = new Set(
      meta.platforms
        .filter((platform) => platform.mediaType === values.mediaType)
        .map((platform) => platform.code),
    );
    const platformCodes = ((values.platformCodes ?? []) as string[]).filter(
      (code) => allowedCodes.has(code),
    );
    setSaving(true);
    try {
      const body = {
        title: values.title,
        content: values.content,
        mediaType: values.mediaType,
        images,
        platformCodes,
        autoPublish: Boolean(values.autoPublish),
        tags: values.tags ?? "",
      };
      if (editingId) {
        await distributionApi.update({
          params: { id: String(editingId) },
          body,
        });
      } else {
        await distributionApi.create({ body });
      }
      message.success(editingId ? "内容已更新" : "内容已创建");
      setEditingId(null);
      void reload();
    } catch (error) {
      message.error((error as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const addUploadedImages = async (file: File) => {
    // 前端按契约上限截断：超出部分不上传，不等后端拒了才知道。
    if (images.length >= DISTRIBUTION_IMAGES_MAX) {
      message.warning(`配图最多 ${DISTRIBUTION_IMAGES_MAX} 张，本张已跳过`);
      return false;
    }
    setUploading(true);
    try {
      const result = await uploadContentMedia(file);
      setImages((prev) => [...prev, { name: result.name || file.name, url: result.url }]);
    } catch (error) {
      message.error((error as Error).message || "图片上传失败");
    } finally {
      setUploading(false);
    }
    return false; // 阻止 antd 默认上传（我们自己走 uploadContentMedia）
  };

  // ---------- 分发 ----------

  const distribute = async (row: DistributionContent) => {
    if (!extensionVersion) {
      message.warning("未检测到 AIPDD Enterprise 插件：请先按下方说明安装，并刷新本页");
      return;
    }
    if (!row.platformCodes.length) {
      message.warning("这条内容还没勾选发布平台，请先编辑勾选");
      return;
    }
    setDistributingId(row.id);
    const ack = await distributeViaExtension({
      title: row.title,
      content: row.content,
      images: row.images,
      platformCodes: row.platformCodes,
      autoPublish: row.autoPublish,
    });
    if (!ack.ok) {
      setDistributingId(0);
      message.error(ack.errorMsg || "推送到插件失败，请确认插件已安装、已在本页弹窗中「信任此站点」，并刷新本页");
      return;
    }
    // 接单成功后登记 jobId→台账 关联，并起兜底定时器。定时器只负责提示与 UI 复位，
    // 不解除关联：插件串行发 13 家很容易超过固定时长，迟到的结果仍要落进台账。
    pendingMapRef.current.set(ack.jobId, row.id);
    fallbackTimerRef.current[ack.jobId] = setTimeout(() => {
      if (pendingMapRef.current.has(ack.jobId)) {
        setDistributingId((cur) => (cur === row.id ? 0 : cur));
        message.warning("插件尚未回传发布结果：本页保持打开，结果迟到仍会自动记入台账；关页后请到平台页确认并人工补记");
      }
      delete fallbackTimerRef.current[ack.jobId];
    }, Math.max(180000, row.platformCodes.length * 60000));
    try {
      await distributionApi.mark({ params: { id: String(row.id) } });
      message.success(
        row.autoPublish
          ? "已推给插件：将自动打开发布各平台，请勿关闭这些标签页"
          : "已推给插件：将自动打开各平台填好内容，请逐个确认发布",
      );
      void reload();
    } catch (error) {
      message.error((error as Error).message || "分发状态更新失败");
    }
  };

  // ---------- 详情与人工补记 ----------

  const openDetail = async (row: DistributionContent) => {
    try {
      const result = await distributionApi.detail({ params: { id: String(row.id) } });
      setDetail(result);
      setDetailOpen(true);
      setManualCode(result?.content.platformCodes[0] ?? "");
      setManualStatus("SUCCESS");
    } catch (error) {
      message.error((error as Error).message || "详情读取失败");
    }
  };

  const reportManual = async () => {
    if (!detail || !manualCode) {
      message.warning("请选择要补记的平台");
      return;
    }
    setManualSaving(true);
    try {
      await distributionApi.reportLogs({
        params: { id: String(detail.content.id) },
        body: {
          source: "MANUAL",
          logs: [
            {
              platformCode: manualCode,
              status: manualStatus,
              publishedUrl: "",
              errorMsg: "",
            },
          ],
        },
      });
      message.success("已人工补记");
      const fresh = await distributionApi.detail({
        params: { id: String(detail.content.id) },
      });
      setDetail(fresh);
      void reload();
    } catch (error) {
      message.error((error as Error).message || "补记失败");
    } finally {
      setManualSaving(false);
    }
  };

  const removeRow = async (row: DistributionContent) => {
    try {
      await distributionApi.remove({ params: { id: String(row.id) } });
      message.success("已删除");
      void reload();
    } catch (error) {
      message.error((error as Error).message || "删除失败");
    }
  };

  // ---------- 渲染 ----------

  const formMediaType = Form.useWatch("mediaType", form) || "MOMENT";
  const platformsOfType = (meta?.platforms ?? []).filter(
    (platform) => platform.mediaType === formMediaType,
  );

  const columns = [
    {
      title: "标题",
      dataIndex: "title",
      render: (value: string, row: DistributionContent) => (
        <Space orientation="vertical" size={0}>
          <span>{value}</span>
          <span className="text-12">
            {row.mediaTypeLabel}
            {row.tags ? ` · ${row.tags}` : ""}
          </span>
        </Space>
      ),
    },
    {
      title: "发布平台",
      dataIndex: "platformNames",
      render: (names: string[], row: DistributionContent) =>
        names.length ? (
          <Space size={[4, 4]} wrap>
            {names.map((name) => (
              <Tag key={name}>{name}</Tag>
            ))}
            {row.autoPublish ? <Tag color="volcano">自动发布</Tag> : null}
          </Space>
        ) : (
          <span className="muted">未勾选</span>
        ),
    },
    {
      title: "状态",
      dataIndex: "statusLabel",
      width: 100,
      render: (value: string, row: DistributionContent) => (
        <Tag color={row.status === "DISTRIBUTED" ? "blue" : "default"}>{value}</Tag>
      ),
    },
    {
      title: "最后分发",
      dataIndex: "lastDistributedAt",
      width: 160,
      render: (value: string | null) => (value ? fmtTime(value) : "-"),
    },
    {
      title: "操作",
      width: 260,
      render: (_: unknown, row: DistributionContent) => (
        <Space size={4} wrap>
          <Button
            type="primary"
            size="small"
            icon={<SendOutlined aria-hidden />}
            loading={distributingId === row.id}
            onClick={() => void distribute(row)}
          >
            分发
          </Button>
          <Button
            size="small"
            icon={<EditOutlined aria-hidden />}
            onClick={() => openEditor(row)}
          >
            编辑
          </Button>
          <Button
            size="small"
            icon={<EyeOutlined aria-hidden />}
            onClick={() => void openDetail(row)}
          >
            结果
          </Button>
          <Popconfirm
            title="删除这条分发内容？"
            description="发布记录一并删除，平台上的已发布内容不受影响。"
            onConfirm={() => void removeRow(row)}
          >
            <Button size="small" danger icon={<DeleteOutlined aria-hidden />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const extension = meta?.extension;

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Panel
        title={
          <>
            <FileTextOutlined aria-hidden /> 插件下载与使用说明
          </>
        }
        titleExtra="内容发布在你自己的浏览器里完成：插件复用各平台已登录会话，账号凭据不出本机"
      >
        <Space wrap style={{ marginBottom: 12 }}>
          <Tag color={extensionVersion ? "success" : "warning"}>
            {extensionVersion
              ? `已检测到插件 v${extensionVersion}`
              : "未检测到插件（安装后刷新本页）"}
          </Tag>
          {extension ? (
            <Button
              type="primary"
              icon={<DownloadOutlined aria-hidden />}
              href={extension.downloadPath}
              target="_blank"
              rel="noreferrer"
            >
              下载 {extension.name} v{extension.version}（zip）
            </Button>
          ) : null}
          <Button
            icon={<ReloadOutlined aria-hidden />}
            onClick={() =>
              void pingExtension().then((pong) =>
                setExtensionVersion(pong?.version ?? null),
              )
            }
          >
            重新检测
          </Button>
        </Space>
        <Collapse
          style={{ marginBottom: 12 }}
          items={[
            {
              key: "guide",
              label: "安装与使用（3 分钟完成）",
              children: (
                <Steps
                  orientation="vertical"
                  size="small"
                  current={extensionVersion ? 5 : 0}
                  status={extensionVersion ? "finish" : "process"}
                  items={[
                    {
                      title: "下载并解压",
                      content:
                        "点上方「下载」按钮获取 zip 安装包，解压到一个固定文件夹（不要删除解压结果）。",
                    },
                    {
                      title: "打开 Chrome 扩展管理",
                      content:
                        "地址栏输入 chrome://extensions/ 回车，打开右上角的「开发者模式」开关。",
                    },
                    {
                      title: "加载已解压的扩展程序",
                      content:
                        "点「加载已解压的扩展程序」，选择第 1 步解压出来的 aipdd-enterprise 文件夹。",
                    },
                    {
                      title: "登录各平台创作中心",
                      content:
                        "在同一个浏览器里登录要发的平台创作中心（微博、小红书/抖音/快手创作者中心、视频号、知识星球、知乎、今日头条、百家号、B站创作中心、公众号、简书、豆瓣；插件用这些已登录会话完成发布）。",
                    },
                    {
                      title: "信任本系统站点",
                      content:
                        "点浏览器工具栏的 AIPDD Enterprise 插件图标，在弹窗中点「信任此站点」——插件出于安全只接受你信任过的站点发来的分发指令。",
                    },
                    {
                      title: "回到本页分发",
                      content:
                        "新建内容 → 勾选平台 → 点「分发」：插件会逐个打开平台创作页填充内容；开了「自动发布」就替你点发布，否则请人工确认后发布。",
                    },
                    {
                      title: "查看与补记结果",
                      content:
                        "发布结果自动回写台账（本页开着才收得到）；填充失败会保留平台标签页供人工接手，可在「结果」里人工补记。",
                    },
                  ]}
                />
              ),
            },
          ]}
        />
        <Notice variant="info">
          平台创作页改版可能导致自动填充失败——失败不算事故：标签页保留，人工点一下发布即可，
          然后在「结果」里补记状态。渠道状态也可由 AI 助手经 MCP（Distribution_* 动作）查询与回写。
        </Notice>
      </Panel>

      <Panel
        title="内容台账"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined aria-hidden />}
            onClick={() => openEditor(null)}
          >
            新建分发内容
          </Button>
        }
      >
        <Space wrap style={{ marginBottom: 12 }}>
          <Select
            allowClear
            placeholder="内容类型"
            style={{ width: 130 }}
            value={filterType || undefined}
            options={[
              { value: "MOMENT", label: "动态/图文" },
              { value: "ARTICLE", label: "文章" },
            ]}
            onChange={(value) => {
              setPage(1);
              setFilterType(DISTRIBUTION_MEDIA_TYPES.find((item) => item === value) ?? "");
            }}
          />
          <Select
            allowClear
            placeholder="分发状态"
            style={{ width: 130 }}
            value={filterStatus || undefined}
            options={[
              { value: "DRAFT", label: "未分发" },
              { value: "DISTRIBUTED", label: "已分发" },
            ]}
            onChange={(value) => {
              setPage(1);
              setFilterStatus(DISTRIBUTION_CONTENT_STATUSES.find((item) => item === value) ?? "");
            }}
          />
          <Input.Search
            placeholder="按标题搜索"
            style={{ width: 220 }}
            allowClear
            onSearch={(value) => {
              setPage(1);
              setKeyword(value);
            }}
          />
        </Space>
        <Table<DistributionContent>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={rows}
          columns={columns}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            onChange: (nextPage, nextSize) => {
              setPage(nextPage);
              setPageSize(nextSize);
            },
          }}
        />
      </Panel>

      <Modal
        title={editingId ? "编辑分发内容" : "新建分发内容"}
        open={editingId !== null}
        width={720}
        confirmLoading={saving}
        onOk={() => void saveContent()}
        onCancel={() => setEditingId(null)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" initialValues={EMPTY_CONTENT}>
          <Form.Item
            name="title"
            label="标题"
            rules={[
              { required: true, message: "请填写标题" },
              { max: DISTRIBUTION_TITLE_MAX, message: `标题最多 ${DISTRIBUTION_TITLE_MAX} 字` },
            ]}
          >
            <Input placeholder="如：秋季新品上市种草" />
          </Form.Item>
          <Form.Item name="mediaType" label="内容类型">
            <Radio.Group
              options={[
                { value: "MOMENT", label: "动态/图文" },
                { value: "ARTICLE", label: "文章" },
              ]}
              onChange={() =>
                // 动态与文章可选平台不同：切类型就清空已勾，避免残留看不见的平台导致保存被拒。
                // 具体能发哪些平台由下方「发布平台」按类型实时列出，无需在此堆平台名。
                form.setFieldValue("platformCodes", [])
              }
            />
          </Form.Item>
          <Form.Item
            name="content"
            label={
              <Space>
                正文
                <Button size="small" onClick={() => void runRewrite()}>
                  AI 多平台改写
                </Button>
              </Space>
            }
            extra={
              <span className="text-12">
                样式只带到支持富文本的渠道（文章类原样带、简书转 Markdown），动态/图文类不吃样式，投递时自动转纯文本；
                图片请走下方「配图」，内联图片不随样式投递。
              </span>
            }
            rules={[
              {
                // 与后端 contentForSave 同源：只看可见字数，`<p><br></p>` 不算有内容。
                validator: (_rule, value: string) => {
                  const visible = richTextVisibleLength(value ?? "");
                  if (visible === 0) return Promise.reject(new Error("正文没有可发布的内容"));
                  return visible > DISTRIBUTION_CONTENT_VISIBLE_MAX
                    ? Promise.reject(new Error(`正文超出 ${DISTRIBUTION_CONTENT_VISIBLE_MAX} 字`))
                    : Promise.resolve();
                },
              },
            ]}
          >
            <RichTextEditor />
          </Form.Item>
          <Form.Item label="配图（选填，插件会下载并上传到平台）">
            <Space orientation="vertical" size={8} style={{ width: "100%" }}>
              {images.length ? (
                <Space size={[8, 8]} wrap>
                  {images.map((image, index) => (
                    <div
                      key={`${image.url}-${index}`}
                      style={{
                        position: "relative",
                        display: "inline-block",
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        padding: 4,
                      }}
                    >
                      <RawImg
                        src={image.url}
                        alt={image.name}
                        style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 4 }}
                      />
                      <Button
                        size="small"
                        danger
                        style={{ position: "absolute", top: -6, right: -6 }}
                        icon={<DeleteOutlined aria-hidden />}
                        onClick={() =>
                          setImages(images.filter((_, i) => i !== index))
                        }
                      />
                    </div>
                  ))}
                </Space>
              ) : null}
              <Space wrap>
                <Upload beforeUpload={addUploadedImages} showUploadList={false} accept="image/*" multiple>
                  <Button loading={uploading}>
                    上传图片
                  </Button>
                </Upload>
                <Input
                  placeholder="或直接粘贴图片 URL"
                  style={{ width: 260 }}
                  value={imageUrl}
                  onChange={(event) => setImageUrl(event.target.value)}
                />
                <Button
                  disabled={!imageUrl.trim()}
                  onClick={() => {
                    const url = imageUrl.trim();
                    if (!/^https?:\/\//.test(url)) {
                      message.warning("图片 URL 需以 http(s):// 开头");
                      return;
                    }
                    // 与上传口同一上限：URL 添加路径也要截断。
                    if (images.length >= DISTRIBUTION_IMAGES_MAX) {
                      message.warning(`配图最多 ${DISTRIBUTION_IMAGES_MAX} 张`);
                      return;
                    }
                    setImages([...images, { name: url.split("/").pop() || "image", url }]);
                    setImageUrl("");
                  }}
                >
                  添加
                </Button>
              </Space>
            </Space>
          </Form.Item>
          <Form.Item
            name="platformCodes"
            label="发布平台"
            extra="按内容类型列出可发平台；切换类型会自动清空已勾选（动态与文章支持的平台不同）"
          >
            <Checkbox.Group
              options={platformsOfType.map((platform) => ({
                value: platform.code,
                label: platform.name,
              }))}
            />
          </Form.Item>
          <div className="form-2col">
            <Form.Item
              name="autoPublish"
              label="自动发布"
              valuePropName="checked"
              tooltip="开：插件填完直接点发布按钮；关（默认）：只填好，等你在平台页确认后再发布"
            >
              <Switch />
            </Form.Item>
            <Form.Item name="tags" label="标签">
              <Input placeholder="如：新品、种草（选填）" />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <AiResultModal
        open={rewriteOpen}
        title="AI 多平台改写"
        loading={rewriteLoading}
        mode={rewrite?.mode}
        model={rewrite?.model}
        onClose={() => setRewriteOpen(false)}
        width={760}
      >
        {rewrite ? (
          <>
            {rewrite.versions.map((version) => (
              <div
                key={version.platformCode}
                style={{ borderTop: "1px dashed #eee", padding: "10px 0" }}
              >
                <Space wrap>
                  <Tag>{version.platformCode}</Tag>
                  <strong>{version.title}</strong>
                  <Button size="small" onClick={() => applyVersion(version)}>
                    应用到正文
                  </Button>
                </Space>
                <div style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>
                  {version.content}
                </div>
                {version.tags.length ? (
                  <div className="muted text-12">
                    标签：{version.tags.join("、")}
                  </div>
                ) : null}
              </div>
            ))}
            {rewrite.titles.length ? (
              <div className="muted text-12">
                备选标题：{rewrite.titles.join("；")}
              </div>
            ) : null}
          </>
        ) : null}
      </AiResultModal>

      <Drawer
        title={detail ? `分发结果 · ${detail.content.title}` : "分发结果"}
        open={detailOpen}
        size={560}
        onClose={() => setDetailOpen(false)}
      >
        {detail ? (
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions
              size="small"
              column={1}
              items={[
                { key: "type", label: "类型", children: detail.content.mediaTypeLabel },
                {
                  key: "platforms",
                  label: "目标平台",
                  children: detail.content.platformNames.join("、") || "未勾选",
                },
                {
                  key: "status",
                  label: "分发状态",
                  children: detail.content.statusLabel,
                },
                {
                  key: "time",
                  label: "最后分发",
                  children: detail.content.lastDistributedAt
                    ? fmtTime(detail.content.lastDistributedAt)
                    : "-",
                },
                {
                  key: "content",
                  label: "正文",
                  children: (
                    // 带样式预览：内容入库时已过白名单清洗，这里再洗一道防旧数据越界。
                    <div
                      style={{
                        maxHeight: 260,
                        overflowY: "auto",
                        padding: "8px 12px",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        lineHeight: 1.7,
                      }}
                      dangerouslySetInnerHTML={{
                        __html: sanitizeRichTextHtml(detail.content.content),
                      }}
                    />
                  ),
                },
              ]}
            />
            <Table<DistributionLog>
              rowKey="id"
              size="small"
              dataSource={detail.logs}
              pagination={false}
              columns={[
                { title: "平台", dataIndex: "platformName", width: 90 },
                {
                  title: "结果",
                  dataIndex: "statusLabel",
                  width: 120,
                  render: (value: string, row: DistributionLog) => (
                    <Tag color={LOG_STATUS_COLOR[row.status] || "default"}>{value}</Tag>
                  ),
                },
                {
                  title: "来源",
                  dataIndex: "source",
                  width: 80,
                  render: (value: string) =>
                    value === "MANUAL" ? "人工" : "插件",
                },
                {
                  title: "说明",
                  dataIndex: "errorMsg",
                  render: (value: string, row: DistributionLog) =>
                    value || (row.publishedUrl ? "已回传链接" : "-"),
                },
                {
                  title: "时间",
                  dataIndex: "createdAt",
                  width: 150,
                  render: (value: string) => fmtTime(value),
                },
              ]}
            />
            <Panel title="人工补记（插件没回传 / 线下发布时）">
              <Space wrap>
                <Select
                  placeholder="平台"
                  style={{ width: 140 }}
                  value={manualCode || undefined}
                  options={detail.content.platformCodes.map((code) => ({
                    value: code,
                    label:
                      detail.content.platformNames[
                        detail.content.platformCodes.indexOf(code)
                      ] ?? code,
                  }))}
                  onChange={setManualCode}
                />
                <Select
                  style={{ width: 150 }}
                  value={manualStatus}
                  options={LOG_STATUS_OPTIONS}
                  onChange={(value) =>
                    setManualStatus(DISTRIBUTION_LOG_STATUSES.find((item) => item === value) ?? "SUCCESS")
                  }
                />
                <Button
                  type="primary"
                  loading={manualSaving}
                  onClick={() => void reportManual()}
                >
                  补记
                </Button>
              </Space>
            </Panel>
            <DistributionIndexingPanel logs={detail.logs} />
          </Space>
        ) : null}
      </Drawer>
    </Space>
  );
}

/**
 * 分发台账 → 收录提交联动（设计方案 §5.7 / §5.14）：把发布成功的链接勾选后
 * 一键提交 IndexNow / 百度。收录协议只接受「已验证自有域名」的 URL，第三方平台
 * 域名（微博/小红书等）无法经此通知收录，故按所选站点主机预筛，跨主机行禁选并明示原因。
 */
function DistributionIndexingPanel({ logs }: { logs: DistributionLog[] }) {
  const { message } = App.useApp();
  const projects = useSeoProjects();
  const actions = useSeoActions();
  const [projectId, setProjectId] = useState(0);
  const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
  const [busy, setBusy] = useState("");

  const project = (projects.data ?? []).find((p) => p.id === projectId) ?? null;
  const projectHost = project
    ? domainOf(project.domain).replace(/^www\./, "").split(":")[0]
    : "";

  const rows = useMemo(() => {
    const seen = new Set<string>();
    const list: { url: string; platformName: string; sameHost: boolean }[] = [];
    for (const log of logs) {
      if (log.status !== "SUCCESS") continue;
      const url = log.publishedUrl?.trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      let host = "";
      try {
        host = new URL(url).hostname.toLowerCase();
      } catch {
        host = "";
      }
      list.push({
        url,
        platformName: log.platformName,
        sameHost: Boolean(projectHost) && host === projectHost,
      });
    }
    return list;
  }, [logs, projectHost]);

  const submit = (target: "indexnow" | "baidu") => {
    if (!project) {
      message.warning("请先选择 SEO 站点");
      return;
    }
    const urls = selectedUrls.filter((url) =>
      rows.some((row) => row.url === url && row.sameHost),
    );
    if (!urls.length) {
      message.warning("请勾选至少一个属于该站点域名的已发布链接");
      return;
    }
    setBusy(target);
    const run =
      target === "indexnow"
        ? actions.submitIndexnow.mutateAsync({ body: { projectId: project.id, urls } })
        : actions.submitBaidu.mutateAsync({ body: { projectId: project.id, urls } });
    void run
      .then((result) => {
        if (target === "indexnow") {
          message.success("已提交 IndexNow（成功提交不等于已收录）");
        } else {
          const r = result as { success?: number; remain?: number | null } | null;
          message.success(
            `百度返回成功 ${r?.success ?? 0} 条${r?.remain != null ? `，剩余配额 ${r.remain}` : ""}（成功提交不等于已收录）`,
          );
        }
        setSelectedUrls([]);
      })
      .catch((error: unknown) => {
        if (error instanceof Error) presentMutationError(error, (t) => message.error(t));
      })
      .finally(() => setBusy(""));
  };

  return (
    <Panel title="收录提交（IndexNow / 百度）">
      <Notice variant="info">
        勾选发布成功的链接，一键提交收录。IndexNow 仅通知 Bing/Yandex 等参与方（Google、百度不参与）；
        百度走站长平台主动推送。两者都只接受所选站点<strong>自有域名</strong>的 URL，第三方平台域名无法经此通知收录。
        提交前请先在「SEO 优化 → 结构化数据与收录」完成 IndexNow key 验证 / 百度凭据配置；成功提交不等于已收录。
      </Notice>
      {rows.length === 0 ? (
        <Notice variant="warn">这条内容还没有「已发布」且带回链接的平台结果，无法提交收录。</Notice>
      ) : (
        <Space orientation="vertical" size={12} style={{ width: "100%", marginTop: 12 }}>
          <Select
            placeholder="选择 SEO 站点（决定可提交的域名）"
            style={{ width: 280 }}
            value={projectId || undefined}
            options={(projects.data ?? []).map((p) => ({
              value: p.id,
              label: `${p.brandName || p.domain}（${p.domain}）`,
            }))}
            onChange={(value) => {
              setProjectId(value ?? 0);
              setSelectedUrls([]);
            }}
          />
          <Table<{ url: string; platformName: string; sameHost: boolean }>
            rowKey="url"
            size="small"
            dataSource={rows}
            pagination={false}
            rowSelection={{
              selectedRowKeys: selectedUrls,
              onChange: (keys) => setSelectedUrls(keys as string[]),
              getCheckboxProps: (row) => ({ disabled: !row.sameHost }),
            }}
            columns={[
              { title: "平台", dataIndex: "platformName", width: 100 },
              {
                title: "已发布链接",
                dataIndex: "url",
                render: (url: string) => (
                  <a href={url} target="_blank" rel="noreferrer" className="mono text-12">
                    {url}
                  </a>
                ),
              },
              {
                title: "可否提交",
                dataIndex: "sameHost",
                width: 130,
                render: (sameHost: boolean) =>
                  sameHost ? (
                    <Tag color="green">自有域名</Tag>
                  ) : (
                    <Tag>第三方平台域名</Tag>
                  ),
              },
            ]}
          />
          <Space wrap>
            <Button
              type="primary"
              loading={busy === "indexnow"}
              disabled={!project || selectedUrls.length === 0}
              onClick={() => submit("indexnow")}
            >
              提交 IndexNow
            </Button>
            <Button
              loading={busy === "baidu"}
              disabled={!project || selectedUrls.length === 0}
              onClick={() => submit("baidu")}
            >
              提交百度
            </Button>
            <span className="text-12 muted">已选 {selectedUrls.length} 条</span>
          </Space>
        </Space>
      )}
    </Panel>
  );
}
