"use client";

import { useEffect, useState } from "react";
import {
  App,
  Button,
  Checkbox,
  Form,
  Input,
  Select,
  Space,
  Switch,
  Table,
  Tag,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  ALIYUN_RISK_LABELS,
  PUBLISH_REVIEW_REGION_LABELS,
  PUBLISH_REVIEW_REGIONS,
} from "@enterprise/contracts";
import { Notice, Panel } from "@/components/ui/panel";
import {
  publishReviewApi,
  type PublishReviewLog,
  type PublishReviewTestResult,
} from "@/api/moderation";
import { presentMutationError } from "@/query/errors";
import { fmtTime } from "@/lib/datetime";
import { PermissionNotice, useAdminData } from "./common";

/* ============================================================
   平台管理后台「发布审核」：
   - 阿里云内容安全（绿网）AccessKey 加密保存，只回掩码；
   - 发布需求 / 服务必选，社群发帖 / 简历可选；
   - 命中违规直接阻断发布，上游故障降级放行并记台账。
   ============================================================ */

type FormValues = {
  enabled: boolean;
  region: (typeof PUBLISH_REVIEW_REGIONS)[number];
  accessKeyId: string;
  accessKeySecret: string;
  communityPost: boolean;
  resume: boolean;
};

const DECISION_META: Record<
  PublishReviewLog["decision"],
  { text: string; color: string }
> = {
  BLOCK: { text: "已拦截", color: "red" },
  REVIEW: { text: "疑似违规·已阻断", color: "orange" },
  ERROR: { text: "调用失败·已放行", color: "default" },
};

const labelNames = (labels: string[]) =>
  labels.map((label) => ALIYUN_RISK_LABELS[label] || label).join("、");

function AuditLogsPanel({
  page,
  onPage,
  reloadKey,
}: {
  page: number;
  onPage: (page: number) => void;
  reloadKey: number;
}) {
  const { data, loading, denied } = useAdminData(
    "admin-publish-review-logs",
    (signal) =>
      publishReviewApi.logs({ query: { page, pageSize: 20 } }, { signal }),
    { page, reloadKey },
  );

  const columns: ColumnsType<PublishReviewLog> = [
    {
      title: "时间",
      dataIndex: "createdAt",
      width: 150,
      render: (value: string) => (
        <span className="text-12 muted">{fmtTime(value)}</span>
      ),
    },
    {
      title: "场景",
      dataIndex: "sceneLabel",
      width: 100,
      render: (value: string) => <Tag>{value}</Tag>,
    },
    {
      title: "结果",
      dataIndex: "decision",
      width: 140,
      render: (value: PublishReviewLog["decision"]) => {
        const meta = DECISION_META[value];
        return <Tag color={meta?.color}>{meta?.text || value}</Tag>;
      },
    },
    {
      title: "命中分类",
      dataIndex: "labels",
      width: 150,
      render: (labels: string[]) =>
        labels.length ? (
          <span className="text-12">{labelNames(labels)}</span>
        ) : (
          <span className="muted">—</span>
        ),
    },
    {
      title: "文本摘要",
      dataIndex: "snippet",
      ellipsis: true,
      render: (value: string) => (
        <span className="text-12" title={value}>
          {value || "—"}
        </span>
      ),
    },
    {
      title: "说明",
      dataIndex: "reason",
      width: 260,
      ellipsis: true,
      render: (value: string) => (
        <span className="text-12 muted" title={value}>
          {value || "—"}
        </span>
      ),
    },
  ];

  return (
    <Panel
      title="审核台账"
      titleBadge={<span className="text-12 muted">仅记拦截 / 待复核 / 调用失败</span>}
    >
      <PermissionNotice denied={denied} />
      <Table<PublishReviewLog>
        rowKey="id"
        size="small"
        style={{ marginTop: 12 }}
        loading={loading}
        dataSource={data?.list ?? []}
        columns={columns}
        pagination={{
          current: page,
          pageSize: 20,
          total: data?.total ?? 0,
          showSizeChanger: false,
          onChange: onPage,
        }}
        locale={{ emptyText: "暂无拦截或失败记录" }}
      />
    </Panel>
  );
}

export function PublishReviewTab() {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testText, setTestText] = useState("");
  const [testResult, setTestResult] = useState<PublishReviewTestResult | null>(
    null,
  );
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const { data, loading, denied, reload } = useAdminData(
    "admin-publish-review",
    (signal) => publishReviewApi.view({}, { signal }),
  );

  useEffect(() => {
    if (!data) return;
    form.setFieldsValue({
      enabled: data.enabled,
      region: data.region,
      accessKeyId: "",
      accessKeySecret: "",
      communityPost: data.scenes.communityPost,
      resume: data.scenes.resume,
    });
  }, [data, form]);

  const save = async (values: FormValues) => {
    setSaving(true);
    try {
      const saved = await publishReviewApi.save({
        body: {
          enabled: values.enabled,
          region: values.region,
          accessKeyId: values.accessKeyId?.trim() || "",
          accessKeySecret: values.accessKeySecret?.trim() || "",
          scenes: {
            communityPost: Boolean(values.communityPost),
            resume: Boolean(values.resume),
          },
        },
      });
      form.setFieldsValue({ accessKeyId: "", accessKeySecret: "" });
      message.success(
        saved?.configured
          ? "发布审核配置已保存，下一次发布即时生效"
          : "配置已保存，但尚未填写 AccessKey",
      );
      setPage(1);
      setRefresh((value) => value + 1);
      await reload();
    } catch (error) {
      presentMutationError(error, message.error);
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    const text = testText.trim();
    if (!text) {
      message.warning("请先填写待检测文本");
      return;
    }
    setTesting(true);
    try {
      setTestResult(await publishReviewApi.test({ body: { text } }));
    } catch (error) {
      setTestResult(null);
      presentMutationError(error, message.error);
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <PermissionNotice denied={denied} />

      <Panel
        title="发布审核"
        titleBadge={
          <Space size={6}>
            <Tag color={data?.configured ? "green" : "default"}>
              {data?.configured ? "已配置" : "未配置"}
            </Tag>
            <Tag color={data?.enabled ? "blue" : "default"}>
              {data?.enabled ? "已启用" : "已停用"}
            </Tag>
          </Space>
        }
      >
        <Notice variant="info">
          配置阿里云内容安全（绿网）AccessKey 后，平台会对发布内容做机器审核：命中违规 / 疑似违规直接阻断本次发布，上游超时或不可用时降级放行并记入台账。AccessKey 加密保存、不回显；留空的密钥字段沿用已保存值。审核接口为按次计费，请使用已开通「内容安全」的 RAM 子账号。
        </Notice>

        <Space wrap style={{ margin: "12px 0" }}>
          {data?.accessKeyIdMasked ? (
            <span className="text-12 muted">
              AccessKey：
              <span className="mono">{data.accessKeyIdMasked}</span>
            </span>
          ) : null}
          {data?.updatedAt ? (
            <span className="text-12 muted">
              最近保存：{fmtTime(data.updatedAt)}
            </span>
          ) : null}
        </Space>

        <Form<FormValues>
          form={form}
          layout="vertical"
          onFinish={save}
          disabled={saving || loading}
          autoComplete="off"
          style={{ maxWidth: 620 }}
        >
          <Form.Item
            name="enabled"
            label="启用发布审核"
            valuePropName="checked"
          >
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>

          <Form.Item
            name="region"
            label="接入区域"
            extra="与阿里云内容安全控制台开通的区域一致；默认华东2（上海）。"
            rules={[{ required: true, message: "请选择接入区域" }]}
          >
            <Select
              options={PUBLISH_REVIEW_REGIONS.map((region) => ({
                value: region,
                label: `${PUBLISH_REVIEW_REGION_LABELS[region]}（${region}）`,
              }))}
            />
          </Form.Item>

          <Form.Item
            name="accessKeyId"
            label="AccessKey ID"
            extra="留空沿用已保存值；更换凭据时请整对重填。"
          >
            <Input maxLength={256} placeholder={data?.configured ? "已配置，留空不修改" : "LTAI..."} />
          </Form.Item>

          <Form.Item name="accessKeySecret" label="AccessKey Secret">
            <Input.Password
              maxLength={512}
              autoComplete="new-password"
              placeholder={data?.configured ? "已配置，留空不修改" : "填写 AccessKey Secret"}
            />
          </Form.Item>

          <Form.Item label="审核场景">
            <Space orientation="vertical" size={8}>
              <Checkbox checked disabled>
                发布需求（必选）
              </Checkbox>
              <Checkbox checked disabled>
                发布服务（必选）
              </Checkbox>
              <Form.Item name="communityPost" valuePropName="checked" noStyle>
                <Checkbox>社群发帖（可选：动态与小组主题）</Checkbox>
              </Form.Item>
              <Form.Item name="resume" valuePropName="checked" noStyle>
                <Checkbox>发布简历（可选：简历主信息与经历条目）</Checkbox>
              </Form.Item>
            </Space>
          </Form.Item>

          <Space>
            <Button type="primary" htmlType="submit" loading={saving}>
              保存配置
            </Button>
            <Button onClick={() => void reload()} disabled={saving}>
              重新读取
            </Button>
          </Space>
        </Form>
      </Panel>

      <Panel title="测试审核" titleBadge={<span className="text-12 muted">使用已保存的凭据</span>}>
        <div style={{ marginTop: 12, maxWidth: 720 }}>
          <Input.TextArea
            value={testText}
            onChange={(event) => setTestText(event.target.value)}
            rows={3}
            maxLength={10000}
            showCount
            placeholder="粘贴一段发布内容，检测阿里云会返回 pass / review / block"
          />
          <Space style={{ marginTop: 12 }} wrap>
            <Button type="primary" loading={testing} onClick={() => void runTest()} disabled={!data?.configured}>
              送审测试
            </Button>
            {!data?.configured ? (
              <span className="text-12 muted">保存 AccessKey 后才能测试。</span>
            ) : null}
          </Space>
          {testResult ? (
            <div style={{ marginTop: 12 }}>
              <Notice
                variant={testResult.suggestion === "pass" ? "success" : "error"}
              >
                <Space wrap>
                  <Tag
                    color={
                      testResult.suggestion === "pass"
                        ? "green"
                        : testResult.suggestion === "block"
                          ? "red"
                          : "orange"
                    }
                  >
                    {testResult.suggestion}
                  </Tag>
                  {testResult.labels.length ? (
                    <span>命中：{labelNames(testResult.labels)}</span>
                  ) : null}
                  <span>{testResult.message}</span>
                </Space>
              </Notice>
            </div>
          ) : null}
        </div>
      </Panel>

      <AuditLogsPanel page={page} onPage={setPage} reloadKey={refresh} />
    </>
  );
}
