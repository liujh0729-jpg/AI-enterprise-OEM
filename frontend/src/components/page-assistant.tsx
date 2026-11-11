"use client";

import { EnvironmentOutlined, RobotOutlined, SendOutlined } from "@ant-design/icons";
import { Button, Drawer, Input, Select, Space, Spin, Tooltip } from "antd";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  gapsApi,
  type AssistantAnswer,
  type AssistantExtractResult,
  type AssistantHistory,
  type AssistantRegistry,
} from "@/api/gaps";
import { EmptyState } from "@/components/ui/panel";
import { useI18n } from "@/lib/i18n/i18n";
import { gapError, zhTime } from "@/app/gaps/_components/gaps-common";

/**
 * B2#15 页面感知助手：右侧可拖拽的圆形浮动入口，提问时自动带上当前路由与业务域；
 * 回答只会引用本系统页面信息，找不到就指向帮助中心。
 */
const FAB_SIZE = 52;
const FAB_EDGE = 18;
const POS_KEY = "pa-fab-pos-v1";

type FabPos = { x: number; y: number };

function clampPos(x: number, y: number): FabPos {
  const maxX = Math.max(FAB_EDGE, window.innerWidth - FAB_SIZE - FAB_EDGE);
  const maxY = Math.max(FAB_EDGE, window.innerHeight - FAB_SIZE - FAB_EDGE);
  return {
    x: Math.min(Math.max(FAB_EDGE, x), maxX),
    y: Math.min(Math.max(FAB_EDGE, y), maxY),
  };
}

function defaultPos(): FabPos {
  return clampPos(
    window.innerWidth - FAB_SIZE - FAB_EDGE,
    window.innerHeight * 0.5 - FAB_SIZE / 2,
  );
}

/** 气泡 + 问号：一眼看出「点这里可以提问」。 */
function AskIcon() {
  return (
    <svg className="pa-fab-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.4c-4.36 0-7.9 2.98-7.9 6.66 0 2.09 1.14 3.95 2.93 5.19v3.02c0 .5.58.78.97.46l2.83-2.14c.36.04.72.06 1.09.06 4.36 0 7.9-2.98 7.9-6.66S16.36 3.4 12 3.4Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M10.35 9.2c.09-1.02.92-1.78 1.95-1.78 1.07 0 1.94.75 1.94 1.74 0 1.42-1.9 1.5-1.9 2.96"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="12.28" cy="14.9" r="0.98" fill="currentColor" />
    </svg>
  );
}

export function PageAssistant() {
  const { t } = useI18n();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [history, setHistory] = useState<AssistantHistory[]>([]);
  const [error, setError] = useState("");

  /** 场景助手（docs §11.2）：注册表按路由取最长前缀，展示能力与人工边界。 */
  const [registry, setRegistry] = useState<AssistantRegistry[]>([]);
  const [extractText, setExtractText] = useState("");
  const [extractType, setExtractType] = useState<"MEETING" | "MAIL">("MEETING");
  const [extracting, setExtracting] = useState(false);
  const [extractResult, setExtractResult] = useState<AssistantExtractResult | null>(null);

  const scenario = (() => {
    const path = pathname || "/";
    return (
      registry
        .filter((row) => path === row.route || path.startsWith(`${row.route}/`))
        .sort((a, b) => b.route.length - a.route.length)[0] || null
    );
  })();

  const [pos, setPos] = useState<FabPos | null>(null);
  const [dragging, setDragging] = useState(false);
  const [posReady, setPosReady] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    let next = defaultPos();
    try {
      const raw = window.localStorage.getItem(POS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as FabPos;
        if (typeof parsed?.x === "number" && typeof parsed?.y === "number") {
          next = clampPos(parsed.x, parsed.y);
        }
      }
    } catch {
      /* 位置缓存损坏时退回默认右侧位置 */
    }
    setPos(next);
    setPosReady(true);

    const onResize = () =>
      setPos((current) => (current ? clampPos(current.x, current.y) : current));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!posReady || !pos) return;
    try {
      window.localStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch {
      /* 位置缓存写失败不影响使用 */
    }
  }, [pos, posReady]);

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    setPos(clampPos(drag.originX + dx, drag.originY + dy));
  };

  const endDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* 指针已释放时忽略 */
    }
    if (drag && !drag.moved) setOpen(true);
  };

  const loadHistory = useCallback(async () => {
    try {
      const data = await gapsApi.assistantHistory({ query: { page: 1, pageSize: 20 } });
      setHistory(data?.list || []);
    } catch {
      setHistory([]);
    }
  }, []);

  const loadRegistry = useCallback(async () => {
    try {
      setRegistry((await gapsApi.assistantRegistry()) || []);
    } catch {
      setRegistry([]);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadHistory();
    void loadRegistry();
  }, [open, loadHistory, loadRegistry]);

  const extractActions = async () => {
    const text = extractText.trim();
    if (!text || extracting) return;
    setExtracting(true);
    setError("");
    try {
      const result = await gapsApi.extractAssistantActions({
        body: {
          sourceType: extractType,
          sourceRef: "",
          text,
          assigneeUserId: "",
          model: "",
          channelId: 0,
        },
      });
      setExtractResult(result);
      if (result?.total) setExtractText("");
    } catch (err) {
      setError(gapError(err));
    } finally {
      setExtracting(false);
    }
  };

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
      <Tooltip
        title={t("页面助手 · 问当前页面怎么用")}
        placement="left"
        open={dragging ? false : undefined}
      >
        <button
          type="button"
          className={`pa-fab${dragging ? " pa-fab-dragging" : ""}`}
          style={pos ? { left: pos.x, top: pos.y } : { visibility: "hidden" }}
          aria-label={t("页面助手")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setOpen(true);
            }
          }}
        >
          <AskIcon />
        </button>
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
        {scenario?.scenarioTitle ? (
          <div className="pa-chips" style={{ marginBottom: 10 }}>
            <span className="pa-chip">
              <span className="pa-chip-label">场景</span>
              {scenario.scenarioTitle}
            </span>
            {scenario.capabilities.map((item) => (
              <span className="pa-chip" key={item}>
                {item}
              </span>
            ))}
          </div>
        ) : null}

        {scenario?.extract ? (
          <div style={{ marginBottom: 12 }}>
            <div className="pa-hint" style={{ marginBottom: 6 }}>
              粘贴会议记录或邮件正文（只处理你提供的文本），提取行动项、责任人、截止时间，生成待确认任务。
            </div>
            <Space.Compact style={{ width: "100%", marginBottom: 8 }}>
              <Select
                value={extractType}
                onChange={(value) => setExtractType(value)}
                options={[
                  { value: "MEETING", label: "会议记录" },
                  { value: "MAIL", label: "邮件" },
                ]}
                style={{ width: 120 }}
              />
              <Button type="primary" ghost loading={extracting} onClick={() => void extractActions()} disabled={!extractText.trim()}>
                提取行动项
              </Button>
            </Space.Compact>
            <Input.TextArea
              value={extractText}
              onChange={(event) => setExtractText(event.target.value)}
              placeholder={"待办：周五前把报价单发给客户\nTODO: 跟进合同盖章"}
              autoSize={{ minRows: 3, maxRows: 8 }}
              maxLength={20000}
            />
            {extractResult ? (
              <div className="pa-hint" style={{ marginTop: 6 }}>
                {extractResult.total
                  ? `已生成 ${extractResult.total} 条待确认任务：${extractResult.items.map((item) => item.title).join("；")}（在「我的任务」确认）`
                  : "没有识别到行动项：可把每条行动以「待办：」开头再试一次"}
              </div>
            ) : null}
          </div>
        ) : null}

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
            {answer.boundaries?.length ? (
              <div className="pa-hint">边界：{answer.boundaries.join("；")}</div>
            ) : null}
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
