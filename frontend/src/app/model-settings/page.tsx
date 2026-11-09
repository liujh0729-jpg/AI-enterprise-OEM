"use client";

import {
  ApiOutlined,
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import {
  App,
  AutoComplete,
  Button,
  Input,
  Modal,
  Popconfirm,
  Select,
  Skeleton,
  Space,
  Tag,
} from "antd";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CONTENT_CHANNEL_PRESET_BASE_URLS,
  CONTENT_CHANNEL_PRESET_LABELS,
  CONTENT_CHANNEL_PRESETS,
  CONTENT_CHANNEL_PROVIDER_LABELS,
  CONTENT_MEDIA_TYPES,
  CONTENT_MEDIA_TYPE_LABELS,
  type ContentChannelPreset,
  type ContentChannelProvider,
  type ContentMediaType,
  type ContentModel,
  type ContentModelChannel,
  type ContentSettings,
} from "@enterprise/contracts";
import { contentApi } from "@/api/content";
import { Notice, PageHero, Panel } from "@/components/ui/panel";

type SlotDraft = { channelId: number; model: string };
type Draft = Record<string, SlotDraft>;

const SLOT_TYPES: ContentMediaType[] = [...CONTENT_MEDIA_TYPES];

/** 每个槽位能选哪些模型：视觉理解优先带 vision 标记的文本模型，其余按 kind 对齐。 */
function filterModels(mediaType: string, models: ContentModel[]) {
  return models.filter((model) => {
    if (mediaType === "vision") return model.vision;
    if (mediaType === "text") return model.kind === "text";
    return model.kind === mediaType;
  });
}

/** 火山 MediaKit 的渠道卡片说明（它只提供超分与字幕/文字擦除）。 */
const MEDIAKIT_HINT = "提供生成式视频超分与字幕/文字擦除，只填 Key 即可";

export default function ModelSettingsPage() {
  const { message } = App.useApp();
  const [settings, setSettings] = useState<ContentSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<Record<number, ContentModel[]>>({});
  const [modelErrors, setModelErrors] = useState<Record<number, string>>({});
  const [loadingModels, setLoadingModels] = useState<Record<number, boolean>>(
    {},
  );

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ContentModelChannel | null>(null);
  const [form, setForm] = useState({
    provider: "custom" as ContentChannelProvider,
    preset: "openai" as ContentChannelPreset,
    name: "",
    baseUrl: "",
    apiKey: "",
    asrApiKey: "",
  });
  const [testing, setTesting] = useState(false);
  const [savingChannel, setSavingChannel] = useState(false);

  const applySettings = useCallback((next: ContentSettings | null) => {
    if (!next) return;
    setSettings(next);
    setDraft(
      Object.fromEntries(
        next.slots.map((slot) => [
          slot.mediaType,
          { channelId: slot.channelId, model: slot.model },
        ]),
      ),
    );
  }, []);

  const reload = useCallback(async () => {
    try {
      const result = await contentApi.settings();
      applySettings(result);
      setError("");
    } catch (caught) {
      setError((caught as Error).message || "模型设置加载失败");
    } finally {
      setLoading(false);
    }
  }, [applySettings]);

  const loadModels = useCallback(
    async (channelId: number, force = false) => {
      if (!force && (models[channelId] || loadingModels[channelId])) return;
      setLoadingModels((prev) => ({ ...prev, [channelId]: true }));
      setModelErrors((prev) => ({ ...prev, [channelId]: "" }));
      try {
        const result = await contentApi.models({ query: { channelId } });
        setModels((prev) => ({ ...prev, [channelId]: result?.models || [] }));
      } catch (caught) {
        setModels((prev) => ({ ...prev, [channelId]: [] }));
        setModelErrors((prev) => ({
          ...prev,
          [channelId]: (caught as Error).message || "模型列表读取失败",
        }));
      } finally {
        setLoadingModels((prev) => ({ ...prev, [channelId]: false }));
      }
    },
    [loadingModels, models],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!settings) return;
    const used = new Set(
      Object.values(draft)
        .map((slot) => slot.channelId)
        .filter((id) => id >= 0),
    );
    for (const channelId of used) void loadModels(channelId);
  }, [settings, draft, loadModels]);

  const channelOptions = useMemo(
    () =>
      (settings?.channels || []).map((channel) => ({
        value: channel.id,
        label:
          channel.id === 0
            ? "AIPDD（内置）"
            : channel.id === -1
              ? "LocalAPI（本站模型广场，免 Key）"
              : channel.available
                ? channel.name
                : `${channel.name}（${channel.unavailableReason || "不可用"}）`,
        disabled: !channel.available,
      })),
    [settings],
  );

  const dirty = useMemo(() => {
    if (!settings) return false;
    const savedSlots = Object.fromEntries(
      settings.slots.map((slot) => [
        slot.mediaType,
        { channelId: slot.channelId, model: slot.model },
      ]),
    );
    return JSON.stringify(savedSlots) !== JSON.stringify(draft);
  }, [settings, draft]);

  const save = async () => {
    setSaving(true);
    try {
      const result = await contentApi.saveSettings({
        body: {
          slots: SLOT_TYPES.map((mediaType) => ({
            mediaType,
            channelId: draft[mediaType]?.channelId || 0,
            model: draft[mediaType]?.model || "",
          })),
        },
      });
      if (result) applySettings(result);
      message.success("已保存模型设置");
    } catch (caught) {
      message.error((caught as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const openChannelModal = (channel: ContentModelChannel | null) => {
    setEditing(channel);
    const preset = (channel?.preset || "openai") as ContentChannelPreset;
    setForm({
      provider: (channel?.provider === "mediakit" ? "mediakit" : "custom") as ContentChannelProvider,
      preset,
      name: channel?.name || CONTENT_CHANNEL_PRESET_LABELS[preset],
      baseUrl: channel?.baseUrl || CONTENT_CHANNEL_PRESET_BASE_URLS[preset] || "",
      apiKey: "",
      asrApiKey: "",
    });
    setModalOpen(true);
  };

  const pickProvider = (provider: ContentChannelProvider) => {
    setForm((prev) => {
      if (provider === "volcengine") {
        return { ...prev, provider, name: "火山引擎", baseUrl: "https://ark.cn-beijing.volces.com/api/v3" };
      }
      if (provider === "mediakit") {
        return { ...prev, provider, name: "火山 AI MediaKit", baseUrl: "https://mediakit.cn-beijing.volces.com/api/v1" };
      }
      return {
        ...prev,
        provider,
        preset: "openai",
        name: CONTENT_CHANNEL_PRESET_LABELS.openai,
        baseUrl: CONTENT_CHANNEL_PRESET_BASE_URLS.openai,
      };
    });
  };

  const pickPreset = (preset: ContentChannelPreset) => {
    setForm((prev) => {
      const previousUrl = CONTENT_CHANNEL_PRESET_BASE_URLS[prev.preset] || "";
      const nextUrl = CONTENT_CHANNEL_PRESET_BASE_URLS[preset] || "";
      // 地址没被手工改过才跟着预设切换，避免覆盖用户自己填的网关
      const keepUrl = prev.baseUrl.trim() && prev.baseUrl !== previousUrl;
      const previousName = CONTENT_CHANNEL_PRESET_LABELS[prev.preset];
      const keepName = prev.name.trim() && prev.name !== previousName;
      return {
        ...prev,
        preset,
        baseUrl: keepUrl ? prev.baseUrl : nextUrl,
        name: keepName
          ? prev.name
          : preset === "custom"
            ? ""
            : CONTENT_CHANNEL_PRESET_LABELS[preset],
      };
    });
  };

  const testChannel = async () => {
    setTesting(true);
    try {
      const result = await contentApi.testChannel({
        body: {
          id: editing?.id || 0,
          provider: form.provider,
          preset: form.provider === "custom" ? form.preset : "",
          name: form.name,
          baseUrl: form.baseUrl,
          apiKey: form.apiKey,
          asrApiKey: form.asrApiKey,
        },
      });
      if (!result) throw new Error("连通测试没有返回结果");
      if (result.ok) message.success(result.message);
      else message.warning(result.message);
      if (editing?.id) await reload();
    } catch (caught) {
      message.error((caught as Error).message || "连通测试失败");
    } finally {
      setTesting(false);
    }
  };

  const saveChannel = async () => {
    setSavingChannel(true);
    try {
      const saved = await contentApi.saveChannel({
        body: {
          id: editing?.id || 0,
          provider: form.provider,
          preset: form.provider === "custom" ? form.preset : "",
          name: form.name,
          baseUrl: form.baseUrl,
          apiKey: form.apiKey,
        },
      });
      setModalOpen(false);
      message.success("渠道已保存");
      setModels({});
      // 保存后立刻用已落库的凭据校验一次：通过才会被允许选为默认模型
      if (saved?.id) {
        try {
          const checked = await contentApi.testChannel({
            body: { id: saved.id, provider: saved.provider },
          });
          if (checked?.ok) message.success(checked.message);
          else message.warning(checked?.message || "连通校验未通过");
        } catch (caught) {
          message.warning(
            (caught as Error).message || "连通校验未通过，渠道暂不可选",
          );
        }
      }
      await reload();
    } catch (caught) {
      message.error((caught as Error).message || "渠道保存失败");
    } finally {
      setSavingChannel(false);
    }
  };

  const removeChannel = async (channel: ContentModelChannel) => {
    try {
      await contentApi.removeChannel({ params: { id: String(channel.id) } });
      message.success("渠道已删除");
      setModels({});
      await reload();
    } catch (caught) {
      message.error((caught as Error).message || "删除失败");
    }
  };

  const aipdd = settings?.aipdd;
  // 0 是 AIPDD、-1 是 LocalAPI，两者都是内置虚拟渠道，只有正数 id 才是用户自建渠道
  const customChannels = (settings?.channels || []).filter(
    (channel) => channel.id > 0,
  );

  return (
    <div>
      <PageHero
        title="模型设置"
        desc="Agent 与内容创作共用的模型配置。AIPDD 是内置渠道，直接使用当前登录账号在「API Key 管理」里的同源 API Key；没有时先去生成一把，不需要为渠道单独配置。也可以接入其他 OpenAI 兼容网关与火山 AI MediaKit。每种类型选好默认模型后，对应功能才能提交任务"
        extra={
          <Button
            icon={<ReloadOutlined aria-hidden />}
            onClick={() => {
              setModels({});
              void reload();
            }}
          >
            刷新
          </Button>
        }
      />

      {error ? <Notice variant="error">{`模型设置加载失败：${error}`}</Notice> : null}
      {loading ? <Skeleton active paragraph={{ rows: 8 }} /> : null}

      {!loading && settings ? (
        <>
          {!aipdd?.configured ? (
            <Notice variant="info">
              当前登录账号还没有 API Key，AIPDD 渠道暂时不可用。
              <Link href="/developer/keys"> 去「API Key 管理」生成一把 sk- Key</Link>
              ，回来刷新即可。
            </Notice>
          ) : null}

          <Panel
            title="渠道"
            titleExtra={
              <span className="text-12 muted">
                AIPDD 使用当前账号的 API Key（在「API Key 管理」维护）；其余渠道的 Key 加密保存在本系统
              </span>
            }
            extra={
              <Button
                icon={<PlusOutlined aria-hidden />}
                onClick={() => openChannelModal(null)}
              >
                新增渠道
              </Button>
            }
          >
            <div style={{ display: "grid", gap: 14 }}>
              <div style={{ border: "1px solid var(--line, #f0f0f0)", borderRadius: 10, padding: "12px 14px" }}>
                <Space size={8} wrap>
                  <Tag color="processing">AIPDD</Tag>
                  <span className="muted text-12">{aipdd?.baseUrl}</span>
                  <span className="text-12">
                    {aipdd?.configured
                      ? `API Key ${aipdd.keyMasked}`
                      : "当前账号未生成 API Key"}
                  </span>
                </Space>
                <div className="text-12 muted" style={{ marginTop: 6 }}>
                  内置渠道：模型都从这里拉取，使用当前登录账号在「API Key 管理」里的同源 API Key。
                  {aipdd?.configured ? null : (
                    <>
                      {" "}
                      <Link href="/developer/keys">去生成一把 sk- Key</Link>
                      ，回来刷新即可；不需要为渠道单独配置。
                    </>
                  )}
                </div>
              </div>

              <div style={{ border: "1px solid var(--line, #f0f0f0)", borderRadius: 10, padding: "12px 14px" }}>
                <Space size={8} wrap>
                  <Tag color="geekblue">LocalAPI</Tag>
                  <span className="muted text-12">本站模型广场 · 免 Key</span>
                  <Tag color="green">可直接选择</Tag>
                </Space>
                <div className="text-12 muted" style={{ marginTop: 6 }}>
                  使用本站「模型广场」统一上架的模型，不需要你生成任何 API Key；每次调用按目录价扣积分，余额不足会被拒绝。
                </div>
              </div>

              {customChannels.map((channel) => (
                <div key={channel.id} style={{ border: "1px solid var(--line, #f0f0f0)", borderRadius: 10, padding: "12px 14px" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <Space size={8} wrap>
                      <Tag>{CONTENT_CHANNEL_PROVIDER_LABELS[channel.provider]}</Tag>
                      <span>{channel.name}</span>
                      <span className="muted text-12">{channel.baseUrl}</span>
                      <span className="text-12">
                        {channel.keyMasked ? `Key ${channel.keyMasked}` : "未保存 Key"}
                      </span>
                      {channel.verified ? (
                        <Tag color="green">已校验</Tag>
                      ) : (
                        <Tag color="orange">未校验</Tag>
                      )}
                      {channel.provider === "volcengine" ? (
                        <span className="text-12">
                          {channel.asrKeyMasked
                            ? `ASR Key ${channel.asrKeyMasked}`
                            : "ASR Key 未配置"}
                        </span>
                      ) : null}
                    </Space>
                    <Space size={4}>
                      <Button
                        icon={<ApiOutlined aria-hidden />}
                        onClick={async () => {
                          try {
                            const checked = await contentApi.testChannel({
                              body: { id: channel.id, provider: channel.provider },
                            });
                            if (!checked) throw new Error("连通测试没有返回结果");
                            if (checked.ok) message.success(checked.message);
                            else message.warning(checked.message);
                            await reload();
                          } catch (caught) {
                            message.error(
                              (caught as Error).message || "连通测试失败",
                            );
                          }
                        }}
                      >
                        测试连通
                      </Button>
                      <Button onClick={() => openChannelModal(channel)}>
                        编辑
                      </Button>
                      <Popconfirm
                        title="删除该渠道？"
                        description="用到它的默认模型会被清空，需要重新选择"
                        okText="删除"
                        cancelText="取消"
                        onConfirm={() => void removeChannel(channel)}
                      >
                        <Button danger icon={<DeleteOutlined aria-hidden />}>
                          删除
                        </Button>
                      </Popconfirm>
                    </Space>
                  </div>
                  {channel.provider === "mediakit" ? (
                    <div className="text-12 muted" style={{ marginTop: 6 }}>
                      {MEDIAKIT_HINT}
                    </div>
                  ) : null}
                </div>
              ))}

              {!customChannels.length ? (
                <div className="text-12 muted">
                  还没有自定义渠道。只有 AIPDD 一个渠道也能正常使用。
                </div>
              ) : null}
            </div>
          </Panel>

          <Panel
            title="默认模型"
            titleExtra={
              <span className="text-12 muted">
                缺哪一类，对应功能提交时会直接提示，不会替你猜一个模型
              </span>
            }
            extra={
              <Button
                icon={<ApiOutlined aria-hidden />}
                onClick={() => {
                  const used = new Set(
                    Object.values(draft).map((slot) => slot.channelId),
                  );
                  for (const channelId of used) void loadModels(channelId, true);
                }}
              >
                刷新模型列表
              </Button>
            }
          >
            <div style={{ display: "grid", gap: 14 }}>
              {SLOT_TYPES.map((mediaType) => {
                const slot = draft[mediaType] || { channelId: 0, model: "" };
                const list = models[slot.channelId] || [];
                const candidates = filterModels(mediaType, list);
                const channelError = modelErrors[slot.channelId];
                return (
                  <div
                    key={mediaType}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "120px 220px 1fr",
                      gap: 12,
                      alignItems: "center",
                    }}
                  >
                    <span>{CONTENT_MEDIA_TYPE_LABELS[mediaType]}</span>
                    <Select
                      value={slot.channelId}
                      options={channelOptions}
                      onChange={(channelId) => {
                        setDraft((prev) => ({
                          ...prev,
                          [mediaType]: { channelId, model: "" },
                        }));
                        void loadModels(channelId);
                      }}
                    />
                    {slot.channelId === 0 ? (
                      <Select
                        value={slot.model || undefined}
                        placeholder={
                          loadingModels[slot.channelId]
                            ? "正在读取模型列表…"
                            : channelError || "选择默认模型"
                        }
                        loading={Boolean(loadingModels[slot.channelId])}
                        showSearch
                        allowClear
                        options={candidates.map((model) => ({
                          value: model.id,
                          label: model.vision ? `${model.id}（视觉）` : model.id,
                        }))}
                        notFoundContent={
                          channelError
                            ? channelError
                            : loadingModels[slot.channelId]
                              ? "读取中…"
                              : "该渠道没有这一类型的模型"
                        }
                        onChange={(model) =>
                          setDraft((prev) => ({
                            ...prev,
                            [mediaType]: {
                              channelId: slot.channelId,
                              model: model || "",
                            },
                          }))
                        }
                      />
                    ) : (
                      // 自定义渠道 / 火山引擎未必提供 /models：允许直接手填模型名，下拉只是候选
                      <AutoComplete
                        value={slot.model || undefined}
                        placeholder={
                          channelError
                            ? "该渠道读不到模型列表，直接填模型名"
                            : "选择或直接填写模型名"
                        }
                        options={candidates.map((model) => ({
                          value: model.id,
                          label: model.vision ? `${model.id}（视觉）` : model.id,
                        }))}
                        allowClear
                        onChange={(model) =>
                          setDraft((prev) => ({
                            ...prev,
                            [mediaType]: {
                              channelId: slot.channelId,
                              model: model || "",
                            },
                          }))
                        }
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </Panel>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 10,
            }}
          >
            <span className="text-12 muted">
              {dirty ? "有未保存的改动" : "改完点这里「保存设置」才生效"}
            </span>
            <Button
              type="primary"
              icon={<SaveOutlined aria-hidden />}
              disabled={!dirty}
              loading={saving}
              onClick={() => void save()}
            >
              保存设置
            </Button>
          </div>
        </>
      ) : null}

      <Modal
        open={modalOpen}
        title={editing ? "编辑渠道" : "新增渠道"}
        okText="保存"
        cancelText="取消"
        confirmLoading={savingChannel}
        onOk={() => void saveChannel()}
        onCancel={() => setModalOpen(false)}
        footer={[
          <Button key="test" loading={testing} onClick={() => void testChannel()}>
            测试连通
          </Button>,
          <Button key="cancel" onClick={() => setModalOpen(false)}>
            取消
          </Button>,
          <Button key="ok" type="primary" loading={savingChannel} onClick={() => void saveChannel()}>
            保存
          </Button>,
        ]}
      >
        <div style={{ display: "grid", gap: 14 }}>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 6 }}>
              渠道类型
            </div>
            <Select
              style={{ width: "100%" }}
              value={form.provider}
              disabled={Boolean(editing)}
              options={(editing?.provider === "aipdd"
                ? (["aipdd"] as ContentChannelProvider[])
                : (["custom", "volcengine", "mediakit"] as ContentChannelProvider[])
              ).map((value) => ({
                value,
                label: CONTENT_CHANNEL_PROVIDER_LABELS[value],
              }))}
              onChange={(provider) => pickProvider(provider)}
            />
          </div>
          {form.provider === "custom" ? (
            <div>
              <div className="text-12 muted" style={{ marginBottom: 6 }}>
                渠道预设
              </div>
              <Select
                style={{ width: "100%" }}
                value={form.preset}
                options={CONTENT_CHANNEL_PRESETS.map((value) => ({
                  value,
                  label: CONTENT_CHANNEL_PRESET_LABELS[value],
                }))}
                onChange={(value: ContentChannelPreset) => pickPreset(value)}
              />
              <div className="text-12 muted" style={{ marginTop: 6 }}>
                {form.preset === "anthropic"
                  ? "Claude 走 Anthropic 原生协议（/messages + x-api-key），可选「文本」「视觉理解」两类默认模型"
                  : "预设只决定默认地址与接口协议；换成自定义可接 NewAPI 等任意 OpenAI 兼容网关"}
              </div>
            </div>
          ) : null}
          {form.provider === "aipdd" ? null : (
          <div>
            <div className="text-12 muted" style={{ marginBottom: 6 }}>
              渠道名称
            </div>
            <Input
              value={form.name}
              placeholder={
                form.provider === "mediakit"
                  ? "火山 AI MediaKit"
                  : form.provider === "volcengine"
                    ? "火山引擎"
                    : "例如：公司网关"
              }
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            />
          </div>
          )}
          {form.provider === "aipdd" ? null : (
          <div>
            <div className="text-12 muted" style={{ marginBottom: 6 }}>
              渠道地址
            </div>
            <Input
              value={form.baseUrl}
              placeholder={
                form.provider === "mediakit"
                  ? "https://mediakit.cn-beijing.volces.com/api/v1"
                  : form.provider === "volcengine"
                    ? "https://ark.cn-beijing.volces.com/api/v3"
                    : "https://api.example.com/v1"
              }
              onChange={(event) => setForm((prev) => ({ ...prev, baseUrl: event.target.value }))}
            />
          </div>
          )}
          {form.provider === "volcengine" ? (
            <div>
              <div className="text-12 muted" style={{ marginBottom: 6 }}>
                豆包语音识别 Key（可选，与方舟 Key 不通用）
              </div>
              <Input.Password
                value={form.asrApiKey}
                placeholder={
                  editing?.asrKeyMasked
                    ? `已保存 ${editing.asrKeyMasked}；留空＝不修改`
                    : "豆包语音控制台「API Key 管理」里的 Key；不填则语音识别不可用"
                }
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, asrApiKey: event.target.value }))
                }
              />
            </div>
          ) : null}
          {form.provider === "aipdd" ? null : (
            <div>
              <div className="text-12 muted" style={{ marginBottom: 6 }}>
                API Key
              </div>
              <Input.Password
                value={form.apiKey}
                placeholder={
                  editing?.keyMasked
                    ? "留空＝不修改已保存的 Key"
                    : "填写渠道密钥"
                }
                onChange={(event) => setForm((prev) => ({ ...prev, apiKey: event.target.value }))}
              />
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}