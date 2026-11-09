"use client";

import { App, Button, Empty, Modal, Popconfirm, Select, Space, Tag } from "antd";
import { useCallback, useEffect, useState } from "react";
import type {
  ContentDigitalAsset,
  ContentSharedAsset,
  ContentShareTarget,
} from "@enterprise/contracts";
import { contentApi } from "@/api/content";
import { Notice, Panel } from "@/components/ui/panel";

function errText(error: unknown) {
  return (error as Error)?.message || "操作失败";
}

const TYPE_LABEL: Record<string, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
  file: "文件",
};

/** 把一条数字资产共享给同一组织内的账号（已认证企业或服务商）：多选用户，支持全选。 */
export function ShareAssetModal({
  asset,
  onClose,
  onShared,
}: {
  asset: ContentDigitalAsset | null;
  onClose: () => void;
  onShared: () => void;
}) {
  const { message } = App.useApp();
  const [targets, setTargets] = useState<ContentShareTarget[]>([]);
  const [orgName, setOrgName] = useState("");
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!asset) return;
    setPicked([]);
    setLoading(true);
    setError("");
    contentApi
      .shareTargets()
      .then((data) => {
        setTargets(data?.users || []);
        setOrgName(data?.orgName || "");
      })
      .catch((caught: unknown) => {
        setTargets([]);
        setError(errText(caught));
      })
      .finally(() => setLoading(false));
  }, [asset]);

  const share = async () => {
    if (!asset) return;
    if (!picked.length) {
      message.warning("请选择要共享到的组织内用户");
      return;
    }
    setSaving(true);
    try {
      const result = await contentApi.shareAsset({
        body: {
          asset: {
            id: String(asset.id),
            name: asset.name,
            type: asset.type,
            size: asset.fileSize,
            url: asset.url,
          },
          targetUserIds: picked,
        },
      });
      message.success(`已共享给 ${result?.shared || picked.length} 个用户`);
      onShared();
      onClose();
    } catch (caught) {
      message.error(errText(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={Boolean(asset)}
      title={`共享资料 · ${asset?.name || ""}`}
      width={620}
      okText="共享"
      confirmLoading={saving}
      onOk={() => void share()}
      onCancel={onClose}
      destroyOnHidden
    >
      {error ? <Notice variant="error">{error}</Notice> : null}
      {!loading && !targets.length ? (
        <Notice variant="warn">
          当前账号不是已认证企业账号、也不是服务商在职人员，或组织内还没有其他在职成员；只有同组织内用户之间可以共享资料。
        </Notice>
      ) : null}
      {targets.length ? (
        <Space orientation="vertical" size={10} style={{ width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="field-label" style={{ marginBottom: 0 }}>
              {`共享给 ${orgName || "本组织"} 的用户`}
            </span>
            <Button
              size="small"
              onClick={() =>
                setPicked(
                  picked.length === targets.length
                    ? []
                    : targets.map((item) => item.userId),
                )
              }
            >
              {picked.length === targets.length ? "取消全选" : "全选"}
            </Button>
            <span className="text-12 muted" style={{ marginLeft: "auto" }}>
              {`已选 ${picked.length} / ${targets.length}`}
            </span>
          </div>
          <Select
            mode="multiple"
            style={{ width: "100%" }}
            value={picked}
            onChange={(values: string[]) => setPicked(values)}
            optionFilterProp="label"
            placeholder="可多选组织内用户"
            options={targets.map((item) => ({
              value: item.userId,
              label: `${item.name}${item.department ? `（${item.department}）` : ""}${item.phone ? ` · ${item.phone}` : ""}`,
            }))}
          />
          <span className="text-12 muted">
            资料仍存放在 AIPDD 数字资产里，本系统只记录「这条资料共享给了哪个账号」。
          </span>
        </Space>
      ) : null}
    </Modal>
  );
}

function SharedRow({
  row,
  onRevoke,
}: {
  row: ContentSharedAsset;
  onRevoke?: () => void;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--line, #f0f0f0)",
        borderRadius: 10,
        padding: "10px 12px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
      }}
    >
      <strong>{row.assetName || row.assetId}</strong>
      <Tag>{TYPE_LABEL[row.assetType] || row.assetType}</Tag>
      <span className="text-12 muted">
        {row.direction === "SENT"
          ? `共享给：${row.targetName}`
          : `来自：${row.ownerName}`}
      </span>
      <span className="text-12 muted">
        {row.createdAt.replace("T", " ").slice(0, 16)}
      </span>
      <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        {row.assetUrl ? (
          <Button
            type="link"
            size="small"
            onClick={() =>
              window.open(row.assetUrl, "_blank", "noopener,noreferrer")
            }
          >
            打开
          </Button>
        ) : null}
        {onRevoke ? (
          <Popconfirm
            title="取消这条共享？"
            okText="取消共享"
            cancelText="保留"
            onConfirm={onRevoke}
          >
            <Button type="link" size="small" danger>
              取消共享
            </Button>
          </Popconfirm>
        ) : null}
      </span>
    </div>
  );
}

/** 共享资料：收到的 / 我共享的；共享动作在「数字资产」页签的资产卡上发起。 */
export function SharedAssetsPanel({ onChanged }: { onChanged?: () => void }) {
  const { message } = App.useApp();
  const [sent, setSent] = useState<ContentSharedAsset[]>([]);
  const [received, setReceived] = useState<ContentSharedAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    contentApi
      .sharedAssets()
      .then((data) => {
        setSent(data?.sent || []);
        setReceived(data?.received || []);
        setError("");
      })
      .catch((caught: unknown) => setError(errText(caught)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const revoke = async (row: ContentSharedAsset) => {
    try {
      await contentApi.unshareAsset({ params: { id: String(row.id) } });
      message.success("已取消共享");
      load();
      onChanged?.();
    } catch (caught) {
      message.error(errText(caught));
    }
  };

  return (
    <>
      {error ? <Notice variant="error">{`共享资料读取失败：${error}`}</Notice> : null}
      <Panel
        title="收到的共享"
        titleExtra={
          <span className="text-12 muted">
            同组织其他账号共享给你的资料；文件仍归上传者
          </span>
        }
      >
        {loading ? null : received.length ? (
          <div style={{ display: "grid", gap: 8 }}>
            {received.map((row) => (
              <SharedRow key={row.id} row={row} />
            ))}
          </div>
        ) : (
          <Empty description="还没有收到别人共享的资料" />
        )}
      </Panel>
      <Panel
        title="我共享的"
        titleExtra={
          <span className="text-12 muted">
            在「数字资产」页签点资产卡上的「共享」，选择同组织内用户（可全选）
          </span>
        }
      >
        {loading ? null : sent.length ? (
          <div style={{ display: "grid", gap: 8 }}>
            {sent.map((row) => (
              <SharedRow key={row.id} row={row} onRevoke={() => void revoke(row)} />
            ))}
          </div>
        ) : (
          <Empty description="还没有共享出去的资料" />
        )}
      </Panel>
    </>
  );
}