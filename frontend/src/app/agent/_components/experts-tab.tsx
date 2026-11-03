"use client";

import { DeleteOutlined, PlusOutlined, TeamOutlined } from "@ant-design/icons";
import type { ContentAgentExpert } from "@enterprise/contracts";
import { App, Button, Empty, Input, Modal, Popconfirm, Skeleton, Tag } from "antd";
import { useCallback, useEffect, useState } from "react";
import { contentApi } from "@/api/content";
import { Notice, Panel } from "@/components/ui/panel";

/** 新建专家的默认指令：用户只需把 XXX 换成自己的领域与经验。 */
const INSTRUCTION_TEMPLATE =
  "帮我创建一个XXX专家、擅长XXXXX。我的经验是：[请补充你的行业背景、相关经验]";

/**
 * Agent 专家：用一段指令生成公共角色，谁创建的专家全站都能直接用；
 * 只有创建人能删；列表按被启用的会话数从多到少排（热度）。
 */
export function AgentExpertsTab({
  onUseExpert,
}: {
  onUseExpert: (expert: ContentAgentExpert) => void;
}) {
  const { message } = App.useApp();
  const [experts, setExperts] = useState<ContentAgentExpert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState(INSTRUCTION_TEMPLATE);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await contentApi.experts();
      setExperts(rows || []);
      setError("");
    } catch (caught) {
      setError((caught as Error).message || "专家列表加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setInstruction(INSTRUCTION_TEMPLATE);
    setOpen(true);
  };

  const create = async () => {
    const text = instruction.trim();
    if (!text) {
      message.warning("请先描述你想要的专家");
      return;
    }
    setCreating(true);
    try {
      const row = await contentApi.createExpert(
        { body: { instruction: text } },
        { timeoutMs: 180000 },
      );
      if (!row) throw new Error("生成专家失败");
      setOpen(false);
      await load();
      message.success(`专家「${row.name}」已创建，所有人都可以使用`);
    } catch (caught) {
      message.error((caught as Error).message || "生成专家失败，请稍后重试");
    } finally {
      setCreating(false);
    }
  };

  const remove = async (expert: ContentAgentExpert) => {
    try {
      await contentApi.removeExpert({ params: { id: String(expert.id) } });
      setExperts((prev) => prev.filter((item) => item.id !== expert.id));
      message.success("已删除");
    } catch (caught) {
      message.error((caught as Error).message || "删除失败");
    }
  };

  return (
    <Panel
      title="专家"
      titleExtra={
        <span className="text-12 muted">
          全站共用；按使用次数从多到少排序；点卡片直接和这个专家开始新对话
        </span>
      }
      extra={
        <Button icon={<PlusOutlined aria-hidden />} onClick={openCreate}>
          新建专家
        </Button>
      }
    >
      {error ? <Notice variant="error">{error}</Notice> : null}
      {loading ? <Skeleton active paragraph={{ rows: 4 }} /> : null}
      {!loading && !experts.length ? (
        <Empty
          description="还没有专家：点「新建专家」，用一段话描述你想要的专家，生成后所有人都能直接使用"
          image={<TeamOutlined style={{ fontSize: 40, color: "#bfbfbf" }} aria-hidden />}
        />
      ) : null}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 12,
        }}
      >
        {experts.map((expert) => (
          <div
            key={expert.id}
            role="button"
            tabIndex={0}
            onClick={() => onUseExpert(expert)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onUseExpert(expert);
              }
            }}
            style={{
              border: "1px solid #ececf0",
              borderRadius: 10,
              padding: "14px 16px",
              display: "grid",
              gap: 8,
              alignContent: "start",
              minHeight: 132,
              cursor: "pointer",
              background: "#fff",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontWeight: 600,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {expert.name}
              </span>
              {expert.mine ? <Tag color="processing">我的</Tag> : null}
              {expert.mine ? (
                <Popconfirm
                  title="删除这个专家？"
                  description="删除后所有人都不能再使用它；已经开始的会话不受影响。"
                  okText="删除"
                  cancelText="取消"
                  onConfirm={(event) => {
                    event?.stopPropagation();
                    void remove(expert);
                  }}
                >
                  <Button
                    type="text"
                    icon={<DeleteOutlined aria-hidden />}
                    onClick={(event) => event.stopPropagation()}
                  />
                </Popconfirm>
              ) : null}
            </div>
            <div
              className="text-12 muted"
              style={{
                lineHeight: 1.6,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {expert.description || expert.prompt.slice(0, 80)}
            </div>
            <div className="text-12 muted" style={{ marginTop: "auto" }}>
              {`${expert.creatorName || "匿名"} · 使用 ${expert.useCount} 次`}
            </div>
          </div>
        ))}
      </div>

      <Modal
        title="新建专家"
        open={open}
        onCancel={() => {
          if (!creating) setOpen(false);
        }}
        onOk={() => void create()}
        okText="生成专家"
        cancelText="取消"
        confirmLoading={creating}
        maskClosable={!creating}
        width={640}
      >
        <div style={{ display: "grid", gap: 10 }}>
          <div className="text-12 muted">
            用一段话描述你想要的专家，模型会据此生成专家人设；创建后全站任何账号都能直接使用。
          </div>
          <Input.TextArea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            autoSize={{ minRows: 5, maxRows: 10 }}
            maxLength={4000}
            showCount
            placeholder={INSTRUCTION_TEMPLATE}
          />
        </div>
      </Modal>
    </Panel>
  );
}
