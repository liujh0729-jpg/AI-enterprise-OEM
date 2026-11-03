import { redactLog } from './logger';
describe('structured log redaction', () => {
  it('removes credentials from structured metadata, URLs and errors', () => {
    const value = redactLog({
      authorization: 'Bearer test-token',
      nested: { apiKey: 'test-key' },
      url: 'https://user:test-password@example.test/?access_token=test-access',
      error: new Error(
        'postgresql://user:test-db@localhost/data Bearer test-bearer',
      ),
    });
    const output = JSON.stringify(value);
    for (const secret of [
      'test-token',
      'test-key',
      'test-password',
      'test-access',
      'test-db',
      'test-bearer',
    ])
      expect(output).not.toContain(secret);
    expect(output).toContain('[redacted]');
  });
});
