"use client";

import { CopyOutlined, LinkOutlined, TeamOutlined } from "@ant-design/icons";
import { App, Button, Descriptions, Space, Statistic } from "antd";
import { useCallback, useEffect, useState } from "react";
import { inviteApi, type InviteInfo } from "@/api/invite";
import { pointsPublicApi } from "@/api/points";
import { Notice, PageHero, Panel, StatCard, StatGrid } from "@/components/ui/panel";
import { joinSiteUrl } from "@/lib/site-url";
import { useSiteBase } from "@/lib/site-brand";

/**
 * 我的邀请（/invite）：每个用户都有一把专属邀请码。
 * 分享给好友，对方注册时填写（非必填）即建立邀请关系；本页同时展示
 * 自己是被谁邀请注册的，以及已成功邀请的人数。邀请码非机密，可对外分享。
 */

/** 公开配置里的邀请奖励字段（0 = 后台未开启该项）。 */
type InviteReward = {
  signupBonus: number;
  inviteRewardSignup: number;
  inviteRechargePercent: number;
  inviteRechargeCap: number;
  inviteDailyCount: number;
};
export default function InvitePage() {
  const { message } = App.useApp();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [reward, setReward] = useState<InviteReward | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      setInfo(await inviteApi.me());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 邀请奖励规则走公开配置：后台把各项奖励配成 0 时整块不展示
  useEffect(() => {
    let cancelled = false;
    pointsPublicApi
      .config()
      .then((cfg) => {
        if (!cancelled) setReward(cfg);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const hasReward =
    reward !== null &&
    (reward.inviteRewardSignup > 0 || reward.inviteRechargePercent > 0 || reward.signupBonus > 0);

  const copy = async (text: string, label: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      message.success(`${label}已复制`);
    } catch {
      message.warning("浏览器不允许剪贴板，请手动复制");
    }
  };

  // 邀请链接发给外部用户，必须是绝对地址：域名跟站点配置走（没配则按当前访问域名）
  const siteBase = useSiteBase();
  const registerLink =
    info?.inviteCode && siteBase
      ? joinSiteUrl(siteBase, `/login?invite=${info.inviteCode}`)
      : "";

  return (
    <>
      <PageHero
        title="我的邀请"
        desc="每位用户都有一把专属邀请码：好友注册时填写你的邀请码（非必填），即建立邀请关系；你能看到自己是被谁邀请注册的，以及已成功邀请的人数。"
      />

      <Panel title="我的邀请码">
        {loadError ? (
          <Notice variant="error">
            {loadError} <Button size="small" onClick={() => void reload()}>重试</Button>
          </Notice>
        ) : loading ? (
          <span className="muted text-12">加载中…</span>
        ) : (
          <Space orientation="vertical" size={14} style={{ width: "100%" }}>
            <Space size={10} wrap>
              <span
                style={{
                  fontFamily: "monospace",
                  fontSize: 22,
                  fontWeight: 700,
                  letterSpacing: 4,
                  padding: "6px 18px",
                  border: "1px solid var(--line, #d9d9d9)",
                  borderRadius: 8,
                  background: "rgba(0,0,0,0.02)",
                }}
              >
                {info?.inviteCode || "—"}
              </span>
              <Button icon={<CopyOutlined aria-hidden />} onClick={() => void copy(info?.inviteCode || "", "邀请码")}>
                复制邀请码
              </Button>
              <Button icon={<LinkOutlined aria-hidden />} disabled={!registerLink} onClick={() => void copy(registerLink, "注册链接")}>
                复制注册链接
              </Button>
            </Space>
            {hasReward && reward ? (
              <div style={{ width: "100%" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)", marginBottom: 10 }}>
                  邀请奖励
                </div>
                <StatGrid>
                  {reward.inviteRewardSignup > 0 ? (
                    <StatCard
                      label="邀请注册奖励"
                      value={`+${reward.inviteRewardSignup} 积分`}
                      hint={
                        reward.inviteDailyCount > 0
                          ? `每成功邀请 1 位好友注册即得，每日最多 ${reward.inviteDailyCount} 人`
                          : "每成功邀请 1 位好友注册即得"
                      }
                    />
                  ) : null}
                  {reward.inviteRechargePercent > 0 ? (
                    <StatCard
                      label="好友首充返奖"
                      value={`${reward.inviteRechargePercent}%`}
                      hint={
                        reward.inviteRechargeCap > 0
                          ? `按好友首充到账积分计算，单人最高 ${reward.inviteRechargeCap} 积分`
                          : "按好友首充到账积分计算"
                      }
                    />
                  ) : null}
                  {reward.signupBonus > 0 ? (
                    <StatCard
                      label="好友注册礼"
                      value={`${reward.signupBonus} 积分`}
                      hint="好友注册即得，可直接用于站内消费"
                    />
                  ) : null}
                </StatGrid>
                <div className="muted text-12" style={{ marginTop: 10 }}>
                  奖励自动发放到你的积分账户（首充返奖在好友完成首充后才到账），可在「积分中心 → 流水」查看。
                </div>
              </div>
            ) : null}
            <Descriptions column={1} size="small" bordered style={{ maxWidth: 560 }}>
              <Descriptions.Item label="我是被谁邀请的">
                {info?.invitedBy ? (
                  <span className="mono text-12">{info.invitedBy.username}</span>
                ) : (
                  "——（自主注册，未使用邀请码）"
                )}
              </Descriptions.Item>
            </Descriptions>
            <Space size={40}>
              <Statistic
                title="已成功邀请"
                value={info?.invitedCount ?? 0}
                suffix="人"
                prefix={<TeamOutlined aria-hidden />}
                styles={{ content: { fontSize: 22 } }}
              />
            </Space>
          </Space>
        )}
      </Panel>
    </>
  );
}
