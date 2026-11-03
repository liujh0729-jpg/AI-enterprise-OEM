"use client";
import { presentMutationError } from "@/query/errors";
import { identityApi } from "@/api/identity";
import { useOperationMutation } from "@/query/business";

import { App, Button, Input, Modal } from "antd";
import { useEffect, useState } from "react";
import { useStaffSearch } from "@/query/identity";

/** /enterprise/staff/search 返回行（仅已提交个人资料的账号）。 */
type SearchRow = NonNullable<ReturnType<typeof useStaffSearch>["data"]>[number];

/**
 * 「添加代理人（发起添加申请 → 本人确认生效）」弹窗——全站唯一实现。
 * 灵活用工与知识产权的代理人资源库共用：动作＝identityApi.inviteStaff（providerStaff 邀请），
 * 不是单方面绑定，也不要在资源库里直接登记一个自由填写的「代理人」资料卡。
 */
export function AddAgentModal({
  open,
  category,
  agentNoun = "代理人",
  extraHint = "",
  onClose,
}: {
  open: boolean;
  /** 挂靠类目码，如 FLEX_WORK / IP_SERVICE */
  category: string;
  /** 称谓：代理人 */
  agentNoun?: string;
  /** 类目专属补充说明（一类目一机构等） */
  extraHint?: string;
  onClose: () => void;
}) {
  const identity_inviteStaffMutation = useOperationMutation(
    identityApi.inviteStaff,
    ["*"],
  );
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [picked, setPicked] = useState<SearchRow | null>(null);
  const [inviting, setInviting] = useState(false);
  const searchQuery = useStaffSearch(searchKeyword, open);
  const results = searchKeyword ? (searchQuery.data ?? []) : null;
  const searching = searchQuery.isFetching;

  useEffect(() => {
    if (!open) return;
    setKeyword("");
    setSearchKeyword("");
    setPicked(null);
  }, [open]);

  /** 搜索可添加的账号（仅已提交个人资料的账号会出现在结果里）。 */
  const search = async () => {
    const value = keyword.trim();
    if (value.length < 2) {
      message.warning("请输入至少 2 个字符");
      return;
    }
    setPicked(null);
    if (value === searchKeyword) await searchQuery.refetch();
    else setSearchKeyword(value);
  };

  const submit = async () => {
    try {
      if (!picked) {
        message.warning(`请先搜索并选择一个${agentNoun}账号`);
        return;
      }
      setInviting(true);
      try {
        await identity_inviteStaffMutation.mutateAsync({
          body: { staffUserId: picked.userId, categories: [category] },
        });

        message.success("已发起添加申请，待对方在「我的服务商」中确认后生效");
        onClose();
      } finally {
        setInviting(false);
      }
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  return (
    <Modal
      open={open}
      title={`添加${agentNoun}（发起添加申请 · 待${agentNoun}本人确认生效）`}
      okText="发起申请"
      cancelText="取消"
      confirmLoading={inviting}
      onCancel={() => {
        if (!inviting) onClose();
      }}
      onOk={() => void submit()}
    >
      <div className="text-12 muted" style={{ marginBottom: 10 }}>
        对方必须是已注册的 AIworkin 账号并已提交个人资料；发起后由「{agentNoun}
        本人确认」才建立合作（不是单方面绑定）。
        {extraHint}
      </div>
      <Input
        value={keyword}
        placeholder="用户名 / 姓名 / 手机号（至少 2 个字符，回车搜索）"
        onChange={(event) => setKeyword(event.target.value)}
        onPressEnter={() => void search()}
      />
      <div
        style={{
          marginTop: 10,
          minHeight: 64,
          maxHeight: 240,
          overflowY: "auto",
        }}
      >
        {searchQuery.isError ? (
          <div role="alert">
            搜索失败：{searchQuery.error.message}{" "}
            <Button onClick={() => void searchQuery.refetch()}>重试</Button>
          </div>
        ) : searching ? (
          <div className="text-12 muted" style={{ padding: "10px 2px" }}>
            搜索中…
          </div>
        ) : results === null ? (
          <div className="text-12 muted" style={{ padding: "10px 2px" }}>
            {agentNoun}需先在 aiworkin.com
            注册账号并提交「职员/{agentNoun}」个人资料，再在此搜索添加
          </div>
        ) : results.length ? (
          results.map((row) => {
            const on = picked?.userId === row.userId;
            return (
              <div
                key={row.userId}
                onClick={() => setPicked(row)}
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
                  <div style={{ fontWeight: 600 }}>
                    {row.real_name || row.userId}
                  </div>
                  <div className="text-12 muted">
                    {`${row.userId}${row.phone ? ` · ${row.phone}` : ""}`}
                  </div>
                </div>
                <span className="text-12 muted">
                  {on ? "已选择" : "选择"}
                </span>
              </div>
            );
          })
        ) : (
          <div className="text-12 muted" style={{ padding: "10px 2px" }}>
            未找到匹配账号（{agentNoun}需先注册 AIworkin 账号并提交个人资料）
          </div>
        )}
      </div>
    </Modal>
  );
}
