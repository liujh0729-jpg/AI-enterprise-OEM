"use client";

import { App, Button, Form, Input, Select } from "antd";
import { useEffect } from "react";
import { Notice } from "@/components/ui/panel";
import { LocationFields } from "@/components/location-fields";
import { useStaffProfile, useIdentityActions } from "@/query/identity";
import { type EndpointResponse } from "@enterprise/contracts";

export type StaffProfile = NonNullable<EndpointResponse<"Identity_staffProfile">["data"]>;

/** 职员/代理人的服务类目（可多选：你可承办的业务方向；十一个板块一项不少，与后端 STAFF_CATEGORIES 同源）。 */
const STAFF_CATEGORIES: [string, string][] = [
  ["TAX_FINANCE", "企业财税"],
  ["EXPORT_REFUND", "跨境出海"],
  ["LOGISTICS", "物流服务"],
  ["SMART_SERVICE", "IT服务"],
  ["LEGAL_SERVICE", "法律服务"],
  ["IP_SERVICE", "知识产权"],
  ["THINK_TANK_SERVICE", "智库服务"],
  ["FLEX_WORK", "灵活用工"],
  ["SUPPLY_NETWORK", "供销服务"],
  ["MARKETING", "营销服务"],
  ["ASSET_TRADE", "资产交易"],
];

/** 个人资料（职员/代理人身份资质）。 */
export function StaffProfileForm({ onSaved }: { onSaved: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const profileQuery = useStaffProfile();
  const actions = useIdentityActions();
  const profile = profileQuery.data;
  const load = async () => { await profileQuery.refetch(); };
  const submitting = actions.saveStaff.isPending;

  useEffect(() => {
    if(!profileQuery.isSuccess) return;
    const data = profileQuery.data;
    form.setFieldsValue({
      real_name: data?.realName || "",
      phone: data?.phone || "",
      email: data?.email || "",
      province: data?.province || "",
      city: data?.city || "",
      region: data?.region || "",
      categories: data?.categories || [],
      qualification: data?.qualification || "",
      intro: data?.intro || "",
    });
  }, [form, profileQuery.data, profileQuery.isSuccess]);

  if(profileQuery.isPending) return <Notice variant="info">资料加载中…</Notice>;
  if(profileQuery.isError) return <Notice variant="error">{profileQuery.error.message} <Button onClick={() => void load()}>重试</Button></Notice>;

  return (
    <Form
      form={form}
      layout="vertical"
      onFinish={async (values) => {
        const cats = (values.categories || []) as string[];
        if (!cats.length) {
          message.warning("请至少选择一项服务类目");
          return;
        }
        try {
          await actions.saveStaff.mutateAsync({
            real_name: String(values.real_name || "").trim(),
            phone: String(values.phone || "").trim(),
            email: String(values.email || "").trim(),
            province: String(values.province || "").trim(),
            city: String(values.city || "").trim(),
            region: String(values.region || "").trim(),
            categories: cats,
            qualification: String(values.qualification || "").trim(),
            intro: String(values.intro || "").trim(),
          });
          message.success("个人资料已提交（职员/代理人身份）");
          onSaved();
        } catch { /* 统一 Mutation Hook 已展示错误。 */ }
      }}
    >
      <div className="muted" style={{ marginBottom: 14 }}>
        {profile?.id
          ? "个人资料已提交；更新后即时生效，已绑定的服务商可见你的最新资料。"
          : "提交个人资料后，服务商即可在职员名录中搜索并绑定你的账号，把企业业务派给你办理。"}
      </div>

      <div className="form-2col">
        <Form.Item
          name="real_name"
          label="真实姓名"
          rules={[{ required: true, message: "真实姓名必填" }]}
        >
          <Input placeholder="与证件一致（工单以你的账号承办）" />
        </Form.Item>
        <Form.Item
          name="phone"
          label="手机号"
          rules={[{ required: true, message: "手机号必填" }]}
        >
          <Input placeholder="手机号（服务商联系你时使用）" />
        </Form.Item>
        <Form.Item
          name="email"
          label="邮箱"
          rules={[{ type: "email", message: "邮箱格式不正确" }]}
        >
          <Input placeholder="name@example.com" />
        </Form.Item>
      </div>

      <LocationFields extra="所在省市必填：服务商按地域派单、企业按省市查找职员/代理人" />

      <Form.Item name="region" label="所在区/县（选填，比城市更细）">
        <Input placeholder="如：余杭区 / 浦东新区" />
      </Form.Item>

      <Form.Item
        name="categories"
        label="服务类目（可多选：你可承办的业务方向）"
        rules={[{ required: true, message: "请至少选择一项服务类目" }]}
        extra="服务类目决定服务商可将哪些业务方向的工单派给你（如仅企业财税与跨境出海）"
      >
        <Select
          mode="multiple"
          placeholder="可多选"
          options={STAFF_CATEGORIES.map(([value, label]) => ({ value, label }))}
        />
      </Form.Item>

      <Form.Item name="qualification" label="资质证书说明">
        <Input.TextArea
          rows={2}
          placeholder="如：中级会计师、税务师、律师执业证、报关员证等（选填）"
        />
      </Form.Item>

      <Form.Item
        name="intro"
        label="个人简介"
        rules={[{ required: true, message: "个人简介必填" }]}
      >
        <Input.TextArea rows={3} placeholder="从业年限、擅长业务、服务过的行业等" />
      </Form.Item>

      <Button type="primary" htmlType="submit" loading={submitting}>
        {profile?.id ? "保存个人资料" : "提交个人资料"}
      </Button>
    </Form>
  );
}
