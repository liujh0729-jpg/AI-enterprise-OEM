import { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { HelpService } from './help.service';

const USER = new CurrentUser('user-1', 'user', 'user');
const ADMIN = new CurrentUser('admin-1', 'admin', 'admin');

describe('HelpService access', () => {
  const service = new HelpService();

  it('hides platform-admin topics from non-admin chapter lists and search', () => {
    const chapters = service.chapters(USER);
    expect(chapters.some((chapter) => chapter.code === 'platform-admin')).toBe(
      false,
    );
    expect(
      service
        .search(USER, { keyword: '阿里云 AI 助手' })
        .some((hit) => hit.code.startsWith('pa-')),
    ).toBe(false);
  });

  it('rejects direct access to platform-admin topics for non-admins', () => {
    expect(() => service.topic(USER, 'pa-aliyun-deploy')).toThrow(
      new BusinessException(ErrorCode.NOT_FOUND, '帮助主题不存在或已调整'),
    );
  });

  it('shows platform-admin topics to admins', () => {
    const chapters = service.chapters(ADMIN);
    expect(chapters.some((chapter) => chapter.code === 'platform-admin')).toBe(
      true,
    );
    expect(service.topic(ADMIN, 'pa-aliyun-deploy').title).toBe(
      '在阿里云部署本系统',
    );
    expect(service.topic(ADMIN, 'pa-aliyun-ai-ops').title).toBe(
      '用阿里云 AI 助手部署与运维',
    );
  });

  it('keeps non-admin audience labels informational rather than restrictive', () => {
    const chapters = service.chapters(USER);
    expect(
      chapters.some((chapter) =>
        chapter.audience.some(
          (audience) => audience.code === 'SERVICE_PROVIDER',
        ),
      ),
    ).toBe(true);
    expect(
      chapters.some((chapter) =>
        chapter.audience.some((audience) => audience.code === 'PROVIDER_STAFF'),
      ),
    ).toBe(true);
  });
});
