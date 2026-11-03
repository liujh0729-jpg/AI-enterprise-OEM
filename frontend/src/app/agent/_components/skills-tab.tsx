"use client";

import { DeleteOutlined, InboxOutlined } from "@ant-design/icons";
import { App, Button, Empty, Popconfirm, Skeleton, Switch, Tag, Upload } from "antd";
import { useCallback, useEffect, useState } from "react";
import type { ContentAgentSkill } from "@enterprise/contracts";
import { contentApi, importSkillPackage } from "@/api/content";
import { Notice, Panel, TabStrip } from "@/components/ui/panel";
import { SkillCenterPanel } from "./skill-center-tab";

const SKILL_TABS = [
  { key: "center", label: "技能中心" },
  { key: "mine", label: "我的技能" },
];

/** 技能页：SkillHub 技能中心与账号自有技能（zip 上传）两个页签。 */
export function AgentSkillsTab() {
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
          items={SKILL_TABS}
          value={tab}
          onChange={(key) => setTab(key as "mine" | "center")}
        />
      </div>
      {tab === "mine" ? (
        <MySkillsPanel />
      ) : (
        <SkillCenterPanel onInstalled={() => setTab("mine")} />
      )}
    </>
  );
}

/**
 * Agent 技能（照附件的 SKILL.md 规范）：技能只有一个来源——上传 zip 技能包。
 * 包内根目录要有 SKILL.md（frontmatter 的 name/description 优先），references/ 等文本文件一并带进来；
 * 同名技能重传即覆盖更新。页面上只能启停与删除，不提供手写正文的入口。
 */
function MySkillsPanel() {
  const { message } = App.useApp();
  const [skills, setSkills] = useState<ContentAgentSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [toggling, setToggling] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await contentApi.skills();
      setSkills(rows || []);
      setError("");
    } catch (caught) {
      setError((caught as Error).message || "技能加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (file: File) => {
    if (!/\.zip$/i.test(file.name)) {
      message.error("请上传 .zip 技能包");
      return;
    }
    setImporting(true);
    try {
      const row = await importSkillPackage(file);
      message.success(
        row
          ? `已导入技能「${row.name}」${row.fileCount ? `（含 ${row.fileCount} 个附件）` : ""}`
          : "已导入技能包",
      );
      await load();
    } catch (caught) {
      message.error((caught as Error).message || "技能包导入失败");
    } finally {
      setImporting(false);
    }
  };

  const toggle = async (skill: ContentAgentSkill, enabled: boolean) => {
    setToggling(skill.id);
    try {
      const row = await contentApi.toggleSkill({
        params: { id: String(skill.id) },
        body: { enabled },
      });
      if (row) {
        setSkills((prev) => prev.map((item) => (item.id === row.id ? row : item)));
      }
    } catch (caught) {
      message.error((caught as Error).message || "操作失败");
    } finally {
      setToggling(0);
    }
  };

  const remove = async (id: number) => {
    try {
      await contentApi.removeSkill({ params: { id: String(id) } });
      message.success("技能已删除");
      await load();
    } catch (caught) {
      message.error((caught as Error).message || "删除失败");
    }
  };

  return (
    <Panel
      title="我的技能"
      titleExtra={
        <span className="text-12 muted">
          zip 包根目录放 SKILL.md（可带 references/ 等文本文件）；同名重传即更新。说明会进系统提示，模型要用时读全文
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
            上传技能包
          </Button>
        </Upload>
      }
    >
      {error ? <Notice variant="error">{error}</Notice> : null}
      {loading ? <Skeleton active paragraph={{ rows: 4 }} /> : null}
      {!loading && !skills.length ? (
        <Empty description="还没有技能。上传一个 zip 技能包：根目录放 SKILL.md，写清技能名称、一句话说明与正文。" />
      ) : null}
      {!loading && skills.length ? (
        <div style={{ display: "grid", gap: 10 }}>
          {skills.map((skill) => (
            <div
              key={skill.id}
              style={{
                border: "1px solid var(--line, #f0f0f0)",
                borderRadius: 10,
                padding: "10px 12px",
                display: "grid",
                gap: 6,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <strong>{skill.name}</strong>
                <Tag color={skill.enabled ? "success" : "default"}>
                  {skill.enabled ? "启用中" : "已停用"}
                </Tag>
                {skill.fileCount ? <Tag>含 {skill.fileCount} 个附件</Tag> : null}
                <span style={{ flex: 1 }} />
                <Switch
                  size="small"
                  checked={skill.enabled}
                  loading={toggling === skill.id}
                  onChange={(enabled) => void toggle(skill, enabled)}
                />
                <Popconfirm
                  title="删除这个技能？"
                  okText="删除"
                  cancelText="取消"
                  onConfirm={() => void remove(skill.id)}
                >
                  <Button danger icon={<DeleteOutlined aria-hidden />}>
                    删除
                  </Button>
                </Popconfirm>
              </div>
              {skill.description ? (
                <span className="text-12 muted">{skill.description}</span>
              ) : null}
              {skill.content ? (
                <span className="text-12 muted" style={{ whiteSpace: "pre-wrap" }}>
                  {skill.content.slice(0, 160)}
                  {skill.content.length > 160 ? "…" : ""}
                </span>
              ) : null}
              {skill.files.length ? (
                <span className="text-12 muted">附件：{skill.files.map((file) => file.path).join("、")}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}
