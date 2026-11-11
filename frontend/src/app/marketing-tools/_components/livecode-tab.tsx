"use client";

import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  Button,
  Drawer,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  message,
} from "antd";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  QR_CHILD_LIMIT_SCOPES,
  QR_CHILD_LIMIT_SCOPE_LABELS,
  QR_LIMIT_SCOPES,
  QR_LIMIT_SCOPE_LABELS,
  QR_SELECT_MODES,
  QR_SELECT_MODE_LABELS,
  type QrChildRow,
  type QrCodeRow,
  type QrDomainRow,
} from "@enterprise/contracts";
import { Panel, TabStrip } from "@/components/ui/panel";
import { RawImg } from "@/components/ui/raw-img";
import { livecodeApi } from "@/api/collab";
import { joinSiteUrl } from "@/lib/site-url";
import { useSiteBase } from "@/lib/site-brand";

type TabKey = "codes" | "domains";

const DOMAIN_STATUS_COLOR: Record<string, string> = {
  ACTIVE: "green",
  ERROR: "red",
  PENDING: "orange",
  DISABLED: "default",
  VERIFYING: "blue",
};

export function LivecodeTab() {
  const [tab, setTab] = useState<TabKey>("codes");
  const tabs = (
    <TabStrip
      items={[
        { key: "codes", label: "活码" },
        { key: "domains", label: "域名池" },
      ]}
      value={tab}
      onChange={(key) => setTab(key as TabKey)}
    />
  );
  return tab === "codes" ? (
    <CodesPanel tabs={tabs} onGoDomains={() => setTab("domains")} />
  ) : (
    <DomainsPanel tabs={tabs} />
  );
}

function CodesPanel({ tabs, onGoDomains }: { tabs: ReactNode; onGoDomains: () => void }) {
  const [rows, setRows] = useState<QrCodeRow[]>([]);
  const [domains, setDomains] = useState<QrDomainRow[]>([]);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<number | null>(null);
  const [detail, setDetail] = useState<QrCodeRow | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({
    name: "",
    entryMode: "CDN",
    domainMode: "ROTATE",
    selectMode: "RANDOM",
    sticky: true,
    limitScope: "NONE",
  });

  const load = async () => {
    try {
      const [list, domainRows] = await Promise.all([
        livecodeApi.list({ query: { page: 1, pageSize: 100 } }),
        livecodeApi.domains().catch(() => []),
      ]);
      setRows(list?.list || []);
      setDomains(domainRows || []);
    } catch (error) {
      message.error((error as Error).message || "加载失败");
    }
  };

  useEffect(() => {
    void load();
     
  }, []);

  useEffect(() => {
    if (!current) {
      setDetail(null);
      return;
    }
    void livecodeApi
      .get({ params: { id: String(current) } })
      .then((data) => setDetail(data))
      .catch((error) => message.error((error as Error).message || "详情加载失败"));
  }, [current]);

  return (
    <Panel
      title="活码引流"
      titleExtra={
        <span className="muted" style={{ fontSize: 12 }}>
          域名池已绑定 {domains.length} 个，已生效{" "}
          {domains.filter((item) => item.status === "ACTIVE").length} 个
        </span>
      }
      extra={tabs}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 16,
          marginBottom: 10,
        }}
      >
        <Button
          type="link"
          size="small"
          icon={<ReloadOutlined aria-hidden />}
          style={{ padding: 0 }}
          onClick={() => void load()}
        >
          刷新
        </Button>
        <Button
          type="link"
          size="small"
          icon={<PlusOutlined aria-hidden />}
          style={{ padding: 0 }}
          onClick={() => setOpen(true)}
        >
          新建活码
        </Button>
      </div>
      <Table
        rowKey="id"
        dataSource={rows}
        pagination={false}
        columns={[
          {
            title: "活码",
            dataIndex: "name",
            render: (name: string, row: QrCodeRow) => (
              <a onClick={() => setCurrent(row.id)}>
                {name}
                {row.entryChangedAt ? (
                  <Tag color="orange" style={{ marginLeft: 6 }}>
                    入口已切换
                  </Tag>
                ) : null}
              </a>
            ),
          },
          {
            title: "当前入口域名",
            dataIndex: "currentDomain",
            width: 200,
            render: (value: string) => value || "未绑定",
          },
          { title: "今日", dataIndex: "todayCount", width: 80 },
          { title: "累计", dataIndex: "totalCount", width: 90 },
          {
            title: "状态",
            dataIndex: "statusLabel",
            width: 90,
            render: (value: string, row: QrCodeRow) => (
              <Tag color={row.status === "ACTIVE" ? "green" : "default"}>{value}</Tag>
            ),
          },
          {
            title: "操作",
            width: 160,
            render: (_: unknown, row: QrCodeRow) => (
              <Space size={4}>
                <Button size="small" onClick={() => setCurrent(row.id)}>
                  详情
                </Button>
                <Button
                  size="small"
                  danger
                  onClick={() => {
                    Modal.confirm({
                      title: "删除活码",
                      content: "删除后该活码及其子码不可恢复。",
                      onOk: async () => {
                        await livecodeApi.remove({ params: { id: String(row.id) } });
                        void load();
                      },
                    });
                  }}
                >
                  删除
                </Button>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        open={open}
        title="新建活码"
        width={560}
        onCancel={() => setOpen(false)}
        onOk={async () => {
          try {
            const created = await livecodeApi.create({
              body: {
                name: String(draft.name || "").trim(),
                entryMode: (draft.entryMode as "CDN" | "SCRIPT") || "CDN",
                domainMode: (draft.domainMode as "PINNED" | "ROTATE") || "ROTATE",
                domainId: Number(draft.domainId || 0),
                title: String(draft.title || ""),
                note: String(draft.note || ""),
                selectMode:
                  (draft.selectMode as "RANDOM" | "ORDER" | "WEIGHT") || "RANDOM",
                sticky: draft.sticky !== false,
                limitScope:
                  (draft.limitScope as "NONE" | "DAILY" | "TOTAL") || "NONE",
                dailyLimit: Number(draft.dailyLimit || 0),
                totalLimit: Number(draft.totalLimit || 0),
                scriptUrl: String(draft.scriptUrl || ""),
              },
            });
            setOpen(false);
            setDraft({
              name: "",
              entryMode: "CDN",
              domainMode: "ROTATE",
              selectMode: "RANDOM",
              sticky: true,
              limitScope: "NONE",
            });
            await load();
            if (created) setCurrent(created.id);
          } catch (error) {
            message.error((error as Error).message || "创建失败");
          }
        }}
        okText="创建"
      >
        <Space orientation="vertical" style={{ width: "100%" }} size={12}>
          <Input
            placeholder="活码名称（后台识别用）"
            value={String(draft.name || "")}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
          <Input
            placeholder="落地页标题"
            value={String(draft.title || "")}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
          <Input.TextArea
            rows={2}
            placeholder="落地页说明"
            value={String(draft.note || "")}
            onChange={(event) => setDraft({ ...draft, note: event.target.value })}
          />
          <div>
            <div className="field-label">入口方式</div>
            <Radio.Group
              value={draft.entryMode}
              onChange={(event) => setDraft({ ...draft, entryMode: event.target.value })}
            >
              <Radio value="CDN">官网独立页（CDN 回源）</Radio>
              <Radio value="SCRIPT">官网弹层（接入脚本）</Radio>
            </Radio.Group>
          </div>
          {draft.entryMode === "SCRIPT" ? (
            <Input
              placeholder="落地页地址，例如 https://www.example.com/"
              value={String(draft.scriptUrl || "")}
              onChange={(event) =>
                setDraft({ ...draft, scriptUrl: event.target.value })
              }
            />
          ) : (
            <>
              <div>
                <div className="field-label">入口域名策略</div>
                <Radio.Group
                  value={draft.domainMode}
                  onChange={(event) =>
                    setDraft({ ...draft, domainMode: event.target.value })
                  }
                >
                  <Radio value="ROTATE">池内轮换</Radio>
                  <Radio value="PINNED">固定域名</Radio>
                </Radio.Group>
              </div>
              {draft.domainMode === "PINNED" ? (
                <Select
                  style={{ width: "100%" }}
                  placeholder="选择域名"
                  value={(draft.domainId as number) || undefined}
                  onChange={(value) => setDraft({ ...draft, domainId: value })}
                  options={domains
                    .filter((item) => item.status === "ACTIVE")
                    .map((item) => ({ value: item.id, label: item.domain }))}
                />
              ) : null}
            </>
          )}
          <div>
            <div className="field-label">分发方式</div>
            <Select
              style={{ width: "100%" }}
              value={draft.selectMode}
              onChange={(value) => setDraft({ ...draft, selectMode: value })}
              options={QR_SELECT_MODES.map((item) => ({
                value: item,
                label: QR_SELECT_MODE_LABELS[item],
              }))}
            />
          </div>
          <div>
            <div className="field-label">限额（父码默认，子码可覆盖）</div>
            <Space>
              <Select
                style={{ width: 140 }}
                value={draft.limitScope}
                onChange={(value) => setDraft({ ...draft, limitScope: value })}
                options={QR_LIMIT_SCOPES.map((item) => ({
                  value: item,
                  label: QR_LIMIT_SCOPE_LABELS[item],
                }))}
              />
              <InputNumber
                min={0}
                placeholder="每天"
                value={Number(draft.dailyLimit || 0)}
                onChange={(value) => setDraft({ ...draft, dailyLimit: value })}
              />
              <InputNumber
                min={0}
                placeholder="累计"
                value={Number(draft.totalLimit || 0)}
                onChange={(value) => setDraft({ ...draft, totalLimit: value })}
              />
            </Space>
          </div>
          <div className="sd-switch-row">
            <span>同一访客固定拿同一个子码（粘性 30 天）</span>
            <Switch
              checked={draft.sticky !== false}
              onChange={(value) => setDraft({ ...draft, sticky: value })}
            />
          </div>
        </Space>
      </Modal>

      <Drawer
        open={Boolean(current)}
        size={720}
        title={detail?.name || "活码详情"}
        onClose={() => setCurrent(null)}
      >
        {detail ? (
          <CodeDetail
            code={detail}
            domains={domains}
            onGoDomains={onGoDomains}
            onChanged={async () => {
              await load();
              const refreshed = await livecodeApi.get({
                params: { id: String(detail.id) },
              });
              setDetail(refreshed);
            }}
          />
        ) : (
          "加载中…"
        )}
      </Drawer>
    </Panel>
  );
}

function CodeDetail({
  code,
  domains,
  onChanged,
  onGoDomains,
}: {
  code: QrCodeRow;
  domains: QrDomainRow[];
  onChanged: () => Promise<void>;
  onGoDomains: () => void;
}) {
  const [childOpen, setChildOpen] = useState(false);
  const [childDraft, setChildDraft] = useState<Record<string, unknown>>({
    name: "",
    kind: "TEXT",
    limitScope: "INHERIT",
    weight: 1,
  });
  const [entry, setEntry] = useState<{ url: string; domain: string } | null>(null);
  const [qr, setQr] = useState("");
  const [stats, setStats] = useState<{
    today: number;
    todayVisitors: number;
    total: number;
    clicks: number;
    perChild: { childId: number; name: string; scans: number }[];
    perChannel: { channel: string; scans: number }[];
    perDomain: { domainId: number; domain: string; scans: number }[];
  } | null>(null);

  // 活码入口地址要能被扫码后直达，域名跟站点配置走
  const origin = useSiteBase();

  const loadEntry = useCallback(async () => {
    try {
      const data = await livecodeApi.entry({
        params: { id: String(code.id) },
        body: { count: 1 },
      });
      const first = data?.entries?.[0];
      if (first) {
        const url = first.url.startsWith("http") ? first.url : joinSiteUrl(origin, first.url);
        setEntry({ url, domain: first.domain });
        setQr(await QRCode.toDataURL(url, { width: 320, margin: 1 }));
      }
    } catch (error) {
      message.error((error as Error).message || "生成入口失败");
    }
  }, [code.id, origin]);

  const loadStats = useCallback(async () => {
    try {
      setStats(await livecodeApi.stats({ params: { id: String(code.id) }, query: { days: 30 } }));
    } catch {
      // 统计是辅助信息
    }
  }, [code.id]);

  useEffect(() => {
    void loadEntry();
    void loadStats();
  }, [loadEntry, loadStats]);

  const children = useMemo(() => code.children || [], [code.children]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section>
        <div className="sd-col-head">
          <strong>入口与二维码</strong>
          <Space>
            <Select
              size="small"
              placeholder="切换域名"
              style={{ width: 200 }}
              value={undefined}
              onChange={async (value) => {
                await livecodeApi.switchDomain({
                  params: { id: String(code.id) },
                  body: { domainId: value },
                });
                await onChanged();
              }}
              options={domains
                .filter((item) => item.status === "ACTIVE")
                .map((item) => ({ value: item.id, label: item.domain }))}
            />
            <Button size="small" onClick={() => void loadEntry()}>
              重新生成
            </Button>
          </Space>
        </div>
        <div className="muted" style={{ marginBottom: 8 }}>
          当前入口域名：{code.currentDomain || "未绑定"} ·{" "}
          {code.entryModeLabel} · {code.selectModeLabel}
        </div>
        {entry ? (
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            {qr ? (
              <RawImg src={qr} alt="二维码" style={{ width: 180, height: 180 }} />
            ) : null}
            <div style={{ minWidth: 0 }}>
              <Input value={entry.url} readOnly />
              <div className="muted" style={{ marginTop: 6 }}>
                二维码内容就是上面的地址；换域名只需重新生成二维码，旧域名继续可用。
              </div>
              <a href={qr || "#"} download={`livecode-${code.code}.png`}>
                下载二维码
              </a>
            </div>
          </div>
        ) : (
          <div className="muted">
            还没有可用入口：请先在「域名池」绑定并检测生效。{" "}
            <Button type="link" size="small" onClick={onGoDomains}>
              去域名池绑定
            </Button>
          </div>
        )}
      </section>

      <section>
        <div className="sd-col-head">
          <strong>子码（{children.length}）</strong>
          <Space>
            <Button size="small" onClick={() => setChildOpen(true)}>
              添加子码
            </Button>
            <Button size="small" onClick={() => void loadStats()}>
              刷新统计
            </Button>
          </Space>
        </div>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={children}
          columns={[
            { title: "名称", dataIndex: "name" },
            { title: "类型", dataIndex: "kindLabel", width: 70 },
            {
              title: "渠道",
              dataIndex: "channel",
              width: 90,
              render: (value: string) => value || "全渠道",
            },
            { title: "今日", dataIndex: "todayCount", width: 70 },
            { title: "累计", dataIndex: "totalCount", width: 80 },
            {
              title: "操作",
              width: 130,
              render: (_: unknown, row: QrChildRow) => (
                <Space size={2}>
                  <Button
                    size="small"
                    type="link"
                    onClick={async () => {
                      await livecodeApi.childUpdate({
                        params: { id: String(code.id), childId: String(row.id) },
                        body: { status: row.status === "ACTIVE" ? "PAUSED" : "ACTIVE" },
                      });
                      await onChanged();
                    }}
                  >
                    {row.status === "ACTIVE" ? "暂停" : "启用"}
                  </Button>
                  <Button
                    size="small"
                    type="link"
                    danger
                    onClick={async () => {
                      await livecodeApi.childRemove({
                        params: { id: String(code.id), childId: String(row.id) },
                      });
                      await onChanged();
                    }}
                  >
                    删除
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </section>

      <section>
        <strong>近 30 天统计</strong>
        {stats ? (
          <>
            <div className="muted" style={{ margin: "8px 0" }}>
              今日 {stats.today} 次 · 今日访客 {stats.todayVisitors} · 累计 {stats.total} ·
              链接点击 {stats.clicks}
            </div>
            <div className="sd-two-col">
              <Table
                rowKey="childId"
                size="small"
                title={() => "按子码"}
                pagination={false}
                dataSource={stats.perChild}
                columns={[
                  { title: "子码", dataIndex: "name" },
                  { title: "扫码", dataIndex: "scans" },
                ]}
              />
              <Table
                rowKey="channel"
                size="small"
                title={() => "按渠道"}
                pagination={false}
                dataSource={stats.perChannel}
                columns={[
                  { title: "渠道", dataIndex: "channel" },
                  { title: "扫码", dataIndex: "scans" },
                ]}
              />
            </div>
            <Table
              rowKey="domainId"
              size="small"
              style={{ marginTop: 12 }}
              title={() => "按域名"}
              pagination={false}
              dataSource={stats.perDomain}
              columns={[
                { title: "域名", dataIndex: "domain" },
                { title: "扫码", dataIndex: "scans" },
              ]}
            />
          </>
        ) : (
          <div className="muted">加载中…</div>
        )}
      </section>

      <Modal
        open={childOpen}
        title="添加子码"
        onCancel={() => setChildOpen(false)}
        onOk={async () => {
          try {
            await livecodeApi.childCreate({
              params: { id: String(code.id) },
              body: {
                name: String(childDraft.name || "子码"),
                kind: (childDraft.kind as "IMAGE" | "LINK" | "TEXT") || "TEXT",
                imageKey: String(childDraft.imageKey || ""),
                linkUrl: String(childDraft.linkUrl || ""),
                textContent: String(childDraft.textContent || ""),
                channel: String(childDraft.channel || ""),
                weight: Number(childDraft.weight || 1),
                sortOrder: 0,
                limitScope:
                  (childDraft.limitScope as
                    | "INHERIT"
                    | "NONE"
                    | "DAILY"
                    | "TOTAL") || "INHERIT",
                dailyLimit: Number(childDraft.dailyLimit || 0),
                totalLimit: Number(childDraft.totalLimit || 0),
              },
            });
            setChildOpen(false);
            setChildDraft({ name: "", kind: "TEXT", limitScope: "INHERIT", weight: 1 });
            await onChanged();
          } catch (error) {
            message.error((error as Error).message || "添加失败");
          }
        }}
        okText="添加"
      >
        <Space orientation="vertical" style={{ width: "100%" }} size={12}>
          <Input
            placeholder="子码名称（后台识别用）"
            value={String(childDraft.name || "")}
            onChange={(event) => setChildDraft({ ...childDraft, name: event.target.value })}
          />
          <Radio.Group
            value={childDraft.kind}
            onChange={(event) => setChildDraft({ ...childDraft, kind: event.target.value })}
          >
            <Radio value="TEXT">文本</Radio>
            <Radio value="LINK">链接</Radio>
            <Radio value="IMAGE">图片</Radio>
          </Radio.Group>
          {childDraft.kind === "TEXT" ? (
            <Input.TextArea
              rows={3}
              placeholder="要展示的文本（访客可复制）"
              value={String(childDraft.textContent || "")}
              onChange={(event) =>
                setChildDraft({ ...childDraft, textContent: event.target.value })
              }
            />
          ) : null}
          {childDraft.kind === "LINK" ? (
            <Input
              placeholder="https:// 链接"
              value={String(childDraft.linkUrl || "")}
              onChange={(event) =>
                setChildDraft({ ...childDraft, linkUrl: event.target.value })
              }
            />
          ) : null}
          {childDraft.kind === "IMAGE" ? (
            <Input
              placeholder="图片 OSS 路径（例如 livecode/xxx.png）"
              value={String(childDraft.imageKey || "")}
              onChange={(event) =>
                setChildDraft({ ...childDraft, imageKey: event.target.value })
              }
            />
          ) : null}
          <Input
            placeholder="渠道（可选，例如 门店A；留空＝全渠道）"
            value={String(childDraft.channel || "")}
            onChange={(event) =>
              setChildDraft({ ...childDraft, channel: event.target.value })
            }
          />
          <Space>
            <Select
              style={{ width: 140 }}
              value={childDraft.limitScope}
              onChange={(value) => setChildDraft({ ...childDraft, limitScope: value })}
              options={QR_CHILD_LIMIT_SCOPES.map((item) => ({
                value: item,
                label: QR_CHILD_LIMIT_SCOPE_LABELS[item],
              }))}
            />
            <InputNumber
              min={0}
              placeholder="每天"
              value={Number(childDraft.dailyLimit || 0)}
              onChange={(value) => setChildDraft({ ...childDraft, dailyLimit: value })}
            />
            <InputNumber
              min={0}
              placeholder="累计"
              value={Number(childDraft.totalLimit || 0)}
              onChange={(value) => setChildDraft({ ...childDraft, totalLimit: value })}
            />
          </Space>
        </Space>
      </Modal>
    </div>
  );
}

function DomainsPanel({ tabs }: { tabs: ReactNode }) {
  const [rows, setRows] = useState<QrDomainRow[]>([]);
  const [open, setOpen] = useState(false);
  const [domain, setDomain] = useState("");
  const [mode, setMode] = useState<"CDN" | "SCRIPT">("CDN");
  const [ack, setAck] = useState(false);
  const [checking, setChecking] = useState<number | null>(null);
  // 回源地址与嵌入脚本的域名：跟站点配置走，不写死本站地址
  const origin = useSiteBase();

  const load = async () => {
    try {
      setRows((await livecodeApi.domains()) || []);
    } catch (error) {
      message.error((error as Error).message || "加载失败");
    }
  };

  useEffect(() => {
    void load();
     
  }, []);

  return (
    <Panel
      title="活码引流"
      titleExtra={
        <span className="muted" style={{ fontSize: 12 }}>
          域名池由你自己维护，上限 100 个；不使用本站域名。
        </span>
      }
      extra={tabs}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 16,
          marginBottom: 10,
        }}
      >
        <Button
          type="link"
          size="small"
          icon={<ReloadOutlined aria-hidden />}
          style={{ padding: 0 }}
          onClick={() => void load()}
        >
          刷新
        </Button>
        <Button
          type="link"
          size="small"
          icon={<PlusOutlined aria-hidden />}
          style={{ padding: 0 }}
          onClick={() => setOpen(true)}
        >
          绑定域名
        </Button>
      </div>
      <Table
        rowKey="id"
        dataSource={rows}
        pagination={false}
        columns={[
          { title: "域名", dataIndex: "domain" },
          { title: "用途", dataIndex: "modeLabel", width: 180 },
          {
            title: "状态",
            dataIndex: "statusLabel",
            width: 100,
            render: (value: string, row: QrDomainRow) => (
              <Tag color={DOMAIN_STATUS_COLOR[row.status] || "default"}>{value}</Tag>
            ),
          },
          {
            title: "权重",
            dataIndex: "weight",
            width: 80,
            render: (value: number, row: QrDomainRow) => (
              <InputNumber
                size="small"
                min={0}
                max={100}
                value={value}
                onChange={async (next) => {
                  await livecodeApi.domainUpdate({
                    params: { id: String(row.id) },
                    body: { weight: Number(next || 0) },
                  });
                  void load();
                }}
              />
            ),
          },
          {
            title: "在用活码",
            dataIndex: "codeCount",
            width: 90,
          },
          {
            title: "最近检测",
            dataIndex: "lastCheckAt",
            width: 160,
            render: (value: string, row: QrDomainRow) =>
              value ? value.replace("T", " ").slice(0, 16) : row.lastError || "未检测",
          },
          {
            title: "操作",
            width: 170,
            render: (_: unknown, row: QrDomainRow) => (
              <Space size={2}>
                <Button
                  size="small"
                  loading={checking === row.id}
                  onClick={async () => {
                    try {
                      setChecking(row.id);
                      const result = await livecodeApi.domainCheck({
                        params: { id: String(row.id) },
                      });
                      message[result?.status === "ACTIVE" ? "success" : "error"](
                        result?.status === "ACTIVE"
                          ? "检测通过，域名已生效"
                          : result?.error || "检测未通过",
                      );
                      void load();
                    } finally {
                      setChecking(null);
                    }
                  }}
                >
                  检测
                </Button>
                <Button
                  size="small"
                  onClick={async () => {
                    await livecodeApi.domainUpdate({
                      params: { id: String(row.id) },
                      body: {
                        status: row.status === "DISABLED" ? "ACTIVE" : "DISABLED",
                      },
                    });
                    void load();
                  }}
                >
                  {row.status === "DISABLED" ? "恢复" : "停用"}
                </Button>
                <Button
                  size="small"
                  danger
                  onClick={async () => {
                    await livecodeApi.domainRemove({ params: { id: String(row.id) } });
                    void load();
                  }}
                >
                  解绑
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <div className="panel" style={{ marginTop: 16, padding: 16 }}>
        <strong>接入方式</strong>
        <div className="muted" style={{ lineHeight: 1.9, marginTop: 6 }}>
          {rows[0]
            ? rows[0].mode === "CDN"
              ? `① 在客户域名所在的 CDN 上开启 HTTPS（证书由客户侧提供）；② 回源 Host 改为本站域名；③ 回源地址：${joinSiteUrl(origin, rows[0].originPath)}。检测通过后才参与轮换。`
              : `在客户官网页面上粘贴：<script src="${joinSiteUrl(origin, "/api/public/lk/embed.js")}" data-lk="活码短码"></script>`
            : "先绑定一个你持有的域名，再按页面提示配置回源或脚本。"}
        </div>
      </div>
      <Modal
        open={open}
        title="绑定域名"
        onCancel={() => setOpen(false)}
        onOk={async () => {
          if (!ack) {
            message.warning("请先确认备案与内容责任");
            return;
          }
          try {
            await livecodeApi.domainCreate({
              body: { domain, mode, ack: true },
            });
            setOpen(false);
            setDomain("");
            setAck(false);
            void load();
          } catch (error) {
            message.error((error as Error).message || "绑定失败");
          }
        }}
        okText="绑定"
      >
        <Space orientation="vertical" style={{ width: "100%" }} size={12}>
          <Input
            placeholder="例如 go.example.com"
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
          />
          <Select
            style={{ width: "100%" }}
            value={mode}
            onChange={setMode}
            options={[
              { value: "CDN", label: "官网独立页（CDN 回源）" },
              { value: "SCRIPT", label: "官网弹层（接入脚本）" },
            ]}
          />
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input
              type="checkbox"
              checked={ack}
              onChange={(event) => setAck(event.target.checked)}
            />
            <span className="muted">
              我确认：该域名已备案、证书由我自己的 CDN 提供、落地内容由我负责。
            </span>
          </label>
        </Space>
      </Modal>
    </Panel>
  );
}