"use client";

import { Button, Modal, Steps, Typography } from "antd";
import { useState } from "react";

const { Text, Title } = Typography;

const STEP_ITEMS = [
  {
    title: "准备腾讯云 Workbuddy 企业云凭据",
    content:
      "在腾讯云控制台为 Workbuddy 企业云创建 API 密钥（SecretId / SecretKey），并确认这个账号下已经有可用的 Agent。用哪把密钥签名，就只能看到那个企业名下的 Agent 与会话，隔离由腾讯云侧完成。",
  },
  {
    title: "绑定凭据并校验",
    content:
      "到「Workbuddy Enterprise 账号」页签点「绑定凭据」：起个名字、填 SecretId / SecretKey、选地域（默认广州）、设启停与备注。保存后点「校验」，系统会真打一次腾讯云的 Agent 列表接口，能列出 Agent 才算这把 Key 通了；「最近校验」列会记下时间与可见 Agent 数。",
  },
  {
    title: "确认 Agent 与版本",
    content:
      "「Agent」页签实时读腾讯云：选一把凭据就能看到它名下的 Agent、最新版本、模型、会话数与 A2A 配置，展开可看版本列表、技能 / 专家 / 连接器目录。这里新建、改名、删除 Agent 都是直接写回腾讯云，本系统不另存一份。",
  },
  {
    title: "新建计划：三种建法选一种",
    content:
      "「计划任务」页签点「新建计划」，先选分类：①「与 AI 沟通确定任务」用大白话写清想让 Agent 达成什么，点「创建并和 AI 聊」，AI 会追问关键信息，右侧实时给出任务书（目标 / 交付物 / 验收标准 / 步骤），聊到「可拆解」后点「保存任务书」——没有 API Key 时这一步用不了，先去「API Key 管理」生成一把。②「明确生成任务」不经 AI，直接按同一套任务书字段填目标、交付物、验收标准，并逐条添加任务内容，建完就是待派发任务。③「定时任务」用同样的任务书字段，再多填一份排期（定时一次 / 周期重复，重复要选频率，每周选星期、每月填几号），到点由系统按所属账号自动派发一轮。两种直填分类都要先选定 Workbuddy Enterprise 账号，否则创建会被拦住。",
  },
  {
    title: "拆解成任务并派发",
    content:
      "在计划详情点「拆解为任务」：可以给每条任务指定 Workbuddy Enterprise 账号、Agent 与版本（版本留空＝用最新版），也可以一次选多把账号让任务轮流铺开并行执行。拆完点「派发待执行」，每条任务会在腾讯云侧新建一个 Agent 会话并下发；已经派发过的计划不能再重新拆解，避免重复执行。「明确生成任务」建完已有逐条任务，直接派发即可；「定时任务」到点由后台调度器自动派发（周期重复的会在上一轮跑到终态后退回待执行再跑一轮），也可以提前手工派发。",
  },
  {
    title: "回看消息与跟踪进度",
    content:
      "任务派发后点「同步进度」把会话消息、工具调用与最新状态拉回本系统；点「消息」看完整对话，点「追加」在同一会话里补一句指令，未派发的任务可以直接改 / 删，执行中的任务可以「取消」。计划删除只清本系统的任务与消息记录，腾讯云侧的会话不删。",
  },
];

/**
 * Workbuddy 企业云使用说明：点页头标题右侧的「使用说明」按钮弹出。
 * 六步走：备凭据 → 绑定校验 → 看 Agent → 三种建法 → 拆解派发 → 回看消息。
 * 只读内容，不做任何数据操作。
 */
export function WorkbuddyGuideButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>使用说明</Button>
      <Modal
        open={open}
        title="Workbuddy 企业云使用说明"
        onCancel={() => setOpen(false)}
        footer={<Button onClick={() => setOpen(false)}>知道了</Button>}
        width={760}
        destroyOnHidden
      >
        <Title level={5} style={{ marginTop: 0 }}>
          整体架构
        </Title>
        <Text type="secondary">
          云端（腾讯云 Workbuddy 企业云）负责 Agent、版本、会话与消息事件；本系统负责把大白话聊成任务书、拆成逐条任务、记下派发与回传。
          每个用户填自己的 SecretId / SecretKey，账号之间互不相通，管理员也不代看他人密钥。
          AI 澄清任务书用的是全站统一的 API Key（「API Key 管理」里那一把），不需要在 Workbuddy 里再填。
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
          三个页签的分工
        </Title>
        <Text style={{ whiteSpace: "pre-wrap" }}>
{`• 计划任务：新建计划先选一类（与 AI 沟通确定任务 / 明确生成任务 / 定时任务）→ AI 分类再聊任务书、拆解 → 派发 → 同步进度 / 看消息 / 追加 / 取消。清单可按任务类型与任务状态筛选，两个筛选能同时用，下拉项后面带当前范围内的条数。
• Agent：实时列腾讯云侧的 Agent 与版本，可新建、改名、删 Agent 和新建版本；技能 / 专家 / 连接器按来源（BUILTIN / CUSTOM / AUTHORIZED）查目录。
• Workbuddy Enterprise 账号：绑多把腾讯云密钥，一把密钥对应一个企业；停用的账号不参与派发，历史任务与消息保留。`}
        </Text>

        <Title level={5} style={{ marginTop: 20 }}>
          常见问题
        </Title>
        <Text style={{ whiteSpace: "pre-wrap" }}>
{`Q：Agent 列表是空的？
A：先确认「Workbuddy Enterprise 账号」里这把凭据校验通过；再确认这个腾讯云账号下确实建过 Agent。换账号下拉会重新拉一次，本系统不缓存 Agent 清单。

Q：没有 API Key 能做什么？
A：可以新建计划、手写任务、绑定凭据、看 Agent 与派发，但不能和 AI 聊任务书。到「API Key 管理」生成一把后回来即可。

Q：派发后一直看不到消息？
A：点计划详情的「同步进度」主动拉取；消息与工具调用只在腾讯云侧产生，本系统不会自动轮询。状态异常时先确认密钥未过期、账号未停用。

Q：腾讯云密钥安全吗？
A：SecretKey 只存密文镜像，界面只回打码串；替换密钥时留空＝沿用已存值。修改 / 删除凭据和计划都要过统一的密码校验。`}
        </Text>
      </Modal>
    </>
  );
}
