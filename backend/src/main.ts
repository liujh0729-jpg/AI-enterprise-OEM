import './config';
import { serve } from '@hono/node-server';
import { validateConfig } from './config';
import { createApp } from './http/app';
import { createServices } from './http/services';
import { RpaTaskScheduler } from './rpa/rpa-task.scheduler';
import { RpaChromeScheduleScheduler } from './rpa/rpa-chrome-schedule.scheduler';
import { WorkbuddyPlanScheduler } from './workbuddy/workbuddy-plan.scheduler';
import { ContentAgentScheduleScheduler } from './content/agent-schedule.scheduler';
import { OkrDailyScheduler } from './okr/okr.scheduler';
import { OaReminderScheduler } from './oa/oa.scheduler';
import { TencentQidianScheduler } from './tencent-qidian/tp.scheduler';
import { PointsDailyScheduler } from './points/points-daily.scheduler';
import { ModerationPollScheduler } from './moderation/moderation-poll.scheduler';
import { UsageRetentionScheduler } from './gaps/usage-retention.scheduler';
import { WorkflowScheduler } from './workflow/workflow.scheduler';
import { TaskAssignmentScheduler } from './task-center/task-assignment.scheduler';

async function bootstrap() {
  validateConfig();
  const services = createServices();
  const rpaScheduler = new RpaTaskScheduler(services.rpaTaskService);
  // 浏览器代理计划任务：到点让本人某台在线设备跑一个目标（离线当轮跳过）
  const chromeScheduleScheduler = new RpaChromeScheduleScheduler(
    services.rpaChrome.schedule,
  );
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
  // 视频模版：按后台策略从 AIworkin 平台补充模版（上游接口未上线时只记 SKIPPED）
  const videoTemplateScheduler = services.videoTemplate.scheduler;
  // 视频内容安全：送审是异步的，轮询结论写回数字资产台账
  const moderationScheduler = new ModerationPollScheduler(
    services.digitalAsset,
  );
  // 使用埋点：按后台留存天数定期清理过期事件
  const usageRetentionScheduler = new UsageRetentionScheduler(
    services.gaps.usage,
  );
  // AI 获客：监控源到点建批次、跟进到期发送、超时批次收口
  const acquisitionScheduler = services.acquisition.scheduler;
  // 企微 SCRM：群发到点、继承轮询、SOP 定时/逾期提醒、活码日切再平衡
  const scrmScheduler = services.scrm.scheduler;
  // 微信服务号：失败推送重试（绑定/关注/退订由回调即时处理，不需要周期任务）
  const wechatMpScheduler = services.wechatMp.scheduler;
  // 工作流：按图里的 trigger.schedule 节点定时起运行（外部 Webhook 触发不开放）
  const workflowScheduler = new WorkflowScheduler(services.workflow);
  // 机构待派超时落实（D4=A）：24 小时没人接的机构队列任务自动落到在职职员
  const taskAssignmentScheduler = new TaskAssignmentScheduler(
    services.taskRouter,
    services.taskCenter,
  );
  // 商务社交：AIworkin 同步任务出站投递与重试
  const socialSyncScheduler = services.socialSync.scheduler;
  try {
    await services.prisma.$connect();
    // OSS 配置缓存：后台保存过则用库里的配置，否则回退 .env（URL 生成是同步调用）
    await services.ossSettings.load();
    await services.external.onModuleInit();
    rpaScheduler.onModuleInit();
    chromeScheduleScheduler.onModuleInit();
    workbuddyScheduler.onModuleInit();
    agentScheduler.onModuleInit();
    okrScheduler.onModuleInit();
    oaScheduler.onModuleInit();
    tpScheduler.onModuleInit();
    pointsScheduler.onModuleInit();
    moderationScheduler.onModuleInit();
    usageRetentionScheduler.onModuleInit();
    communityScheduler.onModuleInit();
    videoTemplateScheduler.onModuleInit();
    acquisitionScheduler.onModuleInit();
    scrmScheduler.onModuleInit();
    wechatMpScheduler.onModuleInit();
    workflowScheduler.onModuleInit();
    taskAssignmentScheduler.onModuleInit();
    socialSyncScheduler.onModuleInit();
  } catch (error) {
    rpaScheduler.onModuleDestroy();
    chromeScheduleScheduler.onModuleDestroy();
    workbuddyScheduler.onModuleDestroy();
    agentScheduler.onModuleDestroy();
    okrScheduler.onModuleDestroy();
    oaScheduler.onModuleDestroy();
    tpScheduler.onModuleDestroy();
    pointsScheduler.onModuleDestroy();
    moderationScheduler.onModuleDestroy();
    usageRetentionScheduler.onModuleDestroy();
    communityScheduler.onModuleDestroy();
    videoTemplateScheduler.onModuleDestroy();
    acquisitionScheduler.onModuleDestroy();
    scrmScheduler.onModuleDestroy();
    wechatMpScheduler.onModuleDestroy();
    workflowScheduler.onModuleDestroy();
    taskAssignmentScheduler.onModuleDestroy();
    socialSyncScheduler.onModuleDestroy();
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
    chromeScheduleScheduler.onModuleDestroy();
    workbuddyScheduler.onModuleDestroy();
    agentScheduler.onModuleDestroy();
    okrScheduler.onModuleDestroy();
    oaScheduler.onModuleDestroy();
    tpScheduler.onModuleDestroy();
    pointsScheduler.onModuleDestroy();
    moderationScheduler.onModuleDestroy();
    usageRetentionScheduler.onModuleDestroy();
    communityScheduler.onModuleDestroy();
    videoTemplateScheduler.onModuleDestroy();
    acquisitionScheduler.onModuleDestroy();
    scrmScheduler.onModuleDestroy();
    wechatMpScheduler.onModuleDestroy();
    workflowScheduler.onModuleDestroy();
    taskAssignmentScheduler.onModuleDestroy();
    socialSyncScheduler.onModuleDestroy();
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
