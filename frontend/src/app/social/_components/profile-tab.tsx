"use client";

import { App, Button, Form, Input, Select, Spin } from "antd";
import { useEffect } from "react";
import { EmptyState, Panel } from "@/components/ui/panel";
import { socialApi, type ProfileData } from "@/api/social";
import { useBusinessQuery, useOperationMutation } from "@/query/business";
import { useSession } from "@/lib/session";
import { PersonAvatar } from "./social-ui";
import { SocialSyncPanel } from "./sync-panel";

type ProfileForm = {
  title: string;
  city: string;
  gender: string;
  bio: string;
  phone: string;
  email: string;
  wechat: string;
};

const GENDER_LABELS: Record<string, string> = { MALE: "男", FEMALE: "女", UNSPECIFIED: "保密" };

/** 资料：左侧实时预览卡 + 右侧分组表单（基本信息 / 联系方式）。 */
export function ProfileTab() {
  const { message } = App.useApp();
  const { me } = useSession();
  const userId = me?.userId || "";
  const [form] = Form.useForm<ProfileForm>();
  const { data, isLoading } = useBusinessQuery(
    "social",
    "profile",
    { userId },
    (signal) => socialApi.getProfile(userId, { signal }),
    "all",
    Boolean(userId),
  );

  useEffect(() => {
    if (!data) return;
    const contacts = (data.profile.contacts || {}) as Record<string, string>;
    form.setFieldsValue({
      title: data.profile.title,
      city: data.profile.city,
      gender: data.profile.gender,
      bio: data.profile.bio,
      phone: contacts.phone || "",
      email: contacts.email || "",
      wechat: contacts.wechat || "",
    });
  }, [data, form]);

  // 表单实时值驱动左侧预览（未渲染表单时回落已保存资料）
  const watched = Form.useWatch([], form) as Partial<ProfileForm> | undefined;

  const save = useOperationMutation(
    (input: { body: Partial<ProfileData["profile"]> }) => socialApi.saveProfile(input.body),
    ["social"],
  );

  const onSubmit = async (values: ProfileForm) => {
    await save.mutateAsync({
      body: {
        title: values.title,
        city: values.city,
        gender: values.gender,
        bio: values.bio,
        contacts: { phone: values.phone, email: values.email, wechat: values.wechat },
      },
    });
    message.success("资料已保存");
  };

  if (!userId) return null;
  if (isLoading)
    return (
      <Panel title="我的资料">
        <Spin />
      </Panel>
    );
  if (!data)
    return (
      <Panel title="我的资料">
        <EmptyState text="资料读取失败，请刷新重试。" />
      </Panel>
    );

  const preview: ProfileForm = {
    title: watched?.title ?? data.profile.title ?? "",
    city: watched?.city ?? data.profile.city ?? "",
    gender: watched?.gender ?? data.profile.gender ?? "",
    bio: watched?.bio ?? data.profile.bio ?? "",
    phone: watched?.phone ?? ((data.profile.contacts || {}).phone as string) ?? "",
    email: watched?.email ?? ((data.profile.contacts || {}).email as string) ?? "",
    wechat: watched?.wechat ?? ((data.profile.contacts || {}).wechat as string) ?? "",
  };

  return (
    <div className="sns-profile">
      <div className="sns-profile-card">
        <div className="sns-profile-cover" />
        <div className="sns-profile-body">
          <div className="sns-profile-head">
            <div className="sns-profile-avatar">
              <PersonAvatar person={data.person} size={64} />
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <div className="sns-profile-name">{data.person.displayName || data.person.username}</div>
            <div className="sns-profile-handle">@{data.person.username}</div>
          </div>
          <div className="sns-tags" style={{ marginTop: 10 }}>
            {preview.title ? <span className="sns-flag sns-flag-tag">{preview.title}</span> : null}
            {preview.city ? <span className="sns-tag">{preview.city}</span> : null}
            {preview.gender ? <span className="sns-tag">{GENDER_LABELS[preview.gender] || preview.gender}</span> : null}
          </div>
          <div className="sns-profile-bio">{preview.bio || "还没有填写个人简介，写下你正在做的事吧。"}</div>
          <dl className="sns-kv">
            <dt>用户 ID</dt>
            <dd>{data.person.userId}</dd>
            {preview.phone ? (
              <>
                <dt>手机</dt>
                <dd>{preview.phone}</dd>
              </>
            ) : null}
            {preview.email ? (
              <>
                <dt>邮箱</dt>
                <dd>{preview.email}</dd>
              </>
            ) : null}
            {preview.wechat ? (
              <>
                <dt>微信</dt>
                <dd>{preview.wechat}</dd>
              </>
            ) : null}
          </dl>
        </div>
      </div>

      <Panel title="编辑资料" titleBadge={<span className="sns-muted">保存后立即生效</span>}>
        <Form form={form} layout="vertical" onFinish={onSubmit} requiredMark={false}>
          <div className="sns-section-title">基本信息</div>
          <div className="sns-form-grid">
            <Form.Item name="title" label="头衔 / 职位">
              <Input maxLength={120} placeholder="如：连续创业者 / CTO" />
            </Form.Item>
            <Form.Item name="city" label="所在城市">
              <Input maxLength={64} placeholder="如：上海" />
            </Form.Item>
            <Form.Item name="gender" label="性别">
              <Select
                options={[
                  { value: "UNSPECIFIED", label: "保密" },
                  { value: "MALE", label: "男" },
                  { value: "FEMALE", label: "女" },
                ]}
              />
            </Form.Item>
            <Form.Item name="bio" label="个人简介" className="sns-form-full">
              <Input.TextArea rows={4} maxLength={2000} showCount placeholder="介绍一下你自己和你正在做的事" />
            </Form.Item>
          </div>

          <div className="sns-divider" />
          <div className="sns-section-title">联系方式（填写后展示在资料卡）</div>
          <div className="sns-form-grid">
            <Form.Item name="phone" label="手机号">
              <Input maxLength={32} placeholder="选填" />
            </Form.Item>
            <Form.Item name="email" label="邮箱">
              <Input maxLength={160} placeholder="选填" />
            </Form.Item>
            <Form.Item name="wechat" label="微信号">
              <Input maxLength={64} placeholder="选填" />
            </Form.Item>
          </div>

          <Button type="primary" htmlType="submit" loading={save.isPending}>
            保存资料
          </Button>
        </Form>
      </Panel>

      <div style={{ gridColumn: "1 / -1" }}>
        <SocialSyncPanel />
      </div>
    </div>
  );
}