"use client";

import { Button, Input, Modal, Space, Steps, Tag } from "antd";
import { useState } from "react";
import { communityApi } from "@/api/community";
import { Notice } from "@/components/ui/panel";
import type { CommunityCredentialStatus } from "@enterprise/contracts";

/**
 * 「连接 Comfy Cloud」引导：把上游的四件事实一次性说清楚，再收 Key。
 * 顺序不能变——没有付费订阅就创建不出能用的 Key，先让人确认套餐再粘贴，
 * 否则只会得到一句 401「Key 无效」，用户以为是复制错了。
 */
export function ComfyConnectModal({
  open,
  status,
  onClose,
  onChange,
}: {
  open: boolean;
  status: CommunityCredentialStatus | null;
  onClose: () => void;
  onChange: (status: CommunityCredentialStatus) => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /** Key 只在「提交那一次」留在输入框里：成功即清空，失败也清空（避免截图与历史记录留明文）。 */
  const clear = () => {
    setApiKey("");
    setBusy(false);
    setError("");
  };

  const save = async () => {
    const value = apiKey.trim();
    if (value.length < 8) {
      setError("请粘贴完整的 Comfy Cloud API Key（至少 8 位）");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await communityApi.saveCredential({ body: { apiKey: value } });
      if (!data) throw new Error("保存失败，请稍后重试");
      onChange(data);
      clear();
    } catch (caught) {
      setError((caught as Error).message || "保存失败");
      // 失败也要把上游判定（Key 无效 / 订阅未激活）带回界面：lastError 已由后端落库
      const latest = await communityApi.connectStatus().catch(() => null);
      if (latest) onChange(latest);
      setApiKey("");
    } finally {
      setBusy(false);
    }
  };

  const retest = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await communityApi.testCredential();
      if (data) onChange(data);
      else setError("校验失败，请稍后重试");
    } catch (caught) {
      setError((caught as Error).message || "校验失败");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await communityApi.clearCredential();
      if (data) onChange(data);
      clear();
    } catch (caught) {
      setError((caught as Error).message || "解绑失败");
    } finally {
      setBusy(false);
    }
  };

  const verifiedText = status?.verifiedAt
    ? new Date(status.verifiedAt).toLocaleString("zh-CN", { hour12: false })
    : "";

  return (
    <Modal
      open={open}
      title="连接 Comfy Cloud"
      width={720}
      onCancel={() => {
        clear();
        onClose();
      }}
      footer={
        <Space>
          {status?.connected ? (
            <>
              <Button onClick={retest} loading={busy}>
                重新校验
              </Button>
              <Button danger onClick={disconnect} loading={busy}>
                解除绑定
              </Button>
            </>
          ) : null}
          <Button type="primary" onClick={save} loading={busy}>
            保存并校验
          </Button>
        </Space>
      }
    >
      <Notice variant="info">
        创意社区的工作流都跑在官方 Comfy Cloud 上：用的是<b>你自己的 API Key 和你自己的
        Comfy 积分</b>，本站不代付算力、也拿不到你的 Key 之外的任何账号权限。Key
        以密文存在本站数据库里，任何页面都不会再显示明文。
      </Notice>
      <Steps
        orientation="vertical"
        size="small"
        current={status?.connected ? 4 : 0}
        style={{ margin: "16px 0 8px" }}
        items={[
          {
            title: "注册 Comfy Cloud 账号",
            content: (
              <span className="text-12">
                打开{" "}
                <a href="https://platform.comfy.org" target="_blank" rel="noreferrer">
                  platform.comfy.org
                </a>{" "}
                用 Google / 邮箱注册（同一个账号也能在 comfy.org 里直接用）。
              </span>
            ),
          },
          {
            title: "开通付费订阅（免费套餐不含 API 访问）",
            content: (
              <span className="text-12">
                API 调用需要付费的 Comfy Cloud 订阅，套餐决定并发与每月可跑的积分量：
                <a href={status?.pricingUrl || "https://www.comfy.org/pricing"} target="_blank" rel="noreferrer">
                  查看官方定价
                </a>
                。订阅停掉后 Key 仍在，但上游会直接拒 429。
              </span>
            ),
          },
          {
            title: "创建 API Key",
            content: (
              <span className="text-12">
                在 platform.comfy.org 的「API Keys」里点{" "}
                <Tag>+ New</Tag> 创建；<b>密钥只在创建成功那一刻显示一次</b>，当时没存就只能重建一把。
              </span>
            ),
          },
          {
            title: "粘贴到下面并保存",
            content: (
              <span className="text-12">
                保存时本站会立刻拿它打一次上游探活，通过了才算连接成功；探活失败也会记下原因，
                方便你判断是 Key 错了还是订阅没生效。
              </span>
            ),
          },
        ]}
      />
      {status?.connected ? (
        <Notice variant="success">
          已连接（Key <b>{status.keyMask}</b>）
          {verifiedText ? `，最近校验成功：${verifiedText}` : ""}
        </Notice>
      ) : null}
      {status?.connected && status.lastError ? (
        <Notice variant="warn">最近一次上游报错：{status.lastError}</Notice>
      ) : null}
      <div style={{ marginTop: 12 }}>
        <Input.Password
          value={apiKey}
          maxLength={400}
          placeholder="粘贴 Comfy Cloud API Key（形如 eyJ...，只显示一次所以只能从你保存的地方贴）"
          onChange={(event) => setApiKey(event.target.value)}
          onPressEnter={() => void save()}
          disabled={busy}
        />
        <div className="text-12 muted" style={{ marginTop: 6 }}>
          这把 Key 只用于 Comfy Cloud；本站的「API Key 管理」是另一套（调用本站开放接口的），两者互不相干。
        </div>
        {error ? (
          <div style={{ marginTop: 8 }}>
            <Notice variant="error">{error}</Notice>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
