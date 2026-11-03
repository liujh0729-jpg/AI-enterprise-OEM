import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns the enterprise liveness envelope', () => {
    const controller = new HealthController({} as never);
    expect(controller.health()).toEqual({
      code: 0,
      message: 'ok',
      data: { status: 'up', service: 'aiworkin-enterprise' },
    });
  });
});
