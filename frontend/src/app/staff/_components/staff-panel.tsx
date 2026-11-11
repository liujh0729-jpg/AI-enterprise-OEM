"use client";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";
import { identityApi } from "@/api/identity";

import { InboxOutlined } from "@ant-design/icons";
import { App, Button, Checkbox, Input, Modal, Space, Table } from "antd";
import { useEffect, useState } from "react";
import { EmptyState, Panel } from "@/components/ui/panel";
import { useStaffRoles, useStaffSearch } from "@/query/identity";
import { SendMessageButton } from "./send-message-button";

import {
  categoryLabel,
  fmtDate,
  staffDisplayName,
  type ProviderEnterpriseRow,
  type ProviderStaffRow,
  type StaffSearchRow,
} from "./common";

/**
 * 在职职员（demo staff.js：#在职职员）——添加 AIworkin 账号为职员/代理人（**双向确认**：
 * 服务商发起添加申请 → 职员在「我的服务商」确认后生效）；
 * 角色与服务类目一致（可多选）；在「企业分配」面板把企业分配给职员承办。
 * 后端：GET /enterprise/staff、GET /enterprise/staff/search、GET /enterprise/staff/roles、
 * POST /enterprise/staff/invite、POST /enterprise/staff/:staffUserId/unbind。
 */
export function StaffPanel({
  rows,
  enterprises,
  loading,
}: {
  rows: ProviderStaffRow[];
  enterprises: ProviderEnterpriseRow[];
  loading: boolean;
}) {
  const identity_unbindMutation = useOperationMutation(identityApi.unbind, [
    "*",
  ]);

  const { message, modal } = App.useApp();
  const [bindOpen, setBindOpen] = useState(false);

  const enterpriseCountOf = (staffUserId: string) =>
    enterprises.filter((item) => item.staffUserId === staffUserId).length;

  const unbind = (row: ProviderStaffRow) => {
    const name = staffDisplayName(row);
    const count = enterpriseCountOf(row.staffUserId);
    modal.confirm({
      title: "解绑职员",
      okText: "确认解绑",
      cancelText: "取消",
      okButtonProps: { danger: true },
      content: (
        <span>
          解绑「{name}」后，TA 名下 <b>{count}</b> 家企业回到<b>待分配</b>
          状态，将无法继续办理新业务（历史单据保留流转记录）。确定解绑吗？
        </span>
      ),
      onOk: async () => {
        await identity_unbindMutation.mutateAsync({
          params: { staffUserId: String(row.staffUserId) },
        });

        message.success("已解绑");
      },
    });
  };

  return (
    <>
      <Panel
        title="在职职员"
        titleBadge={
          <span className="text-12 muted">
            可添加的职员需先注册 AIworkin
            账号并提交「职员/代理人」身份的个人资料，再由你在此「发起添加申请」、对方确认后生效；角色与服务类目一致（如
            财税专员 /
            灵活用工专员），一名职员可选多个角色；同一服务类目下仅可与一家服务商机构签约合作（一类目一机构）
          </span>
        }
        extra={
          <Button type="primary" onClick={() => setBindOpen(true)}>
            ＋ 添加职员
          </Button>
        }
      >
        <div className="table-wrap">
          <Table<ProviderStaffRow>
            rowKey="id"
            loading={loading}
            dataSource={rows}
            pagination={false}
            size="middle"
            locale={{
              emptyText: (
                <EmptyState
                  icon={<InboxOutlined aria-hidden />}
                  text="暂无职员：点击右上角「＋ 添加职员」，填写职员的 AIworkin 账号发起添加申请，对方确认后生效"
                />
              ),
            }}
            columns={[
              {
                title: "职员",
                width: 150,
                render: (_, row) => (
                  <span style={{ fontWeight: 600 }}>
                    {staffDisplayName(row)}
                  </span>
                ),
              },
              {
                title: "AIworkin 账号",
                width: 170,
                render: (_, row) => (
                  <span className="mono text-12">
                    {row.username || row.staffUserId || "—"}
                  </span>
                ),
              },
              {
                title: "手机号",
                width: 130,
                render: (_, row) => (
                  <span className="text-12">{row.profile?.phone || "—"}</span>
                ),
              },
              {
                title: "角色（与服务类目一致）",
                width: 200,
                render: (_, row) => {
                  const roles = (row.roles || []).filter(Boolean);
                  return roles.length ? (
                    <Space size={4} wrap>
                      {roles.map((role) => (
                        <span key={role} className="badge badge-sky">
                          {role}
                        </span>
                      ))}
                    </Space>
                  ) : (
                    <span className="text-12 muted">—</span>
                  );
                },
              },
              {
                title: "负责企业",
                width: 110,
                render: (_, row) => {
                  const count = enterpriseCountOf(row.staffUserId);
                  return (
                    <span
                      className={`badge ${
                        count > 0 ? "badge-green" : "badge-gray"
                      }`}
                    >
                      {count} 家
                    </span>
                  );
                },
              },
              {
                title: "绑定时间",
                width: 120,
                render: (_, row) => (
                  <span className="text-12 muted">
                    {fmtDate(row.createdAt)}
                  </span>
                ),
              },
              {
                title: "操作",
                width: 150,
                render: (_, row) => (
                  <Space size={6} wrap>
                    <SendMessageButton
                      userId={row.staffUserId}
                      name={staffDisplayName(row)}
                    />
                    <Button onClick={() => unbind(row)}>解绑</Button>
                  </Space>
                ),
              },
            ]}
          />
        </div>
      </Panel>

      <BindStaffModal
        open={bindOpen}
        staff={rows}
        onClose={() => setBindOpen(false)}
      />
    </>
  );
}

/** 绑定职员账号弹窗（demo staff.js：bindDialog）。 */
function BindStaffModal({
  open,
  staff,
  onClose,
}: {
  open: boolean;
  staff: ProviderStaffRow[];
  onClose: () => void;
}) {
  const identity_inviteStaffMutation = useOperationMutation(
    identityApi.inviteStaff,
    ["*"],
  );

  const { message } = App.useApp();
  const [keyword, setKeyword] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const searchQuery = useStaffSearch(searchKeyword, open);
  const results = searchKeyword ? (searchQuery.data ?? []) : null;
  const searching = searchQuery.isFetching;
  const searchError = searchQuery.error?.message ?? "";
  const [picked, setPicked] = useState<StaffSearchRow | null>(null);
  const rolesQuery = useStaffRoles(open);
  const roleOptions = rolesQuery.data ?? [];
  const rolesLoading = rolesQuery.isPending;
  const rolesError = rolesQuery.error?.message ?? "";
  const [pickedRoles, setPickedRoles] = useState<string[]>([]);
  const [binding, setBinding] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKeyword("");
    setSearchKeyword("");
    setPicked(null);
    setPickedRoles([]);
  }, [open]);

  const boundIds = staff.map((row) => row.staffUserId);

  const search = async () => {
    const value = keyword.trim();
    if (value.length < 2) {
      message.warning("请输入至少 2 个字符");
      return;
    }
    setPicked(null);
    if (searchKeyword === value) await searchQuery.refetch();
    else setSearchKeyword(value);
  };

  const pick = (row: StaffSearchRow) => {
    const hasProfile = row.has_profile !== false;
    const bound = row.bound ?? boundIds.includes(row.userId);
    if (bound) {
      message.warning("该账号已是你的职员，无需重复绑定");
      return;
    }
    if (!hasProfile) {
      message.warning(
        "该账号尚未提交个人资料（职员/代理人身份）：请通知 TA 登录后选择「职员/代理人」身份，并在驾驶舱提交个人资料后再绑定",
      );
      return;
    }
    setPicked(row);
  };

  const submit = async () => {
    try {
      if (!picked) {
        message.warning("请先搜索并选择一个账号");
        return;
      }
      if (!pickedRoles.length) {
        message.warning("请选择系统内增值角色（与服务类目一致）");
        return;
      }
      setBinding(true);
      try {
        await identity_inviteStaffMutation.mutateAsync({
          body: {
            staffUserId: picked.userId,
            categories: pickedRoles,
          },
        });

        const name = picked.nickname || picked.real_name || picked.userId;
        message.success(
          `已发起添加申请，待「${name}」在「我的服务商」确认后生效`,
        );
        onClose();
      } finally {
        setBinding(false);
      }
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  return (
    <Modal
      open={open}
      title="添加职员（发起添加申请 · 待职员确认生效）"
      width={540}
      onCancel={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={binding}>
            取消
          </Button>
          <Button
            type="primary"
            loading={binding}
            onClick={() => void submit()}
          >
            发起申请
          </Button>
        </>
      }
    >
      <div style={{ marginBottom: 6 }}>搜索 AIworkin 账号</div>
      <Input
        value={keyword}
        placeholder="用户名 / 姓名 / 手机号（至少 2 个字符，回车搜索）"
        onChange={(event) => setKeyword(event.target.value)}
        onPressEnter={() => void search()}
      />
      <div className="text-12 muted" style={{ marginTop: 6 }}>
        按用户名 / 姓名 / 手机号检索；仅「已提交个人资料」的账号可添加（TA
        需先登录并选择「职员/代理人」身份提交资料）。发起后由「对方本人确认」才建立绑定（不是单方面绑定）
      </div>

      <div
        style={{
          marginTop: 10,
          minHeight: 64,
          maxHeight: 260,
          overflowY: "auto",
        }}
      >
        {searching ? (
          <div className="text-12 muted" style={{ padding: "10px 2px" }}>
            搜索中…
          </div>
        ) : searchError ? (
          <div className="text-12 muted" style={{ padding: "10px 2px" }}>
            {`搜索失败：${searchError}`}
          </div>
        ) : results === null ? (
          <div className="text-12 muted" style={{ padding: "10px 2px" }}>
            职员需先在 aiworkin.com 注册账号并提交个人资料，再在此搜索添加
          </div>
        ) : results.length ? (
          results.map((row) => {
            const hasProfile = row.has_profile !== false;
            const bound = row.bound ?? boundIds.includes(row.userId);
            const categories = (row.categories || [])
              .map((item) => categoryLabel(item))
              .join("、");
            const on = picked?.userId === row.userId;
            return (
              <div
                key={row.userId}
                onClick={() => pick(row)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  border: `1px solid ${on ? "var(--primary)" : "var(--border)"}`,
                  borderRadius: 8,
                  marginBottom: 8,
                  cursor: "pointer",
                  background: on ? "var(--primary-soft)" : "#fff",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div>
                    <span style={{ fontWeight: 600 }}>
                      {row.nickname || row.real_name || row.userId}
                    </span>
                    {bound ? (
                      <span
                        className="badge badge-green"
                        style={{ marginLeft: 8 }}
                      >
                        已绑定
                      </span>
                    ) : null}
                    {hasProfile ? (
                      <span
                        className="badge badge-sky"
                        style={{ marginLeft: 8 }}
                      >
                        资料已提交
                      </span>
                    ) : (
                      <span
                        className="badge badge-gray"
                        style={{ marginLeft: 8 }}
                      >
                        未提交个人资料
                      </span>
                    )}
                  </div>
                  <div className="text-12 muted">
                    {`${row.username || row.userId}${
                      row.phone ? ` · ${row.phone}` : ""
                    }`}
                  </div>
                  {hasProfile && categories ? (
                    <div className="text-12 muted">{`服务类目：${categories}`}</div>
                  ) : null}
                </div>
                <span className="text-12 muted">
                  {bound ? "—" : hasProfile ? "选择" : "待提交资料"}
                </span>
              </div>
            );
          })
        ) : (
          <div className="text-12 muted" style={{ padding: "10px 2px" }}>
            未找到匹配账号（职员需先注册 AIworkin 账号）
          </div>
        )}
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ marginBottom: 6 }}>
          系统内增值角色（与服务类目一致，可多选）
        </div>
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 8,
            maxHeight: 240,
            overflowY: "auto",
          }}
        >
          {rolesLoading ? (
            <div className="text-12 muted" style={{ padding: "10px 2px" }}>
              加载系统内增值角色…
            </div>
          ) : rolesError ? (
            <div className="text-12 muted" style={{ padding: "10px 2px" }}>
              {`系统内增值角色加载失败：${rolesError}`}
            </div>
          ) : roleOptions.length ? (
            <div style={{ display: "grid", gap: 8 }}>
              {roleOptions.map((option) => {
                const checked = pickedRoles.includes(option.code);
                return (
                  <label
                    key={option.code}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 12px",
                      border: `1px solid ${
                        checked ? "var(--primary)" : "var(--border)"
                      }`,
                      borderRadius: 8,
                      background: checked ? "var(--primary-soft)" : "#fff",
                      cursor: "pointer",
                    }}
                  >
                    <Checkbox
                      checked={checked}
                      onChange={(event) =>
                        setPickedRoles((prev) =>
                          event.target.checked
                            ? [...prev, option.code]
                            : prev.filter((code) => code !== option.code),
                        )
                      }
                    >
                      <span style={{ fontWeight: 600, fontSize: 13 }}>
                        {option.role}
                      </span>
                    </Checkbox>
                    <span
                      className="text-12 muted"
                      style={{ marginLeft: "auto" }}
                    >
                      {`对应类目：${option.category}`}
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <div className="text-12 muted" style={{ padding: "10px 2px" }}>
              你的服务类目暂无可绑定的系统内增值角色（小微服务商无需绑定执行员工）
            </div>
          )}
        </div>
      </div>

      <p className="text-12 muted" style={{ marginTop: 12, marginBottom: 0 }}>
        同一服务类目下仅可与一家服务商机构签约合作；点击「发起申请」后在下方「待对方确认的添加申请」可查看进度、撤回；对方确认生效后请到「企业分配」把企业分配给他，企业资料与未完结业务将自动流转给承办职员。
      </p>
    </Modal>
  );
}
