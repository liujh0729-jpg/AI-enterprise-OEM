"use client";

import {
  DeleteOutlined,
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Tabs,
  Tag,
  Upload,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { uploadContentMedia } from "@/api/content";
import { Notice, EmptyState, Panel } from "@/components/ui/panel";
import { fmtTime } from "@/lib/datetime";
import {
  ASSET_STATUS_COLOR,
  ASSET_STATUS_LABEL,
  DRIVER_LABEL,
  PACK_STATUS_COLOR,
  PACK_STATUS_LABEL,
  PLATFORM_OPTIONS,
  SIZE_OPTIONS,
  TONE_LABEL,
  TONE_OPTIONS,
  domesticPdpApi,
  type DomesticPdpAsset,
  type DomesticPdpBrief,
  type DomesticPdpMeta,
  type DomesticPdpPack,
  type DomesticPdpPackDetail,
  type DomesticPdpPlan,
  type DomesticPdpStyleLock,
} from "./domestic-pdp-common";

/**
 * 国内电商商品页优化（内容创作）。
 *
 * 三段式：商品简报 → 规划（文本模型：转化驱动 / 购买理由卡 / 风格锁 / 每张中文文案与场景）
 * → 逐张确认提示词后出图（图片模型；有参考图时走 /images/edits 锁定产品身份）。
 * 两个模型都取「内容创作 → 模型设置」的默认槽位，不在这里另配 Key。
 *
 * 国内版要点：白底首图预留平台价格区与 logo 区、图面不出现价格、
 * 中文文案用「」包裹、按广告法过滤绝对化用语。
 */

const STYLE_FIELDS: { key: keyof DomesticPdpStyleLock; label: string }[] = [
  { key: "styleName", label: "风格名" },
  { key: "colorPalette", label: "色板（hex）" },
  { key: "backgroundSystem", label: "背景系统" },
  { key: "lighting", label: "光线" },
  { key: "cameraLanguage", label: "镜头语言" },
  { key: "typography", label: "字体与层级" },
  { key: "layoutRules", label: "版式规则" },
  { key: "propRules", label: "道具规则" },
  { key: "productRendering", label: "产品渲染" },
  { key: "negativeRules", label: "否定清单" },
];

function MetaLine({ meta }: { meta: DomesticPdpMeta | null }) {
  if (!meta) return null;
  return (
    <Notice variant={meta.textReady && meta.imageReady ? "info" : "warn"}>
      {meta.hint}
      <div style={{ marginTop: 4, opacity: 0.8 }}>
        文本：{meta.textLabel || "未配置"} · 图片：{meta.imageLabel || "未配置"}
      </div>
    </Notice>
  );
}

function PlanBrief({ plan }: { plan: DomesticPdpPlan }) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div>
        <Tag color="purple">{DRIVER_LABEL[plan.driver] || plan.driver}</Tag>
        <span>{plan.driverReason}</span>
      </div>
      {plan.buyerReasons.length ? (
        <Row gutter={[12, 12]}>
          {plan.buyerReasons.map((reason, index) => (
            <Col xs={24} xl={12} key={`${reason.need}-${index}`}>
              <Card size="small" title={`购买理由 ${index + 1}`}>
                <div>
                  <b>需求：</b>
                  {reason.need}
                </div>
                <div>
                  <b>特性：</b>
                  {reason.feature}
                </div>
                <div>
                  <b>收益：</b>
                  {reason.benefit}
                </div>
                <Tag color={reason.basis === "direct" ? "green" : "orange"}>
                  {reason.basis === "direct" ? "简报事实" : "推断"}
                </Tag>
              </Card>
            </Col>
          ))}
        </Row>
      ) : null}
      <details>
        <summary>风格锁（10 项，后续每张图共用）</summary>
        <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
          {STYLE_FIELDS.map((field) => (
            <div key={field.key}>
              <b>{field.label}：</b>
              {plan.styleLock[field.key]}
            </div>
          ))}
        </div>
      </details>
      {plan.assumptions.length ? (
        <details>
          <summary>推断与缺失信息（{plan.assumptions.length}）</summary>
          <ul style={{ margin: "8px 0 0 18px" }}>
            {plan.assumptions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {plan.bannedClaims.length ? (
        <details>
          <summary>本商品禁用表述（广告法，{plan.bannedClaims.length}）</summary>
          <ul style={{ margin: "8px 0 0 18px" }}>
            {plan.bannedClaims.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function AssetCard({
  packId,
  asset,
  onChanged,
  onRefreshList,
}: {
  packId: number;
  asset: DomesticPdpAsset;
  onChanged: (detail: DomesticPdpPackDetail) => void;
  onRefreshList: () => void;
}) {
  const { message } = App.useApp();
  const [copy, setCopy] = useState(asset.copy);
  const [prompt, setPrompt] = useState(asset.prompt);
  const [size, setSize] = useState(asset.size || "1024x1024");
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    setCopy(asset.copy);
    setPrompt(asset.prompt);
    setSize(asset.size || "1024x1024");
  }, [asset.id, asset.copy, asset.prompt, asset.size]);

  const dirty =
    copy !== asset.copy ||
    prompt !== asset.prompt ||
    size !== (asset.size || "1024x1024");

  const save = async () => {
    setSaving(true);
    try {
      onChanged(await domesticPdpApi.updateAsset(packId, asset.id, { copy, prompt, size }));
      message.success("提示词已保存");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const generate = async () => {
    setRunning(true);
    try {
      // 出图前先落库最新提示词，改词即生成（后端也接受随请求带来的提示词）。
      const next = await domesticPdpApi.generate(packId, asset.id, { prompt, size });
      onChanged(next);
      const updated = next.assets.find((item) => item.id === asset.id);
      if (updated?.error) message.warning(updated.error);
      else message.success(`第 ${asset.position} 张已生成`);
      onRefreshList();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card
      size="small"
      title={
        <Space size={6} wrap>
          <span>{asset.title}</span>
          <Tag color={ASSET_STATUS_COLOR[asset.status]}>
            {ASSET_STATUS_LABEL[asset.status] || asset.status}
          </Tag>
        </Space>
      }
      extra={<Tag>{asset.sceneKey}</Tag>}
    >
      {asset.url ? (
        <Image
          src={asset.url}
          alt={asset.title}
          style={{ width: "100%", borderRadius: 8 }}
        />
      ) : (
        <div
          style={{
            height: 160,
            display: "grid",
            placeItems: "center",
            borderRadius: 8,
            background: "rgba(0,0,0,0.04)",
            color: "#888",
          }}
        >
          尚未生成
        </div>
      )}
      <div style={{ marginTop: 8, opacity: 0.75, fontSize: 12 }}>
        用途：{asset.purpose || "—"}
      </div>
      <div style={{ marginTop: 10, fontWeight: 600 }}>图面文案（中文）</div>
      <Input.TextArea
        value={copy}
        onChange={(event) => setCopy(event.target.value)}
        rows={3}
        placeholder="每行一条，出图时逐行渲染（「」包裹更准）；留空＝图面无文字"
      />
      <div style={{ marginTop: 10, fontWeight: 600 }}>出图提示词</div>
      <Input.TextArea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        rows={6}
        placeholder="Style Lock 已自动拼接，可在这里继续补充构图、留白与角度"
      />
      <Space wrap style={{ marginTop: 10 }}>
        <Select
          value={size}
          onChange={setSize}
          options={SIZE_OPTIONS}
          style={{ width: 140 }}
        />
        <Button onClick={save} loading={saving} disabled={!dirty}>
          保存提示词
        </Button>
        <Button
          type="primary"
          icon={<ThunderboltOutlined aria-hidden />}
          loading={running}
          onClick={generate}
        >
          {asset.url ? "重新生成" : "生成这张"}
        </Button>
        {asset.url ? (
          <Button
            icon={<EyeOutlined aria-hidden />}
            onClick={() => window.open(asset.url, "_blank", "noopener,noreferrer")}
          >
            查看原图
          </Button>
        ) : null}
      </Space>
      {asset.error ? (
        <div style={{ marginTop: 10 }}>
          <Notice variant="warn">{asset.error}</Notice>
        </div>
      ) : null}
    </Card>
  );
}

export function DomesticPdpTab() {
  const { message } = App.useApp();
  const [meta, setMeta] = useState<DomesticPdpMeta | null>(null);
  const [packs, setPacks] = useState<DomesticPdpPack[]>([]);
  const [packsLoading, setPacksLoading] = useState(true);
  const [activeId, setActiveId] = useState(0);
  const [detail, setDetail] = useState<DomesticPdpPackDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createFormKey, setCreateFormKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [references, setReferences] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [form] = Form.useForm<DomesticPdpBrief>();

  const loadDetail = useCallback(
    async (id: number) => {
      setDetailLoading(true);
      const result = await domesticPdpApi.detail(id);
      setDetailLoading(false);
      if (result.data) setDetail(result.data);
      else {
        setDetail(null);
        message.error(result.message);
      }
    },
    [message],
  );

  const reloadList = useCallback(async () => {
    const result = await domesticPdpApi.packs();
    if (result.data) setPacks(result.data.list);
    else message.error(result.message);
  }, [message]);

  const refresh = useCallback(async () => {
    setPacksLoading(true);
    const [metaResult, listResult] = await Promise.all([
      domesticPdpApi.meta(),
      domesticPdpApi.packs(),
    ]);
    setPacksLoading(false);
    setMeta(metaResult.data);
    if (metaResult.message) message.error(metaResult.message);
    if (!listResult.data) {
      message.error(listResult.message);
      return;
    }
    setPacks(listResult.data.list);
    const first = listResult.data.list[0]?.id || 0;
    setActiveId((current) => current || first);
  }, [message]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (activeId) void loadDetail(activeId);
  }, [activeId, loadDetail]);

  const heroAssets = useMemo(
    () => detail?.assets.filter((item) => item.kind === "hero") || [],
    [detail],
  );
  const detailAssets = useMemo(
    () => detail?.assets.filter((item) => item.kind === "detail") || [],
    [detail],
  );

  const openCreate = () => {
    setReferences([]);
    // 弹窗未挂载时调用 form 方法会触发「useForm 未连接」告警，改为重建表单回到初始值
    setCreateFormKey((key) => key + 1);
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    let values: DomesticPdpBrief;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setCreating(true);
    try {
      const created = await domesticPdpApi.create({
        ...values,
        referenceUrls: references,
      });
      setCreateOpen(false);
      setDetail(created);
      setActiveId(created.id);
      await reloadList();
      message.success("已创建。点「生成规划」让文本模型出诊断、风格锁与逐张中文文案。");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const runPlan = async () => {
    if (!detail) return;
    setPlanning(true);
    try {
      const next = await domesticPdpApi.plan(detail.id);
      setDetail(next);
      await reloadList();
      message.success("规划完成：请逐张确认中文文案与提示词，再生成图片");
    } catch (error) {
      message.error((error as Error).message);
      await loadDetail(detail.id);
    } finally {
      setPlanning(false);
    }
  };

  const removePack = async () => {
    if (!detail) return;
    try {
      await domesticPdpApi.remove(detail.id);
      setDetail(null);
      setActiveId(0);
      await refresh();
      message.success("图包已删除");
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const uploadReference = async (file: File) => {
    setUploading(true);
    try {
      const result = await uploadContentMedia(file);
      setReferences((current) => [...current, result.url].slice(0, 6));
      message.success("参考图已上传");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const assetsGrid = (list: DomesticPdpAsset[]) =>
    list.length ? (
      <Row gutter={[12, 12]}>
        {list.map((asset) => (
          <Col xs={24} xl={12} key={asset.id}>
            <AssetCard
              packId={detail?.id || 0}
              asset={asset}
              onChanged={setDetail}
              onRefreshList={() => void reloadList()}
            />
          </Col>
        ))}
      </Row>
    ) : (
      <Empty description="这个图包里没有这一类图片" />
    );

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <MetaLine meta={meta} />

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={8}>
          <Panel
            title="图包"
            titleBadge={`${packs.length} 个`}
            extra={
              <Space>
                <Button
                  icon={<ReloadOutlined aria-hidden />}
                  onClick={() => void refresh()}
                >
                  刷新
                </Button>
                <Button
                  type="primary"
                  icon={<PlusOutlined aria-hidden />}
                  onClick={openCreate}
                >
                  新建
                </Button>
              </Space>
            }
          >
            <Spin spinning={packsLoading}>
              {packs.length ? (
                <div style={{ display: "grid", gap: 8 }}>
                  {packs.map((pack) => (
                    <Card
                      key={pack.id}
                      size="small"
                      hoverable
                      onClick={() => setActiveId(pack.id)}
                      style={
                        pack.id === activeId
                          ? { borderColor: "#1677ff", background: "rgba(22,119,255,0.04)" }
                          : undefined
                      }
                    >
                      <Space size={6} wrap>
                        <b>{pack.productName}</b>
                        <Tag color={PACK_STATUS_COLOR[pack.status]}>
                          {PACK_STATUS_LABEL[pack.status] || pack.status}
                        </Tag>
                      </Space>
                      <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}>
                        {pack.platform} · {TONE_LABEL[pack.tone] || pack.tone} · 主图{" "}
                        {pack.heroCount} / 详情 {pack.detailCount} · 已完成{" "}
                        {pack.doneCount}/{pack.totalCount || pack.heroCount + pack.detailCount}
                      </div>
                      <div style={{ marginTop: 2, fontSize: 12, opacity: 0.55 }}>
                        更新于 {fmtTime(pack.updatedAt)}
                      </div>
                    </Card>
                  ))}
                </div>
              ) : (
                <EmptyState text="还没有图包，点右上角「新建」开始。" />
              )}
            </Spin>
          </Panel>
        </Col>

        <Col xs={24} xl={16}>
          {detail ? (
            <Panel
              title={detail.productName}
              titleBadge={
                <Tag color={PACK_STATUS_COLOR[detail.status]}>
                  {PACK_STATUS_LABEL[detail.status] || detail.status}
                </Tag>
              }
              extra={
                <Space wrap>
                  <Popconfirm
                    title="重新生成规划？"
                    description="会重建全部图片清单，已生成的图随之失效。"
                    onConfirm={() => void runPlan()}
                    okText="重新规划"
                  >
                    <Button
                      icon={<ReloadOutlined aria-hidden />}
                      loading={planning}
                    >
                      重新规划
                    </Button>
                  </Popconfirm>
                  <Popconfirm
                    title="删除这个图包？"
                    description="台账与已生成图片记录一并删除，不可恢复。"
                    onConfirm={() => void removePack()}
                    okText="删除"
                  >
                    <Button danger icon={<DeleteOutlined aria-hidden />}>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              }
            >
              <Spin spinning={detailLoading || planning}>
                {detail.plan ? (
                  <PlanBrief plan={detail.plan} />
                ) : (
                  <Notice variant="info">
                    这个图包还没有规划。点右上角「重新规划」，文本模型会给出转化诊断、
                    风格锁与每张图的中文文案和场景。
                  </Notice>
                )}
                <Space wrap style={{ marginTop: 12 }}>
                  <Button
                    type="primary"
                    icon={<ThunderboltOutlined aria-hidden />}
                    loading={planning}
                    onClick={() => void runPlan()}
                  >
                    {detail.plan ? "按当前简报重新规划" : "生成规划"}
                  </Button>
                  <span style={{ opacity: 0.7 }}>
                    简报：{detail.platform} · {TONE_LABEL[detail.tone] || detail.tone} ·{" "}
                    {detail.input.compliance === false ? "普通合规" : "严格合规（广告法）"}
                    {" · 图面不出现价格"}
                  </span>
                </Space>

                {String(detail.input.shotPlan || "") ? (
                  <div
                    style={{
                      marginTop: 12,
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid var(--line, #f0f0f0)",
                      whiteSpace: "pre-wrap",
                      lineHeight: 1.7,
                      fontSize: 12,
                    }}
                  >
                    逐张内容说明（按序号对应生成）：
                    {String(detail.input.shotPlan)}
                  </div>
                ) : null}

                <div style={{ marginTop: 16 }}>
                  <Tabs
                    defaultActiveKey="hero"
                    items={[
                      {
                        key: "hero",
                        label: `主图 ${heroAssets.length}`,
                        children: assetsGrid(heroAssets),
                      },
                      {
                        key: "detail",
                        label: `详情页 ${detailAssets.length}`,
                        children: assetsGrid(detailAssets),
                      },
                    ]}
                  />
                </div>
              </Spin>
            </Panel>
          ) : (
            <Panel title="商品页优化详情">
              <Empty description="从左侧选一个图包，或点「新建」开始" />
            </Panel>
          )}
        </Col>
      </Row>

      <Modal
        title="新建国内电商商品页优化"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void submitCreate()}
        confirmLoading={creating}
        okText="创建"
        width={880}
        destroyOnHidden
      >
        <Form
          key={createFormKey}
          form={form}
          layout="vertical"
          initialValues={{
            platform: "淘宝/天猫",
            tone: "brand",
            compliance: true,
            heroCount: 5,
            detailCount: 8,
            shotPlan: "",
          }}
        >
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item
                name="productName"
                label="商品名称"
                rules={[{ required: true, message: "请填写商品名称" }]}
              >
                <Input maxLength={120} placeholder="如：真空保温杯 500ml" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="category" label="品类">
                <Input maxLength={64} placeholder="如：家居 / 3C / 美妆 / 服饰 / 食品" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="platform" label="平台">
                <Select options={PLATFORM_OPTIONS.map((item) => ({ value: item, label: item }))} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="tone" label="文案语气">
                <Select options={TONE_OPTIONS} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="audience" label="目标人群">
                <Input maxLength={200} placeholder="如：25-40 岁通勤上班族 / 新手宝妈" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="price"
                label="价格（仅规划参考，图面不出现价格）"
                tooltip="国内平台在价格区展示价格，图内写死容易与实际不一致，因此出图一律不渲染价格"
              >
                <Input maxLength={64} placeholder="如：到手价 89 元；图面不会出现这行字" />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item
                name="sellingPoints"
                label="卖点（有就填，没有让 AI 按品类推导并标注推断）"
              >
                <Input.TextArea rows={2} maxLength={2000} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="specs" label="规格参数 / 材质成分（图面数据的唯一来源）">
                <Input.TextArea rows={2} maxLength={2000} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="evidence"
                label="证据（资质 / 检测 / 售后；没有就留空，图面不画假徽章）"
              >
                <Input.TextArea rows={2} maxLength={2000} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="promo" label="优惠与权益（留空则图面不出现优惠）">
                <Input.TextArea rows={2} maxLength={500} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="difference" label="与同类产品的差异（不点名竞品）">
                <Input.TextArea rows={2} maxLength={1000} />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item
                name="shotPlan"
                label="逐张内容说明（可选：主图1 / 主图2 / 详情图1 …，按序号逐张生成）"
                tooltip={
                  '每行一张：「主图N」对应第 N 张主图，「详情图N」对应第 N 张详情页。填了就严格按顺序逐张对应，不会重排、合并或换主题；条数少于数量时后面的图按场景规则补齐，多于数量时多余部分写进假设披露。说明中的价格仍不进图面，绝对化用语等广告法禁用词一律不会出现在文案里。'
                }
              >
                <Input.TextArea
                  rows={5}
                  maxLength={4000}
                  placeholder={
                    "示例（每行一张，序号即生成顺序）：\n主图1：白底正面图，产品居中占 75%，顶部中央与左上留空给平台价格区和 logo 区\n主图2：倒入热水冒热气，突出「一早上到晚上都热」\n主图3：杯口内胆微距特写，展示 316 不锈钢材质\n主图4：尺寸标注，标出 500ml 容量与杯身高度\n详情图1：开场海报，主标题「12 小时保温」\n详情图2：痛点对比，普通杯 2 小时变凉 vs 本品一整天热乎\n详情图3：三层结构爆炸图，标注内胆 / 真空层 / 外壳\n详情图4：规格参数表，容量、重量、材质、口径"
                  }
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="styleName" label="风格偏好（描述性，可留空）">
                <Input maxLength={120} placeholder="如：clean minimal studio / 国潮暖调" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="colorPalette" label="色板偏好（可留空）">
                <Input maxLength={200} placeholder="如：#0E7C66 / #F5F1E8 / #2D2D2D" />
              </Form.Item>
            </Col>
            <Col xs={8} md={4}>
              <Form.Item
                name="heroCount"
                label="主图数量"
                rules={[
                  {
                    validator: (_, value) =>
                      Number(value || 0) + Number(form.getFieldValue("detailCount") || 0) > 0
                        ? Promise.resolve()
                        : Promise.reject(new Error("主图与详情页不能同时为 0")),
                  },
                ]}
              >
                <InputNumber min={0} max={10} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={8} md={4}>
              <Form.Item
                name="detailCount"
                label="详情页数量"
                rules={[
                  {
                    validator: (_, value) =>
                      Number(value || 0) + Number(form.getFieldValue("heroCount") || 0) > 0
                        ? Promise.resolve()
                        : Promise.reject(new Error("主图与详情页不能同时为 0")),
                  },
                ]}
              >
                <InputNumber min={0} max={20} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={8} md={6}>
              <Form.Item
                name="compliance"
                label="严格合规（广告法）"
                valuePropName="checked"
                tooltip="过滤绝对化用语、无依据功效与虚构销量；推断项会写进假设披露"
              >
                <Switch checkedChildren="开" unCheckedChildren="关" />
              </Form.Item>
            </Col>
          </Row>

          <div style={{ fontWeight: 600, marginBottom: 8 }}>
            产品参考图（可选，最多 6 张；有参考图时出图会锁定产品身份）
          </div>
          <Upload
            listType="picture-card"
            accept="image/*"
            maxCount={6}
            fileList={references.map((url) => ({
              uid: url,
              name: "参考图",
              status: "done" as const,
              url,
            }))}
            customRequest={({ file }) => {
              if (file instanceof File) void uploadReference(file);
            }}
            onRemove={(file) => {
              setReferences((current) => current.filter((url) => url !== file.uid));
            }}
          >
            {references.length >= 6 || uploading ? null : (
              <div>
                <UploadOutlined aria-hidden />
                <div style={{ marginTop: 4 }}>上传</div>
              </div>
            )}
          </Upload>
        </Form>
      </Modal>
    </div>
  );
}