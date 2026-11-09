"use client";

import { Alert, App, Button, Descriptions, InputNumber, Radio, Space, Switch, Tag } from "antd";
import { useCallback, useEffect, useState } from "react";
import { contentApi } from "@/api/content";
import { Notice } from "@/components/ui/panel";

type SyncStatus = {
  showAiworkin: boolean;
  mode: "MANUAL" | "SCHEDULED";
  intervalMinutes: number;
  lastSyncAt: string;
  lastResult: "SUCCESS" | "FAILED" | "SKIPPED" | "";
  lastError: string;
  lastCount: number;
};

const RESULT_TEXT: Record<string, { color: string; label: string }> = {
  SUCCESS: { color: "green", label: "同步成功" },
  FAILED: { color: "red", label: "同步失败" },
  SKIPPED: { color: "orange", label: "已跳过" },
};

export function VideoTemplateAdminTab() {
  const { message } = App.useApp();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setStatus(await contentApi.videoTemplateAdminSettings());
    } catch (error) {
      message.error((error as Error).message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (patch: Partial<Pick<SyncStatus, "showAiworkin" | "mode" | "intervalMinutes">>) => {
    try {
      setSaving(true);
      setStatus(await contentApi.saveVideoTemplateAdminSettings({ body: patch }));
      message.success("已保存");
    } catch (error) {
      message.error((error as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const syncNow = async () => {
    try {
      setSyncing(true);
      const next = await contentApi.syncVideoTemplateAdmin();
      if (!next) throw new Error("同步接口没有返回结果");
      setStatus(next);
      if (next.lastResult === "SUCCESS") {
        message.success(`已同步 ${next.lastCount} 条 AIworkin 模版`);
      } else if (next.lastResult === "SKIPPED") {
        message.info(next.lastError || "本次同步已跳过");
      } else {
        message.error(next.lastError || "同步失败");
      }
    } catch (error) {
      message.error((error as Error).message || "同步失败");
    } finally {
      setSyncing(false);
    }
  };

  const result = status ? RESULT_TEXT[status.lastResult] : undefined;

  return (
    <div style={{ maxWidth: 760 }}>
      <Notice variant="info">
        勾选后，本平台的「视频模版社区」会额外展示 AIworkin 平台模版；后台按下方策略自动调用 AIworkin
        的模版接口做增量补充（同一上游模版只入库一次，重复同步不会产生重复数据）。AIworkin
        的模版接口上线前，同步会以「已跳过」记录并在上线后自动接入，无需再改配置。
      </Notice>

      <Descriptions column={1} bordered size="small" style={{ marginTop: 16 }}>
        <Descriptions.Item label="显示 AIworkin 平台模版">
          <Space>
            <Switch
              checked={status?.showAiworkin ?? false}
              loading={loading || saving}
              onChange={(checked) => void save({ showAiworkin: checked })}
            />
            <span style={{ color: "rgba(0,0,0,.45)" }}>
              {status?.showAiworkin ? "已开启：平台模版与本平台模版一起展示" : "已关闭：只展示本平台用户发布的模版"}
            </span>
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label="补充策略">
          <Radio.Group
            value={status?.mode ?? "MANUAL"}
            disabled={loading || saving}
            onChange={(event) => void save({ mode: event.target.value })}
          >
            <Radio.Button value="MANUAL">手动同步</Radio.Button>
            <Radio.Button value="SCHEDULED">定时同步</Radio.Button>
          </Radio.Group>
        </Descriptions.Item>
        <Descriptions.Item label="同步间隔（分钟）">
          {status?.mode === "SCHEDULED" ? (
            <InputNumber
              min={5}
              max={1440}
              value={status.intervalMinutes}
              disabled={saving}
              onChange={(value) => {
                if (typeof value === "number") void save({ intervalMinutes: value });
              }}
            />
          ) : (
            <span style={{ color: "rgba(0,0,0,.45)" }}>手动模式下不自动同步</span>
          )}
        </Descriptions.Item>
        <Descriptions.Item label="最近同步">
          {status?.lastResult ? (
            <Space orientation="vertical" size={4}>
              <Space>
                <Tag color={result?.color}>{result?.label}</Tag>
                <span>{status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : "—"}</span>
                {status.lastResult === "SUCCESS" ? <span>新增 / 更新 {status.lastCount} 条</span> : null}
              </Space>
              {status.lastError ? <span style={{ color: "#cf1322" }}>{status.lastError}</span> : null}
            </Space>
          ) : (
            <span style={{ color: "rgba(0,0,0,.45)" }}>尚未同步</span>
          )}
        </Descriptions.Item>
      </Descriptions>

      <Space style={{ marginTop: 16 }}>
        <Button type="primary" loading={syncing} onClick={() => void syncNow()}>
          立即同步
        </Button>
      </Space>

      <Alert
        style={{ marginTop: 16 }}
        type="warning"
        showIcon
        title="上游接口未就绪时的表现"
        description="AIworkin 模版接口返回 404 / 501，或本系统未配置上游服务 Token 时，同步结果记为「已跳过」并保留原因；接口上线并配好 Token 后，下一次定时或手动同步即自动拉取。"
      />
    </div>
  );
}
