"use client";

import type {
  ContentLibraryItem,
  MailAccount,
  MailScript,
} from "@enterprise/contracts";
import {
  App,
  Button,
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
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useMemo, useState } from "react";
import { mailApi } from "@/api/mail";
import { contentApi } from "@/api/content";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";

type ScriptDraft = {
  id: number | null;
  name: string;
  keywords: string;
  senderPattern: string;
  priority: number;
  content: string;
  enabled: boolean;
  mailboxIds: number[];
};

const EMPTY_DRAFT: ScriptDraft = {
  id: null,
  name: "",
  keywords: "",
  senderPattern: "",
  priority: 100,
  content: "",
  enabled: true,
  mailboxIds: [],
};

/**
 * 知识与话术：话术是账号级的，可以先预设多条，再勾选「生效邮箱」（不勾＝全部邮箱）；
 * 知识＝资料库，按邮箱绑定，Agent 处理该邮箱时只读它绑定的资料库 + 命中的话术。
 */
export function MailScriptsTab({ accounts }: { accounts: MailAccount[] }) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<MailScript[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<ScriptDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [libraries, setLibraries] = useState<ContentLibraryItem[]>([]);
  const [knowledgeId, setKnowledgeId] = useState(0);
  const [libraryIds, setLibraryIds] = useState<number[]>([]);
  const [savingKnowledge, setSavingKnowledge] = useState(false);

  const accountName = useCallback(
    (id: number) => accounts.find((item) => item.id === id)?.address || `#${id}`,
    [accounts],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await mailApi.scripts({ query: {} })) || []);
      setError("");
    } catch (caught) {
      setRows([]);
      setError((caught as Error).message || "话术清单读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void contentApi
      .library()
      .then((data) => setLibraries(data || []))
      .catch(() => undefined);
  }, [load]);

  useEffect(() => {
    const account = accounts.find((item) => item.id === knowledgeId);
    setLibraryIds(account?.libraryIds || []);
  }, [knowledgeId, accounts]);

  const patch = (next: Partial<ScriptDraft>) =>
    setDraft((prev) => (prev ? { ...prev, ...next } : prev));

  const submit = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      message.error("请给话术起个名字");
      return;
    }
    if (!draft.content.trim()) {
      message.error("话术内容不能为空");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: draft.name.trim(),
        keywords: draft.keywords.trim(),
        senderPattern: draft.senderPattern.trim(),
        priority: draft.priority,
        content: draft.content.trim(),
        enabled: draft.enabled,
        mailboxIds: draft.mailboxIds,
      };
      if (draft.id) {
        await mailApi.updateScript({
          params: { scriptId: String(draft.id) },
          body,
        });
        message.success("话术已更新");
      } else {
        await mailApi.saveScript({ body });
        message.success("话术已添加");
      }
      setDraft(null);
      await load();
    } catch (caught) {
      message.error((caught as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: MailScript) => {
    try {
      await mailApi.removeScript({ params: { scriptId: String(row.id) } });
      message.success("已删除");
      await load();
    } catch (caught) {
      message.error((caught as Error).message || "删除失败");
    }
  };

  const toggle = async (row: MailScript, enabled: boolean) => {
    try {
      await mailApi.updateScript({
        params: { scriptId: String(row.id) },
        body: { enabled },
      });
      await load();
    } catch (caught) {
      message.error((caught as Error).message || "状态修改失败");
    }
  };

  const saveKnowledge = async () => {
    if (!knowledgeId) return;
    setSavingKnowledge(true);
    try {
      await mailApi.updateAccount({
        params: { id: String(knowledgeId) },
        body: { libraryIds },
      });
      message.success("知识已绑定到该邮箱");
    } catch (caught) {
      message.error((caught as Error).message || "保存失败");
    } finally {
      setSavingKnowledge(false);
    }
  };

  const columns: ColumnsType<MailScript> = [
    {
      title: "话术",
      key: "name",
      render: (_, row) => (
        <div>
          <div>{row.name}</div>
          <div className="text-12 muted" style={{ marginTop: 2 }}>
            {row.content.slice(0, 60)}
            {row.content.length > 60 ? "…" : ""}
          </div>
        </div>
      ),
    },
    {
      title: "关键词",
      dataIndex: "keywords",
      key: "keywords",
      width: 150,
      render: (value: string) => value || <span className="muted">不按关键词</span>,
    },
    {
      title: "发件人匹配",
      dataIndex: "senderPattern",
      key: "senderPattern",
      width: 160,
      render: (value: string) => value || <span className="muted">不限</span>,
    },
    {
      title: "生效邮箱",
      key: "mailboxIds",
      width: 220,
      render: (_, row) =>
        row.mailboxIds.length ? (
          <Space size={4} wrap>
            {row.mailboxIds.map((id) => (
              <Tag key={id}>{accountName(id)}</Tag>
            ))}
          </Space>
        ) : (
          <Tag color="blue">全部邮箱</Tag>
        ),
    },
    { title: "优先级", dataIndex: "priority", key: "priority", width: 80 },
    {
      title: "启用",
      key: "enabled",
      width: 70,
      render: (_, row) => (
        <Switch
          checked={row.enabled}
          onChange={(checked) => void toggle(row, checked)}
        />
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 140,
      render: (_, row) => (
        <Space size={4}>
          <Button
            onClick={() =>
              setDraft({
                id: row.id,
                name: row.name,
                keywords: row.keywords,
                senderPattern: row.senderPattern,
                priority: row.priority,
                content: row.content,
                enabled: row.enabled,
                mailboxIds: row.mailboxIds || [],
              })
            }
          >
            编辑
          </Button>
          <Popconfirm
            title="删除这条话术？"
            okText="删除"
            cancelText="取消"
            onConfirm={() => void remove(row)}
          >
            <Button danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const mailboxOptions = useMemo(
    () =>
      accounts.map((item) => ({
        value: item.id,
        label: item.address,
      })),
    [accounts],
  );

  return (
    <>
      <Panel
        title="场景话术库"
        titleExtra={
          <span className="text-12 muted">
            话术可以先预设，再勾选生效邮箱（不勾＝全部邮箱）；命中关键词或发件人时按优先级取最小的一条
          </span>
        }
        extra={
          <Button
            type="primary"
            onClick={() => setDraft({ ...EMPTY_DRAFT })}
          >
            新建话术
          </Button>
        }
      >
        {error ? <Notice variant="warn">{error}</Notice> : null}
        {!rows.length && !loading ? (
          <EmptyState
            text={
              accounts.length
                ? "还没有话术：点右上「新建话术」，可先建好再绑定到这个邮箱"
                : "还没有话术：可以先点右上「新建话术」预设，之后新建邮箱时再按需绑定"
            }
          />
        ) : (
          <Table
            rowKey="id"
            loading={loading}
            dataSource={rows}
            pagination={false}
            columns={columns}
          />
        )}
      </Panel>

      <div style={{ height: 16 }} />

      <Panel
        title="知识绑定"
        titleExtra={
          <span className="text-12 muted">
            知识来自「Agent → 记忆 → 资料库」。这里把资料库绑定到具体邮箱；Agent 处理该邮箱的邮件时只读取这里勾选的资料库
          </span>
        }
      >
        {!accounts.length ? (
          <EmptyState text="先在「邮箱账号」里添加邮箱，再回来绑定知识" />
        ) : (
          <>
            <Space wrap style={{ marginBottom: 12 }}>
              <Select
                style={{ width: 260 }}
                placeholder="选择邮箱"
                value={knowledgeId || undefined}
                onChange={setKnowledgeId}
                options={mailboxOptions}
              />
              <Select
                mode="multiple"
                style={{ minWidth: 360, maxWidth: 620 }}
                placeholder="选择要绑定的资料库"
                value={libraryIds}
                onChange={setLibraryIds}
                options={libraries.map((item) => ({
                  value: item.id,
                  label: `${item.name}（${item.nodeCount} 段）`,
                }))}
                allowClear
              />
              <Button
                type="primary"
                disabled={!knowledgeId}
                loading={savingKnowledge}
                onClick={() => void saveKnowledge()}
              >
                保存设置
              </Button>
            </Space>
            {!libraries.length ? (
              <div className="muted">
                还没有资料库：到「Agent → 记忆」里把数字资产或报告收录进资料库，再回来绑定
              </div>
            ) : (
              <div className="muted">
                未勾选任何资料库时，该邮箱的 Agent 只使用话术库，不读资料。
              </div>
            )}
          </>
        )}
      </Panel>

      <Modal
        open={Boolean(draft)}
        title={draft?.id ? "编辑话术" : "新建话术"}
        width={620}
        onCancel={() => setDraft(null)}
        onOk={() => void submit()}
        confirmLoading={saving}
        okText={draft?.id ? "保存" : "添加"}
      >
        {draft ? (
          <Space orientation="vertical" size={12} style={{ width: "100%" }}>
            <Input
              placeholder="话术名称，例如：报价咨询"
              value={draft.name}
              onChange={(event) => patch({ name: event.target.value })}
            />
            <Select
              mode="multiple"
              style={{ width: "100%" }}
              placeholder="生效邮箱（不选＝全部邮箱）"
              value={draft.mailboxIds}
              onChange={(value) => patch({ mailboxIds: value })}
              options={mailboxOptions}
              allowClear
            />
            <Input
              placeholder="关键词（逗号分隔，可留空）"
              value={draft.keywords}
              onChange={(event) => patch({ keywords: event.target.value })}
            />
            <Input
              placeholder="发件人匹配（邮箱包含这段文字时命中，可留空）"
              value={draft.senderPattern}
              onChange={(event) => patch({ senderPattern: event.target.value })}
            />
            <Input.TextArea
              rows={6}
              placeholder="命中后要使用的回复内容"
              value={draft.content}
              onChange={(event) => patch({ content: event.target.value })}
            />
            <Space size={16}>
              <span>
                优先级{" "}
                <InputNumber
                  min={1}
                  max={999}
                  value={draft.priority}
                  onChange={(value) => patch({ priority: Number(value || 100) })}
                />
              </span>
              <span>
                启用{" "}
                <Switch
                  checked={draft.enabled}
                  onChange={(checked) => patch({ enabled: checked })}
                />
              </span>
            </Space>
          </Space>
        ) : null}
      </Modal>
    </>
  );
}