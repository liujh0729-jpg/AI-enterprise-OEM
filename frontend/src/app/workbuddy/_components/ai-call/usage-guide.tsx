"use client";

import { Button, Modal, Steps, Typography } from "antd";
import { useState } from "react";

const { Text, Title } = Typography;

const STEP_ITEMS = [
  {
    title: "登记平台凭据",
    content:
      "点「登记账号」，按平台实际需要填用户名、登录口令、API Key、Cookie 或其他字段。至少填一种凭据；口令、API Key、Cookie 保存后不再回显，修改时留空即沿用原值。",
  },
  {
    title: "绑定 Workbuddy Enterprise 账号",
    content:
      "同一个 AI 调用账号可以绑定多个 Workbuddy Enterprise 账号。只有与当前执行账号绑定的凭据，机器通道才会放行；绑定关系随时可在「改」里调整。",
  },
  {
    title: "为任务准备 API Key",
    content:
      "AI 任务侧使用全站唯一的那把平台 API Key（「模型服务 → API Key 管理」生成），请求头带 x-api-key。Key 属于哪个账号，就只能看到那个账号名下、且与指定 Workbuddy 账号绑定的 AI 调用账号。",
  },
  {
    title: "任务运行时取用",
    content:
      "先 GET /api/v1/ai-call/accounts?workbuddyAccountId=<id> 列出可用账号（不含明文），再 GET /api/v1/ai-call/accounts/<id>/credentials?workbuddyAccountId=<id> 取一次明文凭据。两次调用都必须带 Workbuddy Enterprise 账号 ID，未绑定的会被拒绝。",
  },
  {
    title: "停用与解绑",
    content:
      "账号停用后不再出现在机器通道列表里，也取不到凭据；要从某个 Workbuddy 账号收回权限，在「改」里移除这条绑定即可。删除 AI 调用账号不可恢复。",
  },
];

/** AI 调用账号使用说明：讲清「登记 → 绑定 → 取用 → 收回」四步。 */
export function AiCallGuideButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>使用说明</Button>
      <Modal
        open={open}
        title="AI 调用账号使用说明"
        onCancel={() => setOpen(false)}
        footer={<Button onClick={() => setOpen(false)}>知道了</Button>}
        width={760}
        destroyOnHidden
      >
        <Title level={5} style={{ marginTop: 0 }}>
          这套账号解决什么
        </Title>
        <Text type="secondary">
          很多平台没有给 AI 用的开放接口，只能靠账号登录或 Cookie 操作。这里把各平台的凭据集中加密保存，
          再用 Workbuddy Enterprise 账号做授权边界：任务在哪个 Workbuddy 账号下运行，就只能取用与该账号绑定的凭据。
        </Text>

        <Title level={5} style={{ marginTop: 20 }}>
          接入步骤
        </Title>
        <Steps
          orientation="vertical"
          size="small"
          current={-1}
          items={STEP_ITEMS.map((item, index) => ({
            title: `${index + 1}. ${item.title}`,
            content: (
              <Text style={{ whiteSpace: "pre-wrap" }}>{item.content}</Text>
            ),
          }))}
        />

        <Title level={5} style={{ marginTop: 20 }}>
          安全边界
        </Title>
        <Text style={{ whiteSpace: "pre-wrap" }}>
{`• 口令 / API Key / Cookie 以 AES-256-GCM 密文落库，密钥上下文独立，界面与列表只显示「存过没有」。
• 明文只在机器通道取用时解密一次，并记录审计；未绑定、已停用或跨账号的请求一律拒绝。
• 平台管理员也不代看他人凭据；请按最小范围绑定 Workbuddy Enterprise 账号。`}
        </Text>
      </Modal>
    </>
  );
}
