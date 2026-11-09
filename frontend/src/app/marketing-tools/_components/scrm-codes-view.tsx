"use client";

import {
  BarsOutlined,
  DeleteOutlined,
  PlusOutlined,
  QrcodeOutlined,
  ReloadOutlined,
  TagsOutlined,
  MessageOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
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
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { Notice, Panel } from "@/components/ui/panel";
import {
  CODE_STATUS_LABELS,
  STAFF_STRATEGY_LABELS,
  WELCOME_SCOPE_LABELS,
  fmtDateTime,
  loadScrmStaff,
  scrmApi,
  tagOptions,
  type ScrmAutoTagRule,
  type ScrmCode,
  type ScrmMaterial,
  type ScrmTagGroup,
  type ScrmWelcome,
} from "./scrm-common";

/**
 * 活码与欢迎语：活码在企微侧生成二维码，成员到上限自动摘除；欢迎语走回调的 WelcomeCode。
 * 自动打标只开放「新客户 / 活码来源」两类事件，关键词与群事件需要会话存档，首期不伪造。
 */

const STRATEGY_OPTIONS = Object.entries(STAFF_STRATEGY_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export function ScrmCodesView({ tick }: { tick: number }) {
  const { message } = App.useApp();
  const [codes, setCodes] = useState<ScrmCode[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  const [welcomes, setWelcomes] = useState<ScrmWelcome[]>([]);
  const [rules, setRules] = useState<ScrmAutoTagRule[]>([]);
  const [tagGroups, setTagGroups] = useState<ScrmTagGroup[]>([]);
  const [materials, setMaterials] = useState<ScrmMaterial[]>([]);
  const [staffOptions, setStaffOptions] = useState<{ value: string; label: string }[]>([]);
  const [codeOpen, setCodeOpen] = useState(false);
  const [editingCode, setEditingCode] = useState<ScrmCode | null>(null);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [editingWelcome, setEditingWelcome] = useState<ScrmWelcome | null>(null);
  const [ruleOpen, setRuleOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<ScrmAutoTagRule | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [stats, setStats] = useState<{ codeId: number; name: string; scanned: number; added: number }[]>([]);
  const [statsDays, setStatsDays] = useState(30);
  const [busy, setBusy] = useState(0);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await scrmApi.codes({
        query: { page, pageSize, ...(keyword.trim() ? { keyword: keyword.trim() } : {}) },
      });
      setCodes(result?.list ?? []);
      setTotal(result?.total ?? 0);
    } catch (error) {
      message.error((error as Error).message || "活码读取失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, message]);

  const reloadMeta = useCallback(async () => {
    const [welcomeValue, ruleValue, tagValue, materialValue] = await Promise.all([
      scrmApi.welcomes().catch(() => []),
      scrmApi.autoTagRules().catch(() => []),
      scrmApi.tagGroups().catch(() => []),
      scrmApi.materials().catch(() => []),
    ]);
    setWelcomes(welcomeValue ?? []);
    setRules(ruleValue ?? []);
    setTagGroups(tagValue ?? []);
    setMaterials(materialValue ?? []);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, tick]);

  useEffect(() => {
    void reloadMeta();
    void loadScrmStaff().then(setStaffOptions);
  }, [reloadMeta]);

  const removeCode = async (row: ScrmCode) => {
    setBusy(row.id);
    try {
      await scrmApi.removeCode({ body: { id: row.id } });
      message.success("活码已删除（企微侧配置一并删除）");
      void reload();
      void reloadMeta();
    } catch (error) {
      message.error((error as Error).message || "删除失败");
    } finally {
      setBusy(0);
    }
  };

  const loadStats = async (days: number) => {
    try {
      setStats((await scrmApi.codeStats({ query: { days } })) ?? []);
    } catch (error) {
      message.error((error as Error).message || "活码统计读取失败");
    }
  };

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Panel
        title={
          <>
            <QrcodeOutlined aria-hidden /> 渠道活码
          </>
        }
        titleExtra="新建时在企微生成二维码；成员到当日上限自动从引流名单摘除，无人可接时暂停活码"
        extra={
          <Space wrap>
            <Button icon={<BarsOutlined aria-hidden />} onClick={() => { setStatsOpen(true); void loadStats(statsDays); }}>
              活码统计
            </Button>
            <Button icon={<ReloadOutlined aria-hidden />} onClick={() => void reload()} loading={loading}>
              刷新
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined aria-hidden />}
              onClick={() => {
                setEditingCode(null);
                setCodeOpen(true);
              }}
            >
              新建活码
            </Button>
          </Space>
        }
      >
        <Space wrap style={{ marginBottom: 12 }}>
          <Input.Search
            allowClear
            placeholder="活码名称"
            style={{ width: 220 }}
            onSearch={(value) => {
              setPage(1);
              setKeyword(value);
            }}
          />
        </Space>
        <Table<ScrmCode>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={codes}
          scroll={{ x: 1100 }}
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
              title: "活码",
              dataIndex: "name",
              render: (value: string, row) => (
                <Space orientation="vertical" size={0}>
                  <Space size={6}>
                    <span>{value}</span>
                    <Tag color={row.status === "ACTIVE" ? "success" : "warning"}>
                      {CODE_STATUS_LABELS[row.status] ?? row.status}
                    </Tag>
                  </Space>
                  <span className="text-12 muted">
                    {row.groupName || "未分组"} · 场景值 {row.scene || "-"}
                  </span>
                </Space>
              ),
            },
            {
              title: "标签",
              dataIndex: "tagNames",
              render: (value: string[]) =>
                value?.length ? (
                  <Space size={2} wrap>
                    {value.map((name) => (
                      <Tag key={name}>{name}</Tag>
                    ))}
                  </Space>
                ) : (
                  "-"
                ),
            },
            {
              title: "接待成员",
              dataIndex: "staff",
              width: 210,
              render: (value: ScrmCode["staff"], row: ScrmCode) => (
                <Space orientation="vertical" size={0}>
                  <span className="text-12">
                    {value?.length
                      ? value.map((item) => `${item.name || item.staffUserId}（今日 ${item.usedToday}）`).join("、")
                      : "-"}
                  </span>
                  <span className="text-12 muted">
                    {STAFF_STRATEGY_LABELS[row.staffStrategy] ?? row.staffStrategy}
                  </span>
                </Space>
              ),
            },
            {
              title: "扫码 / 添加",
              dataIndex: "scanned",
              width: 130,
              render: (value: number, row) => `${value} / ${row.added}`,
            },
            {
              title: "欢迎语",
              dataIndex: "welcomeId",
              width: 140,
              render: (value: number) =>
                welcomes.find((item) => item.id === value)?.name ?? (value ? `#${value}` : "-"),
            },
            {
              title: "二维码",
              dataIndex: "qrUrl",
              width: 90,
              render: (value: string) =>
                value ? (
                  <Button size="small" type="link" href={value} target="_blank" rel="noreferrer">
                    查看
                  </Button>
                ) : (
                  "-"
                ),
            },
            {
              title: "操作",
              width: 130,
              render: (_: unknown, row) => (
                <Space size={4}>
                  <Button
                    size="small"
                    onClick={() => {
                      setEditingCode(row);
                      setCodeOpen(true);
                    }}
                  >
                    编辑
                  </Button>
                  <Popconfirm
                    title="删除这个活码？"
                    description="企微侧二维码会一并删除，已添加的客户不受影响。"
                    onConfirm={() => void removeCode(row)}
                  >
                    <Button size="small" danger loading={busy === row.id}>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
          locale={{ emptyText: "还没有活码：新建后把二维码投放到渠道，客户扫码添加员工" }}
        />
      </Panel>

      <Panel
        title={
          <>
            <MessageOutlined aria-hidden /> 欢迎语
          </>
        }
        titleExtra="客户加好友时用回调的 WelcomeCode 发送，20 秒内有效；失败重试 3 次后留痕"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined aria-hidden />}
            onClick={() => {
              setEditingWelcome(null);
              setWelcomeOpen(true);
            }}
          >
            新建欢迎语
          </Button>
        }
      >
        <Table<ScrmWelcome>
          rowKey="id"
          size="small"
          dataSource={welcomes}
          pagination={false}
          scroll={{ x: 900 }}
          columns={[
            { title: "名称", dataIndex: "name" },
            {
              title: "适用范围",
              dataIndex: "scope",
              width: 130,
              render: (value: string, row) => (
                <Space orientation="vertical" size={0}>
                  <Tag>{WELCOME_SCOPE_LABELS[value] ?? value}</Tag>
                  {value === "STAFF" ? (
                    <span className="text-12 muted">
                      {staffOptions.find((item) => item.value === row.staffUserId)?.label || row.staffUserId}
                    </span>
                  ) : null}
                </Space>
              ),
            },
            {
              title: "内容",
              dataIndex: "content",
              render: (value: string, row) => (
                <Space orientation="vertical" size={0}>
                  <span className="text-12">{value || "-"}</span>
                  {row.materialIds.length ? (
                    <span className="text-12 muted">附件 {row.materialIds.length} 个</span>
                  ) : null}
                </Space>
              ),
            },
            {
              title: "启用",
              dataIndex: "enabled",
              width: 80,
              render: (value: boolean) => (value ? <Tag color="success">启用</Tag> : <Tag>停用</Tag>),
            },
            { title: "创建时间", dataIndex: "createdAt", width: 170, render: fmtDateTime },
            {
              title: "操作",
              width: 150,
              render: (_: unknown, row) => (
                <Space size={4}>
                  <Button
                    size="small"
                    onClick={() => {
                      setEditingWelcome(row);
                      setWelcomeOpen(true);
                    }}
                  >
                    编辑
                  </Button>
                  <Popconfirm
                    title="删除这条欢迎语？"
                    onConfirm={() =>
                      void scrmApi
                        .removeWelcome({ body: { id: row.id } })
                        .then(() => {
                          message.success("已删除");
                          void reloadMeta();
                        })
                        .catch((error: Error) => message.error(error.message || "删除失败"))
                    }
                  >
                    <Button size="small" danger>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
          locale={{ emptyText: "还没有欢迎语：可在活码或 SOP 里引用" }}
        />
      </Panel>

      <Panel
        title={
          <>
            <TagsOutlined aria-hidden /> 自动打标
          </>
        }
        titleExtra="新客户 / 活码来源命中时自动打标；关键词与群事件需要会话存档，首期不开放"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined aria-hidden />}
            onClick={() => {
              setEditingRule(null);
              setRuleOpen(true);
            }}
          >
            新建规则
          </Button>
        }
      >
        <Table<ScrmAutoTagRule>
          rowKey="id"
          size="small"
          dataSource={rules}
          pagination={false}
          scroll={{ x: 860 }}
          columns={[
            { title: "规则名称", dataIndex: "name" },
            {
              title: "触发事件",
              dataIndex: "event",
              width: 120,
              render: (value: string) => (value === "CODE" ? "活码来源" : "新客户"),
            },
            {
              title: "打上标签",
              dataIndex: "tagIds",
              render: (value: number[]) => (
                <Space size={2} wrap>
                  {value.map((id) => (
                    <Tag key={id}>
                      {tagGroups.flatMap((group) => group.tags).find((tag) => tag.id === id)?.name ?? `#${id}`}
                    </Tag>
                  ))}
                </Space>
              ),
            },
            {
              title: "限定活码",
              dataIndex: "codeIds",
              width: 140,
              render: (value: number[]) =>
                value.length ? `${value.length} 个` : <span className="text-12 muted">不限</span>,
            },
            {
              title: "启用",
              dataIndex: "enabled",
              width: 80,
              render: (value: boolean) => (value ? <Tag color="success">启用</Tag> : <Tag>停用</Tag>),
            },
            {
              title: "操作",
              width: 150,
              render: (_: unknown, row) => (
                <Space size={4}>
                  <Button
                    size="small"
                    onClick={() => {
                      setEditingRule(row);
                      setRuleOpen(true);
                    }}
                  >
                    编辑
                  </Button>
                  <Popconfirm
                    title="删除这条规则？"
                    onConfirm={() =>
                      void scrmApi
                        .removeAutoTagRule({ body: { id: row.id } })
                        .then(() => {
                          message.success("已删除");
                          void reloadMeta();
                        })
                        .catch((error: Error) => message.error(error.message || "删除失败"))
                    }
                  >
                    <Button size="small" danger>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
          locale={{ emptyText: "还没有自动打标规则" }}
        />
      </Panel>

      <CodeModal
        open={codeOpen}
        row={editingCode}
        staffOptions={staffOptions}
        tagGroups={tagGroups}
        welcomes={welcomes}
        onClose={() => setCodeOpen(false)}
        onSaved={() => {
          setCodeOpen(false);
          void reload();
          void reloadMeta();
        }}
      />

      <WelcomeModal
        open={welcomeOpen}
        row={editingWelcome}
        staffOptions={staffOptions}
        materials={materials}
        onClose={() => setWelcomeOpen(false)}
        onSaved={() => {
          setWelcomeOpen(false);
          void reloadMeta();
          void reload();
        }}
      />

      <RuleModal
        open={ruleOpen}
        row={editingRule}
        codes={codes}
        tagGroups={tagGroups}
        onClose={() => setRuleOpen(false)}
        onSaved={() => {
          setRuleOpen(false);
          void reloadMeta();
        }}
      />

      <Modal
        title="活码统计"
        open={statsOpen}
        footer={null}
        onCancel={() => setStatsOpen(false)}
        width={620}
      >
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Select
            style={{ width: 130 }}
            value={statsDays}
            options={[7, 30, 90].map((value) => ({ value, label: `近 ${value} 天` }))}
            onChange={(value) => {
              setStatsDays(value);
              void loadStats(value);
            }}
          />
          <Table
            rowKey="codeId"
            size="small"
            dataSource={stats}
            pagination={false}
            columns={[
              { title: "活码", dataIndex: "name" },
              { title: "累计扫码", dataIndex: "scanned", width: 110 },
              { title: "周期内新增客户", dataIndex: "added", width: 140 },
            ]}
            locale={{ emptyText: "暂无数据" }}
          />
        </Space>
      </Modal>
    </Space>
  );
}

function CodeModal({
  open,
  row,
  staffOptions,
  tagGroups,
  welcomes,
  onClose,
  onSaved,
}: {
  open: boolean;
  row: ScrmCode | null;
  staffOptions: { value: string; label: string }[];
  tagGroups: ScrmTagGroup[];
  welcomes: ScrmWelcome[];
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
            groupName: row.groupName,
            scene: row.scene,
            tagIds: row.tagIds,
            welcomeId: row.welcomeId || undefined,
            staffStrategy: row.staffStrategy,
            dailyLimit: row.dailyLimit,
            staff: row.staff.map((item) => ({
              staffUserId: item.staffUserId,
              weight: item.weight,
              dailyLimit: item.dailyLimit,
            })),
          }
        : {
            name: "",
            groupName: "",
            scene: "",
            tagIds: [],
            welcomeId: undefined,
            staffStrategy: "ROUND_ROBIN",
            dailyLimit: 0,
            staff: [],
          },
    );
  }, [open, row, form]);

  const submit = async () => {
    const values = await form.validateFields();
    const staff = (values.staff ?? []) as { staffUserId: string; weight?: number; dailyLimit?: number }[];
    if (!staff.length) {
      message.warning("请至少添加一位引流成员");
      return;
    }
    setSaving(true);
    try {
      await scrmApi.saveCode({
        body: {
          id: row?.id ?? 0,
          name: values.name,
          groupName: values.groupName ?? "",
          scene: values.scene ?? "",
          tagIds: values.tagIds ?? [],
          welcomeId: Number(values.welcomeId ?? 0),
          staffStrategy: values.staffStrategy,
          dailyLimit: Number(values.dailyLimit ?? 0),
          staff: staff.map((item) => ({
            staffUserId: item.staffUserId,
            weight: Number(item.weight ?? 1),
            dailyLimit: Number(item.dailyLimit ?? 0),
          })),
        },
      });
      message.success("活码已保存（企微二维码已生成/更新）");
      onSaved();
    } catch (error) {
      message.error((error as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={row ? "编辑活码" : "新建渠道活码"}
      open={open}
      confirmLoading={saving}
      okText="保存"
      onOk={() => void submit()}
      onCancel={onClose}
      width={720}
    >
      <Form form={form} layout="vertical">
        <div className="form-2col">
          <Form.Item name="name" label="活码名称" rules={[{ required: true, message: "请填写活码名称" }]}>
            <Input maxLength={60} />
          </Form.Item>
          <Form.Item name="groupName" label="分组">
            <Input maxLength={40} placeholder="如：抖音 / 门店海报" />
          </Form.Item>
          <Form.Item name="staffStrategy" label="分流策略">
            <Select options={STRATEGY_OPTIONS} />
          </Form.Item>
          <Form.Item name="dailyLimit" label="整码每日上限" tooltip="0 表示不限；达到上限后暂停活码">
            <InputNumber min={0} max={100000} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="welcomeId" label="欢迎语">
            <Select
              allowClear
              placeholder="选择欢迎语"
              options={welcomes.map((item) => ({ value: item.id, label: item.name }))}
            />
          </Form.Item>
          <Form.Item name="tagIds" label="自动打标">
            <Select mode="multiple" allowClear options={tagOptions(tagGroups)} />
          </Form.Item>
        </div>
        <Form.Item name="scene" label="场景值" tooltip="留空自动生成；同一场景值可复用活码">
          <Input maxLength={40} placeholder="如 douyin-2026" />
        </Form.Item>
        <Form.List name="staff">
          {(items, { add, remove }) => (
            <div>
              <Space style={{ marginBottom: 8 }}>
                <span>引流成员</span>
                <Button size="small" icon={<PlusOutlined aria-hidden />} onClick={() => add({ weight: 1, dailyLimit: 0 })}>
                  添加成员
                </Button>
              </Space>
              {items.map((item) => (
                <Space key={item.key} align="baseline" wrap style={{ marginBottom: 8 }}>
                  <Form.Item
                    name={[item.name, "staffUserId"]}
                    rules={[{ required: true, message: "请选择成员" }]}
                    style={{ marginBottom: 0, minWidth: 200 }}
                  >
                    <Select
                      showSearch
                      optionFilterProp="label"
                      options={staffOptions}
                      placeholder="选择员工"
                    />
                  </Form.Item>
                  <Form.Item name={[item.name, "weight"]} label="权重" style={{ marginBottom: 0 }}>
                    <InputNumber min={1} max={100} />
                  </Form.Item>
                  <Form.Item name={[item.name, "dailyLimit"]} label="日上限" style={{ marginBottom: 0 }}>
                    <InputNumber min={0} max={100000} />
                  </Form.Item>
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined aria-hidden />}
                    onClick={() => remove(item.name)}
                  />
                </Space>
              ))}
            </div>
          )}
        </Form.List>
        <Notice variant="info">
          保存会在企微创建/更新联系我配置并返回二维码；成员必须先在「IM 连接器」完成企微成员映射。
          达到日上限的成员会自动从引流名单摘除，次日凌晨恢复。
        </Notice>
      </Form>
    </Modal>
  );
}

function WelcomeModal({
  open,
  row,
  staffOptions,
  materials,
  onClose,
  onSaved,
}: {
  open: boolean;
  row: ScrmWelcome | null;
  staffOptions: { value: string; label: string }[];
  materials: ScrmMaterial[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const scope = Form.useWatch("scope", form);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue(
      row
        ? {
            name: row.name,
            scope: row.scope,
            staffUserId: row.staffUserId || undefined,
            content: row.content,
            materialIds: row.materialIds,
            enabled: row.enabled,
          }
        : { name: "", scope: "ALL", staffUserId: undefined, content: "", materialIds: [], enabled: true },
    );
  }, [open, row, form]);

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await scrmApi.saveWelcome({
        body: {
          id: row?.id ?? 0,
          name: values.name,
          scope: values.scope,
          staffUserId: values.scope === "STAFF" ? values.staffUserId ?? "" : "",
          content: values.content ?? "",
          materialIds: values.materialIds ?? [],
          enabled: Boolean(values.enabled),
        },
      });
      message.success("欢迎语已保存");
      onSaved();
    } catch (error) {
      message.error((error as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={row ? "编辑欢迎语" : "新建欢迎语"}
      open={open}
      confirmLoading={saving}
      okText="保存"
      onOk={() => void submit()}
      onCancel={onClose}
      width={620}
    >
      <Form form={form} layout="vertical">
        <div className="form-2col">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: "请填写名称" }]}>
            <Input maxLength={60} />
          </Form.Item>
          <Form.Item name="scope" label="适用范围">
            <Select
              options={Object.entries(WELCOME_SCOPE_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </Form.Item>
          {scope === "STAFF" ? (
            <Form.Item
              name="staffUserId"
              label="指定员工"
              rules={[{ required: true, message: "请选择员工" }]}
            >
              <Select showSearch optionFilterProp="label" options={staffOptions} />
            </Form.Item>
          ) : null}
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </div>
        <Form.Item name="content" label="欢迎语正文" rules={[{ max: 2000 }]}>
          <Input.TextArea rows={4} maxLength={2000} showCount placeholder="打招呼 + 能提供的价值 + 下一步引导" />
        </Form.Item>
        <Form.Item name="materialIds" label="附带素材">
          <Select
            mode="multiple"
            allowClear
            options={materials.map((item) => ({ value: item.id, label: item.title }))}
          />
        </Form.Item>
        <Notice variant="info">
          出站敏感词会在发送前检查：拦截词直接跳过发送；替换词用改写后的文案。
          附件在正文被拦截时仍会单独发送。
        </Notice>
      </Form>
    </Modal>
  );
}

function RuleModal({
  open,
  row,
  codes,
  tagGroups,
  onClose,
  onSaved,
}: {
  open: boolean;
  row: ScrmAutoTagRule | null;
  codes: ScrmCode[];
  tagGroups: ScrmTagGroup[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const event = Form.useWatch("event", form);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue(
      row
        ? {
            name: row.name,
            event: row.event,
            tagIds: row.tagIds,
            codeIds: row.codeIds,
            enabled: row.enabled,
          }
        : { name: "", event: "ADD", tagIds: [], codeIds: [], enabled: true },
    );
  }, [open, row, form]);

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await scrmApi.saveAutoTagRule({
        body: {
          id: row?.id ?? 0,
          name: values.name,
          event: values.event,
          conditions: {},
          tagIds: values.tagIds ?? [],
          codeIds: event === "CODE" ? values.codeIds ?? [] : [],
          enabled: Boolean(values.enabled),
        },
      });
      message.success("自动打标规则已保存");
      onSaved();
    } catch (error) {
      message.error((error as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={row ? "编辑自动打标规则" : "新建自动打标规则"}
      open={open}
      confirmLoading={saving}
      okText="保存"
      onOk={() => void submit()}
      onCancel={onClose}
    >
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="规则名称" rules={[{ required: true, message: "请填写规则名称" }]}>
          <Input maxLength={60} />
        </Form.Item>
        <div className="form-2col">
          <Form.Item name="event" label="触发事件">
            <Select
              options={[
                { value: "ADD", label: "新客户添加" },
                { value: "CODE", label: "活码来源" },
              ]}
            />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </div>
        <Form.Item
          name="tagIds"
          label="打上标签"
          rules={[{ required: true, message: "请选择标签" }]}
        >
          <Select mode="multiple" allowClear options={tagOptions(tagGroups)} />
        </Form.Item>
        {event === "CODE" ? (
          <Form.Item name="codeIds" label="限定活码" tooltip="留空表示所有活码来源都命中">
            <Select
              mode="multiple"
              allowClear
              options={codes.map((item) => ({ value: item.id, label: item.name }))}
            />
          </Form.Item>
        ) : null}
      </Form>
    </Modal>
  );
}
