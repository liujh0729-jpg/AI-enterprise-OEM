"use client";

import { EnvironmentOutlined, RobotOutlined, SendOutlined } from "@ant-design/icons";
import { Button, Drawer, Input, Space, Spin, Tooltip } from "antd";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  gapsApi,
  type AssistantAnswer,
  type AssistantHistory,
} from "@/api/gaps";
import { EmptyState } from "@/components/ui/panel";
import { useI18n } from "@/lib/i18n/i18n";
import { gapError, zhTime } from "@/app/gaps/_components/gaps-common";

/**
 * B2#15 页面感知助手：顶栏入口，提问时自动带上当前路由与业务域；
 * 回答只会引用本系统页面信息，找不到就指向帮助中心。
 */
export function PageAssistant() {
  const { t } = useI18n();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [history, setHistory] = useState<AssistantHistory[]>([]);
  const [error, setError] = useState("");

  const loadHistory = useCallback(async () => {
    try {
      const data = await gapsApi.assistantHistory({ query: { page: 1, pageSize: 20 } });
      setHistory(data?.list || []);
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadHistory();
  }, [open, loadHistory]);

  const ask = async () => {
    const text = question.trim();
    if (!text || asking) return;
    setAsking(true);
    setError("");
    try {
      const result = await gapsApi.askAssistant({
        body: {
          route: pathname || "/",
          entityType: "",
          entityId: "",
          question: text,
          model: "",
          channelId: 0,
        },
      });
      setAnswer(result);
      setQuestion("");
      await loadHistory();
    } catch (err) {
      setError(gapError(err));
    } finally {
      setAsking(false);
    }
  };

  return (
    <>
      <Tooltip title={t("页面助手")} key="assistant">
        <Button
          type="text"
          size="small"
          icon={<RobotOutlined />}
          style={{ opacity: 0.65 }}
          onClick={() => setOpen(true)}
          aria-label={t("页面助手")}
        />
      </Tooltip>
      <Drawer
        open={open}
        size={460}
        title={t("页面助手")}
        onClose={() => setOpen(false)}
        destroyOnHidden
      >
        <div className="pa-context">
          <EnvironmentOutlined aria-hidden />
          <span>当前页面</span>
          <code>{pathname || "/"}</code>
        </div>
        <Space.Compact style={{ width: "100%" }}>
          <Input.TextArea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="问当前页面怎么用，例如「这张表的筛选怎么组合」"
            autoSize={{ minRows: 2, maxRows: 6 }}
            maxLength={1000}
            onPressEnter={(event) => {
              if (!event.shiftKey) {
                event.preventDefault();
                void ask();
              }
            }}
          />
          <Button type="primary" icon={<SendOutlined aria-hidden />} loading={asking} onClick={() => void ask()}>
            提问
          </Button>
        </Space.Compact>
        <div className="pa-hint">Enter 发送 · Shift + Enter 换行</div>

        {error ? <div className="pa-error">{error}</div> : null}

        {asking ? (
          <div className="pa-loading">
            <Spin size="small" />
            正在结合当前页面回答…
          </div>
        ) : answer ? (
          <div className="pa-answer">
            <div className="pa-answer-head">
              <span className="pa-answer-title">
                <RobotOutlined aria-hidden />
                回答
              </span>
              <span className="pa-answer-meta">
                {answer.model ? `模型 · ${answer.model}` : "规则回答"}
                {answer.source ? ` · ${answer.source}` : ""}
              </span>
            </div>
            {answer.context.length ? (
              <div className="pa-chips">
                {answer.context.map((item, index) => (
                  <span className="pa-chip" key={`${item.label}-${index}`}>
                    <span className="pa-chip-label">{item.label}</span>
                    {item.value}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="pa-answer-body">{answer.answer}</div>
          </div>
        ) : null}

        <div className="pa-history-head">最近提问{history.length ? `（${history.length}）` : ""}</div>
        {history.length ? (
          <div className="pa-history">
            {history.map((item) => (
              <div className="pa-history-item" key={item.id}>
                <div className="pa-history-q">
                  <RobotOutlined aria-hidden />
                  {item.question}
                </div>
                <div className="pa-history-meta">
                  {zhTime(item.createdAt)} · {item.route}
                </div>
                <div className="pa-history-a">{item.answer}</div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState text="还没有提问记录，问一句试试" />
        )}
      </Drawer>
    </>
  );
}
