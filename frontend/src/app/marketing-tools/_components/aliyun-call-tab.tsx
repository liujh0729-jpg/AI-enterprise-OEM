"use client";

import {
  CheckCircleOutlined,
  HistoryOutlined,
  ReadOutlined,
  SettingOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { Spin, Tag } from "antd";
import { useCallback, useEffect, useState } from "react";
import { Notice, Panel, TabStrip } from "@/components/ui/panel";
import { aliyunCallApi, type AliyunCallSettings } from "./aliyun-call-common";
import { AliyunCallGuide } from "./aliyun-call-guide";
import { AliyunCallImport } from "./aliyun-call-import";
import { AliyunCallRecords } from "./aliyun-call-records";
import { AliyunCallSettingsPanel } from "./aliyun-call-settings";

type View = "import" | "records" | "guide" | "settings";

/**
 * 阿里云智能外呼：把多维表格名单按列映射导入阿里云 OutboundBot（新建任务组或追加号码），
 * 附操作指引与按账号归属的 AK 设置。四个页签贴面板标题行右端。
 */
export function AliyunCallTab() {
  const [view, setView] = useState<View>("import");
  const [settings, setSettings] = useState<AliyunCallSettings | null>(null);
  const [settingsError, setSettingsError] = useState("");
  const [focusImportId, setFocusImportId] = useState<number | null>(null);

  const reloadSettings = useCallback(async () => {
    const result = await aliyunCallApi.settings();
    if (result.data) {
      setSettings(result.data);
      setSettingsError("");
    } else {
      setSettingsError(result.message || "外呼设置读取失败");
    }
  }, []);

  useEffect(() => {
    void reloadSettings();
  }, [reloadSettings]);

  return (
    <Panel
      title="阿里云智能外呼"
      extra={
        <>
          {/* 页签条与全站一致：贴面板标题行的右端，不贴着标题 */}
          <TabStrip
            items={[
              {
                key: "import",
                label: (
                  <>
                    <UploadOutlined aria-hidden /> 导入名单
                  </>
                ),
              },
              {
                key: "records",
                label: (
                  <>
                    <HistoryOutlined aria-hidden /> 任务与进度
                  </>
                ),
              },
              {
                key: "guide",
                label: (
                  <>
                    <ReadOutlined aria-hidden /> 使用说明
                  </>
                ),
              },
              {
                key: "settings",
                label: (
                  <>
                    <SettingOutlined aria-hidden /> 外呼设置
                  </>
                ),
              },
            ]}
            value={view}
            onChange={(value) => setView(value as View)}
          />
          {settings?.configured ? (
            <Tag color="green" icon={<CheckCircleOutlined aria-hidden />}>
              已配置 Key
            </Tag>
          ) : null}
        </>
      }
    >
      {settingsError ? (
        <div style={{ marginBottom: 12 }}>
          <Notice variant="warn">{settingsError}</Notice>
        </div>
      ) : null}

      {!settings ? (
        <div style={{ padding: 24, textAlign: "center" }}>
          <Spin />
        </div>
      ) : view === "settings" ? (
        <AliyunCallSettingsPanel settings={settings} onSaved={reloadSettings} />
      ) : view === "guide" ? (
        <AliyunCallGuide />
      ) : view === "records" ? (
        <AliyunCallRecords
          focusImportId={focusImportId}
          onFocusHandled={() => setFocusImportId(null)}
        />
      ) : (
        <AliyunCallImport
          settings={settings}
          onGoSettings={() => setView("settings")}
          onImported={(importId) => {
            setFocusImportId(importId);
            setView("records");
          }}
        />
      )}
    </Panel>
  );
}
