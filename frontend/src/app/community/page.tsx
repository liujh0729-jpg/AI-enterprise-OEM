"use client";

import { Badge, Button, Space } from "antd";
import { ApiOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useState } from "react";
import { PageHero } from "@/components/ui/panel";
import { communityApi } from "@/api/community";
import type {
  CommunityCategoryRow,
  CommunityCredentialStatus,
} from "@enterprise/contracts";
import { CommunityBoard } from "./_components/community-board";
import { ComfyConnectModal } from "./_components/comfy-connect-modal";

/**
 * 创意社区（Comfy Cloud 工作流市场）。
 *
 * 与「内容创作小工具」里的「视频创作工具（Drama Agent）」不是一回事：那个是装在你自己电脑上的外部项目，
 * 这里的工作流全部跑在官方 Comfy Cloud 上，用的是登录账号自己绑定的 API Key 与自己的 Comfy 积分。
 */
export default function CommunityPage() {
  const [view, setView] = useState("all");
  const [categories, setCategories] = useState<CommunityCategoryRow[]>([]);
  const [credential, setCredential] = useState<CommunityCredentialStatus | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);

  useEffect(() => {
    communityApi
      .categories()
      .then((data) => setCategories(data || []))
      .catch(() => setCategories([]));
  }, []);

  const loadCredential = useCallback(() => {
    communityApi
      .connectStatus()
      .then((data) => setCredential(data))
      .catch(() => setCredential(null));
  }, []);

  useEffect(() => {
    loadCredential();
  }, [loadCredential]);

  const tabs = [
    { key: "all", label: "全部" },
    ...categories.map((item) => ({ key: item.key, label: item.label, count: item.count })),
    { key: "runs", label: "我的产物" },
    { key: "drafts", label: "我的发布" },
  ];

  return (
    <>
      <PageHero
        title="创意社区"
        desc="官方 Comfy Cloud 的工作流市场：按分类挑一个现成的图像 / 视频 / 音频 / 3D / 文本工作流，填好参数就能在站内直接跑，跑的是你自己 Comfy Cloud 账号的订阅积分（本站不代付算力）；生成完成后产物会自动转存进本站对象存储并登记到你的数字资产里。你也可以把自己的工作流发布上来，审核通过并被推荐进市场后会得到积分奖励。注意区分：「内容创作小工具」里的「视频创作工具」是装在你自己电脑上的外部项目，与这里无关。"
        tabs={tabs}
        activeTab={view}
        onTabChange={setView}
        extra={
          <Space>
            <Badge dot={!credential?.connected} offset={[-4, 4]}>
              <Button
                icon={<ApiOutlined />}
                type={credential?.connected ? "default" : "primary"}
                onClick={() => setConnectOpen(true)}
              >
                {credential?.connected ? `已连接 ${credential.keyMask}` : "连接 Comfy Cloud"}
              </Button>
            </Badge>
          </Space>
        }
      />
      <CommunityBoard
        view={view}
        categories={categories}
        credential={credential}
        onConnect={() => setConnectOpen(true)}
      />
      <ComfyConnectModal
        open={connectOpen}
        status={credential}
        onClose={() => setConnectOpen(false)}
        onChange={(status) => {
          setCredential(status);
          loadCredential();
        }}
      />
    </>
  );
}
