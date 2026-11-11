"use client";

import { AppstoreOutlined, RightOutlined } from "@ant-design/icons";
import { App, Button, Input, Select, Skeleton, Space, Tag } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { HwModel } from "@enterprise/contracts";
import { hardwareApi } from "@/api/hardware";
import {
  EmptyState,
  Notice,
  PageHero,
  Panel,
  PillTabs,
} from "@/components/ui/panel";
import { RawImg } from "@/components/ui/raw-img";
import { ModelDetailDrawer } from "./_components/model-detail-drawer";

export default function HardwarePlazaPage() {
  const { message } = App.useApp();
  const [models, setModels] = useState<HwModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState("ALL");
  const [featured, setFeatured] = useState("ALL");
  const [activeCode, setActiveCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await hardwareApi.models({ query: {} });
      setModels(data?.models ?? []);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : "硬件广场加载失败";
      setError(text);
      message.error(text);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(
    () => Array.from(new Set(models.map((item) => item.category).filter(Boolean))),
    [models],
  );

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return models.filter((item) => {
      if (category !== "ALL" && item.category !== category) return false;
      if (featured === "FEATURED" && !item.featured) return false;
      if (!kw) return true;
      return [item.name, item.code, item.vendor, item.chip, item.summary]
        .join(" ")
        .toLowerCase()
        .includes(kw);
    });
  }, [models, keyword, category, featured]);

  return (
    <>
      <PageHero
        title="硬件广场"
        desc="浏览平台支持的硬件型号，下载配套开发包（SDK / 固件），烧录后到「添加硬件」生成设备令牌接入。型号默认工具与本人自建工具在「硬件MCP / 硬件API」按型号查看。"
      />

      <Panel
        title="型号目录"
        extra={
          <Space wrap>
            <Input.Search
              allowClear
              placeholder="搜索型号 / 厂商 / 芯片"
              style={{ width: 220 }}
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            <Select
              style={{ width: 140 }}
              value={category}
              onChange={setCategory}
              options={[
                { value: "ALL", label: "全部分类" },
                ...categories.map((item) => ({ value: item, label: item })),
              ]}
            />
            <PillTabs
              value={featured}
              onChange={setFeatured}
              items={[
                { key: "ALL", label: "全部" },
                { key: "FEATURED", label: "推荐" },
              ]}
            />
          </Space>
        }
      >
        {error ? <Notice variant="error">{error}</Notice> : null}
        {loading ? <Skeleton active paragraph={{ rows: 6 }} /> : null}
        {!loading && !filtered.length ? (
          <EmptyState
            icon={<AppstoreOutlined style={{ fontSize: 40 }} aria-hidden />}
            text={models.length ? "没有符合条件的型号，换个关键词或分类试试。" : "平台暂未上架硬件型号，请联系管理员。"}
          />
        ) : null}
        {!loading && filtered.length ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 12,
              marginTop: 12,
            }}
          >
            {filtered.map((item) => (
              <div
                key={item.id}
                className="card"
                style={{ padding: 0, overflow: "hidden", cursor: "pointer", display: "flex", flexDirection: "column" }}
                onClick={() => setActiveCode(item.code)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setActiveCode(item.code);
                  }
                }}
              >
                <div
                  style={{
                    height: 140,
                    background: "var(--fill-quaternary, #f5f5f5)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                  }}
                >
                  {item.coverUrl ? (
                    <RawImg src={item.coverUrl} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <AppstoreOutlined style={{ fontSize: 44, opacity: 0.35 }} aria-hidden />
                  )}
                </div>
                <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                  <Space size={6} wrap>
                    <span style={{ fontWeight: 600 }}>{item.name}</span>
                    {item.featured ? <Tag color="gold">推荐</Tag> : null}
                  </Space>
                  <span className="mono text-12 muted">{item.code}</span>
                  <Space size={4} wrap>
                    {item.vendor ? <Tag>{item.vendor}</Tag> : null}
                    {item.chip ? <Tag color="blue">{item.chip}</Tag> : null}
                    {item.category ? <Tag>{item.category}</Tag> : null}
                  </Space>
                  {item.summary ? (
                    <p
                      className="text-12 muted"
                      style={{
                        margin: 0,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {item.summary}
                    </p>
                  ) : null}
                  <div style={{ marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span className="text-12 muted">开发包 {item.kitCount} · 我的设备 {item.deviceCount}</span>
                    <Button size="small" type="link" icon={<RightOutlined aria-hidden />} iconPlacement="end">
                      详情
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </Panel>

      <ModelDetailDrawer code={activeCode} onClose={() => setActiveCode(null)} />
    </>
  );
}