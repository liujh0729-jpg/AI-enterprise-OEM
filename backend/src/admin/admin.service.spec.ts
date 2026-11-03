import { CurrentUser } from '../auth/current-user';
import {
  QXY_ACCOUNTS_KEY,
  QXY_SETTINGS_KEY,
} from '../qixiangyun/qxy-settings.service';
import { AdminService } from './admin.service';

describe('generic admin settings credential isolation', () => {
  const user = new CurrentUser('admin', 'admin', 'admin');
  const prisma = {
    systemSetting: {
      findMany: jest.fn().mockResolvedValue([
        { key: QXY_SETTINGS_KEY, value: 'private-ciphertext' },
        { key: QXY_ACCOUNTS_KEY, value: 'private-pool' },
        { key: 'flex_payroll_enabled', value: 'true' },
      ]),
    },
  };
  const identity = { requireAdmin: jest.fn(), setSetting: jest.fn() };
  const admin = new AdminService(
    prisma as never,
    identity as never,
    {} as never,
    {} as never,
    {} as never,
  );

  it('does not return ciphertext from the generic settings endpoint', async () => {
    expect(await admin.settings(user)).toEqual({
      flex_payroll_enabled: 'true',
    });
  });

  it('rejects generic writes to credentials before writing any setting', async () => {
    await expect(
      admin.saveSettings(user, {
        ordinary: 'value',
        [QXY_SETTINGS_KEY]: 'plaintext',
      }),
    ).rejects.toThrow('「财税管理」');
    await expect(
      admin.saveSettings(user, {
        ordinary: 'value',
        [QXY_ACCOUNTS_KEY]: 'plaintext',
      }),
    ).rejects.toThrow('「财税管理」');
    expect(identity.setSetting).not.toHaveBeenCalled();
  });
});
