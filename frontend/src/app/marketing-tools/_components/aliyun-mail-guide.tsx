"use client";

import {
  CopyOutlined,
  ExportOutlined,
  ReadOutlined,
} from "@ant-design/icons";
import { App, Button, Space, Tag } from "antd";
import type { ReactNode } from "react";
import { Notice } from "@/components/ui/panel";
import { CONSOLE_URL } from "./aliyun-mail-common";

/** 最小权限 RAM 策略：只放开本工具用到的邮件推送动作。 */
const RAM_POLICY = `{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dm:QueryReceiverByParam",
        "dm:QueryReceiverDetail",
        "dm:CreateReceiver",
        "dm:SaveReceiverDetail",
        "dm:QueryMailAddressByParam"
      ],
      "Resource": "*"
    }
  ]
}`;

function DocLink({ href, children }: { href: string; children: string }) {
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
 * 使用说明：按「先准备发信资格，再同步名单，最后控制台群发」组织，
 * 链接只放阿里云官方文档，顺序按第一次使用走。
 */
export function AliyunMailGuide() {
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
        本工具只负责「把多维表格里的联系人交给阿里云邮件推送的收件人列表」；
        发信域名、发信地址、邮件模板与真正的群发都在阿里云控制台完成。
        第一次使用建议按下面前九步走一遍。
      </Notice>

      <Step index={1} title="先看额度与产品限制">
        <div>
          单账号最多 10 个收件人列表、单个列表最多 10000 个地址，新账号发信日额度通常从 2000
          封起步（可申请提升）。这些是阿里云账号级硬限，本工具只能提示、不能扩容。
        </div>
        <Space size={12} wrap style={{ marginTop: 6 }}>
          <DocLink href="https://help.aliyun.com/zh/direct-mail/product-overview/limits">
            邮件推送规格清单
          </DocLink>
          <DocLink href={CONSOLE_URL}>邮件推送控制台</DocLink>
        </Space>
      </Step>

      <Step index={2} title="创建只够用的 RAM 子账号">
        <div>
          不要用主账号 AccessKey。给子账号只授下面这些 Action（按需增删），再用它的
          AK/SK 填到「邮件设置」。
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
          <DocLink href="https://help.aliyun.com/zh/direct-mail/api-dm-2015-11-23-ram">
            邮件推送 RAM 授权说明
          </DocLink>
        </div>
      </Step>

      <Step index={3} title="配置发信域名（DNS 验证）">
        <div>
          控制台「发信域名 → 新建域名」，按提示到 DNS 服务商加 TXT / MX 记录；验证通过前不能发信。
          域名要和发信地址的邮箱后缀一致。
        </div>
        <Space size={12} wrap style={{ marginTop: 6 }}>
          <DocLink href="https://help.aliyun.com/document_detail/29426.html">
            如何配置发信域名
          </DocLink>
        </Space>
      </Step>

      <Step index={4} title="创建发信地址">
        <div>
          控制台「发信地址 → 新建」；群发请用 <code>batch</code> （批量）类型的地址，
          <code>trigger</code> 类型只用于触发类邮件。发信地址的业务状态与域名状态都要正常。
        </div>
      </Step>

      <Step index={5} title="创建模板并提交审核">
        <div>
          控制台「模板管理 → 新建模板」，正文里用 <code>{"${UserName}"}</code> 这类占位符引用变量；
          变量名只能是英文字母，最多 50 个。草稿模板必须先「提交审核」，通过后才能在群发时选用。
          模板变量名要与本工具「字段映射」里填的变量名完全一致。
        </div>
        <Space size={12} wrap style={{ marginTop: 6 }}>
          <DocLink href="https://help.aliyun.com/zh/direct-mail/user-guide/create-email-templates">
            创建邮件模板
          </DocLink>
        </Space>
      </Step>

      <Step index={6} title="在本工具同步名单">
        先在「邮件设置」保存 AccessKey、选与控制台一致的地域并「测试连通」；再到「同步名单」：
        选多维表格 → 映射邮箱列与模板变量 → 新建收件人列表或追加到已有列表 → 预览校验 →
        开始同步。首次建议先导 20–50 条试跑。
      </Step>

      <Step index={7} title="核对列表">
        <div>
          控制台「收件人列表 → 点列表名」看人数与明细；或在本工具「同步记录」里点「刷新人数」
          按需回读。已同步过的邮箱会按本地台账跳过，不会重复写入。
        </div>
      </Step>

      <Step index={8} title="回到控制台批量发送">
        <div>
          控制台「发送邮件 → 批量发送」：选「收件人列表 + 已审核模板 + batch 发信地址」，确认后触发。
          发送任务触发后的 10 分钟内不要删除该收件人列表。
        </div>
        <Space size={12} wrap style={{ marginTop: 6 }}>
          <DocLink href="https://help.aliyun.com/document_detail/29430.html">
            发送邮件的三种方式
          </DocLink>
        </Space>
      </Step>

      <Step index={9} title="没同步成功或收不到信时按顺序排查">
        <div>
          列表名称是否重复 → 别称是否是邮箱且少于 30 字符 → 列表是否已满 10 个 →
          单列表是否已达 10000 人 → 地域是否与控制台一致 → 发信域名是否验证通过 →
          模板是否已审核 → 变量名是否只含英文字母且与模板占位符一致 → 日额度是否用完。
          账号若开了 IP 保护，还要把本系统出口 IP 加入白名单。
        </div>
      </Step>

      <div>
        <Tag
          icon={<ReadOutlined aria-hidden />}
          color="default"
          style={{ marginInlineEnd: 0 }}
        >
          合规与费用
        </Tag>
        <div
          className="text-12 muted"
          style={{ marginTop: 6, lineHeight: 1.8 }}
        >
          只同步有授权的联系人邮箱（会员注册、主动订阅等），不要导入购买或抓取的名单；
          退订与无效地址由阿里云处理，本工具不清理、不重售名单。真实发信在控制台触发并消耗日额度，
          发送前确认列表人数与模板内容。
        </div>
      </div>
    </div>
  );
}
