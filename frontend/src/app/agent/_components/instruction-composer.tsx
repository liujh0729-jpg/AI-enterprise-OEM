"use client";

import type {
  ContentAgentConnector,
  ContentAgentExpert,
  ContentAgentPlugin,
  ContentAgentReference,
  ContentAgentSkill,
} from "@enterprise/contracts";
import {
  ApiOutlined,
  BlockOutlined,
  FileAddOutlined,
  PictureOutlined,
  PlusOutlined,
  TeamOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { App, Button, Checkbox, Input, Popover, Spin, Tag } from "antd";
import type { CSSProperties } from "react";
import { useRef, useState } from "react";
import { uploadContentMedia } from "@/api/content";
import {
  AssetReferencePicker,
  nextReferenceLabel,
  referencesFromAssets,
} from "@/components/content/asset-reference-picker";

const ROW_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "7px 8px",
  border: "none",
  background: "transparent",
  borderRadius: 6,
  cursor: "pointer",
  textAlign: "left",
};

/**
 * 定时任务的「每次执行的指令」输入区：样式照 Agent 的文本输入，
 * 「+」里选技能 / 插件 / 专家 / 参考文件 / MCP 连接器，选中项在输入框上方以标签列出。
 */
export function InstructionComposer({
  value,
  onChange,
  skillIds,
  onSkillIds,
  pluginIds,
  onPluginIds,
  expertId,
  onExpertId,
  connectorIds,
  onConnectorIds,
  references,
  onReferences,
  skills,
  plugins,
  experts,
  connectors,
  loading,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  skillIds: number[];
  onSkillIds: (ids: number[]) => void;
  pluginIds: number[];
  onPluginIds: (ids: number[]) => void;
  expertId: number;
  onExpertId: (id: number) => void;
  connectorIds: number[];
  onConnectorIds: (ids: number[]) => void;
  references: ContentAgentReference[];
  onReferences: (items: ContentAgentReference[]) => void;
  skills: ContentAgentSkill[];
  plugins: ContentAgentPlugin[];
  experts: ContentAgentExpert[];
  connectors: ContentAgentConnector[];
  loading: boolean;
  error: string;
}) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<
    "root" | "references" | "skills" | "plugins" | "experts" | "connectors"
  >("root");
  const [uploading, setUploading] = useState(false);
  const [assetOpen, setAssetOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const toggle = (ids: number[], id: number, checked: boolean) =>
    checked ? [...ids, id] : ids.filter((item) => item !== id);

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    const next = [...references];
    try {
      for (const file of Array.from(files)) {
        try {
          const uploaded = await uploadContentMedia(file);
          const media = String(uploaded.kind || "");
          if (media !== "image" && media !== "video" && media !== "audio") {
            message.warning(
              `${uploaded.name || file.name} 不是图片 / 音频 / 视频，参考文件只收这三类`,
            );
            continue;
          }
          next.push({
            label: nextReferenceLabel(next, media),
            fileName: uploaded.name || file.name,
            url: uploaded.url,
            media,
          });
          onReferences([...next]);
        } catch (caught) {
          message.error((caught as Error).message || "参考文件上传失败");
        }
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const pickedSkills = skills.filter((item) => skillIds.includes(item.id));
  const pickedPlugins = plugins.filter((item) => pluginIds.includes(item.id));
  const pickedExperts = experts.filter((item) => item.id === expertId);
  const pickedConnectors = connectors.filter((item) =>
    connectorIds.includes(item.id),
  );

  const panelBody =
    panel === "root" ? (
      <div style={{ display: "grid", gap: 2, width: 280 }}>
        <button
          type="button"
          style={ROW_STYLE}
          onClick={() => setPanel("skills")}
        >
          <ToolOutlined aria-hidden />
          <span>选择技能</span>
          <span className="text-12 muted" style={{ marginLeft: "auto" }}>
            {skillIds.length ? `已选 ${skillIds.length}` : "全部启用"}
          </span>
        </button>
        <button
          type="button"
          style={ROW_STYLE}
          onClick={() => setPanel("plugins")}
        >
          <BlockOutlined aria-hidden />
          <span>选择插件</span>
          <span className="text-12 muted" style={{ marginLeft: "auto" }}>
            {pluginIds.length ? `已选 ${pluginIds.length}` : "全部启用"}
          </span>
        </button>
        <button
          type="button"
          style={ROW_STYLE}
          onClick={() => setPanel("experts")}
        >
          <TeamOutlined aria-hidden />
          <span>选择专家</span>
          <span className="text-12 muted" style={{ marginLeft: "auto" }}>
            {pickedExperts[0]?.name || "未选"}
          </span>
        </button>
        <button
          type="button"
          style={ROW_STYLE}
          onClick={() => setPanel("references")}
        >
          <FileAddOutlined aria-hidden />
          <span>添加参考文件</span>
          <span className="text-12 muted" style={{ marginLeft: "auto" }}>
            {references.length} 个
          </span>
        </button>
        <button
          type="button"
          style={ROW_STYLE}
          onClick={() => setPanel("connectors")}
        >
          <ApiOutlined aria-hidden />
          <span>选择 MCP 连接器</span>
          <span className="text-12 muted" style={{ marginLeft: "auto" }}>
            {connectorIds.length ? `已选 ${connectorIds.length}` : "全部启用"}
          </span>
        </button>
      </div>
    ) : panel === "references" ? (
      <div style={{ display: "grid", gap: 2, width: 280 }}>
        <button
          type="button"
          style={ROW_STYLE}
          disabled={uploading}
          onClick={() => {
            setOpen(false);
            fileRef.current?.click();
          }}
        >
          <FileAddOutlined aria-hidden />
          <span>从本地上传</span>
          <span className="text-12 muted" style={{ marginLeft: "auto" }}>
            {uploading ? "上传中…" : "图片 / 视频 / 音频"}
          </span>
        </button>
        <button
          type="button"
          style={ROW_STYLE}
          onClick={() => {
            setOpen(false);
            setAssetOpen(true);
          }}
        >
          <PictureOutlined aria-hidden />
          <span>从数字资产选择</span>
          <span className="text-12 muted" style={{ marginLeft: "auto" }}>
            复用已传素材
          </span>
        </button>
        <span className="text-12 muted" style={{ padding: "2px 8px" }}>
          {`本轮已有 ${references.length} 个参考文件；按类型自动编号。`}
        </span>
      </div>
    ) : panel === "skills" ? (
      <div style={{ display: "grid", gap: 8, width: 300 }}>
        {loading ? <Spin size="small" /> : null}
        {error ? (
          <span className="text-12" style={{ color: "#d4380d" }}>
            {error}
          </span>
        ) : null}
        {!loading && !skills.length ? (
          <span className="text-12 muted">
            还没有技能：到 Agent「技能」页签上传 zip 技能包。
          </span>
        ) : null}
        {skills.length ? (
          <div style={{ display: "grid", gap: 4, maxHeight: 220, overflowY: "auto" }}>
            {skills.map((item) => (
              <Checkbox
                key={item.id}
                checked={skillIds.includes(item.id)}
                disabled={!item.enabled}
                onChange={(event) =>
                  onSkillIds(toggle(skillIds, item.id, event.target.checked))
                }
              >
                <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                  {item.name}
                  {!item.enabled ? <Tag style={{ marginInlineEnd: 0 }}>已停用</Tag> : null}
                </span>
              </Checkbox>
            ))}
          </div>
        ) : null}
        <span className="text-12 muted">
          勾选后每次执行只把这些技能交给模型；不勾＝全部启用中的技能。
        </span>
      </div>
    ) : panel === "plugins" ? (
      <div style={{ display: "grid", gap: 8, width: 300 }}>
        {loading ? <Spin size="small" /> : null}
        {error ? (
          <span className="text-12" style={{ color: "#d4380d" }}>
            {error}
          </span>
        ) : null}
        {!loading && !plugins.length ? (
          <span className="text-12 muted">
            还没有插件：到 Agent「插件」页签安装或上传 zip 插件包。
          </span>
        ) : null}
        {plugins.length ? (
          <div style={{ display: "grid", gap: 4, maxHeight: 220, overflowY: "auto" }}>
            {plugins.map((item) => (
              <Checkbox
                key={item.id}
                checked={pluginIds.includes(item.id)}
                disabled={!item.enabled}
                onChange={(event) =>
                  onPluginIds(toggle(pluginIds, item.id, event.target.checked))
                }
              >
                <span
                  style={{
                    display: "inline-flex",
                    flexDirection: "column",
                    gap: 2,
                    maxWidth: 236,
                  }}
                >
                  <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                    {item.name}
                    {!item.enabled ? <Tag style={{ marginInlineEnd: 0 }}>已停用</Tag> : null}
                  </span>
                  {item.commands.length ? (
                    <span className="text-12 muted">
                      命令：{item.commands.map((command) => `/${command.name}`).join(" ")}
                    </span>
                  ) : null}
                </span>
              </Checkbox>
            ))}
          </div>
        ) : null}
        <span className="text-12 muted">
          勾选后每次执行只用这几个插件（含它们的插件命令）；不勾＝全部启用中的插件。
        </span>
      </div>
    ) : panel === "experts" ? (
      <div style={{ display: "grid", gap: 4, width: 300, maxHeight: 260, overflowY: "auto" }}>
        <button type="button" style={ROW_STYLE} onClick={() => onExpertId(0)}>
          <TeamOutlined aria-hidden />
          <span>不使用专家</span>
          {expertId ? null : (
            <span className="text-12 muted" style={{ marginLeft: "auto" }}>
              当前
            </span>
          )}
        </button>
        {experts.map((item) => (
          <button
            key={item.id}
            type="button"
            style={ROW_STYLE}
            onClick={() => onExpertId(item.id)}
          >
            <TeamOutlined aria-hidden />
            <span>{item.name}</span>
            <span className="text-12 muted" style={{ marginLeft: "auto" }}>
              {item.id === expertId ? "当前" : `使用 ${item.useCount} 次`}
            </span>
          </button>
        ))}
        <span className="text-12 muted">选中后每次执行都按这位专家作答。</span>
      </div>
    ) : (
      <div style={{ display: "grid", gap: 8, width: 300 }}>
        {loading ? <Spin size="small" /> : null}
        {error ? (
          <span className="text-12" style={{ color: "#d4380d" }}>
            {error}
          </span>
        ) : null}
        {connectors.length ? (
          <div style={{ display: "grid", gap: 4, maxHeight: 220, overflowY: "auto" }}>
            {connectors.map((item) => (
              <Checkbox
                key={item.id}
                checked={connectorIds.includes(item.id)}
                disabled={!item.enabled}
                onChange={(event) =>
                  onConnectorIds(
                    toggle(connectorIds, item.id, event.target.checked),
                  )
                }
              >
                <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                  {item.name}
                  <span className="text-12 muted">{`${item.toolCount} 个工具`}</span>
                  {!item.enabled ? <Tag style={{ marginInlineEnd: 0 }}>已停用</Tag> : null}
                </span>
              </Checkbox>
            ))}
          </div>
        ) : null}
        <span className="text-12 muted">
          勾选后每次执行只注入这些连接器；不勾＝全部启用中的连接器。
        </span>
      </div>
    );

  return (
    <div className="data-table-form-item" style={{ gridColumn: "1 / -1" }}>
      <span className="data-table-form-label">
        每次执行的指令<b style={{ color: "var(--danger)" }}> *</b>
      </span>
      <div
        style={{
          border: "1px solid var(--line, #e5e6eb)",
          borderRadius: 12,
          padding: 10,
          background: "var(--panel, #fff)",
        }}
      >
        {references.length ||
        skillIds.length ||
        pluginIds.length ||
        expertId ||
        connectorIds.length ? (
          <div
            style={{
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
              marginBottom: 8,
            }}
          >
            {references.map((item) => (
              <Tag
                key={item.url}
                closable
                onClose={(event) => {
                  event.preventDefault();
                  onReferences(references.filter((ref) => ref.url !== item.url));
                }}
              >
                {`${item.label} · ${item.fileName}`}
              </Tag>
            ))}
            {pickedSkills.map((item) => (
              <Tag
                key={`skill-${item.id}`}
                closable
                onClose={(event) => {
                  event.preventDefault();
                  onSkillIds(skillIds.filter((id) => id !== item.id));
                }}
              >
                {`技能：${item.name}`}
              </Tag>
            ))}
            {pickedPlugins.map((item) => (
              <Tag
                key={`plugin-${item.id}`}
                closable
                onClose={(event) => {
                  event.preventDefault();
                  onPluginIds(pluginIds.filter((id) => id !== item.id));
                }}
              >
                {`插件：${item.name}`}
              </Tag>
            ))}
            {pickedExperts[0] ? (
              <Tag
                closable
                onClose={(event) => {
                  event.preventDefault();
                  onExpertId(0);
                }}
              >
                {`专家：${pickedExperts[0].name}`}
              </Tag>
            ) : null}
            {pickedConnectors.map((item) => (
              <Tag
                key={`connector-${item.id}`}
                closable
                onClose={(event) => {
                  event.preventDefault();
                  onConnectorIds(connectorIds.filter((id) => id !== item.id));
                }}
              >
                {`连接器：${item.name}`}
              </Tag>
            ))}
          </div>
        ) : null}
        <Input.TextArea
          value={value}
          autoSize={{ minRows: 4, maxRows: 10 }}
          maxLength={8000}
          placeholder="到点时这段话会作为一轮对话内容发给 Agent；点 + 选技能 / 插件 / 专家 / 参考文件 / MCP 连接器，Enter 只换行"
          onChange={(event) => onChange(event.target.value)}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 8,
          }}
        >
          <Popover
            open={open}
            trigger="click"
            placement="topLeft"
            arrow={false}
            content={panelBody}
            onOpenChange={(next) => {
              setOpen(next);
              if (!next) setPanel("root");
            }}
          >
            <Button
              shape="circle"
              icon={<PlusOutlined aria-hidden />}
              loading={uploading}
              aria-label="选技能、插件、专家、参考文件或 MCP 连接器"
            />
          </Popover>
          {panel !== "root" && open ? (
            <Button
              type="link"
              style={{ padding: 0 }}
              onClick={() => {
                setPanel("root");
                setOpen(true);
              }}
            >
              返回
            </Button>
          ) : null}
          {references.length ? (
            <Button
              type="link"
              style={{ padding: 0 }}
              onClick={() => onReferences([])}
            >
              清空参考文件
            </Button>
          ) : null}
          <span className="text-12 muted" style={{ marginLeft: "auto" }}>
            Enter 换行
          </span>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,audio/*,video/*"
          multiple
          hidden
          onChange={(event) => void addFiles(event.target.files)}
        />
        <AssetReferencePicker
          open={assetOpen}
          existingUrls={references.map((item) => item.url)}
          onCancel={() => setAssetOpen(false)}
          onPick={(assets) => {
            onReferences(referencesFromAssets(references, assets));
            setAssetOpen(false);
            setPanel("root");
          }}
        />
      </div>
    </div>
  );
}