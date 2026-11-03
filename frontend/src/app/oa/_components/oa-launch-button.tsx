"use client";

import { Button } from "antd";
import { useRouter } from "next/navigation";
import type { OaLinkTargetType } from "@enterprise/contracts";
import { oaApi } from "@/api/oa";
import { useBusinessQuery } from "@/query/business";

/**
 * 业务侧「发起 OA 审批」入口：当前账号在任何组织里都没有 OA 身份时不渲染。
 * 只负责跳深链，关联对象由 /oa/new 按 id 回查并校验可见性，各模块不各写一套。
 */
export function OaLaunchButton({
  target,
  targetId,
  templateId,
}: {
  target: OaLinkTargetType;
  targetId: number | string;
  templateId?: number;
}) {
  const router = useRouter();
  const workspace = useBusinessQuery("oa", "workspace", {}, (signal) =>
    oaApi.workspace({}, { signal }),
  );
  if (!workspace.data?.orgs.length) return null;
  const query = new URLSearchParams({ target, id: String(targetId) });
  if (templateId) query.set("template", String(templateId));
  return (
    <Button onClick={() => router.push(`/oa/new?${query.toString()}`)}>
      发起 OA 审批
    </Button>
  );
}
