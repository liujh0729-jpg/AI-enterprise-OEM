"use client";

import { QuestionCircleOutlined } from "@ant-design/icons";
import { Button } from "antd";

/**
 * 帮助中心话题的直达入口：新窗口打开 /help?topic=xxx。
 * 只在用户点击时开窗，不做页面自动弹窗；noopener 阻断新页反向操作本页。
 */
export function HelpTopicButton({
  topic,
  label = "使用帮助",
  size = "small",
  type = "link",
}: {
  topic: string;
  label?: string;
  size?: "small" | "middle" | "large";
  type?: "link" | "text" | "primary" | "default";
}) {
  return (
    <Button
      size={size}
      type={type}
      icon={<QuestionCircleOutlined aria-hidden />}
      onClick={() =>
        window.open(
          `/help?topic=${encodeURIComponent(topic)}`,
          "_blank",
          "noopener",
        )
      }
    >
      {label}
    </Button>
  );
}
