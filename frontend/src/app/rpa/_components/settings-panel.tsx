"use client";

import { App, Button, Divider, Form, Input, Select, Space } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { Panel } from "@/components/ui/panel";
import {
  BITPHONE_COMPUTE_TYPE_OPTIONS,
  BITPHONE_REGION_OPTIONS,
  rpaApi,
  type LlmSetting,
} from "./common";

type SettingsForm = {
  bitbrowserApiEndpoint: string;
  bitbrowserApiKey: string;
  bitbrowserGroupId: string;
  bitphoneRegionId: string;
  bitphoneComputeType: string;
};

const EMPTY: SettingsForm = {
  bitbrowserApiEndpoint: "http://127.0.0.1:54345",
  bitbrowserApiKey: "",
  bitbrowserGroupId: "",
  bitphoneRegionId: "",
  bitphoneComputeType: "",
};

/**
 * RPA 设置：每个租户的比特浏览器实例配置。
 * API 端点与密钥用于本地执行端连接比特浏览器；默认分组 / 云手机地域 / 算力在创建任务时作为默认值。
 */
export function SettingsPanel() {
  const { message } = App.useApp();
  const { request, modal } = usePasswordConfirm();
  const [form, setForm] = useState<SettingsForm>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);

  const [llm, setLlm] = useState<LlmSetting | null>(null);
  const [llmModel, setLlmModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [llmBusy, setLlmBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, message: errorMsg } = await rpaApi.settings();
    if (errorMsg) {
      message.error(errorMsg);
      return;
    }
    if (data) {
      setForm({
        bitbrowserApiEndpoint: data.bitbrowserApiEndpoint,
        bitbrowserApiKey: "",
        bitbrowserGroupId: data.bitbrowserGroupId,
        bitphoneRegionId: data.bitphoneRegionId,
        bitphoneComputeType: data.bitphoneComputeType,
      });
      setHasApiKey(data.hasBitbrowserApiKey);
    }
  }, [message]);

  const loadLlm = useCallback(async () => {
    const setting = await rpaApi.llmSetting();
    if (!setting.message) {
      setLlm(setting.data);
      setLlmModel(setting.data?.model || "");
    }
    if (!setting.data?.configured) return;
    const modelsData = await rpaApi.llmModels();
    if (!modelsData.message) {
      setModels(modelsData.data?.models ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadLlm();
  }, [load, loadLlm]);

  const submit = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        bitbrowserApiEndpoint: form.bitbrowserApiEndpoint.trim(),
        bitbrowserGroupId: form.bitbrowserGroupId.trim(),
        bitphoneRegionId: form.bitphoneRegionId,
        bitphoneComputeType: form.bitphoneComputeType,
      };
      if (form.bitbrowserApiKey) {
        body.bitbrowserApiKey = form.bitbrowserApiKey;
      }
      await rpaApi.saveSettings(body);
      message.success("设置已保存");
      setForm((prev) => ({ ...prev, bitbrowserApiKey: "" }));
      await load();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const patch = (next: Partial<SettingsForm>) =>
    setForm((prev) => ({ ...prev, ...next }));

  const loadModels = async () => {
    setLlmBusy(true);
    try {
      const data = await rpaApi.llmModels();
      if (data.message) {
        message.error(data.message);
        return;
      }
      setModels(data.data?.models ?? []);
      message.success(`已读取 ${data.data?.models.length ?? 0} 个模型`);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setLlmBusy(false);
    }
  };

  const clearLlm = () => {
    request({
      title: "清除默认模型（需密码）",
      content: "确认清除 RPA 的默认模型？清除后「AI 写脚本」需要重新选择模型，平台 API Key 不受影响。",
      danger: true,
      okText: "确认清除",
      onOk: async () => {
        await rpaApi.deleteLlm();
        setLlm((prev) => (prev ? { ...prev, model: "" } : prev));
        setLlmModel("");
        setModels([]);
        message.success("默认模型已清除");
      },
    });
  };

  const saveLlm = async () => {
    setLlmBusy(true);
    try {
      const saved = await rpaApi.saveLlm({ model: llmModel });
      setLlm(saved);
      message.success("模型配置已保存");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setLlmBusy(false);
    }
  };

  const modelOptions = Array.from(
    new Set([...models, llm?.model || ""].filter(Boolean)),
  ).map((value) => ({ value, label: value }));

  return (
    <Panel title="RPA 设置" titleBadge="每个租户独立配置">
      <Form layout="vertical" style={{ maxWidth: 600 }}>
        <Form.Item label="比特浏览器 API 端点" required>
          <Input
            value={form.bitbrowserApiEndpoint}
            placeholder="http://127.0.0.1:54345"
            onChange={(event) =>
              patch({ bitbrowserApiEndpoint: event.target.value })
            }
          />
          <div className="text-12 muted" style={{ marginTop: 4 }}>
            本地执行端连接比特浏览器的 API 地址，默认 http://127.0.0.1:54345
          </div>
        </Form.Item>
        <Form.Item
          label={hasApiKey ? "比特浏览器 API 密钥（已保存，留空沿用）" : "比特浏览器 API 密钥"}
        >
          <Input.Password
            value={form.bitbrowserApiKey}
            placeholder={hasApiKey ? "留空沿用已保存密钥" : "输入 API 密钥"}
            onChange={(event) => patch({ bitbrowserApiKey: event.target.value })}
          />
          <div className="text-12 muted" style={{ marginTop: 4 }}>
            比特浏览器客户端生成的 API Key，用于本地执行端调用 /browser/* 接口
          </div>
        </Form.Item>
        <Form.Item label="默认分组 ID">
          <Input
            value={form.bitbrowserGroupId}
            placeholder="创建窗口时使用的默认分组"
            onChange={(event) => patch({ bitbrowserGroupId: event.target.value })}
          />
          <div className="text-12 muted" style={{ marginTop: 4 }}>
            比特浏览器里的分组 ID，创建任务时可作为默认值
          </div>
        </Form.Item>
        <Form.Item label="云手机地域">
          <Select
            value={form.bitphoneRegionId || undefined}
            allowClear
            placeholder="选择云手机地域"
            options={BITPHONE_REGION_OPTIONS}
            onChange={(value) => patch({ bitphoneRegionId: value || "" })}
          />
          <div className="text-12 muted" style={{ marginTop: 4 }}>
            云手机任务创建时的默认地域
          </div>
        </Form.Item>
        <Form.Item label="云手机算力规格">
          <Select
            value={form.bitphoneComputeType || undefined}
            allowClear
            placeholder="选择算力规格"
            options={BITPHONE_COMPUTE_TYPE_OPTIONS}
            onChange={(value) => patch({ bitphoneComputeType: value || "" })}
          />
          <div className="text-12 muted" style={{ marginTop: 4 }}>
            云手机任务创建时的默认算力规格
          </div>
        </Form.Item>
        <Form.Item>
          <Button type="primary" onClick={submit} loading={saving}>
            保存设置
          </Button>
        </Form.Item>
      </Form>

      <Divider />

      <Form layout="vertical" style={{ maxWidth: 600 }}>
        <Form.Item>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
            AI 模型配置（AIPDD 文字模型）
          </div>
          <div className="text-12 muted" style={{ marginBottom: 16 }}>
            配置用于「AI 写脚本」和「AI 填写参数」的文字模型。模型调用使用「API Key 管理」里平台 API Key（AIworkin 签发的 sk- Key），这里只选默认模型。
          </div>
        </Form.Item>
        <Form.Item label="服务地址">
          <Input readOnly value={llm?.baseUrl || "https://api.aipdd.work/v1"} />
          <div className="text-12 muted" style={{ marginTop: 4 }}>
            AIPDD 文字模型的 API 地址，固定为 https://api.aipdd.work/v1
          </div>
        </Form.Item>
        <Form.Item label="API Key">
          {llm?.configured ? (
            <div className="text-12">
              已使用平台 API Key（{llm.keyMasked}），可在{" "}
              <Link href="/developer/keys">API Key 管理</Link> 更换或吊销
            </div>
          ) : (
            <div className="text-12">
              还没有平台 API Key，请先到{" "}
              <Link href="/developer/keys">API Key 管理</Link> 生成一把
            </div>
          )}
        </Form.Item>
        <Form.Item label="模型列表">
          <Button
            loading={llmBusy}
            disabled={!llm?.configured}
            onClick={() => void loadModels()}
          >
            读取模型列表
          </Button>
          <div className="text-12 muted" style={{ marginTop: 4 }}>
            {`已读取 ${models.length} 个模型`}
          </div>
        </Form.Item>
        <Form.Item label="默认模型">
          <Select
            value={llmModel || undefined}
            placeholder="从模型列表选择"
            options={modelOptions}
            onChange={(value) => setLlmModel(value || "")}
            allowClear
          />
          <div className="text-12 muted" style={{ marginTop: 4 }}>
            「AI 写脚本」和「AI 填写参数」默认使用的模型
          </div>
        </Form.Item>
        <Form.Item>
          <Space>
            {llm?.model ? (
              <Button danger onClick={clearLlm}>
                清除默认模型
              </Button>
            ) : null}
            <Button type="primary" loading={llmBusy} onClick={() => void saveLlm()}>
              保存模型配置
            </Button>
          </Space>
        </Form.Item>
      </Form>
      {modal}
    </Panel>
  );
}
