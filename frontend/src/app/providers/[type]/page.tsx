"use client";

import { SearchOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useParams, useRouter } from "next/navigation";
import { ProviderDirectoryTab } from "@/components/provider-directory-tab";
import { EmptyState, PageHero } from "@/components/ui/panel";
import { DIRECTORY_BOARDS, DIRECTORY_ITEMS } from "@/lib/provider-categories";

/**
 * 名录细项的服务商列表页 `/providers/<细项 code>`（2026-09-25 用户指令：
 * 「点击更多应该是进入新页面而不要弹出层」）。
 * 出海 6 / 营销 6 / 物流 3 / IT服务 5 / 资产 5 共 25 个细项分区头部的「更多」都跳到这里；
 * 列表本体复用 `ProviderDirectoryTab` 的单列表模式（同一份卡片、详情与发起签约实现）。
 */
export default function ProviderListPage() {
  const params = useParams<{ type?: string }>();
  const router = useRouter();
  const code = String(params?.type || "");
  const item = DIRECTORY_ITEMS[code];

  if (!item) {
    return (
      <>
        <PageHero title="服务商列表" desc="名录分区「更多」进入的分类服务商完整清单页。" />
        <EmptyState
          icon={<SearchOutlined aria-hidden />}
          text={`未登记的服务分类「${code || "—"}」，请从服务商名录分区标题右上角的「更多」进入。`}
        />
      </>
    );
  }

  const board = DIRECTORY_BOARDS[item.board];
  return (
    <>
      <PageHero
        title={<>{item.icon} {item.name}服务商</>}
        desc={`${item.desc}。本页列出「${board.name}」板块已通过平台备案审核、且覆盖「${item.name}」细项的服务商，最新入驻在前。`}
        extra={
          <Button onClick={() => router.push(board.href)}>
            返回{board.name}
          </Button>
        }
      />
      <ProviderDirectoryTab
        serviceType={item.type}
        title={`${item.name}服务商（平台备案服务商名录）`}
        badge={
          board.exclusive
            ? `该分类每家企业仅可签约一家服务商，解约后才能改签；发起签约后由服务商确认生效`
            : `该分类不限签约家数，可对多家服务商分别发起签约；发起签约后由服务商确认生效`
        }
        exclusive={board.exclusive}
        locationFilter
        selfHint="您当前以服务商身份查看：本页展示同类目的其他已备案服务商，您自己的机构无需向自己发起签约。"
      />
    </>
  );
}
