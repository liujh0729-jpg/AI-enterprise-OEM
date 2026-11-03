"use client";

import { CheckCircleOutlined, WarningOutlined } from "@ant-design/icons";
import { App, Button, Form, Input, Radio, Select, Space } from "antd";
import { useEffect } from "react";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { LocationFields } from "@/components/location-fields";
import { Notice } from "@/components/ui/panel";
import { useEnterpriseProfile, useIdentityActions } from "@/query/identity";
import { type EndpointResponse } from "@enterprise/contracts";
import { SUBJECT_OPTIONS, isPersonalSubject, subjectLabel } from "@/lib/subject";

export type EnterpriseProfile = NonNullable<EndpointResponse<"Identity_enterprise">["data"]>;

const TAXPAYER_OPTIONS = [
  { value: "GENERAL", label: "一般纳税人" },
  { value: "SMALL_SCALE", label: "小规模纳税人" },
];

/** 历史数据兼容：早期版本写入 SMALL，统一归一到 SMALL_SCALE。 */
export function normalizeTaxpayerType(value: string) {
  return value === "SMALL" ? "SMALL_SCALE" : value;
}

/** 用户信息（用户身份资质 · 提交即生效；主体类型三分，材料随类型改变）。 */
export function EnterpriseForm({ onSaved }: { onSaved: () => void }) {
  const { message } = App.useApp();
  const { request: requestPassword, modal: passwordModal } = usePasswordConfirm();
  const [form] = Form.useForm();
  const profileQuery = useEnterpriseProfile();
  const actions = useIdentityActions();
  const profile = profileQuery.data;
  const load = async () => { await profileQuery.refetch(); };
  const submitting = actions.createEnterprise.isPending || actions.updateEnterprise.isPending;
  const subjectType = String(Form.useWatch("subject_type", form) || "COMPANY");
  const personal = subjectType === "PERSONAL";
  const individual = subjectType === "INDIVIDUAL";

  useEffect(() => {
    if(!profileQuery.isSuccess) return;
    const data = profileQuery.data;
    form.setFieldsValue({
      subject_type: data?.subjectType || "COMPANY",
      name: data?.name || "",
      uscc: data?.uscc || "",
      id_card: data?.idCard || "",
      taxpayer_type: normalizeTaxpayerType(data?.taxpayerType || "GENERAL"),
      industry: data?.industry || "",
      legal_person: data?.legalPerson || "",
      phone: data?.phone || "",
      province: data?.province || "",
      city: data?.city || "",
      address: data?.address || "",
      qxy_org_id: data?.qxyOrgId || "",
    });
  }, [form, profileQuery.data, profileQuery.isSuccess]);

  const buildBody = (values: Record<string, unknown>) => ({
    subject_type: String(values.subject_type || "COMPANY"),
    name: String(values.name || "").trim(),
    uscc: String(values.uscc || "").trim(),
    id_card: String(values.id_card || "").trim(),
    taxpayer_type: String(values.taxpayer_type || 'GENERAL'),
    industry: String(values.industry || "").trim(),
    legal_person: String(values.legal_person || "").trim(),
    phone: String(values.phone || "").trim(),
    province: String(values.province || "").trim(),
    city: String(values.city || "").trim(),
    address: String(values.address || "").trim(),
    qxy_org_id: String(values.qxy_org_id || "").trim(),
  });

  /** 已有档案 → 修改（需密码）；否则 → 提交（免密）。 */
  const save = async (values: Record<string, unknown>) => {
    const body = buildBody(values);
    if (!profile?.id) {
      try {
        await actions.createEnterprise.mutateAsync(body);
        message.success("用户信息已提交并生效，用户身份资质已具备");
        onSaved();
      } catch { /* 统一 Mutation Hook 已展示错误。 */ }
      return;
    }
    requestPassword({
      title: "修改用户信息（需密码）",
      content: `确认修改「${profile.name}」的用户信息？主体类型 / 名称 / 统一社会信用代码 / 身份证号 / 纳税人性质在存在生效中签约时不可修改。`,
      okText: "保存修改",
      onOk: async () => {
        await actions.updateEnterprise.mutateAsync(body);
        message.success("用户信息已更新");
        onSaved();
      },
    });
  };

  const removeProfile = () => {
    if (!profile) return;
    requestPassword({
      title: "删除用户信息",
      danger: true,
      okText: "确认删除",
      content: `删除后用户身份资质失效，需重新提交；已有签约或业务单据时不可删除。确定删除「${profile.name}」？`,
      onOk: async () => {
        await actions.removeEnterprise.mutateAsync();
        message.success("用户信息已删除");
        onSaved();
      },
    });
  };

  if(profileQuery.isPending) return <Notice variant="info">资料加载中…</Notice>;
  if(profileQuery.isError) return <Notice variant="error">{profileQuery.error.message} <Button onClick={() => void load()}>重试</Button></Notice>;

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={{ subject_type: "COMPANY", taxpayer_type: "GENERAL" }}
      onFinish={(values) => void save(values)}
    >
      {profile ? (
        profile.status === "REJECTED" ? (
          <Notice variant="warn">
            <WarningOutlined aria-hidden />
            {` 档案未通过：${profile.auditNote || "未填写原因"}。请修正后重新提交。`}
          </Notice>
        ) : (
          <Notice>
            <CheckCircleOutlined aria-hidden />
            {` 用户信息已生效（${String(profile.auditedAt || profile.createdAt || "").slice(0, 10)}）：主体类型「${subjectLabel(profile.subjectType)}」，${isPersonalSubject(profile.subjectType) ? "可浏览全部板块、查看需求并申请加入服务商；财税与出海的签约 / 申报 / 账套 / 发布需求需以「企业」或「个体工商户」主体办理" : "可发起与服务商的签约并享受平台服务"}。`}
          </Notice>
        )
      ) : (
        <Notice>
          提交即生效：用户信息提交后无需平台审核，立即具备用户身份资质。个人主体只需姓名与身份证号，可正常浏览「财税服务」与「跨境出海」并申请加入服务商，但签约、申报、账套、发布需求四类办理需以「企业」或「个体工商户」主体。
        </Notice>
      )}

      <Form.Item
        name="subject_type"
        label="主体类型"
        rules={[{ required: true, message: "请选择主体类型" }]}
        extra="认证材料随主体类型改变：企业＝名称 + 统一社会信用代码；个体工商户＝字号名称 + 统一社会信用代码 + 经营者；个人＝姓名 + 身份证号（个人主体只锁签约 / 申报 / 账套 / 发布需求四类办理，板块页面照常可看）"
      >
        <Radio.Group
          optionType="button"
          buttonStyle="solid"
          options={SUBJECT_OPTIONS.map((item) => ({ ...item }))}
        />
      </Form.Item>

      <div className="form-2col">
        <Form.Item
          name="name"
          label={personal ? "姓名" : individual ? "个体工商户名称（字号）" : "企业名称"}
          rules={[{ required: true, message: personal ? "姓名必填" : "名称必填" }]}
        >
          <Input placeholder={personal ? "身份证姓名" : "营业执照登记名称"} />
        </Form.Item>
        {personal ? (
          <Form.Item
            name="id_card"
            label="身份证号"
            rules={[
              { required: true, message: "身份证号必填" },
              {
                pattern: /^\d{17}[\dXx]$/,
                message: "请填写 18 位身份证号（末位可为 X）",
              },
            ]}
          >
            <Input placeholder="18 位身份证号" />
          </Form.Item>
        ) : (
          <Form.Item
            name="uscc"
            label="统一社会信用代码"
            rules={[{ required: true, message: "统一社会信用代码必填" }]}
          >
            <Input placeholder="18 位统一社会信用代码" />
          </Form.Item>
        )}
        {personal ? null : (
          <Form.Item
            name="taxpayer_type"
            label="纳税人类型"
            rules={[{ required: true, message: "纳税人类型必填" }]}
          >
            <Select options={TAXPAYER_OPTIONS} />
          </Form.Item>
        )}
        {personal ? null : (
          <Form.Item name="industry" label="所属行业">
            <Input placeholder="如：制造业 / 批发零售 / 跨境电商" />
          </Form.Item>
        )}
        {personal ? null : (
          <Form.Item
            name="legal_person"
            label={individual ? "经营者" : "法定代表人"}
          >
            <Input placeholder={individual ? "经营者姓名" : "姓名"} />
          </Form.Item>
        )}
        <Form.Item name="phone" label="联系电话">
          <Input placeholder="手机号" />
        </Form.Item>
      </div>

      {personal ? null : (
        <Form.Item
          name="qxy_org_id"
          label="企享云企业 ID（aggOrgId）"
          extra="用于电子报税 / 电子开票自动办理；由企享云侧提供，未填写时「自动申报/自动开票」不可用"
        >
          <Input placeholder="如：10000012345" />
        </Form.Item>
      )}

      <LocationFields extra="所在省市为必填：企业按省市筛选服务商，服务商也按地域承接业务" />

      <Form.Item name="address" label={personal ? "联系地址" : "注册地址"}>
        <Input placeholder={personal ? "联系地址" : "注册地址"} />
      </Form.Item>

      <Space size={10} wrap>
        <Button type="primary" htmlType="submit" loading={submitting}>
          {profile?.id
            ? "保存修改（需密码）"
            : "提交用户信息（提交即生效）"}
        </Button>
        {profile?.id ? (
          <Button danger onClick={removeProfile}>
            删除用户信息
          </Button>
        ) : null}
      </Space>
      {passwordModal}
    </Form>
  );
}
