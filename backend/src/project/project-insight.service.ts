import type { CurrentUser } from '../auth/current-user';
import { clip, ds, orgKey } from '../hrm/hrm.helpers';
import { kbChatMulti, parseJsonObject, resolveKbLlm } from '../kb/kb-llm';
import { json, num, strArr } from './project.shared';
import type { Row } from './project.shared';
import { ProjectBase } from './project.base';

/** 项目风险与 AI 洞察。 */
export class ProjectInsightService extends ProjectBase {
  async riskList(user: CurrentUser) {
    const org = await this.org(user);
    const projects = await this.prisma.pjProject.findMany({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        status: { in: ['ACTIVE', 'ACCEPTING'] },
      },
      orderBy: { id: 'desc' },
    });
    const rows = [];
    for (const project of projects) rows.push(await this.riskOf(org, project));
    return rows.sort((a, b) =>
      a.riskLevel === b.riskLevel ? 0 : a.riskLevel === 'HIGH' ? -1 : 1,
    );
  }

  async projectInsight(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const project = await this.requireProject(org, num(body.projectId));
    const risk = await this.riskOf(org, project);
    const totalTasks = risk.totalTasks || 0;
    const doneTasks = await this.prisma.pjTask.count({
      where: { projectId: project.id, status: 'DONE' },
    });
    const progress = totalTasks
      ? Math.round((doneTasks / totalTasks) * 100)
      : 0;
    const baseline = {
      projectId: project.id,
      riskLevel: risk.riskLevel,
      progress,
      overdueTasks: risk.overdueTasks,
      loggedMinutes: risk.loggedMinutes,
      budgetMinutes: risk.budgetMinutes,
      costEstimate: ds(risk.loggedMinutes / 60),
      reasons: risk.reasons,
      suggestions: risk.suggestions,
      mode: 'rule' as 'llm' | 'rule',
    };
    const channel = await resolveKbLlm(this.prisma, user.userId);
    const llm = await kbChatMulti(
      channel,
      [
        {
          role: 'system',
          content:
            '你是项目管理顾问。基于指标给出风险判断，只输出 JSON：{"riskLevel":"LOW|MEDIUM|HIGH","reasons":[""],"suggestions":[""]}。',
        },
        {
          role: 'user',
          content: JSON.stringify({ project: project.name, ...baseline }),
        },
      ],
      user.userId,
      800,
    );
    if (llm) {
      const parsed = parseJsonObject(llm.reply);
      if (parsed) {
        const level = ['LOW', 'MEDIUM', 'HIGH'].includes(
          String(parsed.riskLevel),
        )
          ? (String(parsed.riskLevel) as 'LOW' | 'MEDIUM' | 'HIGH')
          : baseline.riskLevel;
        baseline.riskLevel = level;
        baseline.reasons = strArr(parsed.reasons)
          .slice(0, 8)
          .map((item) => clip(item, 300));
        baseline.suggestions = strArr(parsed.suggestions)
          .slice(0, 8)
          .map((item) => clip(item, 300));
        baseline.mode = 'llm';
        await this.aiEval
          .chargeByUsage(
            user.userId,
            'insight_report',
            {
              tokenIn: llm.promptTokens,
              tokenOut: llm.completionTokens,
              call: 1,
            },
            `pj-insight:${project.id}`,
          )
          .catch(() => undefined);
      }
    }
    await this.prisma.aiInsightRecord.create({
      data: {
        ...orgKey(org),
        scope: 'project',
        kind: 'project_risk',
        mode: baseline.mode,
        summary: `项目「${project.name}」风险：${baseline.riskLevel}`,
        findings: json(
          baseline.reasons.map((text) => ({
            title: text,
            detail: '',
            level: baseline.riskLevel,
          })),
        ),
        suggestions: json(baseline.suggestions),
        metrics: json({
          progress,
          overdueTasks: baseline.overdueTasks,
          loggedMinutes: baseline.loggedMinutes,
          budgetMinutes: baseline.budgetMinutes,
        }),
        createdBy: org.actorId,
      },
    });
    return baseline;
  }
}
