"use client";

import { App, Button, Input, Modal, Space } from "antd";
import type { ReactNode } from "react";
import { useState } from "react";
import { tpApi } from "@/api/tp";
import { Notice, Panel, TabStrip } from "@/components/ui/panel";
import { TP_ID_KEYS, TP_NAME_KEYS, load, tpPick, type TpObject } from "./tp-common";
import { TpAccountPanel } from "./tp-account-panel";
import { TpTaskPanel } from "./tp-task-panel";
import {
  TpAccountPicker,
  TpObjectWriter,
  TpReadPanel,
  TpRowsTable,
  useTpAccounts,
  useTpObjectModal,
} from "./tp-ui";
import { usePasswordConfirm } from "@/components/confirm-with-password";

type View =
  | "settings"
  | "codes"
  | "mass"
  | "followups"
  | "ca"
  | "tasks"
  | "guide";

const TABS = [
  { key: "settings", label: "连接设置" },
  { key: "codes", label: "活码" },
  { key: "mass", label: "群发任务" },
  { key: "followups", label: "跟进任务" },
  { key: "ca", label: "会话质检" },
  { key: "tasks", label: "任务台账" },
  { key: "guide", label: "使用说明" },
];

/** 卡片名：工具视图里每个页签都用它做面板标题。 */
const TOOL_TITLE = "腾讯企点·企微运营";

/** 企微企业ID / 应用ID：SCRM 与 CA 的查询都要带这两个值。 */
function WeworkBar({
  corpId,
  agentId,
  onSave,
}: {
  corpId: string;
  agentId: string;
  onSave: (next: { corpId: string; agentId: string }) => void;
}) {
  const [draftCorp, setDraftCorp] = useState(corpId);
  const [draftAgent, setDraftAgent] = useState(agentId);
  const dirty = draftCorp.trim() !== corpId || draftAgent.trim() !== agentId;
  return (
    <Space size={8} wrap>
      <Input
        style={{ width: 220 }}
        value={draftCorp}
        placeholder="企微企业ID"
        onChange={(event) => setDraftCorp(event.target.value)}
      />
      <Input
        style={{ width: 200 }}
        value={draftAgent}
        placeholder="企微应用ID"
        onChange={(event) => setDraftAgent(event.target.value)}
      />
      <Button
        disabled={!dirty}
        onClick={() =>
          onSave({ corpId: draftCorp.trim(), agentId: draftAgent.trim() })
        }
      >
        保存并重查
      </Button>
    </Space>
  );
}

/** 卡二：腾讯企点 · 企微运营（SCRM + CA）。 */
export function TpWeworkTab() {
  const [view, setView] = useState<View>("settings");
  const [corpId, setCorpId] = useState("");
  const [agentId, setAgentId] = useState("");
  const tabs = (
    <TabStrip items={TABS} value={view} onChange={(key) => setView(key as View)} />
  );

  if (view === "settings") {
    return (
      <TpAccountPanel
        products={["SCRM", "CA"]}
        tabs={tabs}
        title={TOOL_TITLE}
        tip="企微活码、群发与跟进用 SCRM 凭据；会话质检用 CA 凭据。查询还要带企微企业ID与应用ID。"
      />
    );
  }
  if (view === "tasks") {
    return <TpTaskPanel products={["SCRM", "CA"]} tabs={tabs} title={TOOL_TITLE} />;
  }
  if (view === "codes") {
    return (
      <CodesPanel tabs={tabs} corpId={corpId} agentId={agentId} onContext={setCorpId} onAgent={setAgentId} />
    );
  }
  if (view === "mass") {
    return <MassPanel tabs={tabs} corpId={corpId} agentId={agentId} />;
  }
  if (view === "followups") {
    return <FollowupsPanel tabs={tabs} corpId={corpId} agentId={agentId} />;
  }
  if (view === "ca") {
    return <CaPanel tabs={tabs} corpId={corpId} agentId={agentId} />;
  }
  return <WeworkGuide tabs={tabs} />;
}

function CodesPanel({
  tabs,
  corpId,
  agentId,
  onContext,
  onAgent,
}: {
  tabs: ReactNode;
  corpId: string;
  agentId: string;
  onContext: (value: string) => void;
  onAgent: (value: string) => void;
}) {
  const { accounts, error: accountsError } = useTpAccounts();
  const [accountId, setAccountId] = useState(0);
  const { request, modal } = usePasswordConfirm();
  const { open, modal: objectModal } = useTpObjectModal(820);
  const [saving, setSaving] = useState(false);
  const [saveTip, setSaveTip] = useState("");
  const context = {
    accountId,
    wxworkCorpId: corpId,
    wxworkAgentId: agentId,
  };

  const removeCode = (row: TpObject) => {
    const codeId = tpPick(row, TP_ID_KEYS);
    if (!codeId) return;
    request({
      title: "删除企微活码",
      content: `删除活码 ${codeId} 后不能再被客户扫码添加；已经加上的好友不受影响。`,
      okText: "确认删除",
      danger: true,
      onOk: async () => {
        await tpApi.scrmDeleteCode({ body: { ...context, codeId } as never });
        setSaveTip(`活码 ${codeId} 已删除`);
      },
    });
  };

  return (
    <Panel title={TOOL_TITLE} extra={tabs}>
      <div style={{ display: "grid", gap: 20 }}>
        <WeworkBar
          corpId={corpId}
          agentId={agentId}
          onSave={(next) => {
            onContext(next.corpId);
            onAgent(next.agentId);
          }}
        />
        <TpAccountPicker
          accounts={accounts}
          error={accountsError}
          product="SCRM"
          value={accountId}
          onChange={setAccountId}
          onGoSettings={() => undefined}
        />
        <TpReadPanel
          title="活码清单"
          tip="企微官方活码，用于加好友 / 进群；与「活码引流」里自建的那套（客户域名 + 短链）并存。"
          reloadKey={`${corpId}|${agentId}`}
          loadRows={async (input) =>
            (await tpApi.scrmCodes({
              query: {
                ...context,
                page: input.page,
                pageSize: input.pageSize,
                keyword: input.keyword,
              },
            }))
          }
          action={(row) => (
            <Space size={4}>
              <Button
                size="small"
                onClick={() => open({ title: "活码详情", data: row })}
              >
                详情
              </Button>
              <Button size="small" danger onClick={() => removeCode(row)}>
                删除
              </Button>
            </Space>
          )}
        />
        <TpObjectWriter
          index={1}
          title="新建 / 编辑活码"
          actionLabel="保存活码"
          accountId={accountId}
          submit={async (payload) => {
            setSaving(true);
            try {
              await tpApi.scrmSaveCode({ body: { ...context, ...payload } as never });
              setSaveTip("活码已保存");
              return "活码已保存";
            } finally {
              setSaving(false);
            }
          }}
          hint="字段名以企点「员工活码」接口为准（如活码名称、员工ID、欢迎语等）；企业ID与应用ID自动带上。"
        />
        <TpObjectWriter
          index={2}
          title="同步欢迎语"
          actionLabel="同步欢迎语"
          accountId={accountId}
          submit={async (payload) => {
            await tpApi.scrmWelcome({ body: { ...context, ...payload } as never });
            return "欢迎语已同步";
          }}
        />
        {saveTip ? <Notice variant="success">{saveTip}</Notice> : null}
        {saving ? <div className="text-12 muted">保存中…</div> : null}
      </div>
      {modal}
      {objectModal}
    </Panel>
  );
}

function MassPanel({
  tabs,
  corpId,
  agentId,
}: {
  tabs: ReactNode;
  corpId: string;
  agentId: string;
}) {
  const { accounts, error: accountsError } = useTpAccounts();
  const [accountId, setAccountId] = useState(0);
  const { open, modal } = useTpObjectModal(820);
  const { modal: confirmModal, message } = App.useApp();
  const context = { accountId, wxworkCorpId: corpId, wxworkAgentId: agentId };

  const runControl = (row: TpObject, actionName: "stop" | "urge") => {
    const taskId = tpPick(row, TP_ID_KEYS);
    if (!taskId) return;
    confirmModal.confirm({
      title: actionName === "stop" ? "停止群发任务" : "催办群发任务",
      content:
        actionName === "stop"
          ? "停止后未执行的员工不再收到提醒，已发送的消息无法撤回。"
          : "会给尚未执行的员工再发一次提醒。",
      okText: actionName === "stop" ? "停止" : "催办",
      onOk: async () => {
        await tpApi.scrmControlMassTask({
          body: { ...context, taskId, action: actionName } as never,
        });
        message.success(actionName === "stop" ? "已请求停止" : "已请求催办");
      },
    });
  };

  return (
    <Panel title={TOOL_TITLE} extra={tabs}>
      <div style={{ display: "grid", gap: 20 }}>
        <TpAccountPicker
          accounts={accounts}
          error={accountsError}
          product="SCRM"
          value={accountId}
          onChange={setAccountId}
          onGoSettings={() => undefined}
        />
        <TpReadPanel
          title="群发任务清单"
          tip={`企业ID / 应用ID 取自「活码」页签：${corpId || "未填"} / ${agentId || "未填"}`}
          reloadKey={`${corpId}|${agentId}`}
          loadRows={async (input) =>
            (await tpApi.scrmMassTasks({
              query: {
                ...context,
                page: input.page,
                pageSize: input.pageSize,
                keyword: input.keyword,
              },
            }))
          }
          action={(row) => {
            const taskId = tpPick(row, TP_ID_KEYS);
            return (
              <Space size={4}>
                <Button
                  size="small"
                  onClick={async () => {
                    if (!taskId) return;
                    const data = await load(
                      tpApi.scrmMassTaskStats({ body: { ...context, taskId } }),
                    );
                    if (data.data)
                      open({ title: `任务统计 · ${taskId}`, data: data.data });
                  }}
                >
                  统计
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    if (taskId) runControl(row, "urge");
                  }}
                >
                  催办
                </Button>
                <Button size="small" danger onClick={() => runControl(row, "stop")}>
                  停止
                </Button>
              </Space>
            );
          }}
        />
        <TpReadPanel
          title="员工执行明细"
          tip="选中一条任务详情时可按员工看执行情况；这里按关键词与分页读明细。"
          reloadKey={`${corpId}|${agentId}`}
          loadRows={async (input) =>
            (await tpApi.scrmMassTaskExecution({
              body: {
                ...context,
                keyword: input.keyword,
                page: input.page,
                pageSize: input.pageSize,
              },
            }))
          }
        />
        <TpReadPanel
          title="组织架构与员工"
          reloadKey={`${corpId}|${agentId}`}
          loadRows={async (input) =>
            (await tpApi.scrmOrgs({
              body: {
                ...context,
                keyword: input.keyword,
                page: input.page,
                pageSize: input.pageSize,
              },
            }))
          }
        />
        <TpObjectWriter
          index={1}
          title="创建群发任务"
          actionLabel="创建群发任务"
          accountId={accountId}
          confirmLabel="我确认：会创建真实的企微群发任务并触达员工与客户"
          submit={async (payload) => {
            await tpApi.scrmSaveMassTask({ body: { ...context, ...payload } as never });
            return "群发任务已创建";
          }}
          hint="字段名以企点「群发任务」接口为准（如任务名称、模板ID、员工范围等）。"
        />
      </div>
      {modal}
    </Panel>
  );
}

function FollowupsPanel({
  tabs,
  corpId,
  agentId,
}: {
  tabs: ReactNode;
  corpId: string;
  agentId: string;
}) {
  const { accounts, error: accountsError } = useTpAccounts();
  const [accountId, setAccountId] = useState(0);
  const { message, modal: confirmModal } = App.useApp();
  const { open, modal } = useTpObjectModal(820);
  const context = { accountId, wxworkCorpId: corpId, wxworkAgentId: agentId };

  return (
    <Panel title={TOOL_TITLE} extra={tabs}>
      <div style={{ display: "grid", gap: 20 }}>
        <TpAccountPicker
          accounts={accounts}
          error={accountsError}
          product="SCRM"
          value={accountId}
          onChange={setAccountId}
          onGoSettings={() => undefined}
        />
        <TpReadPanel
          title="跟进任务清单"
          tip={`企业ID / 应用ID 取自「活码」页签：${corpId || "未填"} / ${agentId || "未填"}`}
          reloadKey={`${corpId}|${agentId}`}
          loadRows={async (input) =>
            (await tpApi.scrmFollowups({
              query: {
                ...context,
                page: input.page,
                pageSize: input.pageSize,
                keyword: input.keyword,
              },
            }))
          }
          action={(row) => {
            const followupId = tpPick(row, TP_ID_KEYS);
            return (
              <Space size={4}>
                <Button
                  size="small"
                  onClick={async () => {
                    if (!followupId) return;
                    const data = await load(
                      tpApi.scrmFollowupCustomers({
                        body: { ...context, followupId },
                      }),
                    );
                    if (data.data)
                      open({
                        title: `需跟进客户 · ${tpPick(row, TP_NAME_KEYS) || followupId}`,
                        data: { rows: data.data.rows, total: data.data.total },
                      });
                  }}
                >
                  需跟进客户
                </Button>
                <Button
                  size="small"
                  onClick={() =>
                    confirmModal.confirm({
                      title: "完成跟进任务",
                      content: "完成后该任务从待办里移除，已记录的跟进内容保留。",
                      okText: "完成",
                      onOk: async () => {
                        if (!followupId) return;
                        await tpApi.scrmFollowupDone({
                          body: { ...context, followupId } as never,
                        });
                        message.success("跟进任务已完成");
                      },
                    })
                  }
                >
                  完成
                </Button>
              </Space>
            );
          }}
        />
      </div>
      {modal}
    </Panel>
  );
}

function CaPanel({
  tabs,
  corpId,
  agentId,
}: {
  tabs: ReactNode;
  corpId: string;
  agentId: string;
}) {
  const { accounts, error: accountsError } = useTpAccounts();
  const [accountId, setAccountId] = useState(0);
  const [detail, setDetail] = useState<{
    title: string;
    data: TpObject;
  } | null>(null);
  const context = { accountId, wxworkCorpId: corpId, wxworkAgentId: agentId };
  return (
    <Panel title={TOOL_TITLE} extra={tabs}>
      <div style={{ display: "grid", gap: 20 }}>
        <TpAccountPicker
          accounts={accounts}
          error={accountsError}
          product="CA"
          value={accountId}
          onChange={setAccountId}
          onGoSettings={() => undefined}
        />
        <TpReadPanel
          title="会话消息"
          tip={`企业ID / 应用ID：${corpId || "未填"} / ${agentId || "未填"}；可按关键词检索会话内容。`}
          reloadKey={`${corpId}|${agentId}`}
          loadRows={async (input) =>
            (await tpApi.caMessages({
              body: {
                ...context,
                keyword: input.keyword,
                page: input.page,
                pageSize: input.pageSize,
              },
            }))
          }
        />
        <TpReadPanel
          title="会话标签任务"
          reloadKey={`${corpId}|${agentId}`}
          loadRows={async (input) =>
            (await tpApi.caTagTasks({
              query: {
                ...context,
                page: input.page,
                pageSize: input.pageSize,
                keyword: input.keyword,
              },
            }))
          }
          action={(row) => {
            const id = tpPick(row, TP_ID_KEYS);
            return id ? (
              <Button
                size="small"
                onClick={async () => {
                  const data = await load(
                    tpApi.caTagDetail({ params: { id }, query: { ...context, page: 1, pageSize: 50, keyword: "" } }),
                  );
                  if (data.data) {
                    setDetail({
                      title: `标签任务详情 · ${id}`,
                      data: { rows: data.data.rows, total: data.data.total },
                    });
                  }
                }}
              >
                详情
              </Button>
            ) : null;
          }}
        />
        <TpReadPanel
          title="会话响应时长"
          tip="专区版能力；没有开通时企点会返回中文错误，按提示开通后再用。"
          reloadKey={`${corpId}|${agentId}`}
          loadRows={async (input) =>
            (await tpApi.caResponseStats({
              query: {
                ...context,
                page: input.page,
                pageSize: input.pageSize,
                keyword: input.keyword,
              },
            }))
          }
        />
      </div>
      {detail ? (
        <Modal
          open
          title={detail.title}
          footer={null}
          width={820}
          destroyOnHidden
          onCancel={() => setDetail(null)}
        >
          <TpRowsTable
            rows={(detail.data.rows as TpObject[]) || []}
            emptyText="没有记录"
          />
        </Modal>
      ) : null}
    </Panel>
  );
}

function WeworkGuide({ tabs }: { tabs: ReactNode }) {
  return (
    <Panel title={TOOL_TITLE} extra={tabs}>
      <div style={{ display: "grid", gap: 12, lineHeight: 1.9 }}>
        <div>
          <b>两份凭据</b>：企微活码、群发、跟进用 SCRM；会话质检用 CA。一个产品一套，按登录账号加密保存。
        </div>
        <div>
          <b>企业ID / 应用ID</b>：在「活码」页签顶部填，保存后其它页签按同一组值重查；SCRM 与 CA 的接口都必须带。
        </div>
        <div>
          <b>活码</b>：企微官方活码（加好友 / 进群），与自建的「活码引流」（客户域名 + 短链）并存，互不替代。
        </div>
        <div>
          <b>群发与跟进</b>：创建群发属于真实触达，提交前必须勾选确认；停止只影响未执行的员工，已发出的不能撤回。
        </div>
        <div>
          <b>会话质检</b>：消息检索、标签任务与响应时长都只读；标签任务详情按任务ID查看。
        </div>
        <div className="text-12 muted">
          SCRM / CA 的上游字段名与网关前缀在联调阶段核对；本页按企点文档的字段原样透传。
        </div>
      </div>
    </Panel>
  );
}