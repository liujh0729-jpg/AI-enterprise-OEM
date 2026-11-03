"use client";

import { useState } from "react";
import { PageHero } from "@/components/ui/panel";
import { FeedTab } from "./_components/feed-tab";
import { FriendsTab } from "./_components/friends-tab";
import { GroupsTab } from "./_components/groups-tab";
import { ListingTab } from "./_components/listing-tab";
import { MailTab } from "./_components/mail-tab";
import { ProfileTab } from "./_components/profile-tab";
import { ResumeTab } from "./_components/resume-tab";

type SocialView = "feed" | "friends" | "groups" | "mail" | "listing" | "profile" | "resume";

/**
 * 社交板块（M5，工作台）：把原 NestJS SNS 的关系 / 动态 / 小组 / 私信 / 简历本地化进本站，
 * 前端融进 AntD。页签切换子视图，数据均走 `/enterprise/social/*` 本地接口，全平台封禁自动拦截。
 */
export default function SocialPage() {
  const [view, setView] = useState<SocialView>("feed");
  return (
    <>
      <PageHero
        title="商务社交"
        desc="结识同行人、发布动态、加入小组讨论、站内私信往来，并维护你的职场简历。全部在你的账号下本地闭环，不受上游影响。"
        tabs={[
          { key: "feed", label: "动态" },
          { key: "friends", label: "好友" },
          { key: "groups", label: "小组" },
          { key: "mail", label: "私信" },
          { key: "listing", label: "供求广场" },
          { key: "profile", label: "资料" },
          { key: "resume", label: "简历" },
        ]}
        activeTab={view}
        onTabChange={(key) => setView(key as SocialView)}
      />
      {view === "feed" ? <FeedTab /> : null}
      {view === "friends" ? <FriendsTab /> : null}
      {view === "groups" ? <GroupsTab /> : null}
      {view === "mail" ? <MailTab /> : null}
      {view === "listing" ? <ListingTab /> : null}
      {view === "profile" ? <ProfileTab /> : null}
      {view === "resume" ? <ResumeTab /> : null}
    </>
  );
}
