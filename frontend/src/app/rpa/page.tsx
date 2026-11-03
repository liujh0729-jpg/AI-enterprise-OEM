"use client";

import {
  CodeOutlined,
  PlayCircleOutlined,
  SettingOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { ConfigProvider, Skeleton } from "antd";
import { useCallback, useEffect, useState } from "react";
import { Notice, PageHero } from "@/components/ui/panel";
import { AccountPanel } from "./_components/account-panel";
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
 * RPA（「工作台」栏目 · 按账号归属）：三个页签＝RPA 任务 / RPA 账号 / RPA 脚本。
 *
 * 体验是「云端配置、本地执行」：任务在建好的那一刻就绑定了脚本 + 账号 + 运行参数，
 * 本地比特浏览器执行端凭 API Key 从 /api/v1/rpa 认领任务、拿正文与口令执行、回传结果。
 * 脚本可以由 AIPDD 文字模型（Base URL 固定 https://api.aipdd.work/v1）按需求生成后保存。
 * 任何账号切企业 / 服务商 / 职员身份，看到的都是同一批 RPA 内容。
 */
export default function RpaPage() {
  const [tab, setTab] = useState("tasks");
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
        desc="云端配置、本地执行：RPA 任务在创建时就绑好要跑的脚本、要用的 RPA 账号与运行参数，本地比特浏览器执行端凭 API Key 认领任务、执行并回传结果。支持三种目标设备——PC（比特浏览器窗口）、安卓云手机、iPhone 云手机，脚本类型按设备区分。RPA 账号的登录口令加密保存，只在认领时回传给执行端；RPA 脚本支持 JSON（Automa 工作流）、比特浏览器 RPA 流程、比特云手机 RPA 流程、JS、Python，也可以输入需求让 AIPDD 文字模型自动写完再保存。三块内容都按账号归属，切企业 / 服务商 / 职员身份看到的都是同一份"
        tabs={[
          {
            key: "tasks",
            label: (
              <>
                <PlayCircleOutlined aria-hidden /> RPA 任务
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
