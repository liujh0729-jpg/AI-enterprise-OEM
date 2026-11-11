'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  App,
  AutoComplete,
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
  TimePicker,
  Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { type Dayjs } from 'dayjs';
import {
  WECHAT_MP_EVENT_KEYS,
  WECHAT_MP_EVENT_LABELS,
  type WechatMpEventKey,
  type WechatMpFollowReply,
  type WechatMpKeywordReply,
  type WechatMpMenuButton,
  type WechatMpSettingsView,
  type WechatMpTemplateMap,
} from '@enterprise/contracts';
import { Notice, Panel, PanelTabs, StatCard, StatGrid } from '@/components/ui/panel';
import { fmtTime } from '@/lib/datetime';
import { presentMutationError } from '@/query/errors';
import {
  wechatMpAdminApi,
  type WechatMpBindingRow,
  type WechatMpMessageRow,
  type WechatMpTemplateCatalog,
} from '@/api/wechat-mp';
import { PermissionNotice, useAdminData } from './common';

/* ============================================================
   平台管理后台「微信服务号设置」：
   基础配置 / 模板映射 / 菜单 / 关注与绑定 / 推送记录。
   ============================================================ */

const STATUS_META: Record<string, { text: string; color: string }> = {
  pending: { text: '待发送', color: 'blue' },
  sent: { text: '已发送', color: 'green' },
  failed: { text: '发送失败', color: 'red' },
  skipped: { text: '已跳过', color: 'default' },
};

function buildSettingsBody(
  view: WechatMpSettingsView,
  patch: Partial<{
    enabled: boolean;
    accountName: string;
    appId: string;
    token: string;
    appSecret: string;
    encodingAesKey: string;
    encryptedMode: boolean;
    followReply: WechatMpFollowReply;
    keywordReplies: WechatMpKeywordReply[];
    defaultReply: WechatMpFollowReply;
    quietHours: WechatMpSettingsView['quietHours'];
    dailyCap: number;
    dedupeSeconds: number;
    mobileLinks: Record<string, string>;
    templates: WechatMpTemplateMap[];
  }>,
) {
  return {
    enabled: view.enabled,
    accountName: view.accountName,
    appId: view.appId,
    encryptedMode: view.encryptedMode,
    followReply: view.followReply,
    keywordReplies: view.keywordReplies,
    defaultReply: view.defaultReply,
    quietHours: view.quietHours,
    dailyCap: view.dailyCap,
    dedupeSeconds: view.dedupeSeconds,
    mobileLinks: view.mobileLinks,
    templates: view.templates,
    ...patch,
  };
}

export function WechatMpTab() {
  const [tab, setTab] = useState('basic');
  return (
    <PanelTabs
      value={tab}
      onChange={setTab}
      items={[
        { key: 'basic', label: '基础配置', children: <BasicPanel /> },
        { key: 'templates', label: '模板映射', children: <TemplatesPanel /> },
        { key: 'menu', label: '服务号菜单', children: <MenuPanel /> },
        { key: 'follow', label: '关注与绑定', children: <FollowPanel /> },
        { key: 'messages', label: '推送记录', children: <MessagesPanel /> },
      ]}
    />
  );
}

/* ---------------- 基础配置 ---------------- */

type BasicForm = {
  enabled: boolean;
  accountName: string;
  appId: string;
  appSecret?: string;
  token?: string;
  encodingAesKey?: string;
  encryptedMode: boolean;
  quietEnabled: boolean;
  quietStart: Dayjs;
  quietEnd: Dayjs;
  dailyCap: number;
  dedupeSeconds: number;
};

const asHhmm = (value: unknown, fallback: string) =>
  value && typeof value === 'object' && 'format' in value
    ? (value as Dayjs).format('HH:mm')
    : String(value || fallback).slice(0, 5);

function BasicPanel() {
  const { message } = App.useApp();
  const [form] = Form.useForm<BasicForm>();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const { data, loading, denied, reload } = useAdminData(
    'wechat-mp-settings',
    (signal) => wechatMpAdminApi.settings({}, { signal }),
  );

  useEffect(() => {
    if (!data) return;
    form.setFieldsValue({
      enabled: data.enabled,
      accountName: data.accountName,
      appId: data.appId,
      appSecret: '',
      token: '',
      encodingAesKey: '',
      encryptedMode: data.encryptedMode,
      quietEnabled: data.quietHours.enabled,
      quietStart: dayjs(`2000-01-01T${data.quietHours.start}:00`),
      quietEnd: dayjs(`2000-01-01T${data.quietHours.end}:00`),
      dailyCap: data.dailyCap,
      dedupeSeconds: data.dedupeSeconds,
    });
  }, [data, form]);

  const save = async (values: BasicForm) => {
    if (!data) return;
    setSaving(true);
    try {
      const saved = await wechatMpAdminApi.saveSettings({
        body: buildSettingsBody(data, {
          enabled: Boolean(values.enabled),
          accountName: values.accountName?.trim() || '',
          appId: values.appId?.trim() || '',
          token: values.token?.trim() || '',
          appSecret: values.appSecret?.trim() || '',
          encodingAesKey: values.encodingAesKey?.trim() || '',
          encryptedMode: Boolean(values.encryptedMode),
          quietHours: {
            enabled: Boolean(values.quietEnabled),
            start: asHhmm(values.quietStart, '22:00'),
            end: asHhmm(values.quietEnd, '08:00'),
          },
          dailyCap: Number(values.dailyCap ?? 0),
          dedupeSeconds: Number(values.dedupeSeconds ?? 0),
        }),
      });
      if (!saved) throw new Error('保存失败：服务端未返回配置');
      form.setFieldsValue({
        token: '',
        appSecret: '',
        encodingAesKey: '',
        enabled: saved.enabled,
      });
      message.success(
        saved.enabled
          ? '配置已保存并启用，微信推送即时生效'
          : '配置已保存（当前未启用）',
      );
      await reload();
    } catch (error) {
      presentMutationError(error, message.error);
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const result = await wechatMpAdminApi.test({ body: {} });
      if (!result) throw new Error('测试连接失败：服务端未返回结果');
      if (result.ok) {
        message.success(
          `${result.message}${result.templateCount ? `（${result.templateCount} 个模板）` : ''}`,
        );
      } else {
        message.error(result.message || '连接失败');
      }
    } catch (error) {
      presentMutationError(error, message.error);
    } finally {
      setTesting(false);
    }
  };

  return (
    <Panel
      title="基础配置"
      titleBadge={
        <Space size={6}>
          <Tag color={data?.enabled ? 'green' : 'default'}>
            {data?.enabled ? '已启用' : '未启用'}
          </Tag>
          <Tag color={data?.appSecretConfigured ? 'blue' : 'default'}>
            {data?.appSecretConfigured ? 'AppSecret 已配置' : '缺少 AppSecret'}
          </Tag>
        </Space>
      }
    >
      <PermissionNotice denied={denied} />
      <Notice variant="info">
        服务号启用后，任务派发、审批、客服回复等站内通知会尽力同步推送到微信；
        推送失败不影响站内消息。服务器地址填到公众号后台「设置与开发 →
        基本配置 → 服务器配置」，Token 与 EncodingAESKey 需和这里一致。
      </Notice>

      <Space wrap style={{ margin: '12px 0' }} size={16}>
        <span className="text-12 muted">
          服务器地址（URL）：
          <span className="mono">{data?.serverUrl || '保存后生成'}</span>
        </span>
        <span className="text-12 muted">
          已绑定 {data?.boundCount ?? 0} 人
          {data?.updatedAt ? ` · 最近保存 ${fmtTime(data.updatedAt)}` : ''}
        </span>
      </Space>

      <Form<BasicForm>
        form={form}
        layout="vertical"
        onFinish={save}
        disabled={saving || loading}
        autoComplete="off"
        style={{ maxWidth: 680 }}
      >
        <Form.Item name="enabled" label="启用微信服务号" valuePropName="checked">
          <Switch checkedChildren="启用" unCheckedChildren="停用" />
        </Form.Item>

        <Form.Item name="accountName" label="服务号名称">
          <Input maxLength={80} placeholder="用于后台识别，例如「AIworkin 服务号」" />
        </Form.Item>

        <Form.Item
          name="appId"
          label="AppID"
          extra="公众号后台「设置与开发 → 基本配置」中的 AppID。"
          rules={[{ required: true, message: '请填写 AppID' }]}
        >
          <Input maxLength={64} placeholder="wx..." />
        </Form.Item>

        <Form.Item
          name="appSecret"
          label="AppSecret"
          extra={
            data?.appSecretConfigured
              ? '已加密保存，留空不修改；更换凭据时整对重填。'
              : '公众号后台生成后立即复制，只显示一次。'
          }
        >
          <Input.Password
            maxLength={128}
            autoComplete="new-password"
            placeholder={data?.appSecretConfigured ? '已配置，留空不修改' : '填写 AppSecret'}
          />
        </Form.Item>

        <Form.Item
          name="token"
          label="服务器配置 Token"
          extra={
            data?.tokenConfigured
              ? '已配置，留空不修改；必须与公众号后台完全一致。'
              : '3–32 位英文或数字，自定义后同步填入公众号后台。'
          }
        >
          <Input maxLength={32} placeholder={data?.tokenConfigured ? '已配置，留空不修改' : '自定义 Token'} />
        </Form.Item>

        <Form.Item
          name="encodingAesKey"
          label="EncodingAESKey"
          extra="安全模式下必填，43 位；公众号后台「服务器配置」中随机生成后复制。"
        >
          <Input.Password
            maxLength={64}
            autoComplete="new-password"
            placeholder={data?.encodingAesKeyConfigured ? '已配置，留空不修改' : '43 位字符'}
          />
        </Form.Item>

        <Form.Item
          name="encryptedMode"
          label="安全模式"
          valuePropName="checked"
          extra="开启后回调消息使用 AES 加密，需同时填写 EncodingAESKey。"
        >
          <Switch checkedChildren="加密" unCheckedChildren="明文" />
        </Form.Item>

        <Form.Item label="免打扰时段" style={{ marginBottom: 0 }}>
          <Space wrap>
            <Form.Item name="quietEnabled" valuePropName="checked" noStyle>
              <Switch checkedChildren="开启" unCheckedChildren="关闭" />
            </Form.Item>
            <Form.Item name="quietStart" noStyle>
              <TimePicker format="HH:mm" minuteStep={10} style={{ width: 110 }} />
            </Form.Item>
            <span className="muted">至</span>
            <Form.Item name="quietEnd" noStyle>
              <TimePicker format="HH:mm" minuteStep={10} style={{ width: 110 }} />
            </Form.Item>
          </Space>
          <div className="text-12 muted" style={{ marginTop: 6 }}>
            免打扰只作用于账号安全等非紧急提醒；任务、审批与客服回复仍会即时推送。
          </div>
        </Form.Item>

        <Space size={16} wrap style={{ marginTop: 4 }}>
          <Form.Item name="dailyCap" label="每人每日推送上限" style={{ marginBottom: 0 }}>
            <InputNumber min={0} max={200} style={{ width: 140 }} />
          </Form.Item>
          <Form.Item name="dedupeSeconds" label="相同事件去重（秒）" style={{ marginBottom: 0 }}>
            <InputNumber min={0} max={86400} step={30} style={{ width: 160 }} />
          </Form.Item>
        </Space>

        <Space style={{ marginTop: 20 }} wrap>
          <Button type="primary" htmlType="submit" loading={saving}>
            保存配置
          </Button>
          <Button loading={testing} onClick={() => void test()} disabled={!data?.appSecretConfigured}>
            测试连接
          </Button>
          {!data?.appSecretConfigured ? (
            <span className="text-12 muted">填写并保存 AppSecret 后才能测试连接。</span>
          ) : null}
        </Space>
      </Form>
    </Panel>
  );
}

/* ---------------- 模板映射 ---------------- */

function TemplatesPanel() {
  const { message } = App.useApp();
  const [rows, setRows] = useState<WechatMpTemplateMap[]>([]);
  const [catalog, setCatalog] = useState<WechatMpTemplateCatalog[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fieldTarget, setFieldTarget] = useState<WechatMpTemplateMap | null>(null);
  const [fieldRows, setFieldRows] = useState<{ key: string; value: string }[]>([]);
  const { data, loading, denied, reload } = useAdminData(
    'wechat-mp-templates',
    (signal) => wechatMpAdminApi.settings({}, { signal }),
  );

  useEffect(() => {
    if (data) setRows(data.templates.map((item) => ({ ...item, fields: [...item.fields] })));
  }, [data]);

  const catalogOptions = useMemo(
    () =>
      catalog.map((item) => ({
        value: item.templateId,
        label: `${item.title || item.templateId}（${item.templateId}）`,
      })),
    [catalog],
  );

  const patch = (eventKey: WechatMpEventKey, next: Partial<WechatMpTemplateMap>) =>
    setRows((prev) =>
      prev.map((item) => (item.eventKey === eventKey ? { ...item, ...next } : item)),
    );

  const loadCatalog = async () => {
    setLoadingCatalog(true);
    try {
      const list = (await wechatMpAdminApi.templates()) || [];
      setCatalog(list);
      message.success(`已读取 ${list.length} 个服务号模板`);
    } catch (error) {
      presentMutationError(error, message.error);
    } finally {
      setLoadingCatalog(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await wechatMpAdminApi.saveTemplates({ body: { templates: rows } });
      message.success('模板映射已保存');
      await reload();
    } catch (error) {
      presentMutationError(error, message.error);
    } finally {
      setSaving(false);
    }
  };

  const openFields = (row: WechatMpTemplateMap) => {
    setFieldTarget(row);
    setFieldRows(row.fields.length ? row.fields.map((item) => ({ ...item })) : [{ key: '', value: '' }]);
  };

  const saveFields = () => {
    if (!fieldTarget) return;
    patch(fieldTarget.eventKey, {
      fields: fieldRows
        .map((item) => ({ key: item.key.trim(), value: item.value }))
        .filter((item) => item.key),
    });
    setFieldTarget(null);
  };

  const columns: ColumnsType<WechatMpTemplateMap> = [
    {
      title: '事件',
      dataIndex: 'eventKey',
      width: 190,
      render: (value: string) => (
        <div>
          <div style={{ fontWeight: 600 }}>{WECHAT_MP_EVENT_LABELS[value] || value}</div>
          <div className="text-12 muted mono">{value}</div>
        </div>
      ),
    },
    {
      title: '启用',
      width: 70,
      render: (_, row) => (
        <Switch size="small" checked={row.enabled} onChange={(enabled) => patch(row.eventKey, { enabled })} />
      ),
    },
    {
      title: '模板 ID',
      width: 230,
      render: (_, row) => (
        <AutoComplete
          value={row.templateId}
          options={catalogOptions}
          onChange={(value) => patch(row.eventKey, { templateId: value || '' })}
          placeholder={catalog.length ? '搜索或粘贴模板 ID' : '先读取服务号模板'}
          style={{ width: '100%' }}
          allowClear
        />
      ),
    },
    {
      title: '标题',
      width: 180,
      render: (_, row) => (
        <Input
          value={row.title}
          maxLength={80}
          placeholder="用于文本兜底"
          onChange={(event) => patch(row.eventKey, { title: event.target.value })}
        />
      ),
    },
    {
      title: '跳转链接',
      width: 220,
      render: (_, row) => (
        <Input
          value={row.url}
          maxLength={500}
          placeholder="/m/inbox 或 https://…"
          onChange={(event) => patch(row.eventKey, { url: event.target.value })}
        />
      ),
    },
    {
      title: (
        <Tooltip title="关闭后，模板未启用或发送失败时不再改用客服文本兜底">
          <span>文本兜底</span>
        </Tooltip>
      ),
      width: 90,
      render: (_, row) => (
        <Switch
          size="small"
          checked={row.customFallback}
          onChange={(customFallback) => patch(row.eventKey, { customFallback })}
        />
      ),
    },
    {
      title: '字段映射',
      width: 110,
      render: (_, row) => (
        <Button size="small" onClick={() => openFields(row)}>
          {row.fields.length ? `${row.fields.length} 项` : '配置'}
        </Button>
      ),
    },
  ];

  return (
    <>
      <Panel
        title="模板映射"
        titleBadge={<span className="text-12 muted">按事件选择服务号模板，字段可引用通知变量</span>}
        extra={
          <Space size={8}>
            <Button size="small" loading={loadingCatalog} onClick={() => void loadCatalog()}>
              读取服务号模板
            </Button>
            <Button type="primary" size="small" loading={saving} onClick={() => void save()}>
              保存映射
            </Button>
          </Space>
        }
      >
        <PermissionNotice denied={denied} />
        <Notice variant="info">
          字段值支持占位符：<span className="mono">{'{title}'}</span>、
          <span className="mono">{'{body}'}</span>、<span className="mono">{'{user}'}</span>、
          <span className="mono">{'{time}'}</span>、<span className="mono">{'{link}'}</span>、
          <span className="mono">{'{entityId}'}</span>。启用的事件必须选择模板 ID；
          未启用或发送失败时，若开启「文本兜底」会改用客服文本（需用户在 48 小时内互动过）。
        </Notice>
        <Table<WechatMpTemplateMap>
          rowKey="eventKey"
          size="small"
          style={{ marginTop: 12 }}
          loading={loading}
          dataSource={rows}
          columns={columns}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: '暂无事件：请先保存基础配置后重新进入。' }}
        />
      </Panel>

      <Modal
        title={`字段映射 · ${fieldTarget ? WECHAT_MP_EVENT_LABELS[fieldTarget.eventKey] || fieldTarget.eventKey : ''}`}
        open={Boolean(fieldTarget)}
        onCancel={() => setFieldTarget(null)}
        onOk={saveFields}
        okText="确定"
        cancelText="取消"
        destroyOnHidden
        width={620}
      >
        <div className="text-12 muted" style={{ marginBottom: 10 }}>
          左侧填微信模板里的字段名（如 first、keyword1、remark），右侧填占位符或固定文本。
        </div>
        <Space orientation="vertical" size={8} style={{ width: '100%' }}>
          {fieldRows.map((item, index) => (
            <Space.Compact key={index} style={{ width: '100%' }}>
              <Input
                value={item.key}
                placeholder="字段名"
                style={{ width: 180 }}
                maxLength={32}
                onChange={(event) =>
                  setFieldRows((prev) =>
                    prev.map((row, i) => (i === index ? { ...row, key: event.target.value } : row)),
                  )
                }
              />
              <Input
                value={item.value}
                placeholder="{title}"
                maxLength={200}
                onChange={(event) =>
                  setFieldRows((prev) =>
                    prev.map((row, i) => (i === index ? { ...row, value: event.target.value } : row)),
                  )
                }
              />
              <Button
                danger
                onClick={() => setFieldRows((prev) => prev.filter((_, i) => i !== index))}
              >
                删除
              </Button>
            </Space.Compact>
          ))}
          <Button onClick={() => setFieldRows((prev) => [...prev, { key: '', value: '' }])}>
            添加字段
          </Button>
        </Space>
      </Modal>
    </>
  );
}

/* ---------------- 服务号菜单 ---------------- */

const MENU_TYPES = [
  { value: 'view', label: '跳转网页' },
  { value: 'click', label: '点击事件' },
];

function MenuPanel() {
  const { message } = App.useApp();
  const [items, setItems] = useState<WechatMpMenuButton[]>([]);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const { data, denied, reload } = useAdminData('wechat-mp-menu', (signal) =>
    wechatMpAdminApi.menu({}, { signal }),
  );

  useEffect(() => {
    if (data) setItems(data.button.map((item) => ({ ...item, sub_button: item.sub_button ? [...item.sub_button] : undefined })));
  }, [data]);

  const updateFirst = (index: number, next: Partial<WechatMpMenuButton>) =>
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...next } : item)));

  const updateSub = (index: number, subIndex: number, next: Partial<WechatMpMenuButton>) =>
    setItems((prev) =>
      prev.map((item, i) =>
        i === index
          ? {
              ...item,
              sub_button: (item.sub_button || []).map((sub, k) => (k === subIndex ? { ...sub, ...next } : sub)),
            }
          : item,
      ),
    );

  const addFirst = () => {
    if (items.length >= 3) {
      message.warning('微信最多 3 个一级菜单');
      return;
    }
    setItems((prev) => [...prev, { type: 'view', name: '', url: '' }]);
  };

  const addSub = (index: number) => {
    const current = items[index]?.sub_button || [];
    if (current.length >= 5) {
      message.warning('每个一级菜单最多 5 个二级菜单');
      return;
    }
    updateFirst(index, { sub_button: [...current, { type: 'view', name: '', url: '' }] });
  };

  const saveDraft = async () => {
    setSaving(true);
    try {
      const menu = await wechatMpAdminApi.saveMenu({ body: { button: items } });
      if (!menu) throw new Error('保存失败：服务端未返回菜单');
      setItems(menu.button);
      message.success('菜单草稿已保存');
      await reload();
    } catch (error) {
      presentMutationError(error, message.error);
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    setPublishing(true);
    try {
      await wechatMpAdminApi.saveMenu({ body: { button: items } });
      const result = await wechatMpAdminApi.publishMenu();
      message.success(result?.message || '菜单已发布到服务号');
      await reload();
    } catch (error) {
      presentMutationError(error, message.error);
    } finally {
      setPublishing(false);
    }
  };

  const pull = async () => {
    setPulling(true);
    try {
      const menu = await wechatMpAdminApi.pullMenu();
      if (!menu) throw new Error('拉取失败：服务端未返回菜单');
      setItems(menu.button);
      message.success('已拉取微信当前菜单并覆盖草稿');
      await reload();
    } catch (error) {
      presentMutationError(error, message.error);
    } finally {
      setPulling(false);
    }
  };

  const renderItem = (
    item: WechatMpMenuButton,
    index: number,
    onChange: (next: Partial<WechatMpMenuButton>) => void,
    onRemove: () => void,
    subMode = false,
    onAddSub?: () => void,
  ) => {
    const hasSub = Boolean(item.sub_button?.length);
    const type = hasSub ? 'view' : item.type;
    return (
      <div
        key={`${subMode ? 'sub' : 'top'}-${index}`}
        style={{
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 12,
          marginBottom: 10,
          background: subMode ? 'var(--bg-2, #fafbfc)' : undefined,
        }}
      >
        <Space wrap size={8} style={{ width: '100%' }}>
          <Input
            value={item.name}
            placeholder={subMode ? '二级菜单名称' : '一级菜单名称'}
            maxLength={16}
            style={{ width: subMode ? 160 : 200 }}
            onChange={(event) => onChange({ name: event.target.value })}
          />
          {!hasSub ? (
            <Select
              value={type}
              options={MENU_TYPES}
              style={{ width: 120 }}
              onChange={(value) =>
                onChange(
                  value === 'click'
                    ? { type: 'click', url: undefined, key: item.key || '' }
                    : { type: 'view', key: undefined, url: item.url || '' },
                )
              }
            />
          ) : (
            <Tag>包含子菜单</Tag>
          )}
          {!hasSub && type === 'view' ? (
            <Input
              value={item.url}
              placeholder="https://…"
              maxLength={500}
              style={{ width: 300 }}
              onChange={(event) => onChange({ url: event.target.value })}
            />
          ) : null}
          {!hasSub && type === 'click' ? (
            <Input
              value={item.key}
              placeholder="事件 key"
              maxLength={128}
              style={{ width: 220 }}
              onChange={(event) => onChange({ key: event.target.value })}
            />
          ) : null}
          <Button size="small" danger onClick={onRemove}>
            删除
          </Button>
          {!subMode && onAddSub ? (
            <Button size="small" onClick={onAddSub}>
              添加二级菜单
            </Button>
          ) : null}
        </Space>
        {hasSub ? (
          <div className="text-12 muted" style={{ marginTop: 8 }}>
            一级菜单含二级菜单时不支持跳转，点击后展开二级菜单。
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <Panel
      title="服务号菜单"
      titleBadge={
        <span className="text-12 muted">
          {data?.publishedAt ? `最近发布 ${fmtTime(data.publishedAt)}` : '尚未发布'}
        </span>
      }
      extra={
        <Space size={8}>
          <Popconfirm
            title="拉取微信当前菜单"
            description="将覆盖本地草稿，请确认草稿已保存。"
            okText="拉取"
            cancelText="取消"
            onConfirm={() => void pull()}
          >
            <Button size="small" loading={pulling}>
              拉取线上菜单
            </Button>
          </Popconfirm>
          <Button size="small" loading={saving} onClick={() => void saveDraft()}>
            保存草稿
          </Button>
          <Button type="primary" size="small" loading={publishing} onClick={() => void publish()}>
            发布到服务号
          </Button>
        </Space>
      }
    >
      <PermissionNotice denied={denied} />
      <Notice variant="info">
        一级菜单最多 3 个、每个一级最多 5 个二级；跳转菜单必须是 https 地址，
        点击菜单需填写事件 key（用户点击后可在服务号内回复关键词或触发绑定）。
        保存草稿不会影响线上菜单，点击「发布到服务号」后生效。
      </Notice>

      <div style={{ marginTop: 12 }}>
        {items.length ? (
          items.map((item, index) =>
            renderItem(
              item,
              index,
              (next) => updateFirst(index, next),
              () => setItems((prev) => prev.filter((_, i) => i !== index)),
              false,
              () => addSub(index),
            ),
          )
        ) : (
          <div className="text-12 muted" style={{ padding: '16px 0' }}>
            还没有菜单。添加一级菜单后可保存草稿并发布。
          </div>
        )}

        {items.map((item, index) =>
          item.sub_button?.length ? (
            <div key={`subs-${index}`} style={{ margin: '-4px 0 14px 24px' }}>
              <div className="text-12 muted" style={{ marginBottom: 6 }}>
                「{item.name || '未命名'}」的二级菜单
              </div>
              {item.sub_button.map((sub, subIndex) =>
                renderItem(
                  sub,
                  subIndex,
                  (next) => updateSub(index, subIndex, next),
                  () =>
                    updateFirst(index, {
                      sub_button: (item.sub_button || []).filter((_, k) => k !== subIndex),
                    }),
                  true,
                ),
              )}
            </div>
          ) : null,
        )}

        <Space wrap>
          <Button onClick={addFirst} disabled={items.length >= 3}>
            添加一级菜单
          </Button>
        </Space>
      </div>
    </Panel>
  );
}

/* ---------------- 关注与绑定 ---------------- */

function ReplyEditor({
  value,
  onChange,
}: {
  value: WechatMpFollowReply;
  onChange: (next: WechatMpFollowReply) => void;
}) {
  return (
    <Space orientation="vertical" size={8} style={{ width: '100%' }}>
      <Space size={8}>
        <Switch
          size="small"
          checked={value.enabled}
          onChange={(enabled) => onChange({ ...value, enabled })}
        />
        <span className="text-12 muted">启用自动回复</span>
      </Space>
      <Input.TextArea
        rows={3}
        maxLength={1000}
        value={value.text}
        placeholder="回复正文，可包含换行"
        onChange={(event) => onChange({ ...value, text: event.target.value })}
      />
      <Space.Compact style={{ width: '100%' }}>
        <Input
          value={value.linkText}
          maxLength={40}
          placeholder="链接文字（留空不附链接）"
          style={{ width: 200 }}
          onChange={(event) => onChange({ ...value, linkText: event.target.value })}
        />
        <Input
          value={value.linkUrl}
          maxLength={500}
          placeholder="/m/inbox 或 https://…"
          onChange={(event) => onChange({ ...value, linkUrl: event.target.value })}
        />
      </Space.Compact>
    </Space>
  );
}

function BindingsTable() {
  const { message } = App.useApp();
  const [page, setPage] = useState(1);
  const [keywordDraft, setKeywordDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const [subscribed, setSubscribed] = useState<'all' | 'yes' | 'no'>('all');
  const { data, loading, denied, reload } = useAdminData(
    'wechat-mp-bindings',
    (signal) =>
      wechatMpAdminApi.bindings(
        { query: { page, pageSize: 20, keyword, subscribed } },
        { signal },
      ),
    { page, keyword, subscribed },
  );

  const unbind = async (row: WechatMpBindingRow) => {
    try {
      await wechatMpAdminApi.unbindBinding({ params: { userId: row.userId } });
      message.success(`已解绑 ${row.userName || row.userId}`);
      await reload();
    } catch (error) {
      presentMutationError(error, message.error);
    }
  };

  const columns: ColumnsType<WechatMpBindingRow> = [
    {
      title: '账号',
      width: 200,
      render: (_, row) => (
        <div>
          <div style={{ fontWeight: 600 }}>{row.userName || row.userId}</div>
          <div className="text-12 muted mono">{row.userId}</div>
        </div>
      ),
    },
    { title: '微信昵称', dataIndex: 'nickname', width: 150, render: (value: string) => value || '—' },
    {
      title: 'OpenID',
      dataIndex: 'openIdMasked',
      width: 180,
      render: (value: string) => <span className="mono text-12">{value}</span>,
    },
    {
      title: '关注状态',
      width: 120,
      render: (_, row) => (
        <Space size={4} orientation="vertical">
          <Tag color={row.subscribed ? 'green' : 'default'}>{row.subscribed ? '已关注' : '已取消'}</Tag>
          {row.pushMuted ? <Tag color="orange">推送暂停</Tag> : null}
        </Space>
      ),
    },
    { title: '来源', dataIndex: 'source', width: 90, render: (value: string) => value || '—' },
    {
      title: '最近互动',
      width: 160,
      render: (_, row) => (
        <span className="text-12 muted">
          {row.lastInteractionAt ? fmtTime(row.lastInteractionAt) : '—'}
        </span>
      ),
    },
    {
      title: '绑定时间',
      width: 160,
      render: (_, row) => <span className="text-12 muted">{fmtTime(row.createdAt)}</span>,
    },
    {
      title: '操作',
      width: 100,
      render: (_, row) => (
        <Popconfirm
          title="解绑该用户"
          description="解绑后该用户不再接收微信推送。"
          okText="解绑"
          cancelText="取消"
          onConfirm={() => void unbind(row)}
        >
          <Button size="small" danger>
            解绑
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <Panel title="绑定用户" titleBadge={<span className="text-12 muted">共 {data?.total ?? 0} 人</span>}>
      <PermissionNotice denied={denied} />
      <Space wrap style={{ marginBottom: 12 }}>
        <Input
          value={keywordDraft}
          placeholder="搜昵称 / OpenID / 用户"
          allowClear
          style={{ width: 240 }}
          onChange={(event) => setKeywordDraft(event.target.value)}
          onPressEnter={() => {
            setPage(1);
            setKeyword(keywordDraft.trim());
          }}
          onClear={() => {
            setPage(1);
            setKeyword('');
          }}
        />
        <Select
          value={subscribed}
          style={{ width: 130 }}
          options={[
            { value: 'all', label: '全部关注状态' },
            { value: 'yes', label: '已关注' },
            { value: 'no', label: '已取消关注' },
          ]}
          onChange={(value) => {
            setPage(1);
            setSubscribed(value);
          }}
        />
      </Space>
      <Table<WechatMpBindingRow>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={data?.list ?? []}
        columns={columns}
        scroll={{ x: 'max-content' }}
        pagination={{
          current: page,
          pageSize: 20,
          total: data?.total ?? 0,
          showSizeChanger: false,
          onChange: setPage,
        }}
        locale={{ emptyText: '暂无绑定用户：用户从右上角二维码入口扫码后即出现在这里。' }}
      />
    </Panel>
  );
}

type KeywordDraft = WechatMpKeywordReply & { uid: string };

let keywordSeq = 0;
const nextKeywordUid = () => `kw-${++keywordSeq}`;

function FollowPanel() {
  const { message } = App.useApp();
  const [followReply, setFollowReply] = useState<WechatMpFollowReply | null>(null);
  const [defaultReply, setDefaultReply] = useState<WechatMpFollowReply | null>(null);
  const [keywords, setKeywords] = useState<KeywordDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [testEventKey, setTestEventKey] = useState<WechatMpEventKey | undefined>();
  const [testUserId, setTestUserId] = useState('');
  const [testing, setTesting] = useState(false);
  const { data, loading, denied, reload } = useAdminData(
    'wechat-mp-follow',
    (signal) => wechatMpAdminApi.settings({}, { signal }),
  );

  useEffect(() => {
    if (!data) return;
    setFollowReply({ ...data.followReply });
    setDefaultReply({ ...data.defaultReply });
    setKeywords(data.keywordReplies.map((item) => ({ ...item, uid: nextKeywordUid() })));
  }, [data]);

  const patchKeyword = (index: number, next: Partial<WechatMpKeywordReply>) =>
    setKeywords((prev) => prev.map((item, i) => (i === index ? { ...item, ...next } : item)));

  const toKeywordInput = (item: KeywordDraft): WechatMpKeywordReply => ({
    keyword: item.keyword,
    match: item.match,
    text: item.text,
    linkText: item.linkText,
    linkUrl: item.linkUrl,
    enabled: item.enabled,
  });

  const save = async () => {
    if (!data || !followReply || !defaultReply) return;
    setSaving(true);
    try {
      await wechatMpAdminApi.saveSettings({
        body: buildSettingsBody(data, {
          followReply,
          defaultReply,
          keywordReplies: keywords
            .filter((item) => item.keyword.trim())
            .map(toKeywordInput),
        }),
      });
      message.success('关注回复与关键词回复已保存');
      await reload();
    } catch (error) {
      presentMutationError(error, message.error);
    } finally {
      setSaving(false);
    }
  };

  const testSend = async () => {
    setTesting(true);
    try {
      const result = await wechatMpAdminApi.testSend({
        body: {
          eventKey: testEventKey,
          userId: testUserId.trim() || undefined,
        },
      });
      if (!result) throw new Error('测试推送失败：服务端未返回结果');
      if (result.sent) {
        message.success(result.message || '测试消息已发送');
      } else {
        message.warning(result.message || `未发送（${result.status}）`);
      }
    } catch (error) {
      presentMutationError(error, message.error);
    } finally {
      setTesting(false);
    }
  };

  const keywordColumns: ColumnsType<WechatMpKeywordReply> = [
    {
      title: '关键词',
      width: 150,
      render: (_, row, index) => (
        <Input
          value={row.keyword}
          maxLength={40}
          placeholder="如：待办"
          onChange={(event) => patchKeyword(index, { keyword: event.target.value })}
        />
      ),
    },
    {
      title: '匹配',
      width: 110,
      render: (_, row, index) => (
        <Select
          value={row.match}
          style={{ width: '100%' }}
          options={[
            { value: 'contains', label: '包含' },
            { value: 'exact', label: '完全相同' },
          ]}
          onChange={(match) => patchKeyword(index, { match })}
        />
      ),
    },
    {
      title: '回复内容',
      render: (_, row, index) => (
        <Input
          value={row.text}
          maxLength={1000}
          placeholder="回复正文"
          onChange={(event) => patchKeyword(index, { text: event.target.value })}
        />
      ),
    },
    {
      title: '链接',
      width: 260,
      render: (_, row, index) => (
        <Space.Compact style={{ width: '100%' }}>
          <Input
            value={row.linkText}
            maxLength={40}
            placeholder="文字"
            style={{ width: 80 }}
            onChange={(event) => patchKeyword(index, { linkText: event.target.value })}
          />
          <Input
            value={row.linkUrl}
            maxLength={500}
            placeholder="/m/inbox"
            onChange={(event) => patchKeyword(index, { linkUrl: event.target.value })}
          />
        </Space.Compact>
      ),
    },
    {
      title: '启用',
      width: 70,
      render: (_, row, index) => (
        <Switch
          size="small"
          checked={row.enabled}
          onChange={(enabled) => patchKeyword(index, { enabled })}
        />
      ),
    },
    {
      title: '',
      width: 60,
      render: (_, __, index) => (
        <Button size="small" danger onClick={() => setKeywords((prev) => prev.filter((_, i) => i !== index))}>
          删除
        </Button>
      ),
    },
  ];

  return (
    <>
      <Panel
        title="关注提示与关键词回复"
        titleBadge={<span className="text-12 muted">用户关注后立即发送，关键词按顺序命中</span>}
        extra={
          <Button type="primary" size="small" loading={saving} onClick={() => void save()} disabled={loading || !data}>
            保存
          </Button>
        }
      >
        <PermissionNotice denied={denied} />
        {followReply && defaultReply ? (
          <div style={{ display: 'grid', gap: 18, maxWidth: 760, marginTop: 12 }}>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>关注回复</div>
              <ReplyEditor value={followReply} onChange={setFollowReply} />
            </div>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>默认回复（未命中关键词）</div>
              <ReplyEditor value={defaultReply} onChange={setDefaultReply} />
            </div>
          </div>
        ) : (
          <div className="text-12 muted" style={{ padding: '12px 0' }}>
            正在读取配置…
          </div>
        )}

        <div style={{ marginTop: 18 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>关键词回复</div>
          <Table<WechatMpKeywordReply>
            rowKey="uid"
            size="small"
            dataSource={keywords}
            columns={keywordColumns}
            pagination={false}
            scroll={{ x: 'max-content' }}
            locale={{ emptyText: '暂无关键词：用户任意回复时会收到「默认回复」。' }}
          />
          <Button
            style={{ marginTop: 10 }}
            onClick={() =>
              setKeywords((prev) => [
                ...prev,
                {
                  uid: nextKeywordUid(),
                  keyword: '',
                  match: 'contains',
                  text: '',
                  linkText: '',
                  linkUrl: '',
                  enabled: true,
                },
              ])
            }
          >
            添加关键词
          </Button>
        </div>

        <Notice variant="info">
          用户在服务号内回复「退订 / 取消」会暂停推送，回复「订阅 / 恢复」会重新开启；
          这两条指令始终优先于自定义关键词。
        </Notice>
      </Panel>

      <Panel title="测试推送" titleBadge={<span className="text-12 muted">使用已保存的模板与配置</span>}>
        <Space wrap style={{ marginTop: 12 }}>
          <Select
            allowClear
            placeholder="事件（留空按平台公告）"
            style={{ width: 240 }}
            value={testEventKey}
            options={WECHAT_MP_EVENT_KEYS.map((key) => ({
              value: key,
              label: WECHAT_MP_EVENT_LABELS[key] || key,
            }))}
            onChange={(value) => setTestEventKey(value)}
          />
          <Input
            value={testUserId}
            placeholder="接收用户 ID（留空取最近关注的用户）"
            style={{ width: 280 }}
            maxLength={64}
            onChange={(event) => setTestUserId(event.target.value)}
          />
          <Button type="primary" loading={testing} onClick={() => void testSend()}>
            发送测试消息
          </Button>
        </Space>
        <div className="text-12 muted" style={{ marginTop: 8 }}>
          测试消息会真实调用微信接口并按推送记录留痕，可用于验证模板字段与跳转链接。
        </div>
      </Panel>

      <BindingsTable />
    </>
  );
}

/* ---------------- 推送记录 ---------------- */

function MessagesPanel() {
  const { message } = App.useApp();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('all');
  const [eventKey, setEventKey] = useState<string | undefined>();
  const [keywordDraft, setKeywordDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const [retrying, setRetrying] = useState<number | null>(null);
  const stats = useAdminData('wechat-mp-stats', (signal) =>
    wechatMpAdminApi.stats({}, { signal }),
  );
  const { data, loading, denied, reload } = useAdminData(
    'wechat-mp-messages',
    (signal) =>
      wechatMpAdminApi.messages(
        { query: { page, pageSize: 20, status, eventKey: eventKey || '', keyword } },
        { signal },
      ),
    { page, status, eventKey, keyword },
  );

  const retry = async (row: WechatMpMessageRow) => {
    setRetrying(row.id);
    try {
      const result = await wechatMpAdminApi.retry({ params: { id: String(row.id) } });
      if (!result) throw new Error('重试失败：服务端未返回结果');
      if (result.status === 'sent') {
        message.success('已重新发送成功');
      } else {
        message.warning(result.errmsg || `重试后状态：${STATUS_META[result.status]?.text || result.status}`);
      }
      await reload();
    } catch (error) {
      presentMutationError(error, message.error);
    } finally {
      setRetrying(null);
    }
  };

  const columns: ColumnsType<WechatMpMessageRow> = [
    {
      title: '时间',
      width: 150,
      render: (_, row) => <span className="text-12 muted">{fmtTime(row.createdAt)}</span>,
    },
    {
      title: '接收人',
      width: 170,
      render: (_, row) => (
        <div>
          <div style={{ fontWeight: 600 }}>{row.userName || row.userId}</div>
          <div className="text-12 muted mono">{row.userId}</div>
        </div>
      ),
    },
    {
      title: '事件',
      width: 150,
      render: (_, row) => (
        <div>
          <div>{WECHAT_MP_EVENT_LABELS[row.eventKey] || row.eventKey || '—'}</div>
          <div className="text-12 muted mono">{row.eventKey || '—'}</div>
        </div>
      ),
    },
    { title: '标题', dataIndex: 'title', ellipsis: true, render: (value: string) => value || '—' },
    {
      title: '状态',
      width: 110,
      render: (_, row) => {
        const meta = STATUS_META[row.status] || { text: row.status, color: 'default' };
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    {
      title: '尝试',
      dataIndex: 'attempts',
      width: 70,
      render: (value: number) => `${value || 0} 次`,
    },
    {
      title: '说明',
      width: 260,
      ellipsis: true,
      render: (_, row) => (
        <span className="text-12 muted" title={row.errmsg}>
          {row.errcode ? `${row.errcode} · ` : ''}
          {row.errmsg || '—'}
        </span>
      ),
    },
    {
      title: '操作',
      width: 90,
      render: (_, row) =>
        row.status === 'failed' ? (
          <Button
            size="small"
            loading={retrying === row.id}
            onClick={() => void retry(row)}
          >
            重试
          </Button>
        ) : (
          <span className="text-12 muted">—</span>
        ),
    },
  ];

  const statsData = stats.data;

  return (
    <>
      <StatGrid>
        <StatCard label="已绑定" value={`${statsData?.boundCount ?? 0} 人`} hint="扫码绑定当前账号" />
        <StatCard label="已关注" value={`${statsData?.subscribedCount ?? 0} 人`} hint="可接收模板消息" />
        <StatCard label="今日发送" value={`${statsData?.todaySent ?? 0} 条`} hint="含模板与客服文本" />
        <StatCard label="今日失败" value={`${statsData?.todayFailed ?? 0} 条`} hint="可在下方重试" />
        <StatCard
          label="模板映射"
          value={`${statsData?.templateCount ?? 0} 个`}
          hint={statsData?.menuPublished ? '菜单已发布' : '菜单未发布'}
        />
      </StatGrid>

      <Panel title="推送记录" titleBadge={<span className="text-12 muted">共 {data?.total ?? 0} 条</span>}>
        <PermissionNotice denied={denied} />
        <Space wrap style={{ marginBottom: 12 }}>
          <Select
            value={status}
            style={{ width: 140 }}
            options={[
              { value: 'all', label: '全部状态' },
              { value: 'sent', label: '已发送' },
              { value: 'failed', label: '发送失败' },
              { value: 'pending', label: '待发送' },
              { value: 'skipped', label: '已跳过' },
            ]}
            onChange={(value) => {
              setPage(1);
              setStatus(value);
            }}
          />
          <Select
            allowClear
            placeholder="全部事件"
            style={{ width: 200 }}
            value={eventKey}
            options={WECHAT_MP_EVENT_KEYS.map((key) => ({
              value: key,
              label: WECHAT_MP_EVENT_LABELS[key] || key,
            }))}
            onChange={(value) => {
              setPage(1);
              setEventKey(value);
            }}
          />
          <Input
            value={keywordDraft}
            placeholder="搜标题 / 用户 / 错误信息"
            allowClear
            style={{ width: 240 }}
            onChange={(event) => setKeywordDraft(event.target.value)}
            onPressEnter={() => {
              setPage(1);
              setKeyword(keywordDraft.trim());
            }}
            onClear={() => {
              setPage(1);
              setKeyword('');
            }}
          />
        </Space>
        <Table<WechatMpMessageRow>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={data?.list ?? []}
          columns={columns}
          scroll={{ x: 'max-content' }}
          pagination={{
            current: page,
            pageSize: 20,
            total: data?.total ?? 0,
            showSizeChanger: false,
            onChange: setPage,
          }}
          locale={{ emptyText: '暂无推送记录：站内通知产生后会自动尝试微信推送。' }}
        />
      </Panel>
    </>
  );
}
