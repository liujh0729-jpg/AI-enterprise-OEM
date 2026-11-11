"use client";

import type { MailAccount } from "@enterprise/contracts";
import { ConfigProvider } from "antd";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { mailApi } from "@/api/mail";
import { PageHero } from "@/components/ui/panel";
import { MailAccountsTab } from "./_components/accounts-tab";
import { MailDraftsTab } from "./_components/drafts-tab";
import { MailInboxTab } from "./_components/inbox-tab";
import { MailScriptsTab } from "./_components/scripts-tab";
import { GapsMailTemplatesTab } from "./_components/gaps-templates";

type View = "accounts" | "inbox" | "drafts" | "scripts" | "templates";

/**
 * AI邮箱服务（「工作台」栏目 · 排在 Workbuddy 企业云之前）：
 * 多邮箱 POP3 / IMAP 收信、SMTP 发信，正文与附件不落库；
 * 回复方式选「只写草稿」或「写草稿并自动回复」，Agent 定时任务通过邮件工具按话术起草。
 */
export default function MailPage() {
  const [view, setView] = useState<View>("accounts");
  // 阻断提示直达：/mail?tab=accounts 定位到邮箱账号页签
  const wantedTab = useSearchParams().get("tab") || "";
  useEffect(() => {
    if (["accounts", "inbox", "drafts", "scripts", "templates"].includes(wantedTab)) {
      setView(wantedTab as View);
    }
  }, [wantedTab]);
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const list = await mailApi.accounts();
      setAccounts(list || []);
      setError("");
    } catch (caught) {
      setAccounts([]);
      setError((caught as Error).message || "邮箱清单读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  return (
    <ConfigProvider button={{ autoInsertSpace: false }}>
      <PageHero
        title="AI邮箱服务"
        desc="支持多个邮箱（POP3 / IMAP）：实时读收件箱与草稿箱，邮件正文和附件都不存本站；话术可以先预设再绑定到具体邮箱、知识（资料库）按邮箱绑定，回复方式选「只写草稿」或「写草稿并自动回复」。Agent 定时任务通过邮件工具读取未读邮件、按话术起草，并按这个设置决定留草稿还是发出"
        tabs={[
          { key: "accounts", label: "邮箱账号" },
          { key: "inbox", label: "收件箱" },
          { key: "drafts", label: "草稿箱" },
          { key: "scripts", label: "知识与话术" },
          { key: "templates", label: "邮件模板" },
        ]}
        activeTab={view}
        onTabChange={(key) => setView(key as View)}
      />

      {view === "accounts" ? (
        <MailAccountsTab
          accounts={accounts}
          loading={loading}
          error={error}
          reload={loadAccounts}
        />
      ) : view === "inbox" ? (
        <MailInboxTab accounts={accounts} />
      ) : view === "drafts" ? (
        <MailDraftsTab accounts={accounts} />
      ) : view === "scripts" ? (
        <MailScriptsTab accounts={accounts} />
      ) : (
        <GapsMailTemplatesTab />
      )}
    </ConfigProvider>
  );
}