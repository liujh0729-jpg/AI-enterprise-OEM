"use client";

import {
  CheckOutlined,
  CloseOutlined,
  PlusOutlined,
  ReloadOutlined,
  SendOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  DatePicker,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SCRM_MASS_TYPES } from "@enterprise/contracts";
import { Notice, Panel } from "@/components/ui/panel";
import {
  MASS_STATUS_COLOR,
  MASS_STATUS_LABELS,
  MASS_TYPE_LABELS,
  TARGET_STATUS_COLOR,
  TARGET_STATUS_LABELS,
  fmtDateTime,
  loadScrmStaff,
  massStatusLabel,
  massTypeLabel,
  scrmApi,
  tagOptions,
  type ScrmChat,
  type ScrmCode,
  type ScrmContact,
  type ScrmMassTarget,
  type ScrmMassTask,
  type ScrmTagGroup,
} from "./scrm-common";

/**
 * 群发：客户群发 / 客户群群发 / 朋友圈。人工审核不可关闭——草稿必须走「提交审核 → 通过」，
 * 通过后才会发送；定时任务到点由调度器提交，出站前再过一遍敏感词闸。
 */

const TYPE_OPTIONS = Object.entries(MASS_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));
const STATUS_OPTIONS = Object.entries(MASS_STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export function ScrmMassView({ tick }: { tick: number }) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<ScrmMassTask[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [type, setType] = useState<(typeof SCRM_MASS_TYPES)[number] | "">("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ScrmMassTask | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<ScrmMassTask | null>(null);
  const [reviewApprove, setReviewApprove] = useState(true);
  const [reviewForm] = Form.useForm();
  const [targetsFor, setTargetsFor] = useState<ScrmMassTask | null>(null);
  const [busy, setBusy] = useState(0);
  const [staffOptions, setStaffOptions] = useState<{ value: string; label: string }[]>([]);
  const [tagGroups, setTagGroups] = useState<ScrmTagGroup[]>([]);
  const [codes, setCodes] = useState<ScrmCode[]>([]);
  const [chats, setChats] = useState<ScrmChat[]>([]);
  const [contacts, setContacts] = useState<ScrmContact[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await scrmApi.massTasks({
        query: {
          page,
          pageSize,
          ...(type ? { type } : {}),
          ...(status ? { status } : {}),
        },
      });
      setRows(result?.list ?? []);
      setTotal(result?.total ?? 0);
    } catch (error) {
      message.error((error as Error).message || "群发任务读取失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, type, status, message]);

  const reloadMeta = useCallback(async () => {
    const [tagValue, codeValue, chatValue, contactValue] = await Promise.all([
      scrmApi.tagGroups().catch(() => []),
      scrmApi.codes({ query: { page: 1, pageSize: 100 } }).catch(() => null),
      scrmApi.chats({ query: { page: 1, pageSize: 100 } }).catch(() => null),
      scrmApi.contacts({ query: { page: 1, pageSize: 100 } }).catch(() => null),
    ]);
    setTagGroups(tagValue ?? []);
    setCodes(codeValue?.list ?? []);
    setChats(chatValue?.list ?? []);
    setContacts(contactValue?.list ?? []);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, tick]);

  useEffect(() => {
    void reloadMeta();
    void loadScrmStaff().then(setStaffOptions);
  }, [reloadMeta]);

  const requestReview = async (row: ScrmMassTask) => {
    setBusy(row.id);
    try {
      await scrmApi.requestMassReview({ body: { id: row.id } });
      message.success("已提交审核，等待另一位管理员通过");
      void reload();
    } catch (error) {
      message.error((error as Error).message || "提交审核失败");
    } finally {
      setBusy(0);
    }
  };

  const review = async () => {
    if (!reviewTarget) return;
    const values = reviewForm.getFieldsValue();
    setBusy(reviewTarget.id);
    try {
      await scrmApi.reviewMassTask({
        body: { id: reviewTarget.id, approve: reviewApprove, note: values.note ?? "" },
      });
      message.success(reviewApprove ? "已通过，等待发送" : "已驳回");
      setReviewTarget(null);
      void reload();
    } catch (error) {
      message.error((error as Error).message || "审批失败");
    } finally {
      setBusy(0);
    }
  };

  const submit = async (row: ScrmMassTask) => {
    setBusy(row.id);
    try {
      const result = await scrmApi.submitMassTask({ body: { id: row.id } });
      message.success(`已提交：成功 ${result?.sent ?? 0}，失败 ${result?.failed ?? 0}`);
      void reload();
    } catch (error) {
      message.error((error as Error).message || "发送失败");
    } finally {
      setBusy(0);
    }
  };

  const actions = (row: ScrmMassTask) => {
    const buttons = [];
    if (row.status === "DRAFT" || row.status === "REJECTED") {
      buttons.push(
        <Button
          key="edit"
          size="small"
          onClick={() => {
            setEditing(row);
            setFormOpen(true);
          }}
        >
          编辑
        </Button>,
        <Button key="review" size="small" loading={busy === row.id} onClick={() => void requestReview(row)}>
          提交审核
        </Button>,
      );
    }
    if (row.status === "PENDING_REVIEW") {
      buttons.push(
        <Button
          key="pass"
          size="small"
          type="primary"
          icon={<CheckOutlined aria-hidden />}
          onClick={() => {
            setReviewApprove(true);
            setReviewTarget(row);
          }}
        >
          通过
        </Button>,
        <Button
          key="reject"
          size="small"
          danger
          icon={<CloseOutlined aria-hidden />}
          onClick={() => {
            setReviewApprove(false);
            setReviewTarget(row);
          }}
        >
          驳回
        </Button>,
      );
    }
    if (row.status === "APPROVED") {
      buttons.push(
        <Popconfirm key="send" title="立即发送这条群发？" onConfirm={() => void submit(row)}>
          <Button size="small" type="primary" loading={busy === row.id} icon={<SendOutlined aria-hidden />}>
            立即发送
          </Button>
        </Popconfirm>,
      );
    }
    if (row.status === "PARTIAL" || row.status === "FAILED") {
      buttons.push(
        <Button key="resume" size="small" loading={busy === row.id} onClick={() => void submit(row)}>
          继续发送
        </Button>,
      );
    }
    buttons.push(
      <Button
        key="targets"
        size="small"
        icon={<UnorderedListOutlined aria-hidden />}
        onClick={() => setTargetsFor(row)}
      >
        明细
      </Button>,
    );
    return <Space size={4} wrap>{buttons}</Space>;
  };

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Panel
        title="群发任务"
        titleExtra="人工审核不可关闭：草稿 → 提交审核 → 另一位管理员通过 → 发送"
        extra={
          <Space wrap>
            <Button icon={<ReloadOutlined aria-hidden />} onClick={() => void reload()} loading={loading}>
              刷新
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined aria-hidden />}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              新建群发
            </Button>
          </Space>
        }
      >
        <Space wrap style={{ marginBottom: 12 }}>
          <Select
            allowClear
            placeholder="类型"
            style={{ width: 150 }}
            value={type || undefined}
            options={TYPE_OPTIONS}
            onChange={(value) => {
              setPage(1);
              setType(SCRM_MASS_TYPES.find((item) => item === value) ?? "");
            }}
          />
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 150 }}
            value={status || undefined}
            options={STATUS_OPTIONS}
            onChange={(value) => {
              setPage(1);
              setStatus(value ?? "");
            }}
          />
        </Space>
        <Notice variant="info">
          群发内容在发送前会过出站敏感词闸：拦截词直接不发送；替换词用改写后的文案继续。
          企微对客户群发有频次限制，任务会自动按回执统计送达与失败。
        </Notice>
        <Table<ScrmMassTask>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={rows}
          scroll={{ x: 1140 }}
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
          columns={[
            {
              title: "任务",
              dataIndex: "name",
              render: (value: string, row) => (
                <Space orientation="vertical" size={0}>
                  <span>{value}</span>
                  <span className="text-12 muted">
                    {massTypeLabel(row.type)}
                    {row.scheduledAt ? ` · 定时 ${fmtDateTime(row.scheduledAt)}` : ""}
                  </span>
                </Space>
              ),
            },
            {
              title: "内容",
              dataIndex: "content",
              render: (value: ScrmMassTask["content"]) => (
                <Typography.Text ellipsis style={{ maxWidth: 280 }}>
                  {value.text || value.linkTitle || value.linkUrl || "-"}
                </Typography.Text>
              ),
            },
            {
              title: "状态",
              dataIndex: "status",
              width: 110,
              render: (value: string) => (
                <Tag color={MASS_STATUS_COLOR[value] || "default"}>{massStatusLabel(value)}</Tag>
              ),
            },
            {
              title: "目标 / 成功 / 失败",
              dataIndex: "total",
              width: 160,
              render: (value: number, row) => `${value} / ${row.sent} / ${row.failed}`,
            },
            {
              title: "审批意见",
              dataIndex: "reviewNote",
              width: 150,
              render: (value: string) => value || "-",
            },
            { title: "创建时间", dataIndex: "createdAt", width: 170, render: fmtDateTime },
            { title: "操作", width: 230, render: (_: unknown, row) => actions(row) },
          ]}
          locale={{ emptyText: "还没有群发任务：新建后提交审核，通过再发送" }}
        />
      </Panel>

      <MassFormModal
        open={formOpen}
        row={editing}
        staffOptions={staffOptions}
        tagGroups={tagGroups}
        codes={codes}
        chats={chats}
        contacts={contacts}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          void reload();
        }}
      />

      <Modal
        title={reviewApprove ? "通过群发审核" : "驳回群发"}
        open={Boolean(reviewTarget)}
        confirmLoading={busy === reviewTarget?.id}
        okText={reviewApprove ? "通过" : "驳回"}
        okButtonProps={{ danger: !reviewApprove }}
        onOk={() => void review()}
        onCancel={() => setReviewTarget(null)}
      >
        <p className="text-12 muted">
          {reviewTarget?.name} · 目标 {reviewTarget?.total ?? 0} 个
        </p>
        <Form form={reviewForm} layout="vertical">
          <Form.Item name="note" label="审批意见（选填）">
            <Input.TextArea rows={3} maxLength={300} placeholder="驳回时请说明原因" />
          </Form.Item>
        </Form>
        <Notice variant="warn">
          群发必须由另一位管理员审批：不能审批自己创建的任务；审批结果会留痕。
        </Notice>
      </Modal>

      <MassTargetsDrawer task={targetsFor} onClose={() => setTargetsFor(null)} />
    </Space>
  );
}

function MassFormModal({
  open,
  row,
  staffOptions,
  tagGroups,
  codes,
  chats,
  contacts,
  onClose,
  onSaved,
}: {
  open: boolean;
  row: ScrmMassTask | null;
  staffOptions: { value: string; label: string }[];
  tagGroups: ScrmTagGroup[];
  codes: ScrmCode[];
  chats: ScrmChat[];
  contacts: ScrmContact[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const type = Form.useWatch("type", form);
  const tagOptionsValue = useMemo(() => tagOptions(tagGroups), [tagGroups]);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue(
      row
        ? {
            type: row.type,
            name: row.name,
            text: row.content.text,
            linkUrl: row.content.linkUrl,
            linkTitle: row.content.linkTitle,
            linkDesc: row.content.linkDesc,
            scheduledAt: row.scheduledAt ? dayjs(row.scheduledAt) : undefined,
            tagIds: row.targetFilter.tagIds,
            staffUserIds: row.targetFilter.staffUserIds,
            codeIds: row.targetFilter.codeIds,
            chatIds: row.targetFilter.chatIds,
            contactIds: row.targetFilter.contactIds,
            addedFrom: row.targetFilter.addedFrom ? dayjs(row.targetFilter.addedFrom) : undefined,
            addedTo: row.targetFilter.addedTo ? dayjs(row.targetFilter.addedTo) : undefined,
          }
        : {
            type: "CONTACT",
            name: "",
            text: "",
            linkUrl: "",
            linkTitle: "",
            linkDesc: "",
            tagIds: [],
            staffUserIds: [],
            codeIds: [],
            chatIds: [],
            contactIds: [],
          },
    );
  }, [open, row, form]);

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await scrmApi.saveMassTask({
        body: {
          id: row?.id ?? 0,
          type: values.type,
          name: values.name,
          targetFilter: {
            tagIds: values.tagIds ?? [],
            staffUserIds: values.staffUserIds ?? [],
            codeIds: values.codeIds ?? [],
            chatIds: values.chatIds ?? [],
            addedFrom: values.addedFrom ? dayjs(values.addedFrom).format("YYYY-MM-DD") : "",
            addedTo: values.addedTo ? dayjs(values.addedTo).format("YYYY-MM-DD") : "",
            contactIds: values.contactIds ?? [],
          },
          content: {
            text: values.text ?? "",
            linkUrl: values.linkUrl ?? "",
            linkTitle: values.linkTitle ?? "",
            linkDesc: values.linkDesc ?? "",
            imageMediaId: "",
            miniProgram: { appId: "", title: "", page: "" },
          },
          scheduledAt: values.scheduledAt ? dayjs(values.scheduledAt).format("YYYY-MM-DD HH:mm:ss") : "",
        },
      });
      message.success("草稿已保存：提交审核并通过后才会发送");
      onSaved();
    } catch (error) {
      message.error((error as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={row ? "编辑群发任务" : "新建群发任务"}
      open={open}
      confirmLoading={saving}
      okText="保存草稿"
      onOk={() => void submit()}
      onCancel={onClose}
      width={720}
    >
      <Form form={form} layout="vertical">
        <div className="form-2col">
          <Form.Item name="type" label="群发类型" rules={[{ required: true }]}>
            <Select options={TYPE_OPTIONS} />
          </Form.Item>
          <Form.Item name="name" label="任务名称" rules={[{ required: true, message: "请填写任务名称" }]}>
            <Input maxLength={60} />
          </Form.Item>
        </div>
        <Form.Item label="发送内容" required>
          <Space orientation="vertical" size={8} style={{ width: "100%" }}>
            <Form.Item name="text" noStyle rules={[{ required: true, message: "请填写文本内容" }]}>
              <Input.TextArea rows={4} maxLength={2000} showCount placeholder="群发正文（必填）" />
            </Form.Item>
            <div className="form-2col">
              <Form.Item name="linkUrl" noStyle>
                <Input maxLength={500} placeholder="链接 URL（选填）" />
              </Form.Item>
              <Form.Item name="linkTitle" noStyle>
                <Input maxLength={120} placeholder="链接标题（选填）" />
              </Form.Item>
            </div>
            <Form.Item name="linkDesc" noStyle>
              <Input maxLength={300} placeholder="链接摘要（选填）" />
            </Form.Item>
          </Space>
        </Form.Item>
        <div className="form-2col">
          <Form.Item name="scheduledAt" label="定时发送" tooltip="留空表示审核通过后手动发送">
            <DatePicker showTime style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="staffUserIds" label="限定归属员工">
            <Select mode="multiple" allowClear options={staffOptions} placeholder="不限" />
          </Form.Item>
          <Form.Item name="tagIds" label="限定标签">
            <Select mode="multiple" allowClear options={tagOptionsValue} placeholder="不限" />
          </Form.Item>
          {type === "CHAT" ? (
            <Form.Item name="chatIds" label="指定客户群">
              <Select
                mode="multiple"
                allowClear
                options={chats.map((chat) => ({ value: chat.id, label: chat.name || chat.chatId }))}
                placeholder="留空表示全部客户群"
              />
            </Form.Item>
          ) : (
            <Form.Item name="codeIds" label="限定来源活码">
              <Select
                mode="multiple"
                allowClear
                options={codes.map((code) => ({ value: code.id, label: code.name }))}
                placeholder="不限"
              />
            </Form.Item>
          )}
          <Form.Item name="addedFrom" label="添加时间起">
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="addedTo" label="添加时间止">
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
        </div>
        {type === "CONTACT" ? (
          <Form.Item name="contactIds" label="指定客户" tooltip="精确发送时使用；留空按上面的条件筛选">
            <Select
              mode="multiple"
              allowClear
              showSearch
              optionFilterProp="label"
              options={contacts.map((contact) => ({
                value: contact.id,
                label: contact.name || contact.remark || `#${contact.id}`,
              }))}
              placeholder="不限"
            />
          </Form.Item>
        ) : null}
        <Notice variant="info">
          保存只生成草稿；编辑后需要重新提交审核。人工确认不可关闭，审核通过后才会进入发送队列。
        </Notice>
      </Form>
    </Modal>
  );
}

function MassTargetsDrawer({ task, onClose }: { task: ScrmMassTask | null; onClose: () => void }) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<ScrmMassTarget[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!task) {
      setRows([]);
      setTotal(0);
      return;
    }
    setLoading(true);
    scrmApi
      .massTargets({
        query: {
          taskId: task.id,
          page,
          pageSize,
          ...(status ? { status } : {}),
        },
      })
      .then((result) => {
        setRows(result?.list ?? []);
        setTotal(result?.total ?? 0);
      })
      .catch((error: Error) => message.error(error.message || "发送明细读取失败"))
      .finally(() => setLoading(false));
  }, [task, page, pageSize, status, message]);

  return (
    <Drawer
      title={task ? `发送明细：${task.name}` : "发送明细"}
      open={Boolean(task)}
      onClose={onClose}
      size={720}
    >
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 160 }}
          value={status || undefined}
          options={Object.entries(TARGET_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
          onChange={(value) => {
            setPage(1);
            setStatus(value ?? "");
          }}
        />
        <Table<ScrmMassTarget>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={rows}
          scroll={{ x: 620 }}
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
          columns={[
            { title: "接收对象", dataIndex: "targetName", render: (value: string) => value || "-" },
            { title: "归属员工", dataIndex: "staffName", width: 140, render: (value: string, row) => value || row.staffUserId || "-" },
            {
              title: "状态",
              dataIndex: "status",
              width: 110,
              render: (value: string) => (
                <Tag color={TARGET_STATUS_COLOR[value] || "default"}>
                  {TARGET_STATUS_LABELS[value] ?? value}
                </Tag>
              ),
            },
            {
              title: "失败原因",
              dataIndex: "error",
              render: (value: string) => value || "-",
            },
            { title: "发送时间", dataIndex: "sentAt", width: 170, render: (value: string) => (value ? fmtDateTime(value) : "-") },
          ]}
          locale={{ emptyText: "还没有发送明细：审核通过并发送后生成" }}
        />
      </Space>
    </Drawer>
  );
}
