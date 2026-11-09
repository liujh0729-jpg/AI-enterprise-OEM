"use client";

import { App, Modal, Radio, Button } from "antd";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { identityLabel } from "@/lib/identity";
import { useSession } from "@/lib/session";
import { subjectLabel } from "@/lib/subject";

export function IdentitySelectModal() {
  const router = useRouter();
  const { message } = App.useApp();
  const { me, switchIdentity } = useSession();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!me) return;
    const identities = me.identities || [];
    // 多身份且未选择过（或首次访问）时弹出
    if (identities.length > 1 && !localStorage.getItem("identity_selected")) {
      setOpen(true);
      setSelected(me.currentIdentity || identities[0]);
    }
  }, [me]);

  const handleConfirm = async () => {
    if (!selected) return;
    setLoading(true);
    // 先落标记：切换身份会刷新 me，effect 再跑时不应把弹窗重新打开
    const previousSelection = localStorage.getItem("identity_selected");
    localStorage.setItem("identity_selected", "1");
    try {
      await switchIdentity(selected);
      setOpen(false);
      router.replace("/dashboard");
    } catch (error) {
      if (previousSelection === null) localStorage.removeItem("identity_selected");
      else localStorage.setItem("identity_selected", previousSelection);
      message.error(error instanceof Error ? error.message : "身份切换失败");
    } finally {
      setLoading(false);
    }
  };

  if (!me || (me.identities || []).length <= 1) return null;

  return (
    <Modal
      open={open}
      title="请选择进入身份"
      closable={false}
      mask={{ closable: false }}
      footer={[
        <Button
          key="confirm"
          type="primary"
          loading={loading}
          onClick={handleConfirm}
        >
          进入 →
        </Button>,
      ]}
    >
      <div style={{ padding: "16px 0" }}>
        <Radio.Group
          value={selected}
          disabled={loading}
          onChange={(e) => setSelected(e.target.value)}
          style={{ width: "100%" }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {(me.identities || []).map((id) => (
              <Radio key={id} value={id} style={{ width: "100%" }}>
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {identityLabel(id, me.enterprise?.subjectType)}
                  </div>
                  {id === "ENTERPRISE_USER" && me.enterprise && (
                    <div className="text-12 muted" style={{ marginTop: 4 }}>
                      {String((me.enterprise as Record<string, unknown>).name || "")}
                      {` · 主体类型${subjectLabel((me.enterprise as Record<string, unknown>).subjectType)}`}
                    </div>
                  )}
                  {id === "SERVICE_PROVIDER" && me.providerApps && (
                    <div className="text-12 muted" style={{ marginTop: 4 }}>
                      {Array.isArray(me.providerApps) ? `${me.providerApps.length} 项备案` : ""}
                    </div>
                  )}
                  {id === "PROVIDER_STAFF" && me.staffOf && (
                    <div className="text-12 muted" style={{ marginTop: 4 }}>
                      {Array.isArray(me.staffOf) ? `${me.staffOf.length} 家绑定机构` : ""}
                    </div>
                  )}
                </div>
              </Radio>
            ))}
          </div>
        </Radio.Group>
      </div>
    </Modal>
  );
}
