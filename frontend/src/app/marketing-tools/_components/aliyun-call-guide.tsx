"use client";

import {
  CopyOutlined,
  ExportOutlined,
  ReadOutlined,
} from "@ant-design/icons";
import { App, Button, Space, Tag } from "antd";
import type { ReactNode } from "react";
import { Notice } from "@/components/ui/panel";
import { CONSOLE_URL } from "./aliyun-call-common";

/** 最小权限 RAM 策略：只放开本工具用到的 OutboundBot 动作。 */
const RAM_POLICY = `{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "outboundbot:ListInstances",
        "outboundbot:ListScripts",
        "outboundbot:QueryScriptsByStatus",
        "outboundbot:ListOutboundCallNumbers",
        "outboundbot:ListJobGroups",
        "outboundbot:GetJobGroup",
        "outboundbot:CreateJobGroup",
        "outboundbot:AssignJobs",
        "outboundbot:ListJobsByGroup"
      ],
      "Resource": "*"
    }
  ]
}`;

function DocLink({
  href,
  children,
}: {
  href: string;
  children: string;
}) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
      <ExportOutlined aria-hidden style={{ fontSize: 11, marginLeft: 2 }} />
    </a>
  );
}

function Step({
  index,
  title,
  children,
}: {
  index: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "flex", gap: 10 }}>
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: "var(--primary)",
          color: "#fff",
          fontSize: 12,
          lineHeight: "22px",
          textAlign: "center",
          flexShrink: 0,
          marginTop: 1,
        }}
      >
        {index}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
          {title}
        </div>
        <div className="text-12 muted" style={{ lineHeight: 1.8 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * 使用说明：把「阿里云侧要准备什么」和「名单进来后怎么真正打出去」讲清楚，
 * 链接只放阿里云官方文档，顺序按第一次使用走。
 */
export function AliyunCallGuide() {
  const { message } = App.useApp();

  const copyPolicy = async () => {
    try {
      await navigator.clipboard.writeText(RAM_POLICY);
      message.success("RAM 最小权限策略已复制");
    } catch {
      message.error("复制失败，请手动选择下方策略内容");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Notice variant="info">
        本工具只负责「把多维表格里的名单交给阿里云智能外呼」；真正拨号由阿里云任务组按策略与全局可外呼时段调度，
        提交号码后不需要再点「启动」。第一次使用建议按下面前六步走一遍。
      </Notice>

      <Step index={1} title="在阿里云准备好三样东西">
        <div>① 开通智能外呼机器人并创建业务实例，记下实例 ID；</div>
        <div>② 在「号码管理」把主叫号码绑定到该实例，没有号码任务不会拨出；</div>
        <div>
          ③ 在控制台画好话术并<strong>发布成功</strong>
          （草稿态不能发起外呼），话术里引用变量时使用 <code>{"${name}"}</code>、
          <code>{"${honorific}"}</code>、<code>{"${gender}"}</code> 这类写法。
        </div>
        <Space size={12} wrap style={{ marginTop: 6 }}>
          <DocLink href={CONSOLE_URL}>智能外呼控制台</DocLink>
          <DocLink href="https://help.aliyun.com/zh/outboundbot/developer-reference/api-outboundbot-2019-12-26-listinstances">
            实例接口说明
          </DocLink>
          <DocLink href="https://help.aliyun.com/zh/outboundbot/developer-reference/api-outboundbot-2019-12-26-queryscriptsbystatus">
            话术状态接口说明
          </DocLink>
          <DocLink href="https://help.aliyun.com/zh/outboundbot/developer-reference/api-outboundbot-2019-12-26-listoutboundcallnumbers">
            主叫号码接口说明
          </DocLink>
        </Space>
      </Step>

      <Step index={2} title="创建只够用的 RAM 子账号">
        <div>
          不要用主账号 AccessKey。给子账号只授下面这些 Action（按需增删），再用它的
          AK/SK 填到「外呼设置」。
        </div>
        <div style={{ margin: "8px 0" }}>
          <Button
            icon={<CopyOutlined aria-hidden />}
            onClick={() => void copyPolicy()}
          >
            复制策略
          </Button>
        </div>
        <pre
          style={{
            margin: 0,
            padding: 12,
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 12,
            lineHeight: 1.6,
            overflowX: "auto",
          }}
        >
          {RAM_POLICY}
        </pre>
        <div style={{ marginTop: 6 }}>
          <DocLink href="https://help.aliyun.com/zh/outboundbot/developer-reference/api-outboundbot-2019-12-26-ram">
            RAM 授权说明
          </DocLink>
        </div>
      </Step>

      <Step index={3} title="在本工具填 Key 并测试">
        打开「外呼设置」，填 AccessKeyId / AccessKeySecret，选默认实例（地域固定华东 2（上海）），点「保存设置」，
        再点「测试连通」。测试会依次读取业务实例、已发布话术与主叫号码，缺哪样会直接提示。
      </Step>

      <Step index={4} title="导入名单">
        「导入名单」里选多维表格 → 映射被叫号码 / 姓名 / 称谓 / 角色 / 自定义变量 →
        选新建任务组或追加到已有任务组 → 预览校验 → 勾选费用确认后导入。
        首次建议先导 20–50 条试跑，确认话术与流程都正常后再导全量。
      </Step>

      <Step index={5} title="名单进了阿里云之后，怎么真正打出去">
        <div>1. 不需要再点「启动」：新建任务组时填的执行方式与时段生效后自动调度；追加模式沿用原任务组策略。</div>
        <div>
          2. 在阿里云控制台「业务管理 → 系统管理」检查全局护栏：全局可外呼时段、
          被叫号码每日拨打上限（单号每日 ≤5）、禁呼名单与白名单。这些配置会覆盖或约束单个任务。
        </div>
        <div>3. 在控制台「任务管理」看状态、进度与接通率，可暂停 / 继续；在本工具「任务与进度」刷新状态。</div>
        <div>4. 通话结果与录音在控制台「外呼历史」查看；接口侧可用 ListJobsByGroup / DescribeJob。</div>
        <Space size={12} wrap style={{ marginTop: 6 }}>
          <DocLink href="https://help.aliyun.com/zh/outboundbot/user-guide/system-configurations-of-outbound-calls/">
            外呼系统管理
          </DocLink>
          <DocLink href="https://help.aliyun.com/zh/ccs/task-management">
            任务管理
          </DocLink>
          <DocLink href="https://help.aliyun.com/zh/outboundbot/developer-reference/api-outboundbot-2019-12-26-listjobsbygroup">
            任务列表接口
          </DocLink>
        </Space>
      </Step>

      <Step index={6} title="没打出去时按顺序排查">
        <div>
          话术是否已发布 → 号码是否已绑定实例 → 是否在全局可外呼时段 → 业务并发是否为 0 →
          任务组是否被暂停 → 号码是否在禁呼名单。
        </div>
        <Space size={12} wrap style={{ marginTop: 6 }}>
          <DocLink href="https://help.aliyun.com/zh/outboundbot/support/faq-about-outbound-robots">
            外呼机器人常见问题
          </DocLink>
          <DocLink href="https://help.aliyun.com/zh/outboundbot/developer-reference/faq-about-api-operations">
            API 常见问题
          </DocLink>
          <DocLink href="https://help.aliyun.com/zh/outboundbot/developer-reference/api-outboundbot-2019-12-26-overview">
            API 概览
          </DocLink>
        </Space>
      </Step>

      <div>
        <Tag
          icon={<ReadOutlined aria-hidden />}
          color="default"
          style={{ marginInlineEnd: 0 }}
        >
          合规与费用
        </Tag>
        <div className="text-12 muted" style={{ marginTop: 6, lineHeight: 1.8 }}>
          早于 9 点、晚于 21 点与午休时段默认不排；真实通话按分钟计费，导入前确认号码数量与任务组；
          客户明确拒绝后把号码加入禁呼名单，不要重复拨打。实例、话术与主叫号码要在同一个上海地域下创建，
          否则会报「找不到实例 / 号码未绑定」。
        </div>
      </div>
    </div>
  );
}
