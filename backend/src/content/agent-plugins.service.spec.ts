import {
  ContentAgentPluginService,
  expandPluginCommandBody,
  matchPluginCommand,
  parsePluginCommands,
} from './agent-plugins.service';

/**
 * 插件命令的解析与展开：Agent 用 run_plugin_command 跑业务时走的就是这几个纯函数，
 * 只读包内文本、不执行脚本，所以这里只验「取哪条命令」和「参数怎么填进正文」。
 */
const files = [
  {
    path: 'commands/build.md',
    content: [
      '---',
      'description: 按需求出一份构建方案',
      'argument-hint: "[目标]"',
      '---',
      '# build',
      '',
      '请针对 $ARGUMENTS 输出步骤。',
    ].join('\n'),
  },
  { path: 'commands/review.md', content: '直接写正文，没有标题。' },
  { path: 'skills/demo/SKILL.md', content: '# 技能不是命令' },
  { path: 'commands/note.txt', content: '非 markdown 不收' },
];

describe('parsePluginCommands', () => {
  it('只收 commands/*.md，命令名取文件名', () => {
    const commands = parsePluginCommands(files);
    expect(commands.map((item) => item.name)).toEqual(['build', 'review']);
    expect(commands[0]?.path).toBe('commands/build.md');
  });

  it('说明取 frontmatter，没有就用正文首行兜底', () => {
    const commands = parsePluginCommands(files);
    expect(commands[0]?.description).toBe('按需求出一份构建方案');
    expect(commands[1]?.description).toBe('直接写正文，没有标题。');
  });

  it('正文去掉 frontmatter，占位符留着交给展开阶段', () => {
    const commands = parsePluginCommands(files);
    expect(commands[0]?.content).toContain('$ARGUMENTS');
    expect(commands[0]?.content).not.toContain('argument-hint');
  });

  it('没有命令文件时回空数组（目录安装的插件就是这种）', () => {
    expect(
      parsePluginCommands([{ path: 'README.md', content: '# hi' }]),
    ).toEqual([]);
  });
});

describe('matchPluginCommand', () => {
  const commands = parsePluginCommands(files);

  it('兼容 build、/build、插件名:build 三种写法', () => {
    expect(matchPluginCommand(commands, 'build')?.name).toBe('build');
    expect(matchPluginCommand(commands, '/build')?.name).toBe('build');
    expect(matchPluginCommand(commands, '测试插件:build')?.name).toBe('build');
  });

  it('大小写不敏感，叫不中就不硬凑', () => {
    expect(matchPluginCommand(commands, 'BUILD')?.name).toBe('build');
    expect(matchPluginCommand(commands, 'deploy')).toBeUndefined();
    expect(matchPluginCommand(commands, '')).toBeUndefined();
  });
});

describe('expandPluginCommandBody', () => {
  it('有 $ARGUMENTS 就原位替换', () => {
    const body = matchPluginCommand(parsePluginCommands(files), 'build')
      ?.content as string;
    expect(expandPluginCommandBody(body, '做一张促销海报')).toContain(
      '请针对 做一张促销海报 输出步骤。',
    );
    expect(expandPluginCommandBody(body, '做一张促销海报')).not.toContain(
      '$ARGUMENTS',
    );
  });

  it('没有占位符就把参数附在正文后，不丢用户给的信息', () => {
    const body = parsePluginCommands(files)[1]?.content;
    expect(expandPluginCommandBody(body, '检查文案')).toContain(
      '【本次参数】检查文案',
    );
  });

  it('不传参数时正文原样返回', () => {
    expect(expandPluginCommandBody('# 步骤\n1. 做', '  ')).toBe(
      '# 步骤\n1. 做',
    );
  });
});

describe('ContentAgentPluginService.promptSummaries', () => {
  const rows = [
    {
      name: '演示插件',
      description: '带命令的插件',
      files: [
        {
          path: 'commands/build.md',
          content: '---\ndescription: 按需求出方案\n---\n# build\n正文',
        },
        { path: 'commands/review.md', content: '# review\n正文' },
      ],
    },
  ];
  const findMany = jest.fn().mockResolvedValue(rows);
  const service = new ContentAgentPluginService(
    { contentAgentPlugin: { findMany } } as never,
    {} as never,
  );

  it('只拼名字、一句说明与命令名，并把条数收在查询上', async () => {
    expect(await service.promptSummaries('u1')).toBe(
      '- 演示插件：带命令的插件（插件命令：build、review）',
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 41 }),
    );
  });
});
