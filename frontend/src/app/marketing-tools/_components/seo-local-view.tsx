"use client";

import { App, Button, Form, Input, InputNumber, Modal, Select, Space, Table, Tag } from "antd";
import { useState } from "react";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { EmptyState, Notice, Panel, StatCard, StatGrid } from "@/components/ui/panel";
import { fmtDateTime } from "@/lib/datetime";
import { useSeoActions, useSeoLocalEstimate, useSeoLocalGrid, useSeoLocalTrackers, useSeoSettings } from "@/query/seo";
import { presentMutationError } from "@/query/errors";
import { CostHint, NoSourceNotice, fmtNum, fmtPos, type SeoLocalGrid, type SeoLocalTracker, type SeoProject } from "./seo-common";

const rankColor = (rank: number | null): string => {
  if (rank === null) return "#f5f5f5";
  if (rank === 1) return "#52c41a";
  if (rank <= 3) return "#95de64";
  if (rank <= 10) return "#ffd666";
  return "#ff7875";
};

/** 本地 SEO：以门店为中心 3×3 / 5×5 网格 Maps SERP 实测，热力图看本地排名覆盖。 */
export function SeoLocalView({ project }: { project: SeoProject }) {
  const { message } = App.useApp();
  const actions = useSeoActions();
  const { request, modal } = usePasswordConfirm();
  const settingsQuery = useSeoSettings();
  const providerConnected = (settingsQuery.data ?? []).some((r) => r.code === "dataforseo" && r.connected);
  const query = useSeoLocalTrackers(project.id);
  const trackers = query.data ?? [];
  const [selected, setSelected] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const openCreate = () => {
    form.setFieldsValue({ businessName: project.brandName || "", keyword: "", centerLat: 0, centerLng: 0, gridSize: 3, radiusKm: 5 });
    setFormOpen(true);
  };
  const save = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const t = await actions.createLocalTracker.mutateAsync({
        body: { projectId: project.id, businessName: values.businessName, keyword: values.keyword, centerLat: values.centerLat, centerLng: values.centerLng, gridSize: values.gridSize ?? 3, radiusKm: values.radiusKm ?? 5 },
      });
      message.success("本地跟踪器已创建");
      setFormOpen(false);
      if (t?.id) setSelected(t.id);
    } catch (error) {
      if (error instanceof Error) presentMutationError(error, (t) => message.error(t));
    } finally { setSaving(false); }
  };
  const remove = (t: SeoLocalTracker) => {
    request({ title: "删除本地跟踪器", danger: true, okText: "确认删除", content: `确认删除「${t.businessName} · ${t.keyword}」？`, onOk: async () => { await actions.removeLocalTracker.mutateAsync({ body: { id: t.id } }); message.success("已删除"); if (selected === t.id) setSelected(0); } });
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {!providerConnected ? <NoSourceNotice>本地 SEO 网格需要 DataForSEO Key（Maps SERP 实测，你付费）。未配置时不造假网格排名。</NoSourceNotice> : null}
      <Panel title="本地跟踪器" extra={<Button type="primary" onClick={openCreate}>＋ 新建本地跟踪器</Button>}>
        {query.isError ? <Notice variant="warn">{query.error?.message}</Notice> : null}
        <Table
          rowKey="id"
          size="small"
          loading={query.isPending}
          dataSource={trackers}
          pagination={false}
          onRow={(r) => ({ onClick: () => setSelected(r.id), style: { cursor: "pointer", background: r.id === selected ? "var(--fill-2, #fafafa)" : undefined } })}
          columns={[
            { title: "门店", dataIndex: "businessName", ellipsis: true },
            { title: "关键词", dataIndex: "keyword", ellipsis: true },
            { title: "中心坐标", width: 180, render: (_: unknown, t: SeoLocalTracker) => `${t.centerLat.toFixed(4)}, ${t.centerLng.toFixed(4)}` },
            { title: "网格", dataIndex: "gridSize", width: 80, render: (v: number) => `${v}×${v}` },
            { title: "半径(km)", dataIndex: "radiusKm", width: 90 },
            { title: "操作", width: 70, render: (_: unknown, t: SeoLocalTracker) => <Button size="small" type="link" danger onClick={(e) => { e.stopPropagation(); remove(t); }}>删除</Button> },
          ]}
          locale={{ emptyText: <EmptyState text="尚无本地跟踪器：新建后填门店名、关键词与中心经纬度，跑网格检查" /> }}
        />
      </Panel>
      {selected > 0 ? <LocalGridPanel trackerId={selected} providerConnected={providerConnected} /> : null}

      <Modal open={formOpen} title="新建本地跟踪器" okText="创建" confirmLoading={saving} onCancel={() => setFormOpen(false)} onOk={() => void save()}>
        <Form form={form} layout="vertical">
          <Form.Item name="businessName" label="门店名 *" rules={[{ required: true, message: "请填写门店名" }]}><Input placeholder="如：星链咖啡（国贸店）" /></Form.Item>
          <Form.Item name="keyword" label="本地关键词 *" rules={[{ required: true, message: "请填写关键词" }]}><Input placeholder="如：咖啡 / coffee shop" /></Form.Item>
          <div className="form-2col">
            <Form.Item name="centerLat" label="中心纬度 *" rules={[{ required: true, message: "请填写纬度" }]}><InputNumber min={-90} max={90} step={0.0001} style={{ width: "100%" }} /></Form.Item>
            <Form.Item name="centerLng" label="中心经度 *" rules={[{ required: true, message: "请填写经度" }]}><InputNumber min={-180} max={180} step={0.0001} style={{ width: "100%" }} /></Form.Item>
          </div>
          <div className="form-2col">
            <Form.Item name="gridSize" label="网格规模"><Select options={[{ value: 3, label: "3×3（9 点）" }, { value: 5, label: "5×5（25 点）" }]} /></Form.Item>
            <Form.Item name="radiusKm" label="半径（km，0.5–50）"><InputNumber min={0.5} max={50} step={0.5} style={{ width: "100%" }} /></Form.Item>
          </div>
        </Form>
      </Modal>
      {modal}
    </div>
  );
}

function LocalGridPanel({ trackerId, providerConnected }: { trackerId: number; providerConnected: boolean }) {
  const { message } = App.useApp();
  const actions = useSeoActions();
  const estimateQuery = useSeoLocalEstimate(trackerId);
  const gridQuery = useSeoLocalGrid(trackerId);
  const [busy, setBusy] = useState(false);
  const grid: SeoLocalGrid | null = gridQuery.data ?? null;
  const estimate = estimateQuery.data;

  const run = async () => {
    setBusy(true);
    try {
      await actions.runLocalCheck.mutateAsync({ body: { trackerId } });
      message.success("网格检查完成");
      void gridQuery.refetch();
    } catch (error) {
      if (error instanceof Error) presentMutationError(error, (t) => message.error(t));
    } finally { setBusy(false); }
  };

  const size = grid?.gridSize ?? 3;
  const pointAt = (row: number, col: number) => grid?.points.find((p) => p.row === row && p.col === col);

  return (
    <Panel
      title={`本地网格 #${trackerId}`}
      extra={<Space><Button loading={busy} disabled={!providerConnected} onClick={() => void run()}>跑网格检查</Button><Button onClick={() => { void gridQuery.refetch(); void estimateQuery.refetch(); }}>刷新</Button></Space>}
    >
      {estimate ? <CostHint calls={estimate.calls} estimatedUsd={estimate.estimatedUsd} note={estimate.note} /> : null}
      {!grid ? (
        <EmptyState text={gridQuery.isPending ? "正在加载网格…" : "暂无网格结果：点「跑网格检查」实测本地排名"} />
      ) : (
        <div style={{ display: "grid", gap: 16, marginTop: 12 }}>
          <StatGrid>
            <StatCard label="平均排名" value={fmtPos(grid.stats.avgRank)} />
            <StatCard label="第 1 名点数" value={fmtNum(grid.stats.top1)} />
            <StatCard label="前 3 名点数" value={fmtNum(grid.stats.top3)} />
            <StatCard label="覆盖" value={`${grid.stats.covered}/${grid.stats.total}`} />
          </StatGrid>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${size}, 56px)`, gap: 6, justifyContent: "start" }}>
            {Array.from({ length: size }).map((_, row) =>
              Array.from({ length: size }).map((__, col) => {
                const p = pointAt(row, col);
                return (
                  <div key={`${row}-${col}`} title={p ? `排名 ${fmtPos(p.rank)} · ${p.lat.toFixed(3)},${p.lng.toFixed(3)}` : "无数据"} style={{ width: 56, height: 56, borderRadius: 8, background: rankColor(p?.rank ?? null), display: "grid", placeItems: "center", color: "#fff", fontWeight: 600, textShadow: "0 0 2px rgba(0,0,0,.4)" }}>
                    {p?.rank ?? "—"}
                  </div>
                );
              }),
            )}
          </div>
          <Space wrap className="text-12 muted">
            <span><Tag color="#52c41a">1</Tag>第 1</span>
            <span><Tag color="#95de64">2–3</Tag>前 3</span>
            <span><Tag color="#ffd666">4–10</Tag>前 10</span>
            <span><Tag color="#ff7875">10+</Tag>10 名外</span>
            <span><Tag color="#f5f5f5">—</Tag>未上榜</span>
          </Space>
          {grid.checkedAt ? <p className="text-12 muted">检查时间：{fmtDateTime(grid.checkedAt)}</p> : null}
          <Panel title="中心点结果">
            <Table rowKey={(r) => `${r.name}|${r.rank}`} size="small" dataSource={grid.centerResults} pagination={false} columns={[{ title: "商家", dataIndex: "name", ellipsis: true }, { title: "排名", dataIndex: "rank", width: 80 }, { title: "地址", dataIndex: "address", ellipsis: true }]} locale={{ emptyText: "无中心点结果" }} />
          </Panel>
        </div>
      )}
    </Panel>
  );
}