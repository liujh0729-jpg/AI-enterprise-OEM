"use client";

import {
  CheckOutlined,
  CopyOutlined,
  LinkOutlined,
  StopOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  Avatar,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  completeWecomScrmSidebarTask,
  fetchWecomScrmSidebar,
  type WecomScrmSidebar,
  type WecomScrmSidebarField,
  type WecomScrmSidebarTask,
} from "@/api/scrm";
import { MATERIAL_TYPE_LABELS } from "@/app/marketing-tools/_components/scrm-common";

/**
 * 员工侧边栏（企业微信工作台 H5）：不带登录会话，凭 URL 里的 2 小时票据访问。
 * 只显示与当前员工确有好友关系的客户；待办完成后即时从列表移除。
 */

const fmtTime = (value: string) =>
  value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-";

const fieldText = (field: WecomScrmSidebarField) =>
  Array.isArray(field.value) ? field.value.join("、") : field.value || "-";

export default function WecomScrmSidebarPage() {
  const [ticket, setTicket] = useState("");
  const [contactId, setContactId] = useState(0);
  const [data, setData] = useState<WecomScrmSidebar | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [completeTarget, setCompleteTarget] = useState<{
    task: WecomScrmSidebarTask;
    status: "DONE" | "SKIPPED";
  } | null>(null);
  const [result, setResult] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (nextTicket: string, nextContactId: number) => {
    setLoading(true);
    try {
      setData(await fetchWecomScrmSidebar(nextTicket, nextContactId));
      setError("");
    } catch (reason) {
      setError((reason as Error).message || "侧边栏加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextTicket = params.get("ticket") || "";
    const nextContactId = Number(params.get("contactId") || 0);
    setTicket(nextTicket);
    setContactId(Number.isFinite(nextContactId) ? nextContactId : 0);
    if (!nextTicket) {
      setError("缺少侧边栏票据，请从企业微信客户会话重新打开");
      setLoading(false);
      return;
    }
    void load(nextTicket, nextContactId);
  }, [load]);

  const completeTask = async () => {
    if (!completeTarget) return;
    setSaving(true);
    try {
      await completeWecomScrmSidebarTask(ticket, {
        id: completeTarget.task.id,
        status: completeTarget.status,
        result,
      });
      setCompleteTarget(null);
      setResult("");
      await load(ticket, contactId);
    } catch (reason) {
      setError((reason as Error).message || "待办处理失败");
    } finally {
      setSaving(false);
    }
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 企微内置浏览器可能禁止剪贴板，文本仍可直接长按选择
    }
  };

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
        <Spin />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div style={{ padding: 24, textAlign: "center" }}>
        <Typography.Text type="danger">{error}</Typography.Text>
      </div>
    );
  }

  if (!data) return null;

  const contact = data.contact;

  return (
    <div style={{ padding: 12, background: "#f5f6f8", minHeight: "100vh" }}>
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        <Card size="small">
          <Space align="start">
            <Avatar size={48} src={contact?.avatar || undefined} icon={<UserOutlined />} />
            <div>
              <Typography.Text strong style={{ fontSize: 16 }}>
                {contact?.name || contact?.remark || "未选择客户"}
              </Typography.Text>
              <div className="text-12 muted">
                员工：{data.staff.name || data.staff.userId}
                {contact?.sourceCodeName ? ` · 来源：${contact.sourceCodeName}` : ""}
              </div>
              {contact ? (
                <div className="text-12 muted">
                  最近互动：{fmtTime(contact.lastInteractionAt)} · 添加于 {fmtTime(contact.addedAt)}
                </div>
              ) : null}
            </div>
          </Space>
          {data.tags.length ? (
            <Space wrap size={4} style={{ marginTop: 8 }}>
              {data.tags.map((tag) => (
                <Tag key={tag.id} color={tag.color || undefined}>
                  {tag.name}
                </Tag>
              ))}
            </Space>
          ) : null}
          {contact?.remark ? (
            <Typography.Paragraph style={{ margin: "8px 0 0" }} ellipsis={{ rows: 2 }}>
              备注：{contact.remark}
            </Typography.Paragraph>
          ) : null}
          {contact?.description ? (
            <Typography.Paragraph style={{ margin: "4px 0 0" }} ellipsis={{ rows: 3 }}>
              {contact.description}
            </Typography.Paragraph>
          ) : null}
        </Card>

        {contact ? (
          <Card size="small" title="资料卡">
            {data.fields.length ? (
              <Space orientation="vertical" size={6} style={{ width: "100%" }}>
                {data.fields.map((field) => (
                  <div key={field.fieldKey} className="embed-field">
                    <span className="muted">{field.label || field.fieldKey}</span>
                    <span>{fieldText(field)}</span>
                  </div>
                ))}
              </Space>
            ) : (
              <Typography.Text type="secondary">资料卡暂无填写内容</Typography.Text>
            )}
            {data.chats.length ? (
              <div style={{ marginTop: 12 }}>
                <Typography.Text type="secondary">
                  <TeamOutlined aria-hidden /> 所在客户群
                </Typography.Text>
                <Space wrap size={4} style={{ marginTop: 4 }}>
                  {data.chats.map((chat) => (
                    <Tag key={chat.id}>
                      {chat.name}（{chat.memberCount} 人）
                    </Tag>
                  ))}
                </Space>
              </div>
            ) : null}
          </Card>
        ) : (
          <Card size="small">
            <Typography.Text type="secondary">
              从企业微信客户会话打开侧边栏时会自动带入客户资料与资料卡。
            </Typography.Text>
          </Card>
        )}

        <Card size="small" title={`待办 ${data.tasks.length ? `（${data.tasks.length}）` : ""}`}>
          {data.tasks.length ? (
            <Space orientation="vertical" size={10} style={{ width: "100%" }}>
              {data.tasks.map((task) => (
                <div key={task.id} className="embed-task">
                  <div>
                    <Typography.Text strong>{task.sopName || "SOP 待办"}</Typography.Text>
                    <div className="text-12 muted">
                      {task.contactName ? `客户：${task.contactName} · ` : ""}
                      截止 {fmtTime(task.dueAt)}
                    </div>
                  </div>
                  <Space size={4}>
                    <Button
                      size="small"
                      type="primary"
                      icon={<CheckOutlined aria-hidden />}
                      onClick={() => {
                        setResult("");
                        setCompleteTarget({ task, status: "DONE" });
                      }}
                    >
                      完成
                    </Button>
                    <Button
                      size="small"
                      icon={<StopOutlined aria-hidden />}
                      onClick={() => {
                        setResult("");
                        setCompleteTarget({ task, status: "SKIPPED" });
                      }}
                    >
                      跳过
                    </Button>
                  </Space>
                </div>
              ))}
            </Space>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待办" />
          )}
        </Card>

        <Card size="small" title="素材库">
          {data.materials.length ? (
            <Space orientation="vertical" size={10} style={{ width: "100%" }}>
              {data.materials.map((material) => (
                <div key={material.id} className="embed-material">
                  <div>
                    <Space size={4} wrap>
                      <Tag>{MATERIAL_TYPE_LABELS[material.type] ?? material.type}</Tag>
                      <Typography.Text strong>{material.title}</Typography.Text>
                    </Space>
                    {material.content ? (
                      <Typography.Paragraph style={{ margin: "4px 0 0" }} ellipsis={{ rows: 3 }}>
                        {material.content}
                      </Typography.Paragraph>
                    ) : null}
                  </div>
                  <Space size={4}>
                    {material.link ? (
                      <Button
                        size="small"
                        icon={<LinkOutlined aria-hidden />}
                        href={material.link}
                        target="_blank"
                        rel="noreferrer"
                      >
                        打开
                      </Button>
                    ) : null}
                    {material.content ? (
                      <Button
                        size="small"
                        icon={<CopyOutlined aria-hidden />}
                        onClick={() => void copyText(material.content)}
                      >
                        复制
                      </Button>
                    ) : null}
                    {!material.link && !material.content && material.assetId ? (
                      <Typography.Text type="secondary">数字资产 #{material.assetId}</Typography.Text>
                    ) : null}
                  </Space>
                </div>
              ))}
            </Space>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="素材库为空" />
          )}
        </Card>
      </Space>

      <Modal
        title={completeTarget?.status === "DONE" ? "完成待办" : "跳过待办"}
        open={Boolean(completeTarget)}
        confirmLoading={saving}
        okText="确认"
        onOk={() => void completeTask()}
        onCancel={() => setCompleteTarget(null)}
      >
        <Typography.Paragraph type="secondary">
          {completeTarget?.status === "DONE"
            ? "记录本次跟进结果，待办会从列表移除并写入客户时间线。"
            : "跳过同样会写入时间线，便于后续复盘为什么没有执行。"}
        </Typography.Paragraph>
        <Input.TextArea
          rows={3}
          maxLength={1000}
          showCount
          value={result}
          placeholder={completeTarget?.status === "DONE" ? "如：已发送产品资料，客户约了周四沟通" : "如：客户暂不需要"}
          onChange={(event) => setResult(event.target.value)}
        />
      </Modal>
    </div>
  );
}
