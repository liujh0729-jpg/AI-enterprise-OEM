"use client";

import { BankOutlined, CheckOutlined, DownOutlined } from "@ant-design/icons";
import { Button, Dropdown, message } from "antd";
import { useEffect, useState } from "react";
import { gapsApi, type OrgContext } from "@/api/gaps";
import { useSession } from "@/lib/session";

/**
 * B3#29 主体切换器：同一自然人可能既是企业负责人又是服务商负责人/成员；
 * 切换后 HRM 作用域按所选组织解析，页面数据随之切换。
 */
export function OrgContextSwitcher() {
  const { me } = useSession();
  const [contexts, setContexts] = useState<OrgContext[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!me?.userId) {
      setContexts([]);
      return;
    }
    void gapsApi
      .orgContexts()
      .then((rows) => setContexts(rows || []))
      .catch(() => setContexts([]));
  }, [me?.userId, me?.currentIdentity]);

  // 单选不出控件：只有一个主体时不渲染切换器
  if (contexts.length <= 1) return null;
  const current = contexts.find((row) => row.current) || contexts[0];

  const switchTo = async (row: OrgContext) => {
    if (row.current || busy) return;
    setBusy(true);
    try {
      await gapsApi.switchOrgContext({
        body: { orgType: row.orgType as "ENTERPRISE" | "PROVIDER", orgUserId: row.orgUserId },
      });
      message.success(`已切换到「${row.name}」`);
      window.location.reload();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "主体切换失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dropdown
      trigger={["click"]}
      menu={{
        selectedKeys: [current.orgUserId],
        items: contexts.map((row) => ({
          key: row.orgUserId,
          icon: (
            <span className="workspace-identity-check">
              {row.current ? <CheckOutlined /> : null}
            </span>
          ),
          label: (
            <span className="workspace-identity-option">
              {row.name}
              <span className="text-12 muted">
                {row.orgType === "PROVIDER" ? "服务商" : "企业"} · {row.roleLabel}
              </span>
            </span>
          ),
        })),
        onClick: ({ key }) => {
          const target = contexts.find((row) => row.orgUserId === key);
          if (target) void switchTo(target);
        },
      }}
      disabled={busy}
    >
      <Button
        type="text"
        icon={<BankOutlined />}
        className="workspace-identity-trigger"
        aria-label={`当前主体：${current.name}，切换主体`}
      >
        <span className="workspace-identity-text">{current.name}</span>
        <DownOutlined className="workspace-identity-arrow" />
      </Button>
    </Dropdown>
  );
}
