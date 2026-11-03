"use client";

import { App, Button, InputNumber, Select, Space, Switch } from "antd";
import { useEffect, useMemo, useState } from "react";
import { oaApi } from "@/api/oa";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import {
  MemberSelect,
  oaError,
  orgQueryOf,
  type OaMember,
  type OaOrg,
  type OaOrgQuery,
} from "./oa-common";

/** 部门负责人映射在界面上一行一条，提交时折成 `{ 部门名: 成员userId }`。 */
type DeptHeadRow = { department: string; userId: string };

type SettingsDraft = {
  adminUserIds: string[];
  deptHeads: DeptHeadRow[];
  remindAfterHours: number;
  allowWithdraw: boolean;
};

type SettingsData = NonNullable<Awaited<ReturnType<typeof oaApi.settings>>>;

const deptHeadsOf = (rows: DeptHeadRow[]) => {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const department = row.department.trim();
    const userId = row.userId.trim();
    if (!department || !userId) continue;
    out[department] = userId;
  }
  return out;
};

/** 映射表按部门名排序后序列化，作为「有没有改动」的比较基准。 */
const deptHeadsKey = (map: Record<string, string>) =>
  JSON.stringify(
    Object.entries(map)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([department, userId]) => [department, userId]),
  );

const toDraft = (data: SettingsData): SettingsDraft => ({
  adminUserIds: [...data.adminUserIds],
  deptHeads: Object.entries(data.deptHeads || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([department, userId]) => ({ department, userId })),
  remindAfterHours: Number(data.remindAfterHours) || 0,
  allowWithdraw: Boolean(data.allowWithdraw),
});

export function SettingsPanel({
  org,
  isAdmin,
  onChanged,
}: {
  org: OaOrg | null;
  /** 组织主账号或被勾选的 OA 管理员才能改；其余只读看当前生效配置。 */
  isAdmin: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const { message } = App.useApp();
  const { request, modal } = usePasswordConfirm();
  const [data, setData] = useState<SettingsData | null>(null);
  const [saved, setSaved] = useState<SettingsDraft | null>(null);
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const orgQuery: OaOrgQuery = orgQueryOf(org);
  const { orgType, orgUserId } = orgQuery;

  const load = async () => {
    setLoading(true);
    try {
      const next = await oaApi.settings({ query: orgQuery });
      if (!next) throw new Error("设置加载失败");
      setData(next);
      setSaved(toDraft(next));
      setDraft(toDraft(next));
      setError("");
    } catch (err) {
      setError(oaError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在组织切换时重新取设置
  }, [orgType, orgUserId]);

  const members: OaMember[] = data?.members || [];

  const changed = useMemo(() => {
    if (!draft || !saved)
      return {} as {
        adminUserIds?: string[];
        deptHeads?: Record<string, string>;
        remindAfterHours?: number;
        allowWithdraw?: boolean;
      };
    const patch: {
      adminUserIds?: string[];
      deptHeads?: Record<string, string>;
      remindAfterHours?: number;
      allowWithdraw?: boolean;
    } = {};
    if (
      draft.adminUserIds.length !== saved.adminUserIds.length ||
      draft.adminUserIds.some(
        (id, index) => id !== saved.adminUserIds[index],
      )
    ) {
      patch.adminUserIds = draft.adminUserIds;
    }
    if (
      deptHeadsKey(deptHeadsOf(draft.deptHeads)) !==
      deptHeadsKey(deptHeadsOf(saved.deptHeads))
    ) {
      patch.deptHeads = deptHeadsOf(draft.deptHeads);
    }
    if (draft.remindAfterHours !== saved.remindAfterHours) {
      patch.remindAfterHours = draft.remindAfterHours;
    }
    if (draft.allowWithdraw !== saved.allowWithdraw) {
      patch.allowWithdraw = draft.allowWithdraw;
    }
    return patch;
  }, [draft, saved]);

  const dirty = Object.keys(changed).length > 0;

  const persist = async () => {
    if (!draft) return;
    if (!Number.isInteger(draft.remindAfterHours) || draft.remindAfterHours < 0 || draft.remindAfterHours > 720) {
      message.warning("超时提醒小时数需要是 0 到 720 之间的整数");
      return;
    }
    const names = draft.deptHeads.map((row) => row.department.trim());
    if (
      names.some((name, index) => name && names.indexOf(name) !== index)
    ) {
      message.warning("同一个部门只能映射一位负责人");
      return;
    }
    setBusy(true);
    try {
      const next = await oaApi.saveSettings({
        body: {
          ...orgQuery,
          adminUserIds: changed.adminUserIds,
          deptHeads: changed.deptHeads,
          remindAfterHours: changed.remindAfterHours,
          allowWithdraw: changed.allowWithdraw,
        },
      });
      if (next) {
        setData(next);
        setSaved(toDraft(next));
        setDraft(toDraft(next));
      }
      message.success("审批设置已保存");
      await onChanged();
    } catch (err) {
      message.error(oaError(err));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!dirty) return;
    request({
      title: "保存审批设置",
      content: "修改 OA 管理员、部门负责人、超时提醒与撤销开关需要验证密码。",
      okText: "确认保存",
      onOk: persist,
    });
  };

  const patchDeptRow = (index: number, next: Partial<DeptHeadRow>) => {
    if (!draft) return;
    setDraft({
      ...draft,
      deptHeads: draft.deptHeads.map((row, at) =>
        at === index ? { ...row, ...next } : row,
      ),
    });
  };

  const departments = [
    ...new Set(members.map((member) => member.department).filter(Boolean)),
  ];

  if (loading && !data) {
    return (
      <Panel title="审批设置">
        <div className="muted">正在加载审批设置…</div>
      </Panel>
    );
  }

  if (error && !data) {
    return (
      <Panel title="审批设置">
        <Notice variant="error">{error}</Notice>
        <Button style={{ marginTop: 8 }} onClick={() => void load()}>
          重试
        </Button>
      </Panel>
    );
  }

  if (!data || !draft || !saved) {
    return (
      <Panel title="审批设置">
        <EmptyState text="还没有读取到审批设置" />
      </Panel>
    );
  }

  return (
    <>
      <Panel title="审批设置">
        {!isAdmin ? (
          <Notice variant="info">
            只有组织主账号与 OA 管理员可以修改审批设置；以下为当前生效的配置。
          </Notice>
        ) : null}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            marginTop: isAdmin ? 0 : 12,
            maxWidth: 760,
          }}
        >
          <div>
            <div className="field-label">OA 管理员</div>
            <div className="muted text-12" style={{ marginBottom: 4 }}>
              组织主账号默认是管理员，这里勾选的成员额外获得建/改/停用模板、看全部单据与导出、配置本设置的权限。
            </div>
            <MemberSelect
              members={members}
              mode="multiple"
              value={draft.adminUserIds}
              disabled={!isAdmin}
              placeholder="勾选 OA 管理员"
              style={{ width: "100%" }}
              onChange={(next) =>
                setDraft({
                  ...draft,
                  adminUserIds: Array.isArray(next) ? next : [],
                })
              }
            />
          </div>
          <div>
            <div className="field-label">部门负责人</div>
            <div className="muted text-12" style={{ marginBottom: 4 }}>
              「部门负责人审批」按单据提交人的部门在这里找审批人；没有映射时按节点上的「无人可派时」处理。
            </div>
            {!draft.deptHeads.length ? (
              <EmptyState text="还没有配置部门负责人" />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {draft.deptHeads.map((row, index) => (
                  <div
                    key={`${row.department || "新部门"}-${index}`}
                    style={{ display: "flex", gap: 8, alignItems: "center" }}
                  >
                    <Select
                      style={{ width: 200 }}
                      showSearch
                      disabled={!isAdmin}
                      value={row.department || undefined}
                      placeholder="部门"
                      options={[
                        ...new Set([
                          ...departments,
                          ...(row.department ? [row.department] : []),
                        ]),
                      ].map((name) => ({ value: name, label: name }))}
                      onChange={(value: string) =>
                        patchDeptRow(index, { department: value })
                      }
                    />
                    <MemberSelect
                      members={members}
                      value={row.userId || undefined}
                      disabled={!isAdmin}
                      placeholder="选择负责人"
                      style={{ flex: 1, minWidth: 240 }}
                      onChange={(next) =>
                        patchDeptRow(index, {
                          userId: typeof next === "string" ? next : "",
                        })
                      }
                    />
                    {isAdmin ? (
                      <Button
                        type="link"
                        danger
                        onClick={() =>
                          setDraft({
                            ...draft,
                            deptHeads: draft.deptHeads.filter(
                              (_, at) => at !== index,
                            ),
                          })
                        }
                      >
                        删除
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
            {isAdmin ? (
              <Button
                style={{ marginTop: 8 }}
                onClick={() =>
                  setDraft({
                    ...draft,
                    deptHeads: [...draft.deptHeads, { department: "", userId: "" }],
                  })
                }
              >
                ＋ 添加部门映射
              </Button>
            ) : null}
          </div>
          <div>
            <div className="field-label">节点停留超时提醒</div>
            <Space align="center">
              <InputNumber
                min={0}
                max={720}
                precision={0}
                disabled={!isAdmin}
                value={draft.remindAfterHours}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    remindAfterHours: Math.min(
                      Math.max(Number(value) || 0, 0),
                      720,
                    ),
                  })
                }
              />
              <span className="muted text-12">
                小时，待办停留超过该时长提醒审批人一次（0＝不提醒）
              </span>
            </Space>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="field-label" style={{ margin: 0 }}>
              允许发起人撤销
            </div>
            <Switch
              disabled={!isAdmin}
              checked={draft.allowWithdraw}
              onChange={(checked) =>
                setDraft({ ...draft, allowWithdraw: checked })
              }
            />
            <span className="muted text-12">
              审批中的单据，发起人可自行撤销为「已撤销」
            </span>
          </div>
        </div>
        {isAdmin ? (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              marginTop: 16,
            }}
          >
            {dirty ? (
              <Button disabled={busy} onClick={() => setDraft(saved)}>
                还原
              </Button>
            ) : null}
            <Button
              type="primary"
              loading={busy}
              disabled={!dirty}
              onClick={save}
            >
              保存设置
            </Button>
          </div>
        ) : (
          <div className="muted text-12" style={{ marginTop: 16 }}>
            {`当前组织共 ${draft.adminUserIds.length} 名 OA 管理员、${draft.deptHeads.length} 个部门负责人映射。`}
          </div>
        )}
      </Panel>
      {modal}
    </>
  );
}
