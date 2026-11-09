import { ContentAgentService } from './agent.service';
import { PrismaService } from '../prisma/prisma.service';
import { ContentAgentMemoryService } from './agent-memory.service';
import { ContentAgentSkillService } from './agent-skills.service';
import { ContentAgentPluginService } from './agent-plugins.service';
import { ContentAgentExpertService } from './agent-experts.service';
import { ContentAgentConnectorService } from './agent-connectors.service';
import { ContentAgentEngine } from './agent-engine';
import type { AgentToolContext } from './agent-tools';
import { stub } from '../../test/doubles';

/**
 * 多分身协同：主分身起草 → 其余复核 → 主分身汇总。
 * 起草与复核不允许执行写动作，只有最后一次汇总放开写；单个复核失败要变成意见备注，不能拖垮整轮。
 */

type Result = {
  text: string;
  toolEvents: { name: string; args: string; ok: boolean; text: string }[];
  media: { kind: string; url: string; assetId?: string }[];
};

type RunOnce = (
  personaId: number | undefined,
  extraSystem: string | undefined,
  allowWrite: boolean,
  emit: (event: never) => Promise<void>,
) => Promise<Result>;

type PersonaRow = {
  id: number;
  name: string;
  style: string;
  persona: string;
  spaceId: number;
  libraryIds: unknown;
  channelId: number;
  model: string;
};

function emptyResult(text: string): Result {
  return { text, toolEvents: [], media: [] };
}

const rows: PersonaRow[] = [
  {
    id: 1,
    name: '销售分身',
    style: 'concise',
    persona: '',
    spaceId: 0,
    libraryIds: [],
    channelId: 0,
    model: '',
  },
  {
    id: 2,
    name: '交付分身',
    style: 'rigorous',
    persona: '',
    spaceId: 0,
    libraryIds: [],
    channelId: 0,
    model: '',
  },
];

function buildCollaborate() {
  const service = new ContentAgentService(
    stub<PrismaService>(),
    stub<ContentAgentMemoryService>(),
    stub<ContentAgentSkillService>(),
    stub<ContentAgentPluginService>(),
    stub<ContentAgentExpertService>(),
    stub<ContentAgentConnectorService>(),
    stub<ContentAgentEngine>(),
    stub<AgentToolContext>(),
  );
  const collaborate = stub<{
    collaborate: (
      runOnce: RunOnce,
      notice: (text: string) => Promise<void>,
      emitFinal: (event: never) => Promise<void>,
      rows: PersonaRow[],
    ) => Promise<Result>;
  }>(service).collaborate.bind(service);
  return collaborate;
}

describe('数字分身多分身协同', () => {
  it('起草与复核不写库，只有汇总放开写，且汇总带上复核意见', async () => {
    const runOnce = jest
      .fn<ReturnType<RunOnce>, Parameters<RunOnce>>()
      .mockResolvedValueOnce(emptyResult('初稿内容'))
      .mockResolvedValueOnce(emptyResult('补充了风险点'))
      .mockResolvedValueOnce(emptyResult('最终答复'));
    const notices: string[] = [];
    const notice = jest.fn((text: string) => {
      notices.push(text);
      return Promise.resolve();
    });
    const emitFinal = jest.fn().mockResolvedValue(undefined);

    const result = await buildCollaborate()(runOnce, notice, emitFinal, rows);

    expect(result.text).toBe('最终答复');
    expect(runOnce).toHaveBeenCalledTimes(3);
    const [draftCall, reviewCall, finalCall] = runOnce.mock.calls;
    expect(draftCall[0]).toBe(1);
    expect(draftCall[2]).toBe(false);
    expect(reviewCall[0]).toBe(2);
    expect(reviewCall[2]).toBe(false);
    expect(String(reviewCall[1])).toContain('初稿内容');
    expect(finalCall[0]).toBe(1);
    expect(finalCall[2]).toBe(true);
    expect(finalCall[3]).toBe(emitFinal);
    expect(String(finalCall[1])).toContain('补充了风险点');
    expect(notices).toEqual([
      '多分身协同：销售分身 先起草…',
      '多分身协同：交付分身 正在复核…',
      '多分身协同：销售分身 汇总成最终答复…',
    ]);
  });

  it('复核分身失败时不中断，把失败写进意见再汇总', async () => {
    const runOnce = jest
      .fn<ReturnType<RunOnce>, Parameters<RunOnce>>()
      .mockResolvedValueOnce(emptyResult('初稿内容'))
      .mockRejectedValueOnce(new Error('模型超时'))
      .mockResolvedValueOnce(emptyResult('最终答复'));

    const result = await buildCollaborate()(
      runOnce,
      jest.fn().mockResolvedValue(undefined),
      jest.fn().mockResolvedValue(undefined),
      rows,
    );

    expect(result.text).toBe('最终答复');
    const finalSystem = String(runOnce.mock.calls[2][1]);
    expect(finalSystem).toContain('交付分身');
    expect(finalSystem).toContain('复核失败');
    expect(finalSystem).toContain('模型超时');
  });
});
