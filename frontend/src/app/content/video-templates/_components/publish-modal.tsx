"use client";

import {
  DeleteOutlined,
  PictureOutlined,
  PlayCircleOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Tag,
  Upload,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  VIDEO_TEMPLATE_REFERENCE_MAX,
  VIDEO_TEMPLATE_TYPES,
  VIDEO_TEMPLATE_TYPE_LABELS,
  VIDEO_TEMPLATE_VIEW_COST_MAX,
  type ContentModel,
  type VideoTemplateType,
} from "@enterprise/contracts";
import { contentApi, uploadContentMedia } from "@/api/content";
import { Notice } from "@/components/ui/panel";
import { RawImg } from "@/components/ui/raw-img";

type Channel = { value: number; label: string };

/** 发布弹窗：样片/封面/参考图先传到本站内容上传通道，再把直链交给模版接口。 */
export function PublishTemplateModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [videoType, setVideoType] = useState<VideoTemplateType>("all-reference");
  const [sampleUrl, setSampleUrl] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [references, setReferences] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [channelId, setChannelId] = useState(0);
  const [model, setModel] = useState("");
  const [viewCost, setViewCost] = useState(0);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [models, setModels] = useState<ContentModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [uploading, setUploading] = useState("");
  const [saving, setSaving] = useState(false);

  const channelName = useMemo(
    () => channels.find((item) => item.value === channelId)?.label || "",
    [channels, channelId],
  );

  const loadModels = useCallback(async (nextChannelId: number, preferred = "") => {
    setModelsLoading(true);
    try {
      const result = await contentApi.models({ query: { channelId: nextChannelId } });
      const list = (result?.models || []).filter((item) => item.kind === "video");
      setModels(list);
      setModel(
        preferred && list.some((item) => item.id === preferred)
          ? preferred
          : list[0]?.id || "",
      );
    } catch {
      setModels([]);
      setModel("");
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDescription("");
    setVideoType("all-reference");
    setSampleUrl("");
    setCoverUrl("");
    setReferences([]);
    setPrompt("");
    setViewCost(0);
    void (async () => {
      try {
        const settings = await contentApi.settings();
        if (!settings) return;
        const nextChannels = settings.channels.map((item) => ({
          value: item.id,
          label: item.id === 0 ? `${item.name}（内置）` : item.name,
        }));
        setChannels(nextChannels);
        const slot = settings.slots.find((item) => item.mediaType === "video");
        const initialChannel = slot?.channelId ?? nextChannels[0]?.value ?? 0;
        setChannelId(initialChannel);
        await loadModels(initialChannel, slot?.model || "");
      } catch {
        setChannels([]);
        setModels([]);
      }
    })();
  }, [open, loadModels]);

  const upload = async (file: File, kind: "sample" | "cover" | "reference") => {
    if (kind === "reference" && references.length >= VIDEO_TEMPLATE_REFERENCE_MAX) {
      message.warning(`参考图最多 ${VIDEO_TEMPLATE_REFERENCE_MAX} 张`);
      return;
    }
    setUploading(kind);
    try {
      const result = await uploadContentMedia(file);
      if (kind === "sample") setSampleUrl(result.url);
      else if (kind === "cover") setCoverUrl(result.url);
      else setReferences((current) => [...current, result.url]);
    } catch (caught) {
      message.error((caught as Error).message || "上传失败");
    } finally {
      setUploading("");
    }
  };

  const submit = async () => {
    if (!title.trim()) return message.warning("请填写模版标题");
    if (!sampleUrl) return message.warning("请先上传样片视频");
    if (!prompt.trim()) return message.warning("请填写生成提示词");
    if (!model) return message.warning("请选择发布时使用的视频模型");
    setSaving(true);
    try {
      await contentApi.publishVideoTemplate({
        body: {
          title: title.trim(),
          description: description.trim(),
          videoType,
          sampleUrl,
          coverUrl,
          referenceImages: references,
          prompt: prompt.trim(),
          modelChannelName: channelName,
          modelName: model,
          viewCost: Math.max(0, Math.min(VIDEO_TEMPLATE_VIEW_COST_MAX, viewCost)),
        },
      });
      message.success("模版已发布");
      onSaved();
      onClose();
    } catch (caught) {
      message.error((caught as Error).message || "发布失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="发布视频模版"
      width={860}
      destroyOnHidden
      okText="发布"
      cancelText="取消"
      confirmLoading={saving}
      onOk={() => void submit()}
      onCancel={onClose}
    >
      <div style={{ display: "grid", gap: 12 }}>
        <Notice variant="info">
          样片与提示词会公开展示；查看积分默认 0（免费）。设为付费后，非发布者首次查看时扣分，
          这笔积分由你获得。参考图最多 {VIDEO_TEMPLATE_REFERENCE_MAX} 张。
        </Notice>
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 6 }}>
              模版标题
            </div>
            <Input
              value={title}
              maxLength={200}
              placeholder="例如：一镜到底的宠物变身"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 6 }}>
              视频类型
            </div>
            <Select
              style={{ width: "100%" }}
              value={videoType}
              onChange={(value) => setVideoType(value)}
              options={VIDEO_TEMPLATE_TYPES.map((key) => ({
                value: key,
                label: VIDEO_TEMPLATE_TYPE_LABELS[key],
              }))}
            />
          </div>
        </div>
        <div>
          <div className="text-12 muted" style={{ marginBottom: 6 }}>
            模版简介
          </div>
          <Input.TextArea
            value={description}
            maxLength={4000}
            autoSize={{ minRows: 2, maxRows: 4 }}
            placeholder="这个模版适合什么场景、要注意什么"
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 6 }}>
              样片视频
            </div>
            {sampleUrl ? (
              <div style={{ display: "grid", gap: 6 }}>
                <video
                  src={sampleUrl}
                  controls
                  style={{ width: "100%", maxHeight: 180, borderRadius: 8, background: "#000" }}
                />
                <Space>
                  <Tag color="green">已上传</Tag>
                  <Button size="small" onClick={() => setSampleUrl("")}>
                    重新上传
                  </Button>
                </Space>
              </div>
            ) : (
              <Upload
                accept="video/mp4,video/quicktime,video/webm"
                showUploadList={false}
                beforeUpload={(file) => {
                  void upload(file, "sample");
                  return false;
                }}
              >
                <Button icon={<PlayCircleOutlined />} loading={uploading === "sample"}>
                  上传样片
                </Button>
              </Upload>
            )}
          </div>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 6 }}>
              封面图（可选，默认取第一张参考图）
            </div>
            {coverUrl ? (
              <Space align="start">
                <RawImg
                  src={coverUrl}
                  alt="封面"
                  style={{ width: 120, height: 80, objectFit: "cover", borderRadius: 8 }}
                />
                <Button size="small" onClick={() => setCoverUrl("")}>
                  重新上传
                </Button>
              </Space>
            ) : (
              <Upload
                accept="image/*"
                showUploadList={false}
                beforeUpload={(file) => {
                  void upload(file, "cover");
                  return false;
                }}
              >
                <Button icon={<PictureOutlined />} loading={uploading === "cover"}>
                  上传封面
                </Button>
              </Upload>
            )}
          </div>
        </div>
        <div>
          <div className="text-12 muted" style={{ marginBottom: 6 }}>
            参考图（最多 {VIDEO_TEMPLATE_REFERENCE_MAX} 张）
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {references.map((url) => (
              <div key={url} style={{ position: "relative" }}>
                <RawImg
                  src={url}
                  alt="参考图"
                  style={{ width: 84, height: 84, objectFit: "cover", borderRadius: 8 }}
                />
                <Button
                  size="small"
                  danger
                  type="text"
                  icon={<DeleteOutlined />}
                  style={{ position: "absolute", top: -6, right: -6, background: "#fff" }}
                  onClick={() => setReferences((current) => current.filter((item) => item !== url))}
                />
              </div>
            ))}
            {references.length < VIDEO_TEMPLATE_REFERENCE_MAX ? (
              <Upload
                accept="image/*"
                showUploadList={false}
                beforeUpload={(file) => {
                  void upload(file, "reference");
                  return false;
                }}
              >
                <Button icon={<UploadOutlined />} loading={uploading === "reference"}>
                  添加参考图
                </Button>
              </Upload>
            ) : null}
          </div>
        </div>
        <div>
          <div className="text-12 muted" style={{ marginBottom: 6 }}>
            生成提示词
          </div>
          <Input.TextArea
            value={prompt}
            maxLength={4000}
            autoSize={{ minRows: 4, maxRows: 8 }}
            placeholder="写清主体、动作、镜头与风格；复刻时用户会带着这段提示词进入生成器"
            onChange={(event) => setPrompt(event.target.value)}
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 6 }}>
              使用的渠道
            </div>
            <Select
              style={{ width: "100%" }}
              value={channelId}
              options={channels}
              loading={!channels.length}
              placeholder={channels.length ? "选择渠道" : "先在模型设置里配置渠道"}
              onChange={(value) => {
                setChannelId(value);
                void loadModels(value);
              }}
            />
          </div>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 6 }}>
              使用的模型
            </div>
            <Select
              style={{ width: "100%" }}
              value={model || undefined}
              options={models.map((item) => ({ value: item.id, label: item.id }))}
              loading={modelsLoading}
              placeholder={models.length ? "选择模型" : "该渠道没有视频模型"}
              onChange={setModel}
            />
          </div>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 6 }}>
              查看积分（0＝免费）
            </div>
            <InputNumber
              style={{ width: "100%" }}
              min={0}
              max={VIDEO_TEMPLATE_VIEW_COST_MAX}
              step={1}
              value={viewCost}
              onChange={(value) => setViewCost(Number(value ?? 0))}
            />
          </div>
        </div>
        {!channels.length ? (
          <Notice variant="warn">
            没有可用的视频渠道：请到「模型服务 → 模型设置」配置后再发布。
            <Link href="/model-settings"> 立即配置模型</Link>
          </Notice>
        ) : null}
      </div>
    </Modal>
  );
}
