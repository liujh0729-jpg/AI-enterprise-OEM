"use client";

import { useEffect, useState } from "react";
import { App, Button, Form, Input, Space, Spin, Tag } from "antd";
import { Notice, Panel } from "@/components/ui/panel";
import {
  useOssSettings,
  useSaveOssSettings,
  useTestOssSettings,
} from "@/query/settings";
import { fmtTime } from "@/lib/datetime";

type OssForm = {
  bucket: string;
  endpoint: string;
  region: string;
  dir: string;
  accessKeyId: string;
  accessKeySecret: string;
  securityToken: string;
};

const sourceLabel: Record<string, string> = {
  db: "后台配置",
  env: "部署环境变量",
  none: "未配置",
};

export function OssSettingsPanel() {
  const { message } = App.useApp();
  const settingsQuery = useOssSettings();
  const saveMutation = useSaveOssSettings();
  const testMutation = useTestOssSettings();
  const data = settingsQuery.data;
  const loading = settingsQuery.isPending;
  const saving = saveMutation.isPending;
  const testing = testMutation.isPending;
  const error = settingsQuery.error?.message;
  const [form] = Form.useForm<OssForm>();
  const [probe, setProbe] = useState<{ key: string; url: string } | null>(null);

  useEffect(() => {
    if (!data) return;
    form.setFieldsValue({
      bucket: data.bucket,
      endpoint: data.endpoint,
      region: data.region,
      dir: data.dir,
      accessKeyId: "",
      accessKeySecret: "",
      securityToken: "",
    });
  }, [data, form]);

  const save = async (values: OssForm) => {
    try {
      const saved = await saveMutation.mutateAsync({
        bucket: values.bucket.trim(),
        endpoint: values.endpoint.trim(),
        region: values.region.trim(),
        dir: values.dir.trim(),
        accessKeyId: values.accessKeyId.trim(),
        accessKeySecret: values.accessKeySecret.trim(),
        securityToken: values.securityToken.trim(),
      });
      form.setFieldsValue({
        accessKeyId: "",
        accessKeySecret: "",
        securityToken: "",
      });
      setProbe(null);
      message.success(
        `文件存储配置已保存（${saved?.bucket ?? values.bucket.trim()}），后续上传立即生效`,
      );
    } catch {
      // 操作错误由统一 Mutation Hook 呈现。
    }
  };

  const probeConnection = async () => {
    try {
      const result = await testMutation.mutateAsync();
      setProbe(result ? { key: result.key, url: result.url } : null);
      message.success(
        result
          ? `连接成功：已向 ${result.bucket} 上传探针文件`
          : "连接成功",
      );
    } catch {
      setProbe(null);
    }
  };

  return (
    <Panel
      title="文件存储（OSS）"
      titleBadge={<span className="text-12 muted">平台统一存储</span>}
    >
      <Notice variant="info">
        服务商资质附件、活码图片等平台附件统一上传至该 Bucket 并公开读取。AccessKey
        加密保存、不回显；留空的密钥字段沿用已保存值，保存后立即生效、无需重启。仅支持阿里云
        OSS。
      </Notice>
      {loading ? (
        <Spin style={{ marginTop: 16 }} />
      ) : error ? (
        <Notice variant="error">
          {error} <Button onClick={() => void settingsQuery.refetch()}>重新加载</Button>
        </Notice>
      ) : data ? (
        <>
          <Space wrap style={{ margin: "16px 0" }}>
            <Tag color={data.configured ? "green" : "default"}>
              {data.configured ? "已配置" : "未配置"}
            </Tag>
            {data.configured ? (
              <Tag>{sourceLabel[data.source] ?? data.source}</Tag>
            ) : null}
            {data.bucket ? (
              <span className="text-12 muted mono">
                oss://{data.bucket}/{data.dir}
              </span>
            ) : null}
            {data.accessKeyIdMasked ? (
              <span className="text-12 muted">
                AccessKey：<span className="mono">{data.accessKeyIdMasked}</span>
              </span>
            ) : null}
            {data.updatedAt ? (
              <span className="text-12 muted">最近保存：{fmtTime(data.updatedAt)}</span>
            ) : null}
          </Space>
          <Form<OssForm>
            form={form}
            layout="vertical"
            onFinish={save}
            disabled={saving || testing}
            autoComplete="off"
            style={{ maxWidth: 560 }}
          >
            <Form.Item
              name="bucket"
              label="Bucket"
              rules={[
                { required: true, whitespace: true, message: "请填写 Bucket" },
                { max: 63 },
              ]}
            >
              <Input maxLength={63} placeholder="aiworkinenterprise" />
            </Form.Item>
            <Form.Item
              name="endpoint"
              label="Endpoint"
              tooltip="只填域名，不带 https:// 与路径"
              rules={[
                { required: true, whitespace: true, message: "请填写 Endpoint" },
                { max: 128 },
              ]}
            >
              <Input maxLength={128} placeholder="oss-cn-beijing.aliyuncs.com" />
            </Form.Item>
            <Form.Item
              name="region"
              label="Region"
              rules={[
                { required: true, whitespace: true, message: "请填写 Region" },
                { max: 32 },
              ]}
            >
              <Input maxLength={32} placeholder="cn-beijing" />
            </Form.Item>
            <Form.Item
              name="dir"
              label="上传目录"
              tooltip="对象键前缀，留空表示 Bucket 根目录"
              rules={[{ max: 200 }]}
            >
              <Input maxLength={200} placeholder="asset/" />
            </Form.Item>
            <Form.Item
              name="accessKeyId"
              label="AccessKey ID"
              rules={data.configured ? [{ max: 256 }] : [{ required: true, whitespace: true, message: "请填写 AccessKey ID" }]}
            >
              <Input.Password
                autoComplete="new-password"
                maxLength={256}
                placeholder={
                  data.accessKeyIdMasked
                    ? `已保存 ${data.accessKeyIdMasked}，留空沿用`
                    : "填写 AccessKey ID"
                }
              />
            </Form.Item>
            <Form.Item
              name="accessKeySecret"
              label="AccessKey Secret"
              className="text-12"
              rules={data.configured ? [{ max: 512 }] : [{ required: true, whitespace: true, message: "请填写 AccessKey Secret" }]}
            >
              <Input.Password
                autoComplete="new-password"
                maxLength={512}
                placeholder={data.configured ? "留空沿用已保存的 Secret" : "填写 AccessKey Secret"}
              />
            </Form.Item>
            <Form.Item
              name="securityToken"
              label="STS Token（可选）"
              tooltip="仅使用 STS 临时凭据时需要填写"
              rules={[{ max: 4096 }]}
            >
              <Input.Password autoComplete="new-password" maxLength={4096} placeholder="使用永久 AccessKey 时留空" />
            </Form.Item>
            <Space wrap>
              <Button type="primary" htmlType="submit" loading={saving}>
                {data.configured ? "保存配置" : "启用文件存储"}
              </Button>
              <Button onClick={() => void probeConnection()} loading={testing}>
                测试连接
              </Button>
            </Space>
          </Form>
          {probe ? (
            <p className="text-12 muted" style={{ marginTop: 12 }}>
              探针对象：<span className="mono">{probe.key}</span>
              <br />
              访问地址：<span className="mono">{probe.url}</span>
            </p>
          ) : null}
          <p className="text-12 muted" style={{ marginTop: 16 }}>
            测试连接会向当前生效的 Bucket 上传一个 1×1
            像素探针图片（healthcheck/），请确认该目录允许公开读取，否则附件链接无法直接访问。
          </p>
        </>
      ) : null}
    </Panel>
  );
}