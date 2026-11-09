"use client";

import { Button, List, Modal, Tag } from "antd";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { gapsApi, type TermsDocument } from "@/api/gaps";
import { useSession } from "@/lib/session";
import { TERMS_CATEGORY_LABELS } from "@enterprise/contracts";

const DISMISS_KEY = "aiworkin-terms-dismissed";

/**
 * B3#26 条款接受留痕：有未接受的新版本时全站弹窗提示；
 * 「去阅读并接受」跳到独立阅读页，接受后写入版本、时间与 IP。
 */
export function TermsGate() {
  const router = useRouter();
  const pathname = usePathname();
  const { me } = useSession();
  const userId = me?.userId;
  const [pending, setPending] = useState<TermsDocument[]>([]);
  const [dismissed, setDismissed] = useState(false);

  const load = useCallback(async () => {
    if (!userId) {
      setPending([]);
      return;
    }
    try {
      const rows = await gapsApi.pendingTerms();
      const signature = (rows || []).map((row) => `${row.code}@${row.version}`).join(",");
      const sessionDismissed = window.sessionStorage.getItem(`${DISMISS_KEY}:${userId}`) || "";
      setPending(rows || []);
      setDismissed(Boolean(signature) && sessionDismissed === signature);
    } catch {
      // 辅助链路：条款接口失败不阻断使用
      setPending([]);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load, pathname]);

  const dismiss = () => {
    if (me?.userId) {
      const signature = pending.map((row) => `${row.code}@${row.version}`).join(",");
      window.sessionStorage.setItem(`${DISMISS_KEY}:${me.userId}`, signature);
    }
    setDismissed(true);
  };

  const open = pending.length > 0 && !dismissed;

  return (
    <Modal
      open={open}
      title="有新的条款需要确认"
      closable={false}
      mask={{ closable: false }}
      keyboard={false}
      footer={
        <Button onClick={dismiss} type="text">
          稍后处理
        </Button>
      }
      destroyOnHidden
    >
      <div className="text-12 muted" style={{ marginBottom: 8 }}>
        以下条款版本已生效，需要阅读并接受后继续使用。
      </div>
      <List
        size="small"
        bordered
        dataSource={pending}
        renderItem={(row) => (
          <List.Item
            actions={[
              <Button
                key="open"
                type="link"
                onClick={() => router.push(`/terms/${encodeURIComponent(row.code)}?version=${encodeURIComponent(row.version)}`)}
              >
                阅读并接受
              </Button>,
            ]}
          >
            <List.Item.Meta
              title={
                <>
                  {row.title} <Tag>v{row.version}</Tag>
                </>
              }
              description={TERMS_CATEGORY_LABELS[row.category] || row.categoryLabel}
            />
          </List.Item>
        )}
      />
    </Modal>
  );
}
