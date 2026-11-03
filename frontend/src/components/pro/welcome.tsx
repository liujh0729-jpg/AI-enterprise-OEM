"use client";

import { PageContainer, ProCard, StatisticCard } from "@ant-design/pro-components";
import { Alert, Card, Col, Row, Tag, Typography } from "antd";
import Link from "next/link";
import type { ApiResponse } from "@/lib/api-envelope";
import { useSiteBase } from "@/lib/site-brand";

type HealthPayload = {
  status?: string;
  service?: string;
  checks?: { database?: string };
};

const INFO_CARDS = [
  {
    index: 1,
    href: "/identity",
    title: "身份与资质",
    desc: "用户提交主体档案即生效，服务商备案需审核，职员需绑定或挂靠；已获得的身份可在顶栏切换。",
  },
  {
    index: 2,
    href: "/contracts",
    title: "签约与作业",
    desc: "企业发起、服务商确认。需要签约的业务未找到有效签约时返回业务码 20001。",
  },
  {
    index: 3,
    href: "/logistics",
    title: "物流需求",
    desc: "无签约时进入公开需求池；存在匹配服务细项的有效签约时直派对应服务商。",
  },
] as const;

export function WelcomePage({
  liveness,
  readiness,
}: {
  liveness: { ok: boolean; payload: ApiResponse<HealthPayload> };
  readiness: { ok: boolean; payload: ApiResponse<HealthPayload> };
}) {
  // 本站对外地址：不写死端口与域名，跟站点配置 / 当前访问地址走
  const siteBase = useSiteBase();
  return (
    <PageContainer
      title={
        <>
          欢迎使用 AIworkin Enterprise{" "}
          <Tag color="blue" variant="filled">
            Pro
          </Tag>
        </>
      }
      content="企业、服务商与承办职员的业务工作台，覆盖身份与资质、签约及各类企业服务。"
    >
      <Alert
        showIcon
        type="info"
        title="登录由本系统账号服务提供（仅支持本站账号登录），工作台通过同源接口访问 Enterprise 业务服务。"
        style={{ marginBottom: 16 }}
      />
      <StatisticCard.Group>
        <StatisticCard
          statistic={{
            title: "前端",
            value: "Next.js 16",
            description: siteBase || "本系统同域",
          }}
        />
        <StatisticCard
          statistic={{
            title: "后端 liveness",
            value: liveness.ok ? "up" : "down",
            status: liveness.ok ? "success" : "error",
            description: liveness.payload.data?.service || "enterprise",
          }}
        />
        <StatisticCard
          statistic={{
            title: "数据库 readiness",
            value: readiness.payload.data?.checks?.database || "down",
            status: readiness.ok ? "success" : "error",
            description: "ae_test",
          }}
        />
      </StatisticCard.Group>
      <ProCard ghost gutter={[16, 16]} style={{ marginTop: 16 }}>
        {INFO_CARDS.map((card) => (
          <ProCard key={card.href} colSpan={8} headerBordered>
            <Link href={card.href} style={{ color: "inherit" }}>
              <Typography.Text type="secondary">{card.index}</Typography.Text>
              <Typography.Title level={4} style={{ marginTop: 8 }}>
                {card.title}
              </Typography.Title>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                {card.desc}
              </Typography.Paragraph>
            </Link>
          </ProCard>
        ))}
      </ProCard>
      <Card style={{ marginTop: 16 }} title="服务状态说明">
        <Row gutter={[16, 8]}>
          <Col span={24}>
            存活检查反映后端进程状态，就绪检查只验证 Enterprise 数据库连接；Java、AIworkin 和外部服务需分别检查。
          </Col>
        </Row>
      </Card>
    </PageContainer>
  );
}
