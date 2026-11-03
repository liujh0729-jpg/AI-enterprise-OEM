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
import { aliyunMailApi, type AliyunMailSettings } from "./aliyun-mail-common";
import { AliyunMailGuide } from "./aliyun-mail-guide";
import { AliyunMailImport } from "./aliyun-mail-import";
import { AliyunMailRecords } from "./aliyun-mail-records";
import { AliyunMailSettingsPanel } from "./aliyun-mail-settings";

type View = "import" | "records" | "guide" | "settings";

/**
 * 阿里云邮件推送：把多维表格的联系人按列映射同步到阿里云收件人列表
 * （新建列表或追加），附操作指引与按账号归属的 AK 设置。四个页签贴面板标题行右端。
 */
export function AliyunMailTab() {
  const [view, setView] = useState<View>("import");
  const [settings, setSettings] = useState<AliyunMailSettings | null>(null);
  const [settingsError, setSettingsError] = useState("");
  const [focusImportId, setFocusImportId] = useState<number | null>(null);

  const reloadSettings = useCallback(async () => {
    const result = await aliyunMailApi.settings();
    if (result.data) {
      setSettings(result.data);
      setSettingsError("");
    } else {
      setSettingsError(result.message || "邮件设置读取失败");
    }
  }, []);

  useEffect(() => {
    void reloadSettings();
  }, [reloadSettings]);

  return (
    <Panel
      title="阿里云邮件推送"
      extra={
        <>
          {/* 页签条与全站一致：贴面板标题行的右端，不贴着标题 */}
          <TabStrip
            items={[
              {
                key: "import",
                label: (
                  <>
                    <UploadOutlined aria-hidden /> 同步名单
                  </>
                ),
              },
              {
                key: "records",
                label: (
                  <>
                    <HistoryOutlined aria-hidden /> 同步记录
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
                    <SettingOutlined aria-hidden /> 邮件设置
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
        <AliyunMailSettingsPanel
          settings={settings}
          onSaved={reloadSettings}
        />
      ) : view === "guide" ? (
        <AliyunMailGuide />
      ) : view === "records" ? (
        <AliyunMailRecords
          focusImportId={focusImportId}
          onFocusHandled={() => setFocusImportId(null)}
        />
      ) : (
        <AliyunMailImport
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
