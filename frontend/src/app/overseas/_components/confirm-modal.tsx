"use client";

import { Button, Modal } from "antd";
import type { ReactNode } from "react";
import { useState } from "react";

export type ConfirmState = {
  title: string;
  body: ReactNode;
  okText: string;
  danger?: boolean;
  onOk: () => Promise<void>;
};

/** 二次确认弹窗（对齐 demo Ui.confirmDialog）。 */
export function ConfirmModal({
  state,
  onClose,
}: {
  state: ConfirmState | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  return (
    <Modal
      open={Boolean(state)}
      title={state?.title || ""}
      width={520}
      okText={state?.okText || "确认"}
      cancelText="取消"
      okButtonProps={{ danger: state?.danger }}
      confirmLoading={loading}
      onCancel={onClose}
      onOk={async () => {
        if (!state) return;
        setLoading(true);
        try {
          await state.onOk();
        } finally {
          setLoading(false);
        }
      }}
    >
      <div className="text-12 muted">{state?.body}</div>
    </Modal>
  );
}

/** 提示弹窗（单按钮，对齐 demo 的未签约提醒）。 */
export function AlertModal({
  open,
  title,
  body,
  okText,
  onOk,
  onClose,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  okText: string;
  onOk?: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      width={520}
      onCancel={onClose}
      footer={[
        <Button
          key="ok"
          type="primary"
          onClick={() => {
            onOk?.();
            onClose();
          }}
        >
          {okText}
        </Button>,
      ]}
    >
      <div className="text-12 muted">{body}</div>
    </Modal>
  );
}