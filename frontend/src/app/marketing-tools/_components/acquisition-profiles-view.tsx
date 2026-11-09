"use client";

import {
  CalendarOutlined,
  EditOutlined,
  EyeOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Descriptions,
  Drawer,
  Form,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Timeline,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { Notice, Panel } from "@/components/ui/panel";
import { fmtTime } from "@/lib/datetime";
import { AcqFollowUpModal } from "./acquisition-followups-view";
import {
  acqApi,
  businessStatusLabel,
  followUpStatusLabel,
  profileEventLabel,
  type AcqPlaybook,
  type AcqProfile,
  type AcqProfileDetail,
} from "./acquisition-common";

/**
 * 客户档案：线索提升 CRM 后自动建档，接待与跟进事件都沉淀在这里。
 * 业务状态与 CRM 线索阶段双向映射（未成交/沟通中/已确认意向/已成交/已流失）。
 */

const BUSINESS_STATUS_OPTIONS = ["free", "engaged", "qualified", "customer", "churned"].map(
  (value) => ({ value, label: businessStatusLabel(value) }),
);
const BUSINESS_COLOR: Record<string, string> = {
  free: "default",
  engaged: "processing",
  qualified: "gold",
  customer: "success",
  churned: "error",
};

export function AcquisitionProfilesView({
  tick,
  playbooks = [],
}: {
  tick: number;
  playbooks?: AcqPlaybook[];
}) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<AcqProfile[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("");
  const [keyword, setKeyword] = useState("");

  const [detail, setDetail] = useState<AcqProfileDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpProfileId, setFollowUpProfileId] = useState<number | undefined>();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await acqApi.profiles({
        query: {
          page,
          pageSize,
          ...(filterStatus ? { businessStatus: filterStatus } : {}),
          ...(keyword.trim() ? { q: keyword.trim() } : {}),
        },
      });
      setRows(result?.list ?? []);
      setTotal(result?.total ?? 0);
    } catch (error) {
      message.error((error as Error).message || "客户档案读取失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filterStatus, keyword, message]);

  useEffect(() => {
    void reload();
  }, [reload, tick]);

  const openDetail = async (row: AcqProfile) => {
    try {
      const result = await acqApi.profileDetail({ params: { id: row.id } });
      if (!result) {
        message.error("档案详情读取失败：接口未返回数据");
        return;
      }
      setDetail(result);
      setDetailOpen(true);
      setEditing(false);
      form.setFieldsValue({
        displayName: result.displayName,
        businessStatus: result.businessStatus,
        purpose: result.purpose,
        source: result.source,
        budget: result.budget,
        timeline: result.timeline,
        decisionRole: result.decisionRole,
        objections: result.objections,
        tags: result.tags,
        ownerUserId: result.ownerUserId,
        note: "",
      });
    } catch (error) {
      message.error((error as Error).message || "档案详情读取失败");
    }
  };

  const save = async () => {
    if (!detail) return;
    const values = await form.validateFields();
    setSaving(true);
    try {
      const updated = await acqApi.updateProfile({
        params: { id: detail.id },
        body: {
          displayName: values.displayName,
          businessStatus: values.businessStatus,
          purpose: values.purpose ?? "",
          source: values.source ?? "",
          budget: values.budget ?? "",
          timeline: values.timeline ?? "",
          decisionRole: values.decisionRole ?? "",
          objections: values.objections ?? [],
          tags: values.tags ?? [],
          ownerUserId: values.ownerUserId ?? "",
          ...(values.note ? { note: values.note } : {}),
        },
      });
      if (!updated) {
        message.error("保存失败：接口未返回档案");
        return;
      }
      setDetail({ ...detail, ...updated });
      setEditing(false);
      message.success("客户档案已更新");
      void reload();
    } catch (error) {
      message.error((error as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      title: "客户",
      dataIndex: "displayName",
      render: (value: string, row: AcqProfile) => (
        <Space orientation="vertical" size={0}>
          <span>{value || `档案 #${row.id}`}</span>
          <span className="text-12 muted">{row.channelPeerKey || "未知渠道"}</span>
        </Space>
      ),
    },
    {
      title: "业务状态",
      dataIndex: "businessStatus",
      width: 120,
      render: (value: string) => (
        <Tag color={BUSINESS_COLOR[value] || "default"}>{businessStatusLabel(value)}</Tag>
      ),
    },
    {
      title: "需求",
      render: (_: unknown, row: AcqProfile) => (
        <Space orientation="vertical" size={0}>
          <span className="text-12">{row.purpose || "未填写用途"}</span>
          <span className="text-12 muted">
            预算 {row.budget || "-"} · 时间 {row.timeline || "-"}
          </span>
        </Space>
      ),
    },
    {
      title: "健康分",
      dataIndex: "healthScore",
      width: 90,
      render: (value: number) => (
        <Tag color={value >= 70 ? "success" : value >= 40 ? "warning" : "default"}>{value}</Tag>
      ),
    },
    {
      title: "下次动作",
      dataIndex: "nextActionAt",
      width: 160,
      render: (value: string) => (value ? fmtTime(value) : "-"),
    },
    {
      title: "最近联系",
      dataIndex: "lastContactAt",
      width: 160,
      render: (value: string) => (value ? fmtTime(value) : "-"),
    },
    {
      title: "操作",
      width: 150,
      render: (_: unknown, row: AcqProfile) => (
        <Space size={4}>
          <Button size="small" icon={<EyeOutlined aria-hidden />} onClick={() => void openDetail(row)}>
            详情
          </Button>
          <Button
            size="small"
            icon={<CalendarOutlined aria-hidden />}
            onClick={() => {
              setFollowUpProfileId(row.id);
              setFollowUpOpen(true);
            }}
          />
        </Space>
      ),
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Panel
        title="客户档案"
        titleExtra="线索提升 CRM 时自动建档；业务状态会同步回 CRM 线索阶段"
        extra={
          <Button icon={<ReloadOutlined aria-hidden />} onClick={() => void reload()} loading={loading}>
            刷新
          </Button>
        }
      >
        <Space wrap style={{ marginBottom: 12 }}>
          <Select
            allowClear
            placeholder="业务状态"
            style={{ width: 150 }}
            value={filterStatus || undefined}
            options={BUSINESS_STATUS_OPTIONS}
            onChange={(value) => {
              setPage(1);
              setFilterStatus(value ?? "");
            }}
          />
          <Input.Search
            allowClear
            placeholder="按昵称 / 渠道 / 标签搜索"
            style={{ width: 260 }}
            onSearch={(value) => {
              setPage(1);
              setKeyword(value);
            }}
          />
        </Space>
        <Table<AcqProfile>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={rows}
          columns={columns}
          scroll={{ x: 980 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            onChange: (nextPage, nextSize) => {
              setPage(nextPage);
              setPageSize(nextSize);
            },
          }}
          locale={{ emptyText: "还没有客户档案：在线索池把高意向线索「提升 CRM」后自动建档" }}
        />
      </Panel>

      <Drawer
        title={detail ? `客户档案 · ${detail.displayName || `#${detail.id}`}` : "客户档案"}
        open={detailOpen}
        size={640}
        onClose={() => {
          setDetailOpen(false);
          setEditing(false);
        }}
        extra={
          detail ? (
            <Space>
              <Button
                icon={<CalendarOutlined aria-hidden />}
                onClick={() => {
                  setFollowUpProfileId(detail.id);
                  setFollowUpOpen(true);
                }}
              >
                新建跟进
              </Button>
              {editing ? null : (
                <Button icon={<EditOutlined aria-hidden />} onClick={() => setEditing(true)}>
                  编辑
                </Button>
              )}
            </Space>
          ) : null
        }
      >
        {detail ? (
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            {editing ? (
              <Form form={form} layout="vertical">
                <div className="form-2col">
                  <Form.Item name="displayName" label="客户名称">
                    <Input maxLength={120} />
                  </Form.Item>
                  <Form.Item name="businessStatus" label="业务状态">
                    <Select options={BUSINESS_STATUS_OPTIONS} />
                  </Form.Item>
                  <Form.Item name="purpose" label="需求 / 用途">
                    <Input maxLength={200} />
                  </Form.Item>
                  <Form.Item name="source" label="来源">
                    <Input maxLength={60} />
                  </Form.Item>
                  <Form.Item name="budget" label="预算">
                    <Input maxLength={80} />
                  </Form.Item>
                  <Form.Item name="timeline" label="时间计划">
                    <Input maxLength={80} />
                  </Form.Item>
                  <Form.Item name="decisionRole" label="决策角色">
                    <Input maxLength={40} />
                  </Form.Item>
                  <Form.Item name="ownerUserId" label="负责人用户 ID">
                    <Input maxLength={64} />
                  </Form.Item>
                </div>
                <Form.Item name="objections" label="异议">
                  <Select mode="tags" placeholder="输入后回车，如：价格、效果、信任" />
                </Form.Item>
                <Form.Item name="tags" label="标签">
                  <Select mode="tags" placeholder="输入后回车" />
                </Form.Item>
                <Form.Item name="note" label="备注（写事件时间线）">
                  <Input.TextArea rows={2} maxLength={500} />
                </Form.Item>
                <Space>
                  <Button type="primary" loading={saving} onClick={() => void save()}>
                    保存
                  </Button>
                  <Button onClick={() => setEditing(false)}>取消</Button>
                </Space>
              </Form>
            ) : (
              <>
                <Descriptions
                  size="small"
                  column={2}
                  items={[
                    {
                      key: "status",
                      label: "业务状态",
                      children: (
                        <Tag color={BUSINESS_COLOR[detail.businessStatus] || "default"}>
                          {businessStatusLabel(detail.businessStatus)}
                        </Tag>
                      ),
                    },
                    { key: "crmStage", label: "CRM 阶段", children: detail.crmStage || "-" },
                    { key: "purpose", label: "需求 / 用途", children: detail.purpose || "-" },
                    { key: "source", label: "来源", children: detail.source || "-" },
                    { key: "budget", label: "预算", children: detail.budget || "-" },
                    { key: "timeline", label: "时间计划", children: detail.timeline || "-" },
                    { key: "role", label: "决策角色", children: detail.decisionRole || "-" },
                    { key: "health", label: "健康分", children: detail.healthScore },
                    { key: "owner", label: "负责人", children: detail.ownerUserId || "-" },
                    { key: "last", label: "最近联系", children: detail.lastContactAt ? fmtTime(detail.lastContactAt) : "-" },
                  ]}
                />
                {detail.objections.length || detail.tags.length ? (
                  <Space wrap>
                    {detail.objections.map((item) => (
                      <Tag key={`objection-${item}`} color="volcano">
                        {item}
                      </Tag>
                    ))}
                    {detail.tags.map((item) => (
                      <Tag key={`tag-${item}`}>{item}</Tag>
                    ))}
                  </Space>
                ) : null}
                <Panel title="跟进计划">
                  <Table
                    rowKey="id"
                    size="small"
                    dataSource={detail.followUps}
                    pagination={false}
                    columns={[
                      {
                        title: "计划时间",
                        dataIndex: "followUpAt",
                        width: 160,
                        render: (value: string) => fmtTime(value),
                      },
                      { title: "原因", dataIndex: "reason" },
                      {
                        title: "状态",
                        dataIndex: "status",
                        width: 100,
                        render: (value: string) => followUpStatusLabel(value),
                      },
                      {
                        title: "催办",
                        dataIndex: "retryCount",
                        width: 70,
                        render: (value: number) => (value ? `${value} 次` : "-"),
                      },
                    ]}
                    locale={{ emptyText: "还没有跟进计划" }}
                  />
                </Panel>
                <Panel title="事件时间线">
                  {detail.events.length ? (
                    <Timeline
                      items={detail.events.map((event) => ({
                        key: event.id,
                        color: event.kind === "STAGE" ? "green" : "blue",
                        children: (
                          <Space orientation="vertical" size={0}>
                            <span>
                              {profileEventLabel(event.kind)}：{event.summary}
                            </span>
                            <span className="text-12 muted">{fmtTime(event.createdAt)}</span>
                          </Space>
                        ),
                      }))}
                    />
                  ) : (
                    <Notice variant="info">还没有事件：接待、触达与跟进都会自动记入时间线。</Notice>
                  )}
                </Panel>
              </>
            )}
          </Space>
        ) : null}
      </Drawer>

      <AcqFollowUpModal
        open={followUpOpen}
        profileId={followUpProfileId}
        playbooks={playbooks}
        onClose={() => setFollowUpOpen(false)}
        onCreated={() => {
          setFollowUpOpen(false);
          if (detail) void openDetail(detail);
        }}
      />
    </Space>
  );
}
