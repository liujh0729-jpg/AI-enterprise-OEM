"use client";

import { App, Button, Input, Modal } from "antd";
import { useState, type ReactNode } from "react";
import { checkAdminPassword } from "@/lib/admin-password";
import { presentMutationError } from '@/query/errors';

type RequestOptions = {
  title: string;
  content?: ReactNode;
  okText?: string;
  danger?: boolean;
  /** 拿到已校验通过的密码：服务端对「放开权限」的写入还要自己再验一次，不能只信前端预检。 */
  onOk: (password: string) => Promise<void> | void;
};

/**
 * 「修改 / 删除」密码确认弹窗。
 *
 * 新增、批量导入免密；修改与删除统一走本弹窗：输入密码 → 弹窗内校验 → 通过后执行操作。
 *
 * 用法：
 *   const { request, modal } = usePasswordConfirm();
 *   <Button onClick={() => request({ title: "删除资源", danger: true, onOk: del })}>删除</Button>
 *   {modal}
 */
export function usePasswordConfirm() {
  const { message } = App.useApp();
  const [options, setOptions] = useState<RequestOptions | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const request = (next: RequestOptions) => {
    setPassword("");
    setError("");
    setOptions(next);
  };

  const close = () => {
    if (busy) return;
    setOptions(null);
    setPassword("");
    setError("");
  };

  const submit = async () => {
    if (!options) return;
    setBusy(true);
    try {
      if (!(await checkAdminPassword(password))) {
        setError("密码不正确");
        return;
      }
      await options.onOk(password);
      setOptions(null);
      setPassword("");
      setError("");
    } catch (err) {
      presentMutationError(err, text=>message.error(text));
    } finally {
      setBusy(false);
    }
  };

  const modal = (
    <Modal
      open={Boolean(options)}
      title={options?.title}
      onCancel={close}
      onOk={submit}
      okText={options?.okText || "确认"}
      cancelText="取消"
      confirmLoading={busy}
      okButtonProps={{
        danger: Boolean(options?.danger),
        disabled: !password.trim(),
      }}
      destroyOnHidden
    >
      {options?.content}
      <div style={{ marginTop: options?.content ? 14 : 0 }}>
        <div className="text-12 muted" style={{ marginBottom: 6 }}>
          修改与删除需要输入当前账号密码
        </div>
        <Input.Password
          autoFocus
          value={password}
          placeholder="请输入密码"
          status={error ? "error" : undefined}
          onChange={(event) => {
            setPassword(event.target.value);
            if (error) setError("");
          }}
          onPressEnter={submit}
        />
        {error ? (
          <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 6 }}>
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );

  return { request, modal };
}

/** 便捷封装：把「危险操作按钮」直接包成一个组件。 */
export function DangerActionButton({
  label,
  title,
  content,
  onOk,
  size = "small",
}: {
  label: string;
  title: string;
  content?: ReactNode;
  onOk: () => Promise<void> | void;
  size?: "small" | "middle";
}) {
  const { request, modal } = usePasswordConfirm();
  return (
    <>
      <Button
        size={size}
        danger
        onClick={() => request({ title, content, danger: true, onOk })}
      >
        {label}
      </Button>
      {modal}
    </>
  );
}
