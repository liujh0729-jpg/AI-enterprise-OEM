"use client";

import type { ContentAgentExpert } from "@enterprise/contracts";
import { ConfigProvider } from "antd";
import { useState } from "react";
import { PageHero } from "@/components/ui/panel";
import { AgentAssistantTab } from "./_components/assistant-tab";
import { AgentChatPanel } from "./_components/chat-panel";
import { AgentConnectorsTab } from "./_components/connectors-tab";
import { AgentExpertsTab } from "./_components/experts-tab";
import { AgentPersonaTab } from "./_components/persona-tab";
import { AgentPluginsTab } from "./_components/plugins-tab";
import { AgentSchedulesTab } from "./_components/schedules-tab";
import { AgentSkillsTab } from "./_components/skills-tab";

type View =
  | "chat"
  | "schedules"
  | "assistant"
  | "personas"
  | "skills"
  | "plugins"
  | "experts"
  | "connectors";

/**
 * Agent（「工作台」栏目第一项 · 按登录账号归属）：
 * 与模型对话并直接产出图片/视频；产出的媒体自动进本账号的 AIPDD 数字资产。
 * 「定时任务」页签到点把任务指令交给 Agent 执行，结果落进任务专属会话。
 * 「助理」页签把企业微信/飞书/钉钉/QQ 等第三方消息通道接进来，远程发一句话就能指挥 Agent。
 * 长期记忆 / 资料库 / 操作记忆与「动作授权」已并入「知识库 → 记忆」，本页不再单开「记忆」页签；
 * 「MCP连接器」页签里除连接器外还挂着「可自动执行的动作」（授权闸）。
 * 「技能」后面是「插件」：技能中心/插件中心都来自 SkillHub，装进本账号后模型按需读全文。
 * 「数字分身」页签按登录账号建多套风格与人设，对话里可选某个分身或交给「自动」按语义自选。
 * 「专家」页签是全站共用的角色库：一段指令生成专家，点卡片即用该专家开新对话。
 */
export default function AgentPage() {
  const [view, setView] = useState<View>("chat");
  const [expertToUse, setExpertToUse] = useState<ContentAgentExpert | null>(
    null,
  );
  /** 定时任务执行记录里「查看会话」：切到对话页签并打开那条结果会话。 */
  const [conversationToOpen, setConversationToOpen] = useState<number | null>(
    null,
  );

  return (
    <ConfigProvider button={{ autoInsertSpace: false }}>
      <PageHero
        title="Agent"
        desc="把你的想法说清楚，Agent 会调用模型生成图片/视频、记住你的偏好、按你配置的技能办事，还能调用你接入的 MCP 工具，并把生成结果存进这个账号的数字资产；「定时任务」到点自动执行常用任务，「助理」让你在企微/飞书/钉钉/QQ 里远程发指令；想换说话方式，到「数字分身」里建多套风格与人设，对话里可选某个分身或交给「自动」按语义自选。模型与 Key 在「开放集成 → 模型设置」里配"
        tabs={[
          { key: "chat", label: "对话" },
          { key: "schedules", label: "定时任务" },
          { key: "assistant", label: "助理" },
          { key: "personas", label: "数字分身" },
          { key: "skills", label: "技能" },
          { key: "plugins", label: "插件" },
          { key: "experts", label: "专家" },
          { key: "connectors", label: "MCP连接器" },
        ]}
        activeTab={view}
        onTabChange={(key) => setView(key as View)}
      />

      {view === "chat" ? (
        <AgentChatPanel
          expertToUse={expertToUse}
          onExpertConsumed={() => setExpertToUse(null)}
          conversationToOpen={conversationToOpen}
          onConversationOpened={() => setConversationToOpen(null)}
        />
      ) : view === "schedules" ? (
        <AgentSchedulesTab
          onOpenConversation={(id) => {
            setConversationToOpen(id);
            setView("chat");
          }}
        />
      ) : view === "assistant" ? (
        <AgentAssistantTab />
      ) : view === "personas" ? (
        <AgentPersonaTab />
      ) : view === "skills" ? (
        <AgentSkillsTab />
      ) : view === "plugins" ? (
        <AgentPluginsTab />
      ) : view === "connectors" ? (
        <AgentConnectorsTab />
      ) : (
        <AgentExpertsTab
          onUseExpert={(expert) => {
            setExpertToUse(expert);
            setView("chat");
          }}
        />
      )}
    </ConfigProvider>
  );
}
