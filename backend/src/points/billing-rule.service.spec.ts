import { BillingRuleService } from './billing-rule.service';
import type { PrismaService } from '../prisma/prisma.service';
import { stub } from '../../test/doubles';

describe('BillingRuleService AI subject seeds', () => {
  it('seeds every AI subject priced in 积分方案 §8.4 with the documented defaults', async () => {
    const created: Array<Record<string, unknown>> = [];
    const prisma = {
      billingRule: {
        count: jest.fn().mockResolvedValue(1),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return data;
        }),
      },
    };
    const service = new BillingRuleService(stub<PrismaService>(prisma));

    await service.ensureSeed();

    const byCode = Object.fromEntries(
      created.map((row) => [String(row.code), row]),
    );
    expect(Object.keys(byCode).sort()).toEqual(
      [
        'hrm_resume_score',
        'insight_report',
        'jd_generate',
        'kb_consolidate',
        'kb_ingest',
        'kb_lint',
        'kb_query',
        'mkt_skill_eval',
        'mkt_skill_run',
        'recruit_job_eval',
        'recruit_resume_tailor',
        'seo_audit_ai',
        'seo_competitor_ai',
        'seo_keyword_ai',
        'seo_outreach_ai',
        'seo_programmatic_ai',
        'seo_report_ai',
        'seo_schema_ai',
        'skill_review',
      ].sort(),
    );
    expect(byCode).not.toHaveProperty('hrm_eval');
    expect(byCode).not.toHaveProperty('hrm_jd');
    expect(byCode.kb_ingest).toMatchObject({
      unitPriceAmount: 0.5,
      freeQuotaMonthly: 500,
    });
    expect(byCode.insight_report).toMatchObject({
      unitPriceAmount: 2,
      freeQuotaMonthly: 100,
    });
    expect(byCode.recruit_job_eval).toMatchObject({
      unitPriceAmount: 0.2,
      freeQuotaMonthly: 200,
    });
  });
});
