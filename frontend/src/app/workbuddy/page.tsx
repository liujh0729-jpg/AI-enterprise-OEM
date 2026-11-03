"use client";

import {
  KeyOutlined,
  LockOutlined,
  RobotOutlined,
  ScheduleOutlined,
} from "@ant-design/icons";
import { ConfigProvider, Skeleton } from "antd";
import { useCallback, useEffect, useState } from "react";
import { Notice, PageHero } from "@/components/ui/panel";
import { AccountPanel } from "./_components/account-panel";
import { AgentPanel } from "./_components/agent-panel";
import { AccountPanel as AiCallAccountPanel } from "./_components/ai-call/account-panel";
import { aiCallApi, type AiCallAccount } from "./_components/ai-call/common";
import { AiCallGuideButton } from "./_components/ai-call/usage-guide";
import {
  workbuddyApi,
  type WbAccount,
  type WbPlan,
} from "./_components/common";
import { PlanPanel } from "./_components/plan-panel";
import { WorkbuddyGuideButton } from "./_components/usage-guide";

/**
 * Workbuddy 企业云（「工作台」栏目 · 按用户归属）：四个页签＝计划任务 / Agent /
 * Workbuddy Enterprise 账号 / AI 调用账号。
 *
 * 每个用户在「Workbuddy Enterprise 账号」里填自己的腾讯云 SecretId / SecretKey，用哪把密钥签名就只
 * 看得到那个企业名下的 Agent 与会话（隔离由腾讯云侧完成）；一个用户可以配多把密钥，
 * 计划拆解后把任务轮流分到多个账号的 Agent 上并行执行。计划任务走「口水话 → AI 澄清
 * 任务书 → 拆成逐条任务 → 派发到 Agent 会话 → 同步消息事件」，AI 澄清用的是全站统一的
 * API Key（在「API Key 管理」生成）。
 *
 * 「AI 调用账号」是同一套账号体系下的第三方平台凭据库：每条凭据必须绑定到一个或多个
 * Workbuddy Enterprise 账号，任务在哪个 Workbuddy 账号下运行就只能取与该账号绑定的凭据，
 * 因此与 Workbuddy 收在同一个页面，不再单开入口。
 */
export default function WorkbuddyPage() {
  const [tab, setTab] = useState("plans");
  const [plans, setPlans] = useState<WbPlan[]>([]);
  const [accounts, setAccounts] = useState<WbAccount[]>([]);
  const [aiCallAccounts, setAiCallAccounts] = useState<AiCallAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    const [planResult, accountResult, aiCallResult] = await Promise.all([
      workbuddyApi.plans(),
      workbuddyApi.accounts(),
      aiCallApi.accounts(),
    ]);
    setPlans(planResult.data?.items ?? []);
    setAccounts(accountResult.data ?? []);
    setAiCallAccounts(aiCallResult.data ?? []);
    setError(
      [planResult.message, accountResult.message, aiCallResult.message]
        .filter(Boolean)
        .join("；"),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <ConfigProvider button={{ autoInsertSpace: false }}>
      <PageHero
        title="Workbuddy 企业云"
        desc="先和 AI 把目标、交付物、验收标准与步骤聊清楚，形成任务书，再拆成逐条任务派给腾讯云侧合适的 Agent 执行，消息与工具调用回传到本系统查看。Agent、版本、会话都在你自己的腾讯云 Workbuddy 企业云账号下，本系统只保存调用凭据与任务记录；每个用户填自己的 SecretId / SecretKey，互不相通。可以配多把密钥，把任务并行分给多个账号的 Agent 加速。AI 澄清使用「API Key 管理」里平台 API Key（AIworkin 签发的 sk- Key）。「AI 调用账号」页签集中加密保存第三方平台的口令、API Key 与 Cookie，每条凭据按 Workbuddy Enterprise 账号授权，任务运行时经机器通道按绑定取用"
        tabs={[
          {
            key: "plans",
            label: (
              <>
                <ScheduleOutlined aria-hidden /> 计划任务
              </>
            ),
            count: plans.length,
          },
          {
            key: "agents",
            label: (
              <>
                <RobotOutlined aria-hidden /> 云端Agent
              </>
            ),
          },
          {
            key: "accounts",
            label: (
              <>
                <KeyOutlined aria-hidden /> Workbuddy Enterprise 账号
              </>
            ),
            count: accounts.length,
          },
          {
            key: "ai-call",
            label: (
              <>
                <LockOutlined aria-hidden /> AI 调用账号
              </>
            ),
            count: aiCallAccounts.length,
          },
        ]}
        activeTab={tab}
        onTabChange={setTab}
        titleExtra={
          tab === "ai-call" ? (
            <AiCallGuideButton />
          ) : (
            <WorkbuddyGuideButton />
          )
        }
      />

      {error ? (
        <Notice variant="error">{`Workbuddy 数据加载失败：${error}`}</Notice>
      ) : null}

      {loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : tab === "plans" ? (
        <PlanPanel plans={plans} accounts={accounts} reload={reload} />
      ) : tab === "agents" ? (
        <AgentPanel accounts={accounts} />
      ) : tab === "accounts" ? (
        <AccountPanel accounts={accounts} reload={reload} />
      ) : (
        <AiCallAccountPanel
          accounts={aiCallAccounts}
          workbuddyAccounts={accounts.map((item) => ({
            id: item.id,
            name: item.name,
            status: item.status,
            region: item.region,
          }))}
          reload={reload}
        />
      )}
    </ConfigProvider>
  );
}
