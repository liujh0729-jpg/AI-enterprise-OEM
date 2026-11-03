"use client";

import { App, Button, Form, Input, Popconfirm, Space, Spin, Tag } from "antd";
import { Notice, Panel } from "@/components/ui/panel";
import {
  useAipddPlatformKey,
  useClearAipddPlatformKey,
  useSaveAipddPlatformKey,
} from "@/query/settings";
import { fmtTime } from "@/lib/datetime";

/** 与后端 `AIPDD_KEY_PATTERN` 同口径：sk- 开头 + 48 位十六进制。 */
const KEY_PATTERN = /^sk-[a-fA-F0-9]{48}$/;

const sourceLabel: Record<string, string> = {
  db: "后台配置",
  env: "部署环境变量",
};

type KeyForm = { key: string };

/**
 * 平台级 AIPDD APIKey（基础数据通道）。
 * 省市字典、平台字典项这类参照数据由平台统一 Key 调用上游，普通用户不必先绑 Key
 * 就能加载表单里的地区下拉；发布需求、建联同步等用户动作仍使用各自绑定的 Key。
 * 未配置也不报错：地区字典自动回落本地内置省市表（backend/src/shared/region-dictionary.ts）。
 */
export function AipddPlatformKeyPanel() {
  const { message } = App.useApp();
  const keyQuery = useAipddPlatformKey();
  const saveMutation = useSaveAipddPlatformKey();
  const clearMutation = useClearAipddPlatformKey();
  const data = keyQuery.data;
  const loading = keyQuery.isPending;
  const saving = saveMutation.isPending || clearMutation.isPending;
  const error = keyQuery.error?.message;
  const [form] = Form.useForm<KeyForm>();

  const save = async (values: KeyForm) => {
    try {
      await saveMutation.mutateAsync(values.key.trim());
      form.resetFields();
      message.success("平台 AIPDD APIKey 已保存，基础数据调用立即生效");
    } catch {
      // 操作错误由统一 Mutation Hook 呈现。
    }
  };

  const clear = async () => {
    try {
      await clearMutation.mutateAsync();
      form.resetFields();
      message.success("已清除平台 AIPDD APIKey");
    } catch {
      // 操作错误由统一 Mutation Hook 呈现。
    }
  };

  return (
    <Panel
      title="AIPDD 平台 Key"
      titleBadge={<span className="text-12 muted">基础数据通道</span>}
    >
      <Notice variant="info">
        平台统一 Key，用于加载省市字典、平台字典项等基础数据（参照数据与用户身份无关）。
        用户发布需求、同步上游、查看建联资源等动作仍使用各自在「开放集成 → API Key 管理」
        绑定的 Key，不受此处影响。Key 加密保存、只回显掩码；更换需重新填写。
      </Notice>
      {loading ? (
        <Spin style={{ marginTop: 16 }} />
      ) : error ? (
        <Notice variant="error">
          {error}{" "}
          <Button onClick={() => void keyQuery.refetch()}>重新加载</Button>
        </Notice>
      ) : data ? (
        <>
          {!data.configured ? (
            <Notice variant="warn">
              尚未配置平台 Key：地区等基础数据目前回落本地内置省市字典，平台字典项需用户先绑定
              AIPDD Key。请填写并保存本项（必填）。
            </Notice>
          ) : null}
          <Space wrap style={{ margin: "16px 0" }}>
            <Tag color={data.configured ? "green" : "default"}>
              {data.configured ? "已配置" : "未配置"}
            </Tag>
            {data.configured && data.source !== "db" ? (
              <Tag>{sourceLabel[data.source] ?? data.source}</Tag>
            ) : null}
            {data.masked ? (
              <span className="text-12 muted">
                当前使用：<span className="mono">{data.masked}</span>
              </span>
            ) : null}
            {data.updatedAt ? (
              <span className="text-12 muted">
                最近保存：{fmtTime(data.updatedAt)}
              </span>
            ) : null}
          </Space>
          <Form<KeyForm>
            form={form}
            layout="vertical"
            onFinish={save}
            disabled={saving}
            autoComplete="off"
            style={{ maxWidth: 560 }}
          >
            <Form.Item
              name="key"
              label="AIPDD APIKey"
              rules={[
                { required: true, whitespace: true, message: "请填写平台 AIPDD APIKey" },
                {
                  pattern: KEY_PATTERN,
                  message: "格式不正确（应为 sk- 开头的 51 位字符）",
                },
              ]}
            >
              <Input.Password
                autoComplete="new-password"
                maxLength={200}
                placeholder={
                  data.configured ? "输入新的平台 APIKey" : "填写 sk- 开头的 APIKey"
                }
              />
            </Form.Item>
            <Space wrap>
              <Button type="primary" htmlType="submit" loading={saveMutation.isPending}>
                {data.configured ? "更新平台 Key" : "保存平台 Key"}
              </Button>
              {data.source === "db" ? (
                <Popconfirm
                  title="清除平台 AIPDD APIKey？"
                  description="清除后基础数据将回落本地字典或用户各自绑定的 Key。"
                  okText="清除"
                  okButtonProps={{ danger: true, loading: clearMutation.isPending }}
                  cancelText="取消"
                  onConfirm={() => void clear()}
                >
                  <Button danger disabled={saving}>
                    清除
                  </Button>
                </Popconfirm>
              ) : null}
            </Space>
          </Form>
          {data.source === "env" ? (
            <p className="text-12 muted" style={{ marginTop: 16 }}>
              当前生效的是部署环境变量 AIPDD_PLATFORM_KEY；在此保存后以数据库密文为准（优先级高于环境变量）。
            </p>
          ) : null}
        </>
      ) : null}
    </Panel>
  );
}
