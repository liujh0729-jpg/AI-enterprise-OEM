import {
  SeoDataForSeoClient,
  SEO_PROVIDER_CODE,
} from './seo-dataforseo.client';
import type { PrismaService } from '../prisma/prisma.service';
import type { AccountCrypto } from '../account/account-crypto';
import { BusinessException } from '../common/business.exception';
import { stub } from '../../test/doubles';

function setup() {
  const findUnique = jest.fn();
  const decrypt = jest.fn();
  const prisma = stub<PrismaService>({
    seoProviderSetting: { findUnique },
  });
  const crypto = stub<AccountCrypto>({ decrypt });
  return {
    client: new SeoDataForSeoClient(prisma, crypto),
    findUnique,
    decrypt,
  };
}

describe('DataForSEO 凭据：缺 Key 不造假数据', () => {
  it('未配置返回 null（调用方据此引导，绝不造假）', async () => {
    const { client, findUnique } = setup();
    findUnique.mockResolvedValue(null);
    expect(await client.credential('u1')).toBeNull();
    expect(findUnique.mock.calls[0][0].where.userId_code).toEqual({
      userId: 'u1',
      code: SEO_PROVIDER_CODE,
    });
  });

  it('密文为空返回 null', async () => {
    const { client, findUnique } = setup();
    findUnique.mockResolvedValue({ credentialCipher: '' });
    expect(await client.credential('u1')).toBeNull();
  });

  it('解密 login:password 合并密文', async () => {
    const { client, findUnique, decrypt } = setup();
    findUnique.mockResolvedValue({ credentialCipher: 'cipher' });
    decrypt.mockReturnValue('mylogin:mypassword');
    expect(await client.credential('u1')).toEqual({
      login: 'mylogin',
      password: 'mypassword',
    });
  });

  it('解密失败或格式非法返回 null，不抛裸错', async () => {
    const { client, findUnique, decrypt } = setup();
    findUnique.mockResolvedValue({ credentialCipher: 'cipher' });
    decrypt.mockImplementation(() => {
      throw new Error('bad key');
    });
    expect(await client.credential('u1')).toBeNull();
    decrypt.mockReturnValue('no-colon');
    expect(await client.credential('u1')).toBeNull();
  });

  it('requireCredential 缺凭据抛 BAD_REQUEST 引导配置', async () => {
    const { client, findUnique } = setup();
    findUnique.mockResolvedValue(null);
    await expect(client.requireCredential('u1')).rejects.toBeInstanceOf(
      BusinessException,
    );
  });
});
