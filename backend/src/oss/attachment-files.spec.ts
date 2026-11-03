import { CurrentUser } from '../auth/current-user';
import { FlexService } from '../flex/flex.service';
import { IdentityService } from '../identity/identity.service';
import { parseAttachmentFiles } from './attachment-files';

const valid = {
  name: '营业执照.png',
  contentBase64: Buffer.from('image').toString('base64'),
};

describe.each(['provider', 'flex'])('%s attachments', (kind) => {
  const upload = jest
    .fn()
    .mockResolvedValue({ size: 5, url: 'https://example.test/file.png' });
  const requireRoles = jest.fn().mockResolvedValue(undefined);
  const service = Object.create(
    kind === 'provider' ? IdentityService.prototype : FlexService.prototype,
  ) as Pick<IdentityService, 'uploadAttachments'>;
  Object.assign(service, { oss: { upload }, identity: { requireRoles } });
  const user = new CurrentUser('unit', 'unit', 'user');

  beforeEach(() => jest.clearAllMocks());

  it.each([
    null,
    {},
    [null],
    [valid, { ...valid, contentBase64: 'bad base64!' }],
    [valid, { ...valid, name: 'page.html' }],
  ])('rejects malformed batches before any OSS writes: %j', async (files) => {
    await expect(
      service.uploadAttachments(user, files as (typeof valid)[]),
    ).rejects.toMatchObject({ errorCode: { httpStatus: 400 } });
    expect(upload).not.toHaveBeenCalled();
  });

  it('keeps encoded files and server-generated metadata consistent', async () => {
    const result = await service.uploadAttachments(user, [valid]);
    expect(upload).toHaveBeenCalledWith(
      expect.stringContaining('/unit/'),
      Buffer.from('image'),
    );
    expect(result.files[0]).toMatchObject({
      name: valid.name,
      size: 5,
      url: 'https://example.test/file.png',
    });
    if (kind === 'flex')
      expect(requireRoles).toHaveBeenCalledWith(user, 'ENTERPRISE_USER');
  });
});

describe('attachment decoding limits', () => {
  it('accepts exactly 10MiB, including a data URL, and rejects an extra byte', () => {
    const content = Buffer.alloc(10 * 1024 * 1024);
    expect(
      parseAttachmentFiles([
        {
          ...valid,
          contentBase64: `data:image/png;base64,${content.toString('base64')}`,
        },
      ])[0].content,
    ).toEqual(content);
    expect(() =>
      parseAttachmentFiles([
        {
          ...valid,
          contentBase64: Buffer.alloc(content.length + 1).toString('base64'),
        },
      ]),
    ).toThrow('超过 10MB');
  });

  it.each(['Zg=!', 'Zh==', 'Zg', '', '===='])(
    'rejects corrupt or noncanonical base64: %s',
    (contentBase64) => {
      expect(() =>
        parseAttachmentFiles([{ ...valid, contentBase64 }]),
      ).toThrow();
    },
  );

  it('limits batches and rejects inherited MIME map keys', () => {
    expect(() => parseAttachmentFiles(Array(11).fill(valid))).toThrow('10 个');
    expect(() =>
      parseAttachmentFiles([{ ...valid, name: 'file.__proto__' }]),
    ).toThrow('仅支持');
  });
});
