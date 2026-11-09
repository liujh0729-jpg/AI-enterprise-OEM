import { HealthController } from './health.controller';
import type { PrismaService } from './prisma/prisma.service';
import { stub } from '../test/doubles';

describe('HealthController', () => {
  it('returns the enterprise liveness envelope', () => {
    const controller = new HealthController(stub<PrismaService>());
    expect(controller.health()).toEqual({
      code: 0,
      message: 'ok',
      data: { status: 'up', service: 'aiworkin-enterprise' },
    });
  });
});
