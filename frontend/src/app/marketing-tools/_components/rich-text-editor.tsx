"use client";

import { BgColorsOutlined } from "@ant-design/icons";
import { Button, Divider, Dropdown, Input, Popover, Space, Tooltip } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { richTextVisibleLength, sanitizeRichTextHtml } from "@enterprise/contracts";

/**
 * 分发正文的富文本编辑器：产出契约 rich-text.ts 认得的「受限 HTML」子集。
 * 只做能带到各平台文章编辑器里的那些格式（粗体/斜体/下划线/删除线/小标题/列表/引用/颜色/链接），
 * 不做图片内联——配图仍走台账的图片清单（插件按 URL 下载后传平台上传口）。
 * 粘贴外部内容先过白名单清洗，避免把别处样式和脚本一起带进来。
 */

const HEADING_ITEMS = [
  { key: "p", label: "正文" },
  { key: "h2", label: "大标题" },
  { key: "h3", label: "小标题" },
  { key: "blockquote", label: "引用" },
];

const COLOR_ITEMS = [
  { key: "#1f2329", label: "默认" },
  { key: "#f5222d", label: "红" },
  { key: "#fa8c16", label: "橙" },
  { key: "#52c41a", label: "绿" },
  { key: "#1677ff", label: "蓝" },
  { key: "#722ed1", label: "紫" },
];

function toolbarStyle(): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 2,
    padding: "4px 6px",
    border: "1px solid var(--border-strong)",
    borderBottom: "none",
    borderRadius: "8px 8px 0 0",
    background: "#fafafa",
  };
}

/**
 * 工具栏按钮：模块级组件，onClick 以 prop 传入。
 * 不能在 render 里调用局部 helper 去创建 handler——那会让「render 期间访问 ref」
 * 的静态判定（react-hooks/refs）成立，exec 读的是编辑区的 ref。
 */
function ToolButton({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip title={title}>
      <Button
        size="small"
        type="text"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClick}
        style={{ minWidth: 28, fontWeight: 600 }}
      >
        {children}
      </Button>
    </Tooltip>
  );
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = "发布到各平台的正文；文章类渠道会带上这里的样式",
  minHeight = 180,
  visibleMax = 20000,
  disabled,
}: {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  minHeight?: number;
  visibleMax?: number;
  disabled?: boolean;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  /** 最近一次由本组件抛出的串：外部回灌同值时不重设 innerHTML，否则光标会跳。 */
  const emittedRef = useRef("");
  const savedRangeRef = useRef<Range | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkText, setLinkText] = useState("https://");
  const [empty, setEmpty] = useState(!(value ?? "").trim());

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const next = value ?? "";
    if (next === emittedRef.current) return;
    // 进 DOM 前先过白名单：旧台账是纯文本，万一正文里写了带 onerror 的标签，
    // 直接回灌 contenteditable 就会在本页执行（入库路径已清洗，读路径同样不能侥幸）。
    const clean = sanitizeRichTextHtml(next);
    if (editor.innerHTML !== clean) editor.innerHTML = clean;
    setEmpty(richTextVisibleLength(clean) === 0);
  }, [value]);

  // 工具栏动作一律提为 useCallback：内联箭头会让「render 期间访问 ref」的静态判定成立
  // （react-hooks/refs），提出来既满足规则，也保住 handler 稳定。
  const emit = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const html = editor.innerHTML;
    emittedRef.current = html;
    setEmpty(richTextVisibleLength(html) === 0);
    onChange?.(html);
  }, [onChange]);

  /** 工具栏按钮一律 preventDefault，保住编辑区的选区。 */
  const exec = useCallback((command: string, arg?: string) => {
    const editor = editorRef.current;
    if (!editor || disabled) return;
    editor.focus();
    document.execCommand(command, false, arg);
    emit();
  }, [disabled, emit]);

  const formatBlock = useCallback((tag: string) => {
    exec("formatBlock", tag === "p" ? "<p>" : `<${tag}>`);
  }, [exec]);

  const rememberRange = useCallback(() => {
    const selection = window.getSelection();
    savedRangeRef.current =
      selection && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
  }, []);

  /** 恢复并消费弹窗期间暂存的选区：一次性使用，用完即清，避免陈旧 Range 打断后续操作。 */
  const restoreRange = useCallback(() => {
    const saved = savedRangeRef.current;
    savedRangeRef.current = null;
    if (!saved) return false;
    const selection = window.getSelection();
    if (!selection) return false;
    try {
      selection.removeAllRanges();
      selection.addRange(saved);
      return true;
    } catch {
      // 编辑区 innerHTML 被重设后 Range 宿主节点已脱离文档，addRange 会抛错：
      // 当作没选区处理，不能让它打断链接之外的工具栏链路。
      return false;
    }
  }, []);

  const applyLink = useCallback(() => {
    setLinkOpen(false);
    const url = linkText.trim();
    // 弹层会抢焦点：只有当前选区塌了才恢复暂存选区，否则直接用编辑区现存选区。
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) restoreRange();
    else savedRangeRef.current = null;
    if (url) {
      const safe = /^(https?:\/\/|mailto:)/i.test(url) ? url : `https://${url}`;
      exec("createLink", safe);
    }
    setLinkText("https://");
  }, [exec, linkText, restoreRange]);

  const openLinkPopover = useCallback(() => {
    rememberRange();
    setLinkOpen(true);
  }, [rememberRange]);

  const closeLinkPopover = useCallback(() => {
    setLinkOpen(false);
    setLinkText("https://");
    // 取消也要丢弃暂存选区，否则它会陈旧地等到下一次链接/工具栏操作。
    savedRangeRef.current = null;
  }, []);

  const onEditorBlur = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    // 失焦时收敛一次：进库的始终是白名单内的串。
    const clean = sanitizeRichTextHtml(editor.innerHTML);
    if (clean !== editor.innerHTML) {
      editor.innerHTML = clean;
      emittedRef.current = clean;
    }
    setEmpty(richTextVisibleLength(clean) === 0);
    onChange?.(clean);
  }, [onChange]);

  const onEditorPaste = useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const html = event.clipboardData.getData("text/html");
    const text = event.clipboardData.getData("text/plain");
    if (html) exec("insertHTML", sanitizeRichTextHtml(html));
    else exec("insertText", text);
  }, [exec]);

  // 每个按钮一个稳定 handler（而不是在 render 里现造闭包），同时保住 memo 效果。
  const onBold = useCallback(() => exec("bold"), [exec]);
  const onItalic = useCallback(() => exec("italic"), [exec]);
  const onUnderline = useCallback(() => exec("underline"), [exec]);
  const onStrike = useCallback(() => exec("strikeThrough"), [exec]);
  const onUnorderedList = useCallback(() => exec("insertUnorderedList"), [exec]);
  const onOrderedList = useCallback(() => exec("insertOrderedList"), [exec]);
  const onClearFormat = useCallback(() => exec("removeFormat"), [exec]);
  const onHeading = useCallback(
    (info: { key: string | React.Key }) => formatBlock(String(info.key)),
    [formatBlock],
  );
  const onColor = useCallback((info: { key: string | React.Key }) => exec("foreColor", String(info.key)), [exec]);

  const visible = richTextVisibleLength(value ?? "");

  return (
    <div>
      <div style={toolbarStyle()}>
        <Space size={0} wrap>
          <ToolButton title="加粗" onClick={onBold} disabled={disabled}>B</ToolButton>
          <ToolButton title="斜体" onClick={onItalic} disabled={disabled}><i>I</i></ToolButton>
          <ToolButton title="下划线" onClick={onUnderline} disabled={disabled}><u>U</u></ToolButton>
          <ToolButton title="删除线" onClick={onStrike} disabled={disabled}><s>S</s></ToolButton>
        </Space>
        <Divider orientation="vertical" />
        <Dropdown
          disabled={disabled}
          menu={{
            items: HEADING_ITEMS.map((item) => ({ key: item.key, label: item.label })),
            onClick: onHeading,
          }}
        >
          <Button
            size="small"
            type="text"
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
          >
            段落
          </Button>
        </Dropdown>
        <Dropdown
          disabled={disabled}
          menu={{
            items: COLOR_ITEMS.map((item) => ({
              key: item.key,
              label: (
                <span>
                  <span
                    style={{
                      display: "inline-block",
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      marginRight: 6,
                      background: item.key,
                    }}
                  />
                  {item.label}
                </span>
              ),
            })),
            onClick: onColor,
          }}
        >
          <Button
            size="small"
            type="text"
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            icon={<BgColorsOutlined />}
          />
        </Dropdown>
        <Divider orientation="vertical" />
        <ToolButton title="无序列表" onClick={onUnorderedList} disabled={disabled}>•≡</ToolButton>
        <ToolButton title="有序列表" onClick={onOrderedList} disabled={disabled}>1≡</ToolButton>
        <ToolButton title="链接" onClick={openLinkPopover} disabled={disabled}>链</ToolButton>
        <ToolButton title="清除格式" onClick={onClearFormat} disabled={disabled}>清</ToolButton>
        <Popover
          open={linkOpen}
          trigger={[]}
          content={
            <Space orientation="vertical" style={{ width: 260 }}>
              <Input
                autoFocus
                value={linkText}
                placeholder="https://example.com"
                onChange={(event) => setLinkText(event.target.value)}
                onPressEnter={applyLink}
              />
              <Space>
                <Button type="primary" onClick={applyLink}>
                  确定
                </Button>
                <Button onClick={closeLinkPopover}>取消</Button>
              </Space>
            </Space>
          }
        >
          <span />
        </Popover>
      </div>
      <div style={{ position: "relative" }}>
        <div
          ref={editorRef}
          contentEditable={!disabled}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          onInput={emit}
          onBlur={onEditorBlur}
          onPaste={onEditorPaste}
          style={{
            minHeight,
            maxHeight: 420,
            overflowY: "auto",
            padding: "8px 11px",
            border: "1px solid var(--border-strong)",
            borderRadius: "0 0 8px 8px",
            outline: "none",
            background: disabled ? "#f5f5f5" : "#fff",
            fontSize: 14,
            lineHeight: 1.7,
          }}
        />
        {empty && !disabled ? (
          <div
            style={{
              position: "absolute",
              top: 8,
              left: 12,
              color: "var(--text-4)",
              pointerEvents: "none",
            }}
          >
            {placeholder}
          </div>
        ) : null}
      </div>
      <div
        className="text-12"
        style={{ marginTop: 4, color: visible > visibleMax ? "var(--danger)" : undefined }}
      >
        {visible} / {visibleMax} 字（按正文字数计，样式标记不占额度）
      </div>
    </div>
  );
}
