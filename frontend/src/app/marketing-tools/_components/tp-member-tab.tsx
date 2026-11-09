"use client";

import { Button, Input, Radio, Select, Space } from "antd";
import type { ReactNode } from "react";
import { useState } from "react";
import { tpApi } from "@/api/tp";
import { Notice, Panel, TabStrip } from "@/components/ui/panel";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { TP_ID_KEYS, taskText, tpPick } from "./tp-common";
import { TpAccountPanel } from "./tp-account-panel";
import { TpTaskPanel } from "./tp-task-panel";
import {
  TpAccountPicker,
  TpBatchForm,
  TpFieldLabel,
  TpObjectWriter,
  TpReadPanel,
  useTpAccounts,
} from "./tp-ui";

type View =
  | "settings"
  | "members"
  | "coupons"
  | "messaging"
  | "rta"
  | "tasks"
  | "guide";

const TABS = [
  { key: "settings", label: "连接设置" },
  { key: "members", label: "会员与积分" },
  { key: "coupons", label: "优惠券与权益" },
  { key: "messaging", label: "短信与邮件" },
  { key: "rta", label: "广告人群" },
  { key: "tasks", label: "任务台账" },
  { key: "guide", label: "使用说明" },
];

/** 卡片名：工具视图里每个页签都用它做面板标题。 */
const TOOL_TITLE = "腾讯企点·会员与触达";

/** 卡三：腾讯企点 · 会员与触达（LM + MA + RTA）。 */
export function TpMemberTab() {
  const [view, setView] = useState<View>("settings");
  const tabs = (
    <TabStrip items={TABS} value={view} onChange={(key) => setView(key as View)} />
  );

  if (view === "settings") {
    return (
      <TpAccountPanel
        products={["LM", "MA", "RTA"]}
        tabs={tabs}
        title={TOOL_TITLE}
        tip="会员积分用 LM、短信邮件用 MA、广告人群用 RTA，一个产品一套凭据。"
      />
    );
  }
  if (view === "tasks") {
    return <TpTaskPanel products={["LM", "MA", "RTA"]} tabs={tabs} title={TOOL_TITLE} />;
  }
  if (view === "members") {
    return <MembersPanel tabs={tabs} />;
  }
  if (view === "coupons") {
    return <CouponsPanel tabs={tabs} />;
  }
  if (view === "messaging") {
    return <MessagingPanel tabs={tabs} />;
  }
  if (view === "rta") {
    return <RtaPanel tabs={tabs} />;
  }
  return <MemberGuide tabs={tabs} />;
}

function MembersPanel({ tabs }: { tabs: ReactNode }) {
  const { accounts, error: accountsError } = useTpAccounts();
  const [accountId, setAccountId] = useState(0);
  const [programId, setProgramId] = useState("");
  const [point, setPoint] = useState("1");
  const [eventName, setEventName] = useState("本系统发放");

  return (
    <Panel title={TOOL_TITLE} extra={tabs}>
      <div style={{ display: "grid", gap: 22 }}>
        <TpAccountPicker
          accounts={accounts}
          error={accountsError}
          product="LM"
          value={accountId}
          onChange={setAccountId}
          onGoSettings={() => undefined}
        />
        <Space size={8} wrap>
          <Input
            style={{ width: 220 }}
            value={programId}
            placeholder="会员计划ID（查积分、发积分用）"
            onChange={(event) => setProgramId(event.target.value)}
          />
        </Space>

        <TpReadPanel
          title="会员计划"
          loadRows={async (input) =>
            (await tpApi.lmPrograms({
              query: { accountId, page: input.page, pageSize: input.pageSize, keyword: input.keyword },
            }))
          }
        />
        <TpReadPanel
          title="会员清单"
          loadRows={async (input) =>
            (await tpApi.lmMembers({
              body: { accountId, keyword: input.keyword, page: input.page, pageSize: input.pageSize },
            }))
          }
        />
        <TpReadPanel
          title="积分记录"
          loadRows={async (input) =>
            (await tpApi.lmPoints({
              body: {
                accountId,
                programId,
                keyword: input.keyword,
                page: input.page,
                pageSize: input.pageSize,
              },
            }))
          }
        />

        <TpObjectWriter
          index={1}
          title="新建 / 编辑会员"
          actionLabel="保存会员"
          accountId={accountId}
          submit={async (payload) => {
            await tpApi.lmSaveMember({ body: payload });
            return "会员已保存";
          }}
          hint="字段名以企点「会员」接口为准（如会员ID、手机号、计划ID等）。"
        />
        <TpObjectWriter
          index={2}
          title="启用 / 停用会员"
          actionLabel="调整状态"
          accountId={accountId}
          submit={async (payload) => {
            await tpApi.lmMemberStatus({ body: payload });
            return "会员状态已调整";
          }}
        />

        <TpBatchForm
          index={3}
          action="Tp_lmIssuePoints"
          actionLabel="发放积分"
          datasetKey="lm_point_issue"
          requiredKeys={["memberId"]}
          accountId={accountId}
          params={{
            programId,
            point: Number(point) || 0,
            eventName,
          }}
          paramsReady={Boolean(programId.trim()) && Number(point) > 0}
          paramsEditor={
            <div style={{ display: "grid", gap: 8 }}>
              <div>
                <TpFieldLabel>每行发放积分</TpFieldLabel>
                <Input
                  style={{ width: 160 }}
                  value={point}
                  placeholder="例如 10"
                  onChange={(event) => setPoint(event.target.value)}
                />
              </div>
              <div>
                <TpFieldLabel>积分事件名</TpFieldLabel>
                <Input
                  style={{ width: 260 }}
                  value={eventName}
                  onChange={(event) => setEventName(event.target.value)}
                />
              </div>
            </div>
          }
          submit={async (body) =>
            taskText(await tpApi.lmIssuePoints({ body }))
          }
        />
      </div>
    </Panel>
  );
}

function CouponsPanel({ tabs }: { tabs: ReactNode }) {
  const { accounts, error: accountsError } = useTpAccounts();
  const [accountId, setAccountId] = useState(0);
  const [couponId, setCouponId] = useState("");

  return (
    <Panel title={TOOL_TITLE} extra={tabs}>
      <div style={{ display: "grid", gap: 22 }}>
        <TpAccountPicker
          accounts={accounts}
          error={accountsError}
          product="LM"
          value={accountId}
          onChange={setAccountId}
          onGoSettings={() => undefined}
        />
        <TpReadPanel
          title="券模板"
          tip="点一行可取券模板ID，填到下面的发券名单里。"
          loadRows={async (input) =>
            (await tpApi.lmCoupons({
              query: { accountId, page: input.page, pageSize: input.pageSize, keyword: input.keyword },
            }))
          }
          action={(row) => (
            <Button
              size="small"
              onClick={() => {
                const id = tpPick(row, TP_ID_KEYS);
                if (id) setCouponId(id);
              }}
            >
              选这张券
            </Button>
          )}
        />
        <TpBatchForm
          index={1}
          action="Tp_lmCouponIssue"
          actionLabel="发放优惠券"
          datasetKey="lm_coupon_issue"
          requiredKeys={["memberId"]}
          accountId={accountId}
          params={{ couponId }}
          paramsReady={Boolean(couponId.trim())}
          paramsEditor={
            <div>
              <TpFieldLabel>券模板ID</TpFieldLabel>
              <Input
                style={{ width: 260 }}
                value={couponId}
                placeholder="可从上面的券列表带入"
                onChange={(event) => setCouponId(event.target.value)}
              />
            </div>
          }
          submit={async (body) =>
            taskText(await tpApi.lmCouponIssue({ body }))
          }
        />
        <Notice variant="info">
          券包、外部权益与库存目前只有控制台操作入口；本系统只做券模板查询与发券（按企点开放接口）。
        </Notice>
      </div>
    </Panel>
  );
}

function MessagingPanel({ tabs }: { tabs: ReactNode }) {
  const { accounts, error: accountsError } = useTpAccounts();
  const [accountId, setAccountId] = useState(0);
  const [channelType, setChannelType] = useState<"sms" | "email">("sms");
  const [templateId, setTemplateId] = useState("");
  const [taskName, setTaskName] = useState("");
  const { request, modal } = usePasswordConfirm();

  const removeShortLink = (row: Record<string, unknown>) => {
    const linkId = tpPick(row, TP_ID_KEYS);
    if (!linkId) return;
    request({
      title: "删除短链",
      content: `删除短链 ${linkId} 后原链接立即失效。`,
      okText: "确认删除",
      danger: true,
      onOk: async () => {
        await tpApi.maDeleteShortLink({ body: { accountId, linkId } });
      },
    });
  };

  return (
    <Panel title={TOOL_TITLE} extra={tabs}>
      <div style={{ display: "grid", gap: 22 }}>
        <TpAccountPicker
          accounts={accounts}
          error={accountsError}
          product="MA"
          value={accountId}
          onChange={setAccountId}
          onGoSettings={() => undefined}
        />
        <TpReadPanel
          title="通道"
          loadRows={async (input) =>
            (await tpApi.maChannels({
              query: { accountId, page: input.page, pageSize: input.pageSize, keyword: input.keyword },
            }))
          }
        />
        <TpReadPanel
          title="发件人"
          loadRows={async (input) =>
            (await tpApi.maSenders({
              query: { accountId, page: input.page, pageSize: input.pageSize, keyword: input.keyword },
            }))
          }
        />
        <TpReadPanel
          title="模板"
          loadRows={async (input) =>
            (await tpApi.maTemplates({
              query: { accountId, page: input.page, pageSize: input.pageSize, keyword: input.keyword },
            }))
          }
          action={(row) => (
            <Button
              size="small"
              onClick={() => {
                const id = tpPick(row, TP_ID_KEYS);
                if (id) setTemplateId(id);
              }}
            >
              选为模板
            </Button>
          )}
        />
        <TpObjectWriter
          index={1}
          title="新建短信 / 邮件模板"
          actionLabel="创建模板"
          accountId={accountId}
          submit={async (payload) => {
            await tpApi.maCreateTemplate({ body: payload });
            return "模板已创建";
          }}
          hint="字段名以企点「创建模板」接口为准；短信与邮件的模板字段不同，按接口文档填。"
        />

        <TpReadPanel
          title="短链"
          loadRows={async (input) =>
            (await tpApi.maShortLinks({
              query: { accountId, page: input.page, pageSize: input.pageSize, keyword: input.keyword },
            }))
          }
          action={(row) => (
            <Button size="small" danger onClick={() => removeShortLink(row)}>
              删除
            </Button>
          )}
        />
        <TpObjectWriter
          index={2}
          title="创建 / 更新短链"
          actionLabel="保存短链"
          accountId={accountId}
          submit={async (payload) => {
            await tpApi.maSaveShortLink({ body: payload });
            return "短链已保存";
          }}
        />

        <TpBatchForm
          index={3}
          action="Tp_maMassSend"
          actionLabel="创建群发任务"
          datasetKey="ma_mass_send"
          accountId={accountId}
          params={{ channelType, templateId, name: taskName }}
          paramsReady={Boolean(templateId.trim() && taskName.trim())}
          paramsEditor={
            <div style={{ display: "grid", gap: 8 }}>
              <div>
                <TpFieldLabel>发送通道</TpFieldLabel>
                <Radio.Group
                  value={channelType}
                  onChange={(event) => setChannelType(event.target.value)}
                >
                  <Radio value="sms">短信</Radio>
                  <Radio value="email">邮件</Radio>
                </Radio.Group>
              </div>
              <div>
                <TpFieldLabel>模板ID</TpFieldLabel>
                <Input
                  style={{ width: 260 }}
                  value={templateId}
                  placeholder="可从上面的模板列表带入"
                  onChange={(event) => setTemplateId(event.target.value)}
                />
              </div>
              <div>
                <TpFieldLabel>任务名称</TpFieldLabel>
                <Input
                  style={{ width: 300 }}
                  value={taskName}
                  placeholder="例如：10 月老客回访"
                  onChange={(event) => setTaskName(event.target.value)}
                />
              </div>
            </div>
          }
          submit={async (body) =>
            taskText(await tpApi.maMassSend({ body }))
          }
        />
      </div>
      {modal}
    </Panel>
  );
}

function RtaPanel({ tabs }: { tabs: ReactNode }) {
  const { accounts, error: accountsError } = useTpAccounts();
  const [accountId, setAccountId] = useState(0);
  const [advertiserId, setAdvertiserId] = useState("");
  const [crowdName, setCrowdName] = useState("");
  const [dataType, setDataType] = useState("mobile");
  const bound = Boolean(advertiserId.trim());

  return (
    <Panel title={TOOL_TITLE} extra={tabs}>
      <div style={{ display: "grid", gap: 18 }}>
        <div className="text-12 muted">
          RTA 人群上传要求先在腾讯企点「广告授权」里绑定广告主账号，再在这里填广告主账号ID；未绑定时不显示上传。
        </div>
        <TpAccountPicker
          accounts={accounts}
          error={accountsError}
          product="RTA"
          value={accountId}
          onChange={setAccountId}
          onGoSettings={() => undefined}
        />
        <div>
          <TpFieldLabel>广告主账号ID（已绑定）</TpFieldLabel>
          <Input
            style={{ width: 320 }}
            value={advertiserId}
            placeholder="填已授权的广告主账号"
            onChange={(event) => setAdvertiserId(event.target.value)}
          />
        </div>
        {!bound ? (
          <Notice variant="info">
            还没有填广告主账号。绑定后再回到这里，上传区域才会出现。
          </Notice>
        ) : (
          <>
            <Space size={8} wrap>
              <Input
                style={{ width: 260 }}
                value={crowdName}
                placeholder="人群包名称"
                onChange={(event) => setCrowdName(event.target.value)}
              />
              <Select
                style={{ width: 160 }}
                value={dataType}
                options={[
                  { value: "mobile", label: "手机号" },
                  { value: "imei", label: "IMEI" },
                  { value: "idfa", label: "IDFA" },
                  { value: "oneid", label: "oneid" },
                ]}
                onChange={(value) => setDataType(value)}
              />
            </Space>
            <TpBatchForm
              index={1}
              action="Tp_rtaUploadAudience"
              actionLabel="上传广告人群"
              datasetKey="rta_audience_upload"
              requiredKeys={["mobile"]}
              accountId={accountId}
              params={{ crowdName, dataType, advertiserId }}
              paramsReady={Boolean(crowdName.trim())}
              submit={async (body) =>
                taskText(await tpApi.rtaUploadAudience({ body }))
              }
            />
          </>
        )}
        <Notice variant="info">
          广告授权、策略实验、模型与 AI 广告分析只在企点控制台操作；本系统只做人群上传。
        </Notice>
      </div>
    </Panel>
  );
}

function MemberGuide({ tabs }: { tabs: ReactNode }) {
  return (
    <Panel title={TOOL_TITLE} extra={tabs}>
      <div style={{ display: "grid", gap: 12, lineHeight: 1.9 }}>
        <div>
          <b>三份凭据</b>：会员积分 LM、短信邮件 MA、广告人群 RTA，一个产品一套，按登录账号加密保存。
        </div>
        <div>
          <b>会员与积分</b>：会员清单 / 积分记录只读；新建会员与状态调整按接口字段填；发积分是名单批量动作，映射必须包含会员ID，单次上限 1 万行并需勾选确认。
        </div>
        <div>
          <b>优惠券</b>：券模板只读，发券按名单批量，映射必须包含会员ID；券包、外部权益与库存仍在企点控制台。
        </div>
        <div>
          <b>短信与邮件</b>：通道、发件人、模板与短链的管理都在这里；建群发任务＝真实触达，需勾选确认并按名单批量下发。
        </div>
        <div>
          <b>广告人群</b>：先在企点「广告授权」绑定广告主，再把广告主账号ID填进来；未绑定不显示上传。
        </div>
        <div className="text-12 muted">
          上游字段名与路径在联调阶段核对；所有批量动作的结果都进「任务台账」，失败不回滚已写入的数据。
        </div>
      </div>
    </Panel>
  );
}