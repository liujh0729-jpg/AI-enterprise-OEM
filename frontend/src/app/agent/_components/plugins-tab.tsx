"use client";

import { DeleteOutlined, InboxOutlined } from "@ant-design/icons";
import { App, Button, Empty, Popconfirm, Skeleton, Switch, Tag, Upload } from "antd";
import { useCallback, useEffect, useState } from "react";
import type { ContentAgentPlugin } from "@enterprise/contracts";
import { contentApi, importPluginPackage } from "@/api/content";
import { Notice, Panel, TabStrip } from "@/components/ui/panel";
import { PluginCenterPanel } from "./plugin-center-tab";

const PLUGIN_TABS = [
  { key: "center", label: "插件中心" },
  { key: "mine", label: "我的插件" },
];

/** 插件页：SkillHub 插件目录与账号自有插件（zip 上传）两个页签。 */
export function AgentPluginsTab() {
  const [tab, setTab] = useState<"mine" | "center">("center");
  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: 12,
        }}
      >
        <TabStrip
          items={PLUGIN_TABS}
          value={tab}
          onChange={(key) => setTab(key as "mine" | "center")}
        />
      </div>
      {tab === "mine" ? (
        <MyPluginsPanel />
      ) : (
        <PluginCenterPanel onInstalled={() => setTab("mine")} />
      )}
    </>
  );
}

/**
 * Agent 插件：一个插件包＝plugin.json（或 .claude-plugin/plugin.json）里的名称与说明，
 * 加上 PLUGIN.md / README.md 正文与包内其余文本文件；同名插件重传即覆盖更新。
 * 也可以从「插件中心」安装，README 直接存成插件正文。页面上只能启停与删除。
 */
function MyPluginsPanel() {
  const { message } = App.useApp();
  const [plugins, setPlugins] = useState<ContentAgentPlugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [toggling, setToggling] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await contentApi.plugins();
      setPlugins(rows || []);
      setError("");
    } catch (caught) {
      setError((caught as Error).message || "插件加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (file: File) => {
    if (!/\.zip$/i.test(file.name)) {
      message.error("请上传 .zip 插件包");
      return;
    }
    setImporting(true);
    try {
      const row = await importPluginPackage(file);
      message.success(
        row
          ? `已导入插件「${row.name}」${row.fileCount ? `（含 ${row.fileCount} 个附件）` : ""}`
          : "已导入插件包",
      );
      await load();
    } catch (caught) {
      message.error((caught as Error).message || "插件包导入失败");
    } finally {
      setImporting(false);
    }
  };

  const toggle = async (plugin: ContentAgentPlugin, enabled: boolean) => {
    setToggling(plugin.id);
    try {
      const row = await contentApi.togglePlugin({
        params: { id: String(plugin.id) },
        body: { enabled },
      });
      if (row) {
        setPlugins((prev) =>
          prev.map((item) => (item.id === row.id ? row : item)),
        );
      }
    } catch (caught) {
      message.error((caught as Error).message || "操作失败");
    } finally {
      setToggling(0);
    }
  };

  const remove = async (id: number) => {
    try {
      await contentApi.removePlugin({ params: { id: String(id) } });
      message.success("插件已删除");
      await load();
    } catch (caught) {
      message.error((caught as Error).message || "删除失败");
    }
  };

  return (
    <Panel
      title="我的插件"
      titleExtra={
        <span className="text-12 muted">
          zip 包根目录放 plugin.json（可带 skills/、commands/ 等文本文件）或 PLUGIN.md；同名重传即更新。说明进系统提示，包内 commands/*.md 会展开成插件命令，模型用 run_plugin_command 照着跑业务（只读文本，不执行脚本）
        </span>
      }
      extra={
        <Upload
          accept=".zip"
          showUploadList={false}
          beforeUpload={(file) => {
            void upload(file as File);
            return false;
          }}
        >
          <Button type="primary" icon={<InboxOutlined aria-hidden />} loading={importing}>
            上传插件包
          </Button>
        </Upload>
      }
    >
      {error ? <Notice variant="error">{error}</Notice> : null}
      {loading ? <Skeleton active paragraph={{ rows: 4 }} /> : null}
      {!loading && !plugins.length ? (
        <Empty description="还没有插件。到「插件中心」安装，或上传一个 zip 插件包：根目录放 plugin.json（name/description），可再用 PLUGIN.md 写说明。" />
      ) : null}
      {!loading && plugins.length ? (
        <div style={{ display: "grid", gap: 10 }}>
          {plugins.map((plugin) => (
            <div
              key={plugin.id}
              style={{
                border: "1px solid var(--line, #f0f0f0)",
                borderRadius: 10,
                padding: "10px 12px",
                display: "grid",
                gap: 6,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <strong>{plugin.name}</strong>
                <Tag color={plugin.enabled ? "success" : "default"}>
                  {plugin.enabled ? "启用中" : "已停用"}
                </Tag>
                {plugin.source === "skillhub" ? (
                  <Tag color="blue">
                    {plugin.sourceSlug ? `SkillHub · ${plugin.sourceSlug}` : "SkillHub"}
                  </Tag>
                ) : (
                  <Tag>本地上传</Tag>
                )}
                {plugin.fileCount ? <Tag>含 {plugin.fileCount} 个附件</Tag> : null}
                <span style={{ flex: 1 }} />
                <Switch
                  size="small"
                  checked={plugin.enabled}
                  loading={toggling === plugin.id}
                  onChange={(enabled) => void toggle(plugin, enabled)}
                />
                <Popconfirm
                  title="删除这个插件？"
                  okText="删除"
                  cancelText="取消"
                  onConfirm={() => void remove(plugin.id)}
                >
                  <Button danger icon={<DeleteOutlined aria-hidden />}>
                    删除
                  </Button>
                </Popconfirm>
              </div>
              {plugin.description ? (
                <span className="text-12 muted">{plugin.description}</span>
              ) : null}
              {plugin.content ? (
                <span className="text-12 muted" style={{ whiteSpace: "pre-wrap" }}>
                  {plugin.content.slice(0, 160)}
                  {plugin.content.length > 160 ? "…" : ""}
                </span>
              ) : null}
              {plugin.commands.length ? (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <span className="text-12 muted">插件命令</span>
                  {plugin.commands.map((command) => (
                    <Tag
                      key={command.path}
                      color="geekblue"
                      title={command.description || command.path}
                      style={{ marginInlineEnd: 0 }}
                    >
                      {`/${command.name}`}
                    </Tag>
                  ))}
                  <span className="text-12 muted">
                    对话里说「用 {plugin.name} 跑 /{plugin.commands[0]?.name} …」，模型会自己展开命令把业务跑下去
                  </span>
                </div>
              ) : null}
              {plugin.files.length ? (
                <span className="text-12 muted">附件：{plugin.files.map((file) => file.path).join("、")}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}