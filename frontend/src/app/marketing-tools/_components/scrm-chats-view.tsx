"use client";

import {
  ApartmentOutlined,
  PlusOutlined,
  ReloadOutlined,
  TeamOutlined,
  UsergroupAddOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
} from "antd";
import type { Key } from "react";
import { useCallback, useEffect, useState } from "react";
import { Notice, Panel } from "@/components/ui/panel";
import {
  CHAT_STATUS_LABELS,
  ROOM_PULL_STATUS_LABELS,
  fmtDateTime,
  scrmApi,
  tagOptions,
  type ScrmChat,
  type ScrmChatDetail,
  type ScrmChatGroup,
  type ScrmRoomPull,
  type ScrmTagGroup,
  type ScrmWelcome,
} from "./scrm-common";

/**
 * 客户群：列表/详情、自定义分组、标签批量拉群。
 * 拉群只统计「已发邀请」与「已在群」两个真实口径，目标群满员直接拒绝。
 */

export function ScrmChatsView({ tick }: { tick: number }) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<ScrmChat[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [groupName, setGroupName] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<Key[]>([]);
  const [groups, setGroups] = useState<ScrmChatGroup[]>([]);
  const [pulls, setPulls] = useState<ScrmRoomPull[]>([]);
  const [welcomes, setWelcomes] = useState<ScrmWelcome[]>([]);
  const [tagGroups, setTagGroups] = useState<ScrmTagGroup[]>([]);
  const [chatOptions, setChatOptions] = useState<{ value: number; label: string }[]>([]);
  const [moveOpen, setMoveOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ScrmChatGroup | null>(null);
  const [pullOpen, setPullOpen] = useState(false);
  const [editingPull, setEditingPull] = useState<ScrmRoomPull | null>(null);
  const [detailId, setDetailId] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(0);
  const [moveForm] = Form.useForm();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await scrmApi.chats({
        query: {
          page,
          pageSize,
          ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
          ...(groupName ? { groupName } : {}),
          ...(status ? { status } : {}),
        },
      });
      setRows(result?.list ?? []);
      setTotal(result?.total ?? 0);
    } catch (error) {
      message.error((error as Error).message || "客户群读取失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, groupName, status, message]);

  const reloadMeta = useCallback(async () => {
    const [groupValue, pullValue, welcomeValue, tagValue, chatValue] = await Promise.all([
      scrmApi.chatGroups().catch(() => []),
      scrmApi.roomPulls().catch(() => []),
      scrmApi.welcomes().catch(() => []),
      scrmApi.tagGroups().catch(() => []),
      scrmApi.chats({ query: { page: 1, pageSize: 200 } }).catch(() => null),
    ]);
    setGroups(groupValue ?? []);
    setPulls(pullValue ?? []);
    setWelcomes(welcomeValue ?? []);
    setTagGroups(tagValue ?? []);
    setChatOptions(
      (chatValue?.list ?? []).map((chat) => ({
        value: chat.id,
        label: `${chat.name || chat.chatId}（${chat.memberCount}/${chat.maxMembers}）`,
      })),
    );
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, tick]);

  useEffect(() => {
    void reloadMeta();
  }, [reloadMeta]);

  const moveChats = async () => {
    const values = await moveForm.validateFields();
    const value = Number(values.groupId ?? 0);
    setBusy(1);
    try {
      const result = await scrmApi.moveChats({
        body: { chatIds: selected.map(Number), groupId: value },
      });
      message.success(`已移动 ${result?.moved ?? 0} 个客户群`);
      setSelected([]);
      setMoveOpen(false);
      void reload();
      void reloadMeta();
    } catch (error) {
      message.error((error as Error).message || "移动失败");
    } finally {
      setBusy(0);
    }
  };

  const runPull = async (row: ScrmRoomPull) => {
    setBusy(row.id);
    try {
      const result = await scrmApi.runRoomPull({ body: { id: row.id } });
      message.success(result?.message || `已邀请 ${result?.invited ?? 0} 位客户`);
      void reloadMeta();
      void reload();
    } catch (error) {
      message.error((error as Error).message || "执行失败");
    } finally {
      setBusy(0);
    }
  };

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Panel
        title={
          <>
            <TeamOutlined aria-hidden /> 客户群
          </>
        }
        titleExtra="客户群从企微同步；分组只影响本系统展示，不动企微侧设置"
        extra={
          <Space wrap>
            <Button icon={<ReloadOutlined aria-hidden />} onClick={() => void reload()} loading={loading}>
              刷新
            </Button>
            <Button
              icon={<ApartmentOutlined aria-hidden />}
              disabled={!selected.length || !groups.length}
              onClick={() => setMoveOpen(true)}
            >
              移动到分组
            </Button>
          </Space>
        }
      >
        <Space wrap style={{ marginBottom: 12 }}>
          <Input.Search
            allowClear
            placeholder="群名称"
            style={{ width: 220 }}
            onSearch={(value) => {
              setPage(1);
              setKeyword(value);
            }}
          />
          <Select
            allowClear
            placeholder="分组"
            style={{ width: 160 }}
            value={groupName || undefined}
            options={groups.map((group) => ({ value: group.name, label: group.name }))}
            onChange={(value) => {
              setPage(1);
              setGroupName(value ?? "");
            }}
          />
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 130 }}
            value={status || undefined}
            options={Object.entries(CHAT_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
            onChange={(value) => {
              setPage(1);
              setStatus(value ?? "");
            }}
          />
        </Space>
        <Table<ScrmChat>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={rows}
          scroll={{ x: 960 }}
          rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys) }}
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
              title: "客户群",
              dataIndex: "name",
              render: (value: string, row) => (
                <Space orientation="vertical" size={0}>
                  <span>{value || `群 ${row.chatId}`}</span>
                  <span className="text-12 muted">群主：{row.ownerStaffName || row.ownerStaffId || "-"}</span>
                </Space>
              ),
            },
            {
              title: "分组",
              dataIndex: "groupName",
              width: 130,
              render: (value: string) => value || <span className="text-12 muted">未分组</span>,
            },
            {
              title: "成员",
              dataIndex: "memberCount",
              width: 110,
              render: (value: number, row) => `${value}/${row.maxMembers}`,
            },
            {
              title: "状态",
              dataIndex: "status",
              width: 100,
              render: (value: string) => (
                <Tag color={value === "ACTIVE" ? "success" : "default"}>
                  {CHAT_STATUS_LABELS[value] ?? value}
                </Tag>
              ),
            },
            { title: "创建时间", dataIndex: "createdAt", width: 170, render: fmtDateTime },
            {
              title: "操作",
              width: 90,
              render: (_: unknown, row) => (
                <Button size="small" onClick={() => setDetailId(row.id)}>
                  详情
                </Button>
              ),
            },
          ]}
          locale={{ emptyText: "还没有客户群：同步企微客户群后自动出现" }}
        />
      </Panel>

      <Panel
        title="客户群分组"
        titleExtra="用于本系统筛选与群发选群；一个群只属于一个分组"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined aria-hidden />}
            onClick={() => {
              setEditingGroup(null);
              setGroupOpen(true);
            }}
          >
            新建分组
          </Button>
        }
      >
        <Table<ScrmChatGroup>
          rowKey="id"
          size="small"
          dataSource={groups}
          pagination={false}
          columns={[
            { title: "分组名称", dataIndex: "name" },
            { title: "客户群数", dataIndex: "chatCount", width: 110 },
            { title: "排序", dataIndex: "sort", width: 90 },
            {
              title: "操作",
              width: 100,
              render: (_: unknown, row) => (
                <Button
                  size="small"
                  onClick={() => {
                    setEditingGroup(row);
                    setGroupOpen(true);
                  }}
                >
                  重命名
                </Button>
              ),
            },
          ]}
          locale={{ emptyText: "还没有分组：新建后可在上方把客户群移进来" }}
        />
      </Panel>

      <Panel
        title={
          <>
            <UsergroupAddOutlined aria-hidden /> 标签拉群
          </>
        }
        titleExtra="按标签挑客户 → 1v1 发入群邀请 → 用群成员对账统计真实入群数"
        extra={
          <Space wrap>
            <Button icon={<ReloadOutlined aria-hidden />} onClick={() => void reloadMeta()}>
              刷新
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined aria-hidden />}
              onClick={() => {
                setEditingPull(null);
                setPullOpen(true);
              }}
            >
              新建拉群任务
            </Button>
          </Space>
        }
      >
        <Table<ScrmRoomPull>
          rowKey="id"
          size="small"
          dataSource={pulls}
          pagination={false}
          scroll={{ x: 860 }}
          columns={[
            { title: "任务名称", dataIndex: "name" },
            {
              title: "目标群",
              dataIndex: "chatIds",
              width: 100,
              render: (value: number[]) => `${value?.length ?? 0} 个`,
            },
            {
              title: "邀请 / 入群",
              dataIndex: "invited",
              width: 130,
              render: (value: number, row) => `${value} / ${row.joined}`,
            },
            {
              title: "状态",
              dataIndex: "status",
              width: 100,
              render: (value: string) => (
                <Tag color={value === "DONE" ? "success" : value === "FAILED" ? "error" : "default"}>
                  {ROOM_PULL_STATUS_LABELS[value] ?? value}
                </Tag>
              ),
            },
            { title: "创建时间", dataIndex: "createdAt", width: 170, render: fmtDateTime },
            {
              title: "操作",
              width: 170,
              render: (_: unknown, row) => (
                <Space size={4}>
                  <Button
                    size="small"
                    type="primary"
                    loading={busy === row.id}
                    onClick={() => void runPull(row)}
                  >
                    立即执行
                  </Button>
                  <Button
                    size="small"
                    onClick={() => {
                      setEditingPull(row);
                      setPullOpen(true);
                    }}
                  >
                    编辑
                  </Button>
                </Space>
              ),
            },
          ]}
          locale={{ emptyText: "还没有拉群任务：选目标群与标签后执行" }}
        />
      </Panel>

      <Modal
        title="移动客户群到分组"
        open={moveOpen}
        confirmLoading={busy === 1}
        okText="移动"
        onOk={() => void moveChats()}
        onCancel={() => setMoveOpen(false)}
      >
        <div className="text-12 muted" style={{ marginBottom: 8 }}>
          已选 {selected.length} 个客户群
        </div>
        <Form form={moveForm} layout="vertical">
          <Form.Item name="groupId" label="目标分组" initialValue={groups[0]?.id ?? 0}>
            <Select
              options={[
                { value: 0, label: "未分组" },
                ...groups.map((group) => ({ value: group.id, label: group.name })),
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <ChatGroupModal
        open={groupOpen}
        row={editingGroup}
        onClose={() => setGroupOpen(false)}
        onSaved={() => {
          setGroupOpen(false);
          void reloadMeta();
          void reload();
        }}
      />

      <RoomPullModal
        open={pullOpen}
        row={editingPull}
        chatOptions={chatOptions}
        welcomes={welcomes}
        tagGroups={tagGroups}
        onClose={() => setPullOpen(false)}
        onSaved={() => {
          setPullOpen(false);
          void reloadMeta();
        }}
      />

      <ChatDetailDrawer id={detailId} onClose={() => setDetailId(undefined)} />
    </Space>
  );
}

function ChatGroupModal({
  open,
  row,
  onClose,
  onSaved,
}: {
  open: boolean;
  row: ScrmChatGroup | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue(row ? { name: row.name, sort: row.sort } : { name: "", sort: 0 });
  }, [open, row, form]);

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await scrmApi.saveChatGroup({
        body: { id: row?.id ?? 0, name: values.name, sort: Number(values.sort ?? 0) },
      });
      message.success("分组已保存");
      onSaved();
    } catch (error) {
      message.error((error as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={row ? "重命名分组" : "新建客户群分组"}
      open={open}
      confirmLoading={saving}
      okText="保存"
      onOk={() => void submit()}
      onCancel={onClose}
    >
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="分组名称" rules={[{ required: true, message: "请填写分组名称" }]}>
          <Input maxLength={40} />
        </Form.Item>
        <Form.Item name="sort" label="排序">
          <InputNumber min={0} max={999} style={{ width: "100%" }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function RoomPullModal({
  open,
  row,
  chatOptions,
  welcomes,
  tagGroups,
  onClose,
  onSaved,
}: {
  open: boolean;
  row: ScrmRoomPull | null;
  chatOptions: { value: number; label: string }[];
  welcomes: ScrmWelcome[];
  tagGroups: ScrmTagGroup[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue(
      row
        ? {
            name: row.name,
            chatIds: row.chatIds,
            welcomeId: row.welcomeId || undefined,
            tagIds: row.tagIds,
          }
        : { name: "", chatIds: [], welcomeId: undefined, tagIds: [] },
    );
  }, [open, row, form]);

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await scrmApi.saveRoomPull({
        body: {
          id: row?.id ?? 0,
          name: values.name,
          chatIds: values.chatIds ?? [],
          welcomeId: Number(values.welcomeId ?? 0),
          tagIds: values.tagIds ?? [],
        },
      });
      message.success("拉群任务已保存");
      onSaved();
    } catch (error) {
      message.error((error as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={row ? "编辑拉群任务" : "新建拉群任务"}
      open={open}
      confirmLoading={saving}
      okText="保存"
      onOk={() => void submit()}
      onCancel={onClose}
      width={620}
    >
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="任务名称" rules={[{ required: true, message: "请填写任务名称" }]}>
          <Input maxLength={60} />
        </Form.Item>
        <Form.Item
          name="chatIds"
          label="目标客户群"
          rules={[{ required: true, message: "请选择目标客户群" }]}
          tooltip="只对未满员的正常群发邀请"
        >
          <Select mode="multiple" allowClear options={chatOptions} placeholder="选择客户群" />
        </Form.Item>
        <Form.Item name="tagIds" label="从哪些标签的客户里挑人" tooltip="留空表示最近添加的客户">
          <Select mode="multiple" allowClear options={tagOptions(tagGroups)} placeholder="选择标签" />
        </Form.Item>
        <Form.Item name="welcomeId" label="入群欢迎语（选填）">
          <Select
            allowClear
            placeholder="默认不发送"
            options={welcomes.map((item) => ({ value: item.id, label: item.name }))}
          />
        </Form.Item>
        <Notice variant="info">
          任务不会自动执行：保存后点「立即执行」。邀请按员工逐条发送，入群数以群成员对账为准，
          未入群的客户不会被计入成功。
        </Notice>
      </Form>
    </Modal>
  );
}

function ChatDetailDrawer({ id, onClose }: { id?: number; onClose: () => void }) {
  const { message } = App.useApp();
  const [detail, setDetail] = useState<ScrmChatDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!id) {
      setDetail(null);
      return;
    }
    setLoading(true);
    scrmApi
      .chat({ query: { id } })
      .then(setDetail)
      .catch((error: Error) => message.error(error.message || "客户群详情读取失败"))
      .finally(() => setLoading(false));
  }, [id, message]);

  return (
    <Drawer
      title={detail ? detail.name || detail.chatId : "客户群详情"}
      open={Boolean(id)}
      onClose={onClose}
      size={680}
      loading={loading}
    >
      {detail ? (
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <Space wrap size={[24, 8]}>
            <span className="text-12 muted">群主：{detail.ownerStaffName || detail.ownerStaffId || "-"}</span>
            <span className="text-12 muted">
              成员：{detail.memberCount}/{detail.maxMembers}
            </span>
            <span className="text-12 muted">分组：{detail.groupName || "未分组"}</span>
            <Tag color={detail.status === "ACTIVE" ? "success" : "default"}>
              {CHAT_STATUS_LABELS[detail.status] ?? detail.status}
            </Tag>
            <span className="text-12 muted">创建：{fmtDateTime(detail.createdAt)}</span>
          </Space>
          {detail.notice ? <Notice variant="info">群公告：{detail.notice}</Notice> : null}
          <Table
            rowKey="externalUserId"
            size="small"
            dataSource={detail.members}
            pagination={false}
            scroll={{ x: 560 }}
            columns={[
              { title: "成员", dataIndex: "name", render: (value: string, row) => value || row.externalUserId },
              {
                title: "角色",
                dataIndex: "role",
                width: 120,
                render: (value: string) => (value === "OWNER" ? "群主" : value === "MANAGER" ? "管理员" : "成员"),
              },
              { title: "入群时间", dataIndex: "joinAt", width: 170, render: (value: string) => (value ? fmtDateTime(value) : "-") },
              { title: "离群时间", dataIndex: "leaveAt", width: 170, render: (value: string) => (value ? fmtDateTime(value) : "-") },
            ]}
            locale={{ emptyText: "没有成员数据：同步后可拉取群成员" }}
          />
        </Space>
      ) : null}
    </Drawer>
  );
}
