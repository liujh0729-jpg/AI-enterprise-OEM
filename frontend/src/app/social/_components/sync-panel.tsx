"use client";

import { ApiOutlined, CloudSyncOutlined, LinkOutlined, ReloadOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { App, Button, Popconfirm, Spin, Switch } from "antd";
import Link from "next/link";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { socialApi, type SyncPreferences } from "@/api/social";
import { useBusinessQuery, useOperationMutation } from "@/query/business";

const IDENTITY_TEXT: Record<string, { label: string; desc: string; tone: "ok" | "warn" | "info" }> = {
  READY: { label: "已连接", desc: "个人 API Key 与 AIworkin 社交身份已打通。", tone: "ok" },
  PLACEHOLDER_ID: {
    label: "Key 未返回真实用户编号",
    desc: "当前 Key 只能访问基础数据，无法同步社交关系。请在「模型服务 → API Key 管理」重新绑定一把在 AIworkin 注册的个人 Key。",
    tone: "warn",
  },
  SNS_GRANT_MISSING: {
    label: "缺少社交授权",
    desc: "Key 有效，但上游没有返回社交权限。可稍后重试验证；持续失败请到 AIworkin 检查该 Key 的授权范围。",
    tone: "warn",
  },
  KEY_INACTIVE: {
    label: "Key 已失效",
    desc: "绑定的 API Key 已不可用，请重新绑定后再同步。",
    tone: "warn",
  },
  UNBOUND: {
    label: "未绑定个人 Key",
    desc: "绑定后，双方都持 Key 时好友申请、好友关系与私信才会同步到 AIworkin 对应账号。",
    tone: "info",
  },
  REVOKED: {
    label: "身份待重新验证",
    desc: "Key 解绑或换绑后身份需要重新验证一次。",
    tone: "info",
  },
};

const JOB_STATUS: Record<string, string> = {
  PENDING: "排队中",
  RUNNING: "执行中",
  SUCCEEDED: "已完成",
  FAILED: "失败",
  DEAD: "已终止",
  SKIPPED: "已跳过",
};

const PREF_ITEMS: Array<{
  key: keyof SyncPreferences;
  title: string;
  desc: string;
}> = [
  { key: "discoverable", title: "允许被推荐", desc: "允许其他用户在你的共同好友/组织关系里看到并推荐你。" },
  { key: "recommendEnabled", title: "接收亲密度推荐", desc: "按社交与业务关联为你推荐可能认识的人。" },
  { key: "businessReasonVisible", title: "展示业务关联原因", desc: "推荐理由可显示合同、订单、服务对接等细节；关闭后只显示「有业务往来」。" },
  { key: "friendRequestOutbound", title: "好友申请出站同步", desc: "向也有 Key 的用户发起好友申请时，同步到 AIworkin。" },
  { key: "friendRelationOutbound", title: "好友关系出站同步", desc: "接受/拒绝好友申请时，把结果同步到 AIworkin。" },
  { key: "friendRelationInbound", title: "好友关系回流", desc: "把 AIworkin 已建立的好友关系拉回本站（只新增，不删除本地数据）。" },
  { key: "mailOutboundDefault", title: "私信默认同步", desc: "发起私信时默认勾选同步到 AIworkin；每次发送仍可单独取消。" },
  { key: "mailInbound", title: "私信回流", desc: "把 AIworkin 私信拉回本站会话（只新增，不覆盖本地消息）。" },
];

/**
 * AIworkin 同步设置：身份状态、写额度、出/入站开关、失败任务与好友回填。
 * 本地数据始终为主，这里的开关只决定是否额外同步到个人 Key 对应的上游账号。
 */
export function SocialSyncPanel() {
  const { message } = App.useApp();
  const overview = useBusinessQuery("social", "sync-overview", {}, (signal) =>
    socialApi.syncOverview({ signal }),
  );
  const jobs = useBusinessQuery("social", "sync-jobs", {}, (signal) => socialApi.syncJobs(undefined, { signal }));
  const backfill = useBusinessQuery("social", "sync-backfill", {}, (signal) =>
    socialApi.backfillProgress({ signal }),
  );

  const save = useOperationMutation(
    (input: Partial<SyncPreferences>) => socialApi.saveSyncPreferences(input),
    ["social"],
  );
  const verify = useOperationMutation(() => socialApi.syncVerify(), ["social"]);
  const pull = useOperationMutation(() => socialApi.syncPull(), ["social"]);
  const retry = useOperationMutation((input: { id: number }) => socialApi.retrySyncJob(input.id), ["social"]);
  const startBackfill = useOperationMutation(
    (input: { confirm: boolean }) => socialApi.backfillFriends(input.confirm),
    ["social"],
  );

  if (overview.isLoading)
    return (
      <Panel title="AIworkin 同步">
        <Spin />
      </Panel>
    );

  const data = overview.data;
  if (!data)
    return (
      <Panel title="AIworkin 同步">
        <EmptyState text="同步状态读取失败，请刷新重试。" />
      </Panel>
    );

  const identity = IDENTITY_TEXT[data.identity.state] || IDENTITY_TEXT.UNBOUND;
  const prefs = data.preferences;
  const inboundOn = prefs.friendRelationInbound || prefs.mailInbound;
  const jobRows = jobs.data || [];
  const failedJobs = jobRows.filter((job) => job.status === "FAILED" || job.status === "DEAD");

  const onToggle = async (key: keyof SyncPreferences, value: boolean) => {
    try {
      await save.mutateAsync({ [key]: value });
      message.success("同步设置已保存");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存失败");
    }
  };

  const onVerify = async () => {
    try {
      const res = await verify.mutateAsync(undefined);
      message.success(res.state === "READY" ? "连接正常" : `当前状态：${res.state}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "验证失败");
    }
  };

  const onPull = async () => {
    try {
      const res = await pull.mutateAsync(undefined);
      message.success(res.queued.length ? "已排队拉取，稍后自动执行" : "没有可拉取的项");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "拉取失败");
    }
  };

  const onBackfill = async () => {
    try {
      const res = await startBackfill.mutateAsync({ confirm: true });
      message.success(`已排队回填 ${res.queued} 位好友`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "回填失败");
    }
  };

  return (
    <Panel
      title="AIworkin 同步"
      titleBadge={<span className="sns-muted">本地为主 · 个人 Key 可选同步</span>}
      extra={
        <Button size="small" icon={<ReloadOutlined />} loading={overview.isFetching} onClick={() => void overview.refetch()}>
          刷新
        </Button>
      }
    >
      <Notice variant={identity.tone === "ok" ? "success" : identity.tone === "warn" ? "warn" : "info"}>
        <b>{identity.label}</b>：{identity.desc}{" "}
        {data.identity.state === "UNBOUND" ? <Link href="/developer/keys">去绑定 API Key</Link> : null}
      </Notice>

      <div className="sns-sync-meta">
        <span>
          <SafetyCertificateOutlined /> 写额度：本小时 {data.quota.writesUsedThisHour}/{data.quota.writesLimitPerHour} · 今日{" "}
          {data.quota.writesUsedToday}/{data.quota.writesLimitPerDay}
        </span>
        {data.identity.mailAddress ? (
          <span>
            <ApiOutlined /> 上游私信地址：{data.identity.mailAddress}
          </span>
        ) : null}
        {data.lastPullAt ? <span>上次拉取：{new Date(data.lastPullAt).toLocaleString("zh-CN")}</span> : null}
        <span>待同步 {data.counts.pending} · 失败 {data.counts.failed + data.counts.dead}</span>
      </div>

      {data.lastError ? <Notice variant="warn">最近一次同步失败：{data.lastError}</Notice> : null}

      <div className="sns-toolbar" style={{ marginTop: 12 }}>
        <Button icon={<SafetyCertificateOutlined />} loading={verify.isPending} onClick={onVerify}>
          验证连接
        </Button>
        <Button
          icon={<CloudSyncOutlined />}
          loading={pull.isPending}
          disabled={!inboundOn}
          onClick={onPull}
          title={inboundOn ? undefined : "先在下方开启好友关系回流或私信回流"}
        >
          立即拉取
        </Button>
        <Popconfirm
          title={`将向 AIworkin 回填 ${backfill.data?.total ?? 0} 位已绑定 Key 的好友关系，可能占用写额度，确认？`}
          okText="开始回填"
          disabled={!backfill.data?.total}
          onConfirm={onBackfill}
        >
          <Button icon={<LinkOutlined />} loading={startBackfill.isPending} disabled={!backfill.data?.total}>
            回填好友关系（{backfill.data?.total ?? 0}）
          </Button>
        </Popconfirm>
        {!inboundOn ? <span className="sns-muted">开启下方任一「回流」开关后可立即拉取。</span> : null}
      </div>

      <div className="sns-divider" />
      <div className="sns-section-title">同步设置</div>
      <div className="sns-sync-list">
        {PREF_ITEMS.map((item) => (
          <div key={item.key} className="sns-sync-row">
            <div className="sns-sync-row-main">
              <div className="sns-sync-row-title">{item.title}</div>
              <div className="sns-sync-row-desc">{item.desc}</div>
            </div>
            <Switch
              checked={Boolean(prefs[item.key])}
              loading={save.isPending}
              onChange={(checked) => void onToggle(item.key, checked)}
            />
          </div>
        ))}
      </div>

      <div className="sns-divider" />
      <div className="sns-section-title">最近同步任务</div>
      {jobRows.length === 0 ? (
        <EmptyState text="还没有同步任务。触发好友申请、接受好友或发送私信后，这里会出现投递记录。" />
      ) : (
        <div className="sns-sync-jobs">
          {jobRows.slice(0, 8).map((job) => (
            <div key={job.id} className="sns-sync-job">
              <span className="sns-flag sns-flag-sync">{JOB_STATUS[job.status] || job.status}</span>
              <span className="sns-ellipsis" style={{ flex: 1 }}>
                {job.action} · {job.localType} {job.localId}
                {job.lastError ? ` · ${job.lastError}` : ""}
              </span>
              <span>{new Date(job.createdAt).toLocaleString("zh-CN")}</span>
              {job.status === "FAILED" || job.status === "DEAD" ? (
                <Button size="small" type="link" loading={retry.isPending} onClick={() => retry.mutateAsync({ id: job.id })}>
                  重试
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {failedJobs.length ? (
        <span className="sns-muted">失败任务会在调度器里按退避自动重试；额度不足时顺延到下一个时段。</span>
      ) : null}
    </Panel>
  );
}
