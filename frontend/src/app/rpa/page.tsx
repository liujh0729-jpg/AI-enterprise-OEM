"use client";

import {
  ChromeOutlined,
  CodeOutlined,
  PlayCircleOutlined,
  SettingOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { ConfigProvider, Skeleton } from "antd";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Notice, PageHero } from "@/components/ui/panel";
import { AccountPanel } from "./_components/account-panel";
import { ChromePanel } from "./_components/chrome-panel";
import { ScriptPanel } from "./_components/script-panel";
import { TaskPanel } from "./_components/task-panel";
import { SettingsPanel } from "./_components/settings-panel";
import { BitBrowserGuideButton } from "./_components/usage-guide";
import {
  rpaApi,
  type RpaAccount,
  type RpaScript,
  type RpaTask,
} from "./_components/common";

/**
 * RPA（「工作台」栏目 · 按账号归属）：五个页签＝本地RPA状态 / RPA 矩阵任务 / RPA 账号 / RPA 脚本 / 设置。
 * 桌面端的能力有两套执行端——比特浏览器（云端配置、本地凭 API Key 认领执行）与
 * 「本地 Chrome 插件」（插件登录本系统后成为在线设备；升级后插件我的侧边栏就是浏览器代理，
 * 目标在插件侧编排、模型与工具在平台，云端仍保留下发与台账）。
 * 任何账号切企业 / 服务商 / 职员身份，看到的都是同一批 RPA 内容。
 */
const TAB_KEYS = ["status", "tasks", "accounts", "scripts", "settings"] as const;

export default function RpaPage() {
  const [tab, setTab] = useState("status");
  // 深链直达：/rpa?tab=status / ?tab=tasks …；旧的 ?tab=chrome 映射到 status（页签改名的兼容口径）。
  const wantedTab = useSearchParams().get("tab") || "";
  useEffect(() => {
    const wanted = wantedTab === "chrome" ? "status" : wantedTab;
    if ((TAB_KEYS as readonly string[]).includes(wanted)) setTab(wanted);
  }, [wantedTab]);
  const [tasks, setTasks] = useState<RpaTask[]>([]);
  const [accounts, setAccounts] = useState<RpaAccount[]>([]);
  const [scripts, setScripts] = useState<RpaScript[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    const [taskResult, accountResult, scriptResult] = await Promise.all([
      rpaApi.tasks(),
      rpaApi.accounts(),
      rpaApi.scripts(),
    ]);
    setTasks(taskResult.data?.list ?? []);
    setAccounts(accountResult.data ?? []);
    setScripts(scriptResult.data?.list ?? []);
    setError(
      [taskResult.message, accountResult.message, scriptResult.message]
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
        title="RPA自动化"
        desc="云端配置、本地执行：RPA 任务在创建时就绑好要跑的脚本、要用的 RPA 账号与运行参数，本地比特浏览器执行端凭 API Key 认领任务、执行并回传结果。支持三种目标设备——PC（比特浏览器窗口）、安卓云手机、iPhone 云手机，脚本类型按设备区分。RPA 账号的登录口令加密保存，只在认领时回传给执行端；RPA 脚本支持 JSON（Automa 工作流）、比特浏览器 RPA 流程、比特云手机 RPA 流程、JS、Python，也可以输入需求让 AIPDD 文字模型自动写完再保存。另一类执行端是本机「本地 Chrome 插件（浏览器代理）」：在电脑上安装插件并登录本系统后，本机浏览器即成为该账号名下的一台在线设备，你在插件侧边栏给一句话目标，云端 LLM 逐步决策、插件在你已登录的站点里自主多步执行（模型与工具都走本系统配置），敏感动作会先停下等你确认，离线设备不会被调度。第一个页签「本地RPA状态」用于自检本机插件的连接状态与在跑的会话。三块内容都按账号归属，切企业 / 服务商 / 职员身份看到的都是同一份"
        tabs={[
          {
            key: "status",
            label: (
              <>
                <ChromeOutlined aria-hidden /> 本地RPA状态
              </>
            ),
          },
          {
            key: "tasks",
            label: (
              <>
                <PlayCircleOutlined aria-hidden /> RPA 矩阵任务
              </>
            ),
            count: tasks.length,
          },
          {
            key: "accounts",
            label: (
              <>
                <UserOutlined aria-hidden /> RPA 账号
              </>
            ),
            count: accounts.length,
          },
          {
            key: "scripts",
            label: (
              <>
                <CodeOutlined aria-hidden /> RPA 脚本
              </>
            ),
            count: scripts.length,
          },
          {
            key: "settings",
            label: (
              <>
                <SettingOutlined aria-hidden /> 设置
              </>
            ),
          },
        ]}
        activeTab={tab}
        onTabChange={setTab}
        titleExtra={<BitBrowserGuideButton />}
      />

      {error ? <Notice variant="error">{`RPA 数据加载失败：${error}`}</Notice> : null}

      {loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : tab === "status" ? (
        <ChromePanel />
      ) : tab === "tasks" ? (
        <TaskPanel
          tasks={tasks}
          scripts={scripts}
          accounts={accounts}
          reload={reload}
        />
      ) : tab === "accounts" ? (
        <AccountPanel accounts={accounts} reload={reload} />
      ) : tab === "scripts" ? (
        <ScriptPanel scripts={scripts} reload={reload} />
      ) : (
        <SettingsPanel />
      )}
    </ConfigProvider>
  );
}
