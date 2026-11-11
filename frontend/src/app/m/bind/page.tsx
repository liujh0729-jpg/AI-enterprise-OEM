"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { App, Badge, Button, Spin } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { wechatMpApi } from "@/api/wechat-mp";
import { RawImg } from "@/components/ui/raw-img";
import { useSession } from "@/lib/session";
import { MobileShell } from "../_components/mobile-common";

type Status = Awaited<ReturnType<typeof wechatMpApi.status>>;
type Scene = Awaited<ReturnType<typeof wechatMpApi.bindScene>>;

const SCENE_POLL_MS = 3000;
const SCENE_POLL_WINDOW = 120_000;

const REASON_TEXT: Record<string, string> = {
  unbound: "当前微信尚未绑定平台账号。请先登录账号，再按下方指引完成绑定。",
  expired: "微信授权已失效，请重新登录后再试。",
  state: "安全校验未通过，可能是页面停留过久或重复打开，请重新进入。",
  failed: "微信授权未完成，可重试或使用账号密码登录。",
};

/** 微信内登录/绑定引导（`/m/bind`）：说明原因并给出绑定二维码或登录入口。 */
export default function MobileBindPage() {
  const params = useSearchParams();
  const reason = params.get("reason") || "";
  const { message } = App.useApp();
  const { me, loading: sessionLoading } = useSession();
  const [status, setStatus] = useState<Status | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(0);
  const [pollUntil, setPollUntil] = useState(0);

  const loadStatus = useCallback(async () => {
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
  }, []);

  const createScene = useCallback(async () => {
    setCreating(true);
    setError("");
    try {
      const next = await wechatMpApi.bindScene();
      if (!next) throw new Error("二维码生成失败：服务端未返回结果");
      setScene(next);
      setNow(Date.now());
      setPollUntil(Date.now() + SCENE_POLL_WINDOW);
    } catch (err) {
      setScene(null);
      setError(err instanceof Error ? err.message : "二维码生成失败，请稍后重试");
    } finally {
      setCreating(false);
    }
  }, []);

  useEffect(() => {
    if (sessionLoading || !me) return;
    setLoading(true);
    void loadStatus().finally(() => setLoading(false));
  }, [sessionLoading, me, loadStatus]);

  useEffect(() => {
    if (!me || !status?.enabled || status.bound || scene) return;
    void createScene();
  }, [me, status?.enabled, status?.bound, scene, createScene]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!me || !scene || status?.bound) return;
    const timer = window.setInterval(() => {
      if (Date.now() > pollUntil) return;
      void loadStatus();
    }, SCENE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [me, scene, status?.bound, pollUntil, loadStatus]);

  const remain = scene
    ? Math.max(0, Math.floor((new Date(scene.expiresAt).getTime() - now) / 1000))
    : 0;
  const remainText = `${String(Math.floor(remain / 60)).padStart(2, "0")}:${String(remain % 60).padStart(2, "0")}`;

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

  const loginHref = `/login?next=${encodeURIComponent("/m/inbox")}`;

  return (
    <MobileShell title="微信服务号" sub="登录与绑定指引">
      {sessionLoading || loading ? (
        <div className="m-loading">
          <Spin />
        </div>
      ) : !me ? (
        <div className="m-view">
          <div className="m-empty">
            <div className="m-empty-icon">🔐</div>
            <div className="m-empty-title">需要登录</div>
            <p className="m-empty-text">
              {REASON_TEXT[reason] ||
                "登录后即可绑定微信服务号，并在手机端接收与处理待办、审批和客服回复。"}
            </p>
            <div className="m-inline-actions">
              <Button type="primary" href={loginHref}>
                账号登录
              </Button>
            </div>
          </div>
          <div className="m-card">
            <div className="m-card-title">如何绑定</div>
            <p className="m-hint" style={{ marginTop: 0 }}>
              1. 使用账号密码登录本平台；
            </p>
            <p className="m-hint">2. 点击顶栏右上角的微信二维码图标；</p>
            <p className="m-hint">
              3. 用微信扫描弹出的二维码并关注服务号，即可完成绑定。
            </p>
          </div>
        </div>
      ) : !status?.enabled ? (
        <div className="m-view">
          <div className="m-empty">
            <div className="m-empty-title">平台尚未启用微信服务号</div>
            <p className="m-empty-text">
              请联系平台管理员在「平台管理后台 → 微信服务号设置」完成配置后再绑定。
            </p>
            <Button href="/m/inbox">返回消息中心</Button>
          </div>
        </div>
      ) : status.bound && status.subscribed ? (
        <div className="m-view">
          <div className="m-empty">
            <div className="m-empty-icon">✅</div>
            <div className="m-empty-title">已绑定并关注</div>
            <p className="m-empty-text">
              {status.nickname ? `微信昵称：${status.nickname}。` : ""}
              任务、审批与客服回复会通过服务号推送到微信。
            </p>
            <div className="m-inline-actions">
              <Button type="primary" href="/m/inbox">
                查看消息
              </Button>
              <Button danger onClick={() => void unbind()}>
                解绑
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="m-view">
          {reason ? (
            <div className="m-card">
              <div className="m-card-title">提示</div>
              <p className="m-hint" style={{ marginTop: 0 }}>
                {REASON_TEXT[reason] || "微信授权未完成，请按下方指引重新绑定。"}
              </p>
            </div>
          ) : null}
          <div className="m-card">
            <div className="m-card-title">
              <span>{status.bound ? "重新关注服务号" : "绑定当前账号"}</span>
              <Badge
                status={status.bound ? "warning" : "processing"}
                text={status.bound ? "已绑定，未关注" : "待绑定"}
              />
            </div>
            <p className="m-hint" style={{ marginTop: 0 }}>
              在微信内长按下方二维码并「识别图中二维码」，关注服务号后即自动完成绑定；
              也可请同事用微信扫码。二维码仅能绑定当前登录账号，转发无效。
            </p>
            <div style={{ textAlign: "center", marginTop: 10 }}>
              {scene ? (
                <RawImg
                  className="wechat-mp-qr"
                  src={scene.qrUrl}
                  alt="微信服务号绑定二维码"
                />
              ) : (
                <div className="wechat-mp-pop-qr-empty" style={{ margin: "0 auto" }}>
                  {creating ? <Spin size="small" /> : null}
                </div>
              )}
              {scene ? (
                <div className="m-hint" style={{ marginTop: 6 }}>
                  二维码 {remainText} 后失效，关注后状态会自动刷新。
                </div>
              ) : null}
            </div>
            <div className="m-inline-actions" style={{ marginTop: 10 }}>
              <Button
                icon={<ReloadOutlined />}
                loading={creating}
                onClick={() => void createScene()}
              >
                {scene ? "重新生成二维码" : "生成绑定二维码"}
              </Button>
              <Button href="/m/inbox">返回消息中心</Button>
            </div>
            {scene && now > pollUntil && !status.bound ? (
              <p className="m-hint" style={{ color: "#ff7d00" }}>
                仍未检测到绑定？请重新生成二维码，或在电脑端登录后从未绑定状态重新扫码。
              </p>
            ) : null}
            {error ? (
              <p className="m-hint" style={{ color: "#f53f3f" }}>
                {error}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </MobileShell>
  );
}
