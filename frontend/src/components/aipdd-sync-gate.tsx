"use client";

import { App } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { aipddKeyApi } from "@/api/aipdd-key";
import { useBusinessQuery } from "@/query/business";

/**
 * 「自动同步到 AIworkin」的勾选门控（供求广场与招聘共用一套口径）：
 * - 已绑定 AIPDD APIKey：打开弹层即默认勾选；
 * - 未绑定：点勾选只弹绑定引导，勾选态不变（绑完回来重开弹层才会默认勾上）；
 * - choice 为 "unset" 表示用户还没表过态，按绑定状态取默认；true/false 是用户自己选过的。
 * subject 用于引导文案里指代本次要发布的内容（帖子 / 岗位）。
 */
export function useAipddSyncGate(options: { panelOpen: boolean; subject: string }) {
  const { modal } = App.useApp();
  const router = useRouter();
  const [choice, setChoice] = useState<"unset" | boolean>("unset");
  // 绑定状态只在弹层打开时取一次：它决定同步勾选的默认值，不必在列表页常驻轮询。
  const keyStatus = useBusinessQuery(
    "social",
    "aipdd-key-status",
    {},
    (signal) => aipddKeyApi.status({ signal }),
    "all",
    options.panelOpen,
  );
  const bound = !!keyStatus.data?.bound;
  const wanted = choice === "unset" ? bound : choice === true;

  return {
    bound,
    wanted,
    /** 每次打开弹层重选一次默认：绑了 Key 就默认同步，没绑就默认仅本地。 */
    reset: () => setChoice("unset"),
    /** 勾上后走 onEnabled 补齐该板块的默认值（如服务范围按省份推导）。 */
    toggle: (checked: boolean, onEnabled?: () => void) => {
      if (!checked) {
        setChoice(false);
        return;
      }
      void (async () => {
        // 刚打开弹层就手快点勾时绑定状态可能还在路上，补一次再判定，免得误拦已绑定的用户
        let ok = bound;
        if (!ok && keyStatus.isPending) ok = !!(await keyStatus.refetch()).data?.bound;
        if (!ok) {
          modal.confirm({
            title: "同步到 AIworkin 需先绑定 AIPDD APIKey",
            content: (
              <span>
                本地发布不需要 Key，{options.subject}照常进本站信息流。要同步到 AIworkin 获得更多关注，
                请先到「开放集成 → <Link href="/developer/keys">API Key 管理</Link>」粘贴 sk- Key 绑定，回来这一项会默认勾选。
              </span>
            ),
            okText: "去绑定",
            cancelText: "仅本地发布",
            onOk: () => router.push("/developer/keys"),
          });
          return;
        }
        setChoice(true);
        onEnabled?.();
      })();
    },
  };
}
