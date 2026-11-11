"use client";

import {
  ContactsOutlined,
  EditOutlined,
  IdcardOutlined,
  PlusOutlined,
  ReloadOutlined,
  SwapOutlined,
  TagsOutlined,
  UserSwitchOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  DatePicker,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Timeline,
} from "antd";
import dayjs from "dayjs";
import type { Key } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SCRM_CONTACT_STATUS, SCRM_FIELD_TYPES } from "@enterprise/contracts";
import { Notice, Panel } from "@/components/ui/panel";
import {
  CONTACT_STATUS_LABELS,
  FIELD_TYPE_LABELS,
  contactStatusLabel,
  fmtDateTime,
  flattenTags,
  loadScrmStaff,
  scrmApi,
  tagOptions,
  tagSourceLabel,
  type ScrmContact,
  type ScrmContactDetail,
  type ScrmField,
  type ScrmTagGroup,
} from "./scrm-common";

/**
 * 客户档案：企微为源、本地镜像；详情抽屉聚合资料卡字段、标签、客户群与事件时间线。
 * 批量打标支持「选中的客户」与「当前筛选项」两种口径；归属变更只允许组织在册成员。
 */

const STATUS_OPTIONS = Object.entries(CONTACT_STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const FIELD_TYPE_OPTIONS = Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

/** 三套资料卡模板：一键补齐常用字段，已存在的同名字段跳过。 */
const FIELD_TEMPLATES: { name: string; desc: string; fields: Omit<ScrmField, "id" | "builtin">[] }[] = [
  {
    name: "教育培训",
    desc: "意向课程 / 学员年级 / 试听时间",
    fields: [
      { key: "edu_course", label: "意向课程", type: "SELECT", options: ["少儿编程", "雅思托福", "成人学历", "职业技能"], required: false, sort: 100, description: "" },
      { key: "edu_grade", label: "学员年级", type: "TEXT", options: [], required: false, sort: 110, description: "" },
      { key: "edu_trial_at", label: "试听时间", type: "DATE", options: [], required: false, sort: 120, description: "" },
    ],
  },
  {
    name: "零售电商",
    desc: "购买渠道 / 会员等级 / 最近下单",
    fields: [
      { key: "retail_channel", label: "购买渠道", type: "SELECT", options: ["天猫", "京东", "抖音", "私域"], required: false, sort: 100, description: "" },
      { key: "retail_level", label: "会员等级", type: "SELECT", options: ["普通", "银卡", "金卡", "黑卡"], required: false, sort: 110, description: "" },
      { key: "retail_last_order", label: "最近下单", type: "DATE", options: [], required: false, sort: 120, description: "" },
    ],
  },
  {
    name: "B2B 企业服务",
    desc: "公司规模 / 决策角色 / 预算周期",
    fields: [
      { key: "b2b_size", label: "公司规模", type: "SELECT", options: ["1-50 人", "51-200 人", "201-1000 人", "1000 人以上"], required: false, sort: 100, description: "" },
      { key: "b2b_role", label: "决策角色", type: "SELECT", options: ["决策人", "影响者", "使用者", "采购"], required: false, sort: 110, description: "" },
      { key: "b2b_budget", label: "预算周期", type: "SELECT", options: ["本月", "本季度", "半年内", "明年"], required: false, sort: 120, description: "" },
    ],
  },
];

export function ScrmContactsView({ tick }: { tick: number }) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<ScrmContact[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<(typeof SCRM_CONTACT_STATUS)[number] | "">("");
  const [staffUserId, setStaffUserId] = useState("");
  const [tagId, setTagId] = useState<number | undefined>(undefined);
  const [selected, setSelected] = useState<Key[]>([]);
  const [tagGroups, setTagGroups] = useState<ScrmTagGroup[]>([]);
  const [staffOptions, setStaffOptions] = useState<{ value: string; label: string }[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchByFilter, setBatchByFilter] = useState(false);
  const [detailId, setDetailId] = useState<number | undefined>(undefined);
  const [fieldsOpen, setFieldsOpen] = useState(false);

  const loadTags = useCallback(async () => {
    try {
      setTagGroups((await scrmApi.tagGroups()) ?? []);
    } catch {
      // 标签库读不到不影响客户列表
    }
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await scrmApi.contacts({
        query: {
          page,
          pageSize,
          ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
          ...(status ? { status } : {}),
          ...(staffUserId ? { staffUserId } : {}),
          ...(tagId ? { tagId } : {}),
        },
      });
      setRows(result?.list ?? []);
      setTotal(result?.total ?? 0);
    } catch (error) {
      message.error((error as Error).message || "客户列表读取失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, status, staffUserId, tagId, message]);

  useEffect(() => {
    void reload();
  }, [reload, tick]);

  useEffect(() => {
    void loadTags();
    void loadScrmStaff().then(setStaffOptions);
  }, [loadTags]);

  const columns = [
    {
      title: "客户",
      dataIndex: "name",
      render: (value: string, row: ScrmContact) => (
        <Space orientation="vertical" size={0}>
          <Space size={6}>
            <span>{value || "未命名客户"}</span>
            <Tag color={row.status === "ACTIVE" ? "success" : "default"}>
              {contactStatusLabel(row.status)}
            </Tag>
          </Space>
          <span className="text-12 muted">
            {row.remark || row.externalUserId}
            {row.region ? ` · ${row.region}` : ""}
          </span>
        </Space>
      ),
    },
    {
      title: "归属员工",
      dataIndex: "staff",
      width: 180,
      render: (value: ScrmContact["staff"]) =>
        value?.length ? (
          <Space size={2} wrap>
            {value.map((item) => (
              <Tag key={item.userId}>{item.name || item.userId}</Tag>
            ))}
          </Space>
        ) : (
          <Tag color="warning">未分配</Tag>
        ),
    },
    {
      title: "标签",
      dataIndex: "tags",
      render: (value: ScrmContact["tags"]) =>
        value?.length ? (
          <Space size={2} wrap>
            {value.slice(0, 4).map((tag) => (
              <Tag key={tag.id} color={tag.color || undefined}>
                {tag.name}
              </Tag>
            ))}
            {value.length > 4 ? <span className="text-12 muted">+{value.length - 4}</span> : null}
          </Space>
        ) : (
          <span className="text-12 muted">-</span>
        ),
    },
    {
      title: "来源活码",
      dataIndex: "sourceCodeName",
      width: 140,
      render: (value: string) => value || "-",
    },
    {
      title: "客户群",
      dataIndex: "chatCount",
      width: 90,
    },
    {
      title: "最近互动",
      dataIndex: "lastInteractionAt",
      width: 170,
      render: (value: string) => (value ? fmtDateTime(value) : "-"),
    },
    {
      title: "操作",
      width: 90,
      render: (_: unknown, row: ScrmContact) => (
        <Button size="small" onClick={() => setDetailId(row.id)}>
          详情
        </Button>
      ),
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Panel
        title={
          <>
            <ContactsOutlined aria-hidden /> 客户档案
          </>
        }
        titleExtra="客户以企微为源、本地镜像；流失客户保留记录与聊天关联，不物理删除"
        extra={
          <Space wrap>
            <Button icon={<ReloadOutlined aria-hidden />} onClick={() => void reload()} loading={loading}>
              刷新
            </Button>
            <Button
              icon={<IdcardOutlined aria-hidden />}
              onClick={() => setFieldsOpen(true)}
            >
              资料卡字段
            </Button>
            <Button
              type="primary"
              icon={<TagsOutlined aria-hidden />}
              disabled={!selected.length}
              onClick={() => {
                setBatchByFilter(false);
                setBatchOpen(true);
              }}
            >
              选中打标
            </Button>
            <Button
              icon={<TagsOutlined aria-hidden />}
              onClick={() => {
                setBatchByFilter(true);
                setBatchOpen(true);
              }}
            >
              按筛选打标
            </Button>
          </Space>
        }
      >
        <Space wrap style={{ marginBottom: 12 }}>
          <Input.Search
            allowClear
            placeholder="姓名 / 备注"
            style={{ width: 220 }}
            onSearch={(value) => {
              setPage(1);
              setKeyword(value);
            }}
          />
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 120 }}
            value={status || undefined}
            options={STATUS_OPTIONS}
            onChange={(value) => {
              setPage(1);
              setStatus(SCRM_CONTACT_STATUS.find((item) => item === value) ?? "");
            }}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="归属员工"
            style={{ width: 180 }}
            value={staffUserId || undefined}
            options={staffOptions}
            onChange={(value) => {
              setPage(1);
              setStaffUserId(value ?? "");
            }}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="标签"
            style={{ width: 180 }}
            value={tagId}
            options={flattenTags(tagGroups).map((tag) => ({ value: tag.id, label: tag.name }))}
            onChange={(value) => {
              setPage(1);
              setTagId(value ?? undefined);
            }}
          />
        </Space>
        <Table<ScrmContact>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={rows}
          columns={columns}
          scroll={{ x: 1080 }}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: (keys) => setSelected(keys),
          }}
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
          locale={{ emptyText: "还没有客户：先在概览做一次同步，或让客户通过活码添加员工" }}
        />
      </Panel>

      <BatchTagModal
        open={batchOpen}
        byFilter={batchByFilter}
        contactIds={selected.map(Number)}
        tagGroups={tagGroups}
        onClose={() => setBatchOpen(false)}
        onDone={() => {
          setBatchOpen(false);
          setSelected([]);
          void reload();
        }}
      />

      <ContactDetailDrawer
        id={detailId}
        staffOptions={staffOptions}
        onClose={() => setDetailId(undefined)}
        onChanged={() => void reload()}
      />

      <FieldManageDrawer
        open={fieldsOpen}
        onClose={() => setFieldsOpen(false)}
      />
    </Space>
  );
}

/** 打标唯一入口：选中客户走 contactIds，按筛选走服务端筛选条件。 */
function BatchTagModal({
  open,
  byFilter,
  contactIds,
  tagGroups,
  onClose,
  onDone,
}: {
  open: boolean;
  byFilter: boolean;
  contactIds: number[];
  tagGroups: ScrmTagGroup[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const options = useMemo(() => tagOptions(tagGroups), [tagGroups]);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
  }, [open, form]);

  const submit = async () => {
    const values = await form.validateFields();
    const addTagIds = (values.addTagIds ?? []) as number[];
    const removeTagIds = (values.removeTagIds ?? []) as number[];
    if (!addTagIds.length && !removeTagIds.length) {
      message.warning("请选择要添加或移除的标签");
      return;
    }
    setSaving(true);
    try {
      if (byFilter) {
        const keywordValue = String(values.keyword || "").trim();
        const statusValue = SCRM_CONTACT_STATUS.find((item) => item === values.status) ?? "";
        const result = await scrmApi.batchTagByFilter({
          body: {
            ...(keywordValue ? { keyword: keywordValue } : {}),
            ...(statusValue ? { status: statusValue } : {}),
            addTagIds,
            removeTagIds,
          },
        });
        message.success(
          `已匹配 ${result?.matched ?? 0} 位客户，更新 ${result?.updated ?? 0} 位`,
        );
      } else {
        const result = await scrmApi.batchTag({
          body: { contactIds, addTagIds, removeTagIds },
        });
        message.success(
          `已更新 ${result?.updated ?? 0} 位客户${result?.failed ? `，失败 ${result.failed} 位` : ""}`,
        );
      }
      onDone();
    } catch (error) {
      message.error((error as Error).message || "打标失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={byFilter ? "按当前筛选批量打标" : `给选中的 ${contactIds.length} 位客户打标`}
      open={open}
      confirmLoading={saving}
      okText="应用"
      onOk={() => void submit()}
      onCancel={onClose}
      width={560}
    >
      <Form form={form} layout="vertical">
        {byFilter ? (
          <div className="form-2col">
            <Form.Item name="keyword" label="姓名 / 备注包含">
              <Input allowClear placeholder="留空表示不限" maxLength={100} />
            </Form.Item>
            <Form.Item name="status" label="客户状态">
              <Select allowClear placeholder="不限" options={STATUS_OPTIONS} />
            </Form.Item>
          </div>
        ) : null}
        <Form.Item name="addTagIds" label="添加标签">
          <Select mode="multiple" allowClear options={options} placeholder="选择要添加的标签" />
        </Form.Item>
        <Form.Item name="removeTagIds" label="移除标签">
          <Select mode="multiple" allowClear options={options} placeholder="选择要移除的标签" />
        </Form.Item>
        <Notice variant="info">
          打标会同步回企微标签；自动打标规则也会在客户新增或活码来源命中时触发。
          单次最多 200 位客户、50 个标签。
        </Notice>
      </Form>
    </Modal>
  );
}

function ContactDetailDrawer({
  id,
  staffOptions,
  onClose,
  onChanged,
}: {
  id?: number;
  staffOptions: { value: string; label: string }[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { message } = App.useApp();
  const [detail, setDetail] = useState<ScrmContactDetail | null>(null);
  const [fields, setFields] = useState<ScrmField[]>([]);
  const [loading, setLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [fieldForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [assignForm] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [detailValue, fieldValue] = await Promise.all([
        scrmApi.contact({ query: { id } }),
        scrmApi.fields(),
      ]);
      setDetail(detailValue);
      setFields(fieldValue ?? []);
      const initial: Record<string, unknown> = {};
      for (const field of fieldValue ?? []) {
        const value = detailValue?.fields.find((item) => item.fieldKey === field.key)?.value;
        if (field.type === "MULTI") initial[field.key] = Array.isArray(value) ? value : [];
        else if ((field.type === "DATE" || field.type === "BIRTHDAY") && value) {
          initial[field.key] = dayjs(String(value));
        } else {
          initial[field.key] = Array.isArray(value) ? value.join(",") : value ?? "";
        }
      }
      fieldForm.resetFields();
      fieldForm.setFieldsValue(initial);
    } catch (error) {
      message.error((error as Error).message || "客户详情读取失败");
    } finally {
      setLoading(false);
    }
  }, [id, fieldForm, message]);

  useEffect(() => {
    if (!id) {
      setDetail(null);
      return;
    }
    void load();
  }, [id, load]);

  const saveFields = async () => {
    if (!id) return;
    const values = fieldForm.getFieldsValue();
    // 空值也要提交：后端按「空即删除」处理，否则用户清空字段后旧值会留在库里
    const payload = fields.map((field) => {
      const value = values[field.key];
      if (field.type === "MULTI") return { fieldKey: field.key, value: Array.isArray(value) ? value.map(String) : [] };
      if (field.type === "DATE" || field.type === "BIRTHDAY") {
        return { fieldKey: field.key, value: value ? dayjs(value).format("YYYY-MM-DD") : "" };
      }
      return { fieldKey: field.key, value: value === undefined || value === null ? "" : String(value) };
    });
    setSaving(true);
    try {
      const result = await scrmApi.saveContactFields({
        body: { contactId: id, values: payload },
      });
      message.success(`资料卡已保存 ${result?.saved ?? 0} 项`);
      await load();
    } catch (error) {
      message.error((error as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!detail) return;
    const values = await editForm.validateFields();
    setSaving(true);
    try {
      await scrmApi.updateContact({
        body: { id: detail.id, remark: values.remark ?? "", description: values.description ?? "" },
      });
      message.success("备注与描述已更新（会同步企微备注）");
      setEditOpen(false);
      await load();
      onChanged();
    } catch (error) {
      message.error((error as Error).message || "更新失败");
    } finally {
      setSaving(false);
    }
  };

  const saveAssign = async () => {
    if (!detail) return;
    const values = await assignForm.validateFields();
    setSaving(true);
    try {
      await scrmApi.assignContact({ body: { id: detail.id, staffUserId: values.staffUserId } });
      message.success("归属已变更");
      setAssignOpen(false);
      await load();
      onChanged();
    } catch (error) {
      message.error((error as Error).message || "变更归属失败");
    } finally {
      setSaving(false);
    }
  };

  const promote = async () => {
    if (!detail) return;
    try {
      const result = await scrmApi.promoteContact({ body: { id: detail.id } });
      message.success(
        result?.crmLeadId ? `已转为 CRM 线索 #${result.crmLeadId}` : "已在 CRM 线索池中",
      );
      await load();
      onChanged();
    } catch (error) {
      message.error((error as Error).message || "转 CRM 失败");
    }
  };

  return (
    <Drawer
      title={detail ? detail.name || "客户详情" : "客户详情"}
      open={Boolean(id)}
      onClose={onClose}
      size={760}
      loading={loading}
      extra={
        detail ? (
          <Space wrap>
            <Button
              icon={<EditOutlined aria-hidden />}
              onClick={() => {
                editForm.setFieldsValue({
                  remark: detail.remark,
                  description: detail.description,
                });
                setEditOpen(true);
              }}
            >
              编辑资料
            </Button>
            <Button
              icon={<UserSwitchOutlined aria-hidden />}
              onClick={() => {
                assignForm.setFieldsValue({
                  staffUserId: detail.staff[0]?.userId ?? undefined,
                });
                setAssignOpen(true);
              }}
            >
              改归属
            </Button>
            <Button icon={<SwapOutlined aria-hidden />} onClick={() => void promote()}>
              转 CRM 线索
            </Button>
          </Space>
        ) : null
      }
    >
      {detail ? (
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <Descriptions
            size="small"
            column={2}
            items={[
              { key: "status", label: "状态", children: <Tag color={detail.status === "ACTIVE" ? "success" : "default"}>{contactStatusLabel(detail.status)}</Tag> },
              { key: "source", label: "来源活码", children: detail.sourceCodeName || "-" },
              { key: "remark", label: "备注", children: detail.remark || "-" },
              { key: "region", label: "地区", children: detail.region || "-" },
              { key: "gender", label: "性别", children: detail.gender || "-" },
              { key: "addedAt", label: "添加时间", children: detail.addedAt ? fmtDateTime(detail.addedAt) : "-" },
              { key: "last", label: "最近互动", children: detail.lastInteractionAt ? fmtDateTime(detail.lastInteractionAt) : "-" },
              { key: "lost", label: "流失", children: detail.lostAt ? `${fmtDateTime(detail.lostAt)}${detail.lostReason ? `（${detail.lostReason}）` : ""}` : "-" },
              { key: "crm", label: "CRM 线索", children: detail.crmLeadId ? `#${detail.crmLeadId}` : "未转" },
              { key: "chats", label: "客户群", children: `${detail.chatCount} 个` },
              { key: "staff", label: "归属员工", span: 2, children: detail.staff.length ? detail.staff.map((item) => item.name || item.userId).join("、") : "未分配" },
              { key: "description", label: "描述", span: 2, children: detail.description || "-" },
              { key: "tags", label: "标签", span: 2, children: detail.tags.length ? (
                <Space size={2} wrap>
                  {detail.tags.map((tag) => (
                    <Tag key={tag.id} color={tag.color || undefined} title={tagSourceLabel(tag.source)}>
                      {tag.name}
                    </Tag>
                  ))}
                </Space>
              ) : "-" },
            ]}
          />

          <Panel title="资料卡" titleExtra="9 类字段类型；空值不覆盖已有数据">
            <Form form={fieldForm} layout="vertical" onFinish={() => void saveFields()}>
              <div className="form-2col">
                {fields.map((field) => (
                  <Form.Item
                    key={field.key}
                    name={field.key}
                    label={field.label}
                    tooltip={field.description || undefined}
                    rules={field.required ? [{ required: true, message: `请填写${field.label}` }] : undefined}
                  >
                    <FieldInput field={field} />
                  </Form.Item>
                ))}
              </div>
              <Button type="primary" htmlType="submit" loading={saving}>
                保存资料卡
              </Button>
            </Form>
          </Panel>

          <Panel title="事件时间线" titleExtra="加好友、打标、进群、流失、转 CRM 都留痕">
            {detail.timeline.length ? (
              <Timeline
                items={detail.timeline.map((item) => ({
                  key: item.id,
                  color: item.kind === "LOST" ? "red" : undefined,
                  content: (
                    <Space orientation="vertical" size={0}>
                      <span>
                        {item.title}
                        <span className="text-12 muted" style={{ marginLeft: 8 }}>
                          {fmtDateTime(item.at)}
                        </span>
                      </span>
                      {item.detail ? <span className="text-12 muted">{item.detail}</span> : null}
                    </Space>
                  ),
                }))}
              />
            ) : (
              <span className="text-12 muted">暂无事件</span>
            )}
          </Panel>

          <Panel title="所在客户群">
            <Table
              rowKey="id"
              size="small"
              dataSource={detail.chats}
              pagination={false}
              columns={[
                { title: "客户群", dataIndex: "name", render: (value: string) => value || "-" },
                { title: "群主", dataIndex: "ownerStaffName", width: 140, render: (value: string) => value || "-" },
                { title: "成员数", dataIndex: "memberCount", width: 90 },
              ]}
              locale={{ emptyText: "该客户还没有进入任何客户群" }}
            />
          </Panel>
        </Space>
      ) : null}

      <Modal
        title="编辑备注与描述"
        open={editOpen}
        confirmLoading={saving}
        okText="保存"
        onOk={() => void saveEdit()}
        onCancel={() => setEditOpen(false)}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="remark" label="备注" rules={[{ max: 200 }]}>
            <Input maxLength={200} placeholder="企微备注名" />
          </Form.Item>
          <Form.Item name="description" label="描述" rules={[{ max: 1000 }]}>
            <Input.TextArea rows={4} maxLength={1000} placeholder="客户背景、沟通偏好等" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="变更客户归属"
        open={assignOpen}
        confirmLoading={saving}
        okText="确认变更"
        onOk={() => void saveAssign()}
        onCancel={() => setAssignOpen(false)}
      >
        <Form form={assignForm} layout="vertical">
          <Form.Item
            name="staffUserId"
            label="新归属员工"
            rules={[{ required: true, message: "请选择员工" }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={staffOptions}
              placeholder="选择组织在册员工"
            />
          </Form.Item>
          <Notice variant="warn">归属变更会同步企微；原员工仍能在历史群聊里看到客户。</Notice>
        </Form>
      </Modal>
    </Drawer>
  );
}

function FieldInput({ field }: { field: ScrmField }) {
  if (field.type === "SELECT") {
    return <Select allowClear options={field.options.map((value) => ({ value, label: value }))} />;
  }
  if (field.type === "MULTI") {
    return <Select mode="multiple" allowClear options={field.options.map((value) => ({ value, label: value }))} />;
  }
  if (field.type === "DATE" || field.type === "BIRTHDAY") {
    return <DatePicker style={{ width: "100%" }} />;
  }
  if (field.type === "NUMBER") {
    return <InputNumber style={{ width: "100%" }} />;
  }
  if (field.type === "PHONE") {
    return <Input maxLength={20} placeholder="手机号" />;
  }
  if (field.type === "EMAIL") {
    return <Input maxLength={120} placeholder="name@example.com" />;
  }
  if (field.type === "IMAGE") {
    return <Input maxLength={500} placeholder="图片 URL 或数字资产 ID" />;
  }
  return <Input maxLength={200} />;
}

/** 资料卡字段管理：内置字段可改名/改排序但不可删；支持一键套用三套行业模板。 */
function FieldManageDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = App.useApp();
  const [fields, setFields] = useState<ScrmField[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<ScrmField | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [templateBusy, setTemplateBusy] = useState("");
  const [form] = Form.useForm();
  const type = Form.useWatch("type", form);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setFields((await scrmApi.fields()) ?? []);
    } catch (error) {
      message.error((error as Error).message || "字段读取失败");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await scrmApi.saveField({
        body: {
          id: editing?.id ?? 0,
          label: values.label,
          type: values.type,
          options: String(values.options || "")
            .split(/[\n,，]/)
            .map((item: string) => item.trim())
            .filter(Boolean),
          required: Boolean(values.required),
          sort: Number(values.sort ?? 0),
          description: values.description ?? "",
        },
      });
      message.success("字段已保存");
      setModalOpen(false);
      await load();
    } catch (error) {
      message.error((error as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: ScrmField) => {
    try {
      await scrmApi.removeField({ body: { id: row.id } });
      message.success("字段已删除（关联的已填值一并清理）");
      await load();
    } catch (error) {
      message.error((error as Error).message || "删除失败");
    }
  };

  const applyTemplate = async (template: (typeof FIELD_TEMPLATES)[number]) => {
    setTemplateBusy(template.name);
    try {
      let created = 0;
      for (const field of template.fields) {
        if (fields.some((item) => item.key === field.key || item.label === field.label)) continue;
        await scrmApi.saveField({
          body: {
            id: 0,
            key: field.key,
            label: field.label,
            type: SCRM_FIELD_TYPES.find((item) => item === field.type) ?? "TEXT",
            options: field.options,
            required: field.required,
            sort: field.sort,
            description: field.description,
          },
        });
        created += 1;
      }
      message.success(created ? `已套用「${template.name}」：新增 ${created} 个字段` : `「${template.name}」字段已存在`);
      await load();
    } catch (error) {
      message.error((error as Error).message || "套用模板失败");
    } finally {
      setTemplateBusy("");
    }
  };

  return (
    <Drawer title="资料卡字段" open={open} onClose={onClose} size={720}>
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        <Space wrap>
          <Button
            type="primary"
            icon={<PlusOutlined aria-hidden />}
            onClick={() => {
              setEditing(null);
              form.resetFields();
              form.setFieldsValue({ type: "TEXT", sort: 100, required: false });
              setModalOpen(true);
            }}
          >
            新增字段
          </Button>
          <Button icon={<ReloadOutlined aria-hidden />} onClick={() => void load()} loading={loading}>
            刷新
          </Button>
        </Space>
        <Space wrap size={[8, 8]}>
          <span className="text-12 muted">示例模板：</span>
          {FIELD_TEMPLATES.map((template) => (
            <Popconfirm
              key={template.name}
              title={`套用「${template.name}」模板？`}
              description={`将补齐 ${template.desc}，已存在的字段跳过。`}
              onConfirm={() => void applyTemplate(template)}
            >
              <Button size="small" loading={templateBusy === template.name}>
                {template.name}
              </Button>
            </Popconfirm>
          ))}
        </Space>
        <Table<ScrmField>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={fields}
          pagination={false}
          columns={[
            { title: "字段名", dataIndex: "label" },
            { title: "类型", dataIndex: "type", width: 110, render: (value: string) => FIELD_TYPE_LABELS[value] ?? value },
            {
              title: "选项",
              dataIndex: "options",
              render: (value: string[]) => (value?.length ? value.slice(0, 4).join(" / ") : "-"),
            },
            { title: "必填", dataIndex: "required", width: 70, render: (value: boolean) => (value ? "是" : "否") },
            {
              title: "来源",
              dataIndex: "builtin",
              width: 90,
              render: (value: boolean) => <Tag>{value ? "内置" : "自定义"}</Tag>,
            },
            {
              title: "操作",
              width: 130,
              render: (_: unknown, row) => (
                <Space size={4}>
                  <Button
                    size="small"
                    onClick={() => {
                      setEditing(row);
                      form.setFieldsValue({
                        label: row.label,
                        type: row.type,
                        options: row.options.join("\n"),
                        required: row.required,
                        sort: row.sort,
                        description: row.description,
                      });
                      setModalOpen(true);
                    }}
                  >
                    编辑
                  </Button>
                  <Button size="small" danger disabled={row.builtin} onClick={() => void remove(row)}>
                    删除
                  </Button>
                </Space>
              ),
            },
          ]}
          locale={{ emptyText: "还没有字段" }}
        />
        <Notice variant="info">
          内置字段用于客户画像与 SOP 条件，可改名或调整排序，但不能删除；删除自定义字段会一并清理已填值。
        </Notice>
      </Space>

      <Modal
        title={editing ? `编辑字段：${editing.label}` : "新增资料卡字段"}
        open={modalOpen}
        confirmLoading={saving}
        okText="保存"
        onOk={() => void submit()}
        onCancel={() => setModalOpen(false)}
      >
        <Form form={form} layout="vertical">
          <div className="form-2col">
            <Form.Item name="label" label="字段名称" rules={[{ required: true, message: "请填写字段名称" }]}>
              <Input maxLength={40} />
            </Form.Item>
            <Form.Item name="type" label="字段类型">
              <Select options={FIELD_TYPE_OPTIONS} />
            </Form.Item>
            <Form.Item name="sort" label="排序" tooltip="数字越小越靠前">
              <InputNumber min={0} max={999} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="required" label="必填" valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>
          {type === "SELECT" || type === "MULTI" ? (
            <Form.Item name="options" label="选项" tooltip="一行一个，或用逗号分隔">
              <Input.TextArea rows={4} />
            </Form.Item>
          ) : null}
          <Form.Item name="description" label="说明">
            <Input maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>
    </Drawer>
  );
}
