"use client";

import { EditOutlined, DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { App, Button, Input, Modal, Radio, Space, Tag } from "antd";
import {
  CONTENT_AGENT_PERSONA_MAX,
  CONTENT_AGENT_PERSONA_MAX_COUNT,
  CONTENT_AGENT_PERSONA_NAME_MAX,
  CONTENT_AGENT_STYLES,
  type ContentAgentPersona,
} from "@enterprise/contracts";
import { useCallback, useEffect, useState } from "react";
import { contentApi } from "@/api/content";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";

type Draft = { name: string; style: string; persona: string };

const EMPTY: Draft = { name: "", style: "", persona: "" };

const styleLabel = (key: string) =>
  CONTENT_AGENT_STYLES.find((item) => item.key === key)?.label || "不限定风格";

/**
 * 数字分身：一个账号可以建多个（名称 + 风格 + 人设），对话里选择或留「自动」；
 * 所有分身共用「记忆」页签里的那一套长期记忆。
 */
export function AgentPersonaTab() {
  const { message } = App.useApp();
  const [rows, setRows] = useState<ContentAgentPersona[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ContentAgentPersona | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const { request, modal } = usePasswordConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await contentApi.personas();
      setRows(list || []);
      setError("");
    } catch (caught) {
      setError((caught as Error).message || "数字分身读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openEditor = (row: ContentAgentPersona | null) => {
    setEditing(row);
    setDraft(
      row
        ? { name: row.name, style: row.style, persona: row.persona }
        : EMPTY,
    );
    setOpen(true);
  };

  const commit = async (payload: Draft) => {
    if (editing) {
      await contentApi.updatePersona({
        params: { id: String(editing.id) },
        body: payload,
      });
    } else {
      await contentApi.createPersona({ body: payload });
    }
    message.success(editing ? "数字分身已修改" : "数字分身已创建");
    setOpen(false);
    await load();
  };

  const submit = async () => {
    const payload = {
      name: draft.name.trim(),
      style: draft.style,
      persona: draft.persona.trim(),
    };
    if (!payload.name) {
      message.warning("请给数字分身起个名字");
      return;
    }
    setSaving(true);
    try {
      if (!editing) {
        await commit(payload);
        return;
      }
      // 改是敏感动作：先验口令再提交
      request({
        title: "修改数字分身",
        content: "修改数字分身需要输入当前账号密码。",
        okText: "确认修改",
        onOk: () => commit(payload),
      });
    } catch (caught) {
      message.error((caught as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const remove = (row: ContentAgentPersona) => {
    request({
      title: "删除数字分身",
      content: `删除「${row.name}」后，选择它的会话会回到「自动」；历史对话与专题大厅里的发言署名不受影响。`,
      okText: "确认删除",
      danger: true,
      onOk: async () => {
        await contentApi.deletePersona({ params: { id: String(row.id) } });
        message.success("数字分身已删除");
        await load();
      },
    });
  };

  return (
    <Panel
      title="数字分身"
      titleExtra={
        <span className="text-12 muted">
          {`每个分身有自己的风格与人设；长期记忆所有分身共用一套。最多 ${CONTENT_AGENT_PERSONA_MAX_COUNT} 个`}
        </span>
      }
      extra={
        <Button
          type="primary"
          icon={<PlusOutlined aria-hidden />}
          disabled={rows.length >= CONTENT_AGENT_PERSONA_MAX_COUNT}
          onClick={() => openEditor(null)}
        >
          新建分身
        </Button>
      }
    >
      {error ? <Notice variant="error">{error}</Notice> : null}
      {loading ? (
        <div className="text-12 muted">数字分身读取中…</div>
      ) : rows.length ? (
        <div style={{ display: "grid", gap: 12 }}>
          {rows.map((row) => (
            <div key={row.id} className="card" style={{ padding: 16 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <Space size={8} wrap>
                  <span style={{ fontWeight: 600 }}>{row.name}</span>
                  <Tag>{styleLabel(row.style)}</Tag>
                </Space>
                <Space size={8}>
                  <Button
                    icon={<EditOutlined aria-hidden />}
                    onClick={() => openEditor(row)}
                  >
                    编辑
                  </Button>
                  <Button
                    danger
                    icon={<DeleteOutlined aria-hidden />}
                    onClick={() => remove(row)}
                  >
                    删除
                  </Button>
                </Space>
              </div>
              <div className="text-12 muted" style={{ marginTop: 8 }}>
                {row.persona || "还没有写人设，只按上面的风格说话。"}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text="还没有数字分身。建一个之后，「对话」里就能选它，或留「自动」按语义自选。" />
      )}

      <Modal
        open={open}
        title={editing ? "编辑数字分身" : "新建数字分身"}
        okText="保存设置"
        confirmLoading={saving}
        destroyOnHidden
        width={560}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
      >
        <div style={{ display: "grid", gap: 14 }}>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>
              分身名称
            </div>
            <Input
              value={draft.name}
              maxLength={CONTENT_AGENT_PERSONA_NAME_MAX}
              placeholder="例如：品牌助理 / 数据分析师"
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, name: event.target.value }))
              }
            />
          </div>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>
              回复风格
            </div>
            <Radio.Group
              value={draft.style}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, style: event.target.value }))
              }
              style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
            >
              <Radio value="">不限定</Radio>
              {CONTENT_AGENT_STYLES.map((item) => (
                <Radio key={item.key} value={item.key}>
                  {item.label}
                </Radio>
              ))}
            </Radio.Group>
          </div>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>
              人设设定
            </div>
            <Input.TextArea
              value={draft.persona}
              maxLength={CONTENT_AGENT_PERSONA_MAX}
              showCount
              autoSize={{ minRows: 3, maxRows: 8 }}
              placeholder="例如：你是我的品牌助理，熟悉小野这个品牌；遇到不确定的地方先问一句再动手。"
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, persona: event.target.value }))
              }
            />
          </div>
        </div>
      </Modal>
      {modal}
    </Panel>
  );
}