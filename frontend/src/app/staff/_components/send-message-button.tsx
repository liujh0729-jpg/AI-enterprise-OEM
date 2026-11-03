"use client";

import { App, Button, Input, Modal } from "antd";
import { useState } from "react";
import { snsApi } from "@/api/collab";

/**
 * 给职员/代理人发 AIworkin 社交私信：正文走 SNS 自己的站内信，收件人在 SNS 铃铛里看到。
 * 只在本组织成员列表里出现，收件人资格由后端再校验一次。
 */
export function SendMessageButton({
  userId,
  name,
}: {
  userId: string;
  name: string;
}) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (!body.trim()) {
      message.warning("请填写私信正文");
      return;
    }
    try {
      setSending(true);
      await snsApi.sendMessage({
        body: {
          toUserId: userId,
          subject: subject.trim(),
          body: body.trim(),
        },
      });
      message.success(`已给 ${name || userId} 发出 AIworkin 社交私信`);
      setOpen(false);
      setSubject("");
      setBody("");
    } catch (caught) {
      message.error((caught as Error).message || "发送失败");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Button type="link" size="small" onClick={() => setOpen(true)}>
        发私信
      </Button>
      <Modal
        open={open}
        title={`发私信 · ${name || userId}`}
        okText="发送"
        confirmLoading={sending}
        destroyOnHidden
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
      >
        <div style={{ display: "grid", gap: 10 }}>
          <Input
            placeholder="主题（可选，最多 200 字）"
            maxLength={200}
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
          />
          <Input.TextArea
            rows={6}
            maxLength={3000}
            showCount
            placeholder="正文（最多 3000 字）；会作为 AIworkin 社交的站内私信送到对方信箱"
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          <div className="text-12 muted">
            收件人会在 AIworkin 社交的私信与通知里看到这条消息；本系统铃铛也会同步那边的通知。
          </div>
        </div>
      </Modal>
    </>
  );
}