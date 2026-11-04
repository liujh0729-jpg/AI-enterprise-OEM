import './config';
import { serve } from '@hono/node-server';
import { validateConfig } from './config';
import { createApp } from './http/app';
import { createServices } from './http/services';
import { RpaTaskScheduler } from './rpa/rpa-task.scheduler';
import { WorkbuddyPlanScheduler } from './workbuddy/workbuddy-plan.scheduler';
import { ContentAgentScheduleScheduler } from './content/agent-schedule.scheduler';
import { OkrDailyScheduler } from './okr/okr.scheduler';
import { OaReminderScheduler } from './oa/oa.scheduler';
import { TencentQidianScheduler } from './tencent-qidian/tp.scheduler';
import { PointsDailyScheduler } from './points/points-daily.scheduler';

async function bootstrap() {
  validateConfig();
  const services = createServices();
  const rpaScheduler = new RpaTaskScheduler(services.rpaTaskService);
  const workbuddyScheduler = new WorkbuddyPlanScheduler(
    services.workbuddyPlanService,
  );
  const agentScheduler = new ContentAgentScheduleScheduler(
    services.contentAgentScheduleService,
  );
  const okrScheduler = new OkrDailyScheduler(services.okrMetrics);
  const oaScheduler = new OaReminderScheduler(services.oa);
  const tpScheduler = new TencentQidianScheduler(services.tencentQidian);
  const pointsScheduler = new PointsDailyScheduler(services.points.billing);
  // 创意社区运行：轮询 Comfy Cloud 作业并把产物转存进本站 OSS（签名 URL 约 6 小时失效）
  const communityScheduler = services.community.scheduler;
  try {
    await services.prisma.$connect();
    // OSS 配置缓存：后台保存过则用库里的配置，否则回退 .env（URL 生成是同步调用）
    await services.ossSettings.load();
    await services.external.onModuleInit();
    rpaScheduler.onModuleInit();
    workbuddyScheduler.onModuleInit();
    agentScheduler.onModuleInit();
    okrScheduler.onModuleInit();
    oaScheduler.onModuleInit();
    tpScheduler.onModuleInit();
    pointsScheduler.onModuleInit();
    communityScheduler.onModuleInit();
  } catch (error) {
    rpaScheduler.onModuleDestroy();
    workbuddyScheduler.onModuleDestroy();
    agentScheduler.onModuleDestroy();
    okrScheduler.onModuleDestroy();
    oaScheduler.onModuleDestroy();
    tpScheduler.onModuleDestroy();
    pointsScheduler.onModuleDestroy();
    communityScheduler.onModuleDestroy();
    await services.prisma.$disconnect();
    throw error;
  }
  const app = createApp(services);
  const server = serve({
    fetch: app.fetch,
    port: Number(process.env.PORT || 1690),
    hostname: process.env.HOST || '127.0.0.1',
  });
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    rpaScheduler.onModuleDestroy();
    workbuddyScheduler.onModuleDestroy();
    agentScheduler.onModuleDestroy();
    okrScheduler.onModuleDestroy();
    oaScheduler.onModuleDestroy();
    tpScheduler.onModuleDestroy();
    pointsScheduler.onModuleDestroy();
    communityScheduler.onModuleDestroy();
    server.close(() => {
      void services.prisma.$disconnect().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 30_000).unref();
  };
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
}

void bootstrap().catch((error) => {
  console.error('Enterprise API 启动失败，请检查配置和数据库连接');
  console.error(error);
  process.exitCode = 1;
});
