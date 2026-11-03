"use client";

import { App, Form, Input, Modal } from "antd";
import { useEffect } from "react";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { useSession } from "@/lib/session";
import { contactApi, type ContactResource } from "@/api/contacts";
import { useOperationMutation } from "@/query/business";

/**
 * 「改联系方式」弹窗（各环节通用）。
 * 系统按对应人档案自动带出联系方式，临时换人时在此人工覆盖：
 * 企业侧 = 法定代表人/经营者/姓名 + 档案电话；执行侧 = 承办人（职员实名/服务商备案联系人）+ 电话。
 * **归属限制（用户口径）**：企业只能改企业自己的（企业侧），服务商只能改服务商自己的、
 * 职员只能改职员自己的（执行侧）——对方那一侧只读展示，由对方维护。
 */
export type ContactEditTarget = {
  resource: ContactResource;
  id: number;
  /** 单据号（标题展示） */
  no?: string;
  contactName?: string | null;
  contactPhone?: string | null;
  providerContactName?: string | null;
  providerContactPhone?: string | null;
  /** 双方称谓：默认「企业侧」/「执行侧」（按环节可写成 发货方/承运方 等） */
  partyLabel?: string;
  providerLabel?: string;
};

/** 本侧可改范围：平台管理员两侧都可改；服务商账号与承办职员＝执行侧；企业＝企业侧。 */
function ownSideOf(identity: string) {
  if (identity === "PLATFORM_ADMIN") return "both" as const;
  if (identity === "SERVICE_PROVIDER" || identity === "PROVIDER_STAFF") {
    return "provider_contact" as const;
  }
  return "contact" as const;
}

/** 对方那一侧：只读展示（自己不能改对方的人）。 */
function ContactReadonly({
  label,
  name,
  phone,
}: {
  label: string;
  name?: string | null;
  phone?: string | null;
}) {
  return (
    <div className="form-2col" style={{ marginBottom: 8 }}>
      <div>
        <div className="text-12 muted">{label}联系人</div>
        <div>{String(name || "").trim() || "—"}</div>
      </div>
      <div>
        <div className="text-12 muted">{label}电话</div>
        <div>{String(phone || "").trim() || "—"}</div>
      </div>
    </div>
  );
}

export function ContactEditModal({
  target,
  onClose,
}: {
  target: ContactEditTarget | null;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const { me } = useSession();
  const { request, modal } = usePasswordConfirm();
  const [form] = Form.useForm();

  const side = ownSideOf(me?.currentIdentity || "ENTERPRISE_USER");
  const canEditContact = side !== "provider_contact";
  const canEditProvider = side !== "contact";

  useEffect(() => {
    if (!target) return;
    form.setFieldsValue({
      contact_name: target.contactName || "",
      contact_phone: target.contactPhone || "",
      provider_contact_name: target.providerContactName || "",
      provider_contact_phone: target.providerContactPhone || "",
    });
  }, [target, form]);

  const updateMutation = useOperationMutation(contactApi.update, ["*"]);
  const save = async () => {
    if (!target) return;
    const values = (await form.validateFields()) as Record<string, string>;
    const payload: Record<string, string> = {};
    if (canEditContact) {
      payload.contact_name = values.contact_name || "";
      payload.contact_phone = values.contact_phone || "";
    }
    if (canEditProvider) {
      payload.provider_contact_name = values.provider_contact_name || "";
      payload.provider_contact_phone = values.provider_contact_phone || "";
    }
    request({
      title: "修改联系方式（需密码）",
      okText: "保存",
      content: `确认修改${target.no ? `「${target.no}」的` : ""}环节联系方式？修改后本单后续环节按新联系人对接。`,
      onOk: async () => {
        await updateMutation.mutateAsync({
          resource: target.resource,
          id: target.id,
          body: payload,
        });
        message.success("联系方式已更新");
        onClose();
      },
    });
  };

  const party = target?.partyLabel || "企业侧";
  const provider = target?.providerLabel || "执行侧";

  return (
    <>
      <Modal
        open={Boolean(target)}
        title={`改联系方式${target?.no ? ` · ${target.no}` : ""}`}
        width={560}
        onCancel={onClose}
        okText="保存"
        onOk={() => void save()}
        destroyOnHidden
      >
        <div className="text-12 muted" style={{ marginBottom: 12 }}>
          系统已按对应人档案自动带出：{party}取企业档案（法定代表人/经营者/姓名
          + 联系电话），{provider}
          取承办人（职员实名或服务商备案联系人）。只能修改自己这一侧（对方那一侧由对方维护），
          临时换人时在此修改，仅影响本单。
        </div>
        <Form form={form} layout="vertical">
          {canEditContact ? (
            <div className="form-2col">
              <Form.Item name="contact_name" label={`${party}联系人`}>
                <Input placeholder="如：临时对接人张三" />
              </Form.Item>
              <Form.Item name="contact_phone" label={`${party}电话`}>
                <Input placeholder="如：13500001111" />
              </Form.Item>
            </div>
          ) : (
            <ContactReadonly
              label={party}
              name={target?.contactName}
              phone={target?.contactPhone}
            />
          )}
          {canEditProvider ? (
            <div className="form-2col">
              <Form.Item
                name="provider_contact_name"
                label={`${provider}联系人`}
              >
                <Input placeholder="如：临时作业人李师傅" />
              </Form.Item>
              <Form.Item
                name="provider_contact_phone"
                label={`${provider}电话`}
              >
                <Input placeholder="如：13600002222" />
              </Form.Item>
            </div>
          ) : (
            <ContactReadonly
              label={provider}
              name={target?.providerContactName}
              phone={target?.providerContactPhone}
            />
          )}
        </Form>
      </Modal>
      {modal}
    </>
  );
}
