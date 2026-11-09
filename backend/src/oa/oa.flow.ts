import type { OaApprover, OaFlowNode, OaFlowStep } from '@enterprise/contracts';
import {
  OA_APPROVAL_MODE_LABELS,
  OA_TASK_STATUS_LABELS,
} from '@enterprise/contracts';
import { text } from '../common/api';
import { fromJson } from '../common/json-input';
import { jsonArray, jsonObject, num, statusLabel } from './oa.helpers';
import type { OaContext, OaMemberRow } from './oa.scope';

export const OA_FLOW_STEP_STATUS_LABELS: Record<string, string> = {
  PENDING: '未开始',
  ACTIVE: '处理中',
  DONE: '已完成',
  SKIPPED: '已跳过',
};

export type OaApplicant = { userId: string; name: string; department: string };

export type OaFrozenNode = OaFlowNode & { skipReason: string };

export type OaFrozenFlow = {
  nodes: OaFrozenNode[];
  /** ERROR 节点（无人可派且不允许跳过）的节点名，提交时拦下。 */
  blocking: string[];
};

/** 快照里额外带 skipReason，界面与流水都能说清「为什么这一步没人批」。 */
export const asFrozenNodes = (value: unknown): OaFrozenNode[] =>
  jsonArray(value).map((item) => {
    const row = jsonObject(item);
    return {
      name: text(row.name) || '审批',
      approverType: (text(row.approverType) ||
        'MEMBER') as OaFlowNode['approverType'],
      userIds: Array.isArray(row.userIds)
        ? row.userIds.map((id) => text(id)).filter(Boolean)
        : [],
      roles: Array.isArray(row.roles)
        ? row.roles.map((role) => text(role)).filter(Boolean)
        : [],
      department: text(row.department),
      positions: Array.isArray(row.positions)
        ? row.positions.map((position) => text(position)).filter(Boolean)
        : [],
      aiPreReview: {
        enabled: (row.aiPreReview as Record<string, unknown>)?.enabled === true,
        personaId: Number(
          (row.aiPreReview as Record<string, unknown>)?.personaId || 0,
        ),
        principles: text(
          (row.aiPreReview as Record<string, unknown>)?.principles,
        ),
        personaName: text(
          (row.aiPreReview as Record<string, unknown>)?.personaName,
        ),
        personaStyle: text(
          (row.aiPreReview as Record<string, unknown>)?.personaStyle,
        ),
        personaText: text(
          (row.aiPreReview as Record<string, unknown>)?.personaText,
        ),
      },
      mode: (text(row.mode) || 'ANY') as OaFlowNode['mode'],
      condition: row.condition
        ? fromJson<OaFlowNode['condition']>(jsonObject(row.condition))
        : null,
      emptyAction: (text(row.emptyAction) ||
        'SKIP') as OaFlowNode['emptyAction'],
      ccUserIds: Array.isArray(row.ccUserIds)
        ? row.ccUserIds.map((id) => text(id)).filter(Boolean)
        : [],
      remindAfterHours: Math.min(
        Math.max(num(row.remindAfterHours, 24), 0),
        720,
      ),
      skipReason: text(row.skipReason),
    };
  });

/**
 * 流程解析：提交时把「部门负责人 / 业务板块 / 组织主账号」这类动态审批人算成一份固定名单，
 * 之后模板改动、人员调动都不影响在途单据（改名单只能靠转交与加签）。
 */
export class OaFlowService {
  constructor(
    private readonly membersOf: (ctx: OaContext) => Promise<OaMemberRow[]>,
  ) {}

  /** 命中条件后按审批人类型算出候选人（未过滤在职状态）。 */
  candidates(
    ctx: OaContext,
    node: OaFlowNode,
    applicant: OaApplicant,
    members: OaMemberRow[],
  ): string[] {
    switch (node.approverType) {
      case 'DEPT_HEAD': {
        const head = applicant.department
          ? text(ctx.settings.deptHeads[applicant.department])
          : '';
        return head ? [head] : [];
      }
      case 'ROLE':
        return members
          .filter((item) =>
            item.roles.some((role) => node.roles.includes(role)),
          )
          .map((item) => item.userId);
      case 'DEPT_POSITION':
        // 部门 + 岗位同时命中才算；岗位为空＝只按部门。
        return members
          .filter((item) => item.department === node.department)
          .filter((item) =>
            node.positions.length
              ? item.positions.some((position) =>
                  node.positions.includes(position.name),
                )
              : true,
          )
          .map((item) => item.userId);
      case 'SUBMITTER':
        return [applicant.userId];
      case 'OWNER':
        return [ctx.orgUserId];
      default:
        return node.userIds;
    }
  }

  /** 冻结整条流程：逐个节点算名单、判条件、按 emptyAction 决定跳过或拦下。 */
  async freeze(
    ctx: OaContext,
    nodes: OaFlowNode[],
    applicant: OaApplicant,
    hit: (node: OaFlowNode) => boolean,
  ): Promise<OaFrozenFlow> {
    const members = await this.membersOf(ctx);
    const active = new Set(members.map((item) => item.userId));
    active.add(ctx.orgUserId);
    const frozen: OaFrozenNode[] = [];
    const blocking: string[] = [];
    nodes.forEach((node, index) => {
      const name = node.name || `第 ${index + 1} 步`;
      if (!hit(node)) {
        frozen.push({
          ...node,
          userIds: [],
          skipReason: '条件未命中，自动跳过',
        });
        return;
      }
      const roster = [
        ...new Set(
          this.candidates(ctx, node, applicant, members).filter(
            (userId) => userId && active.has(userId),
          ),
        ),
      ];
      if (!roster.length) {
        if (node.emptyAction === 'ERROR') {
          blocking.push(name);
          frozen.push({ ...node, userIds: [], skipReason: '' });
          return;
        }
        frozen.push({ ...node, userIds: [], skipReason: '无人可派，自动跳过' });
        return;
      }
      frozen.push({ ...node, userIds: roster, skipReason: '' });
    });
    return { nodes: frozen, blocking };
  }

  /** 时间线渲染：节点状态由「已产生的任务 + 当前指针 + 单据终态」推出，不另存流程状态。 */
  steps(
    nodes: OaFrozenNode[],
    tasks: {
      nodeIndex: number;
      approverId: string;
      status: string;
      comment: string;
      actedAt: Date | null;
    }[],
    names: Map<string, string>,
    currentNode: number,
    finished: boolean,
  ): OaFlowStep[] {
    return nodes.map((node, index) => {
      const rows = tasks.filter((task) => task.nodeIndex === index);
      const byApprover = new Map(rows.map((task) => [task.approverId, task]));
      const approvers: OaApprover[] = node.userIds.map((userId) => {
        const task = byApprover.get(userId);
        const status = task ? task.status : 'PENDING';
        return {
          userId,
          name: names.get(userId) || userId,
          status,
          statusLabel: statusLabel(OA_TASK_STATUS_LABELS, status),
          actedAt: task?.actedAt ? task.actedAt.toISOString() : '',
          comment: task ? text(task.comment) : '',
        };
      });
      const pending = approvers.filter((item) => item.status === 'PENDING');
      const status: OaFlowStep['status'] = node.userIds.length
        ? pending.length
          ? index === currentNode && !finished
            ? 'ACTIVE'
            : 'PENDING'
          : 'DONE'
        : 'SKIPPED';
      return {
        index,
        name: node.name || `第 ${index + 1} 步`,
        mode: node.mode,
        modeLabel: statusLabel(OA_APPROVAL_MODE_LABELS, node.mode),
        status,
        statusLabel: statusLabel(OA_FLOW_STEP_STATUS_LABELS, status),
        approvers,
        ccNames: node.ccUserIds.map((userId) => names.get(userId) || userId),
        aiPreReviewEnabled: node.aiPreReview.enabled,
        aiPreReviewPersona: node.aiPreReview.personaName,
      };
    });
  }
}
