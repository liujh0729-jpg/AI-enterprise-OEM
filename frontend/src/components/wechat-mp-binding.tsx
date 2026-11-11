"use client";

import { App, Badge, Button, Dropdown, Popconfirm, Spin, Tooltip } from "antd";
import { QrcodeOutlined, ReloadOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { wechatMpApi } from "@/api/wechat-mp";
import { RawImg } from "@/components/ui/raw-img";
import { useSession } from "@/lib/session";

type Status = Awaited<ReturnType<typeof wechatMpApi.status>>;
type Scene = Awaited<ReturnType<typeof wechatMpApi.bindScene>>;

const SCENE_POLL_MS = 3000;
const SCENE_POLL_WINDOW = 120_000;

/**
 * 顶栏「微信服务号」入口：扫码关注即绑定当前账号。
 * 未绑定自动生成一次性场景二维码（仅能绑定创建者，转发无效），每 3 秒回查绑定状态。
 */
export function WechatMpBindingEntry() {
  const { message } = App.useApp();
  const { me } = useSession();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(0);
  const [pollUntil, setPollUntil] = useState(0);
  const creatingRef = useRef(false);

  const loadStatus = useCallback(async () => {
    if (!me) return null;
    try {
      const next = await wechatMpApi.status();
      if (!next) return null;
      setStatus(next);
      setError("");
      if (next.bound) setScene(null);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : "微信服务号状态暂时不可用");
      return null;
    }
  }, [me]);

  const createScene = useCallback(async () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    setError("");
    try {
      const next = await wechatMpApi.bindScene();
      if (!next) throw new Error('二维码生成失败：服务端未返回结果');
      setScene(next);
      setNow(Date.now());
      setPollUntil(Date.now() + SCENE_POLL_WINDOW);
    } catch (err) {
      setScene(null);
      setError(
        err instanceof Error
          ? err.message
          : "二维码生成失败，请稍后重试或联系平台管理员",
      );
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void loadStatus().finally(() => setLoading(false));
  }, [open, loadStatus]);

  useEffect(() => {
    if (!me) return;
    void loadStatus();
  }, [me, loadStatus]);

  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open]);

  useEffect(() => {
    if (!open || !status?.enabled || status.bound || scene) return;
    void createScene();
  }, [open, status?.enabled, status?.bound, scene, createScene]);

  useEffect(() => {
    if (!open || !scene || status?.bound) return;
    const timer = setInterval(() => {
      if (Date.now() > pollUntil) return;
      void loadStatus();
    }, SCENE_POLL_MS);
    return () => clearInterval(timer);
  }, [open, scene, status?.bound, pollUntil, loadStatus]);

  const unbind = async () => {
    try {
      await wechatMpApi.unbind();
      message.success("已解绑微信服务号");
      setScene(null);
      await loadStatus();
      await createScene();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "解绑失败，请稍后重试");
    }
  };

  // 平台未配置/未启用服务号时不展示入口，避免给出无法完成的绑定引导。
  if (!me || !status?.enabled) return null;

  const remain = scene
    ? Math.max(0, Math.floor((new Date(scene.expiresAt).getTime() - now) / 1000))
    : 0;
  const remainText = `${String(Math.floor(remain / 60)).padStart(2, "0")}:${String(remain % 60).padStart(2, "0")}`;

  const content = (
    <div className="wechat-mp-pop">
      <div className="wechat-mp-pop-head">
        <span>微信服务号</span>
        {status?.accountName ? (
          <span className="text-12 muted">{status.accountName}</span>
        ) : null}
      </div>

      {loading ? (
        <div className="wechat-mp-pop-state">
          <Spin size="small" /> 正在读取绑定状态…
        </div>
      ) : status.bound && status.subscribed ? (
        <div className="wechat-mp-pop-state">
          <Badge status="success" text="已绑定并关注" />
          <div className="text-12 muted" style={{ marginTop: 6 }}>
            {status.nickname
              ? `微信昵称：${status.nickname}`
              : "当前微信已绑定此账号"}
            ，任务、审批与客服回复会通过服务号推送到微信。
          </div>
          {status.muted ? (
            <div className="text-12" style={{ marginTop: 6 }}>
              当前已暂停推送：在服务号内回复「订阅」即可恢复。
            </div>
          ) : null}
          <Popconfirm
            title="解绑微信服务号"
            description="解绑后将收不到微信推送，可随时重新扫码绑定。"
            okText="解绑"
            cancelText="取消"
            onConfirm={() => void unbind()}
          >
            <Button size="small" danger style={{ marginTop: 10 }}>
              解绑
            </Button>
          </Popconfirm>
        </div>
      ) : status.bound ? (
        <div className="wechat-mp-pop-state">
          <Badge status="warning" text="已绑定，但已取消关注" />
          <div className="text-12 muted" style={{ marginTop: 6 }}>
            重新关注服务号后才能继续接收推送。请扫描下方二维码重新关注。
          </div>
          {scene ? (
            <>
              <RawImg
                className="wechat-mp-qr"
                src={scene.qrUrl}
                alt="微信服务号绑定二维码"
              />
              <div className="text-12 muted">
                二维码 {remainText} 后失效，仅能绑定当前账号
              </div>
              <Button
                size="small"
                icon={<ReloadOutlined />}
                loading={creating}
                onClick={() => void createScene()}
              >
                重新生成
              </Button>
            </>
          ) : (
            <Button
              size="small"
              icon={<QrcodeOutlined />}
              loading={creating}
              onClick={() => void createScene()}
            >
              生成二维码
            </Button>
          )}
          <Popconfirm
            title="解绑微信服务号"
            okText="解绑"
            cancelText="取消"
            onConfirm={() => void unbind()}
          >
            <Button size="small" type="text" danger>
              解绑
            </Button>
          </Popconfirm>
        </div>
      ) : (
        <div className="wechat-mp-pop-state">
          <div className="text-12 muted" style={{ marginBottom: 8 }}>
            使用微信「扫一扫」关注服务号并绑定当前账号，即可在手机上处理待办、审批与客服回复。
          </div>
          {scene ? (
            <RawImg
              className="wechat-mp-qr"
              src={scene.qrUrl}
              alt="微信服务号绑定二维码"
            />
          ) : (
            <div className="wechat-mp-pop-qr-empty">
              {creating ? <Spin size="small" /> : null}
            </div>
          )}
          {scene ? (
            <div className="text-12 muted">
              二维码 {remainText} 后失效；扫码后请等待状态自动刷新。
            </div>
          ) : null}
          {scene && now > pollUntil ? (
            <div className="text-12" style={{ color: "#ff7d00" }}>
              仍未检测到绑定？请关闭面板后重新打开，或重新生成二维码。
            </div>
          ) : null}
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={creating}
            onClick={() => void createScene()}
          >
            {scene ? "重新生成二维码" : "生成绑定二维码"}
          </Button>
        </div>
      )}

      {error ? (
        <div className="text-12" style={{ color: "#f53f3f", marginTop: 8 }}>
          {error}
        </div>
      ) : null}
    </div>
  );

  return (
    <Dropdown
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setScene(null);
          setError("");
        }
      }}
      trigger={["click"]}
      popupRender={() => content}
      placement="bottomRight"
    >
      <Tooltip title={status?.bound && status.subscribed ? "微信服务号（已绑定）" : "微信服务号"}>
        <Button
          type="text"
          size="small"
          style={{ opacity: 0.65 }}
          aria-label="微信服务号"
          icon={
            <Badge
              dot={Boolean(status?.bound && status.subscribed)}
              color="#00b96b"
              offset={[2, -2]}
            >
              <QrcodeOutlined />
            </Badge>
          }
        />
      </Tooltip>
    </Dropdown>
  );
}
