// Only loaded by benchmark-backend-isolated.mjs in copied, disposable applications.
const assert = require('node:assert/strict');
const net = require('node:net');
const dns = require('node:dns');
assert.equal(process.env.ISOLATED_BENCHMARK, '1');
const database = new URL(process.env.DATABASE_URL);
assert.equal(database.hostname, '127.0.0.1');
assert.match(database.pathname, /^\/enterprise_benchmark_\d+_\d+_[a-f0-9]+$/);
const ports = new Set([Number(database.port), Number(process.env.BENCHMARK_MOCK_PORT)]);
function checkHost(host) {
  if (host && !['127.0.0.1', '::1', 'localhost'].includes(String(host))) {
    process.send?.({ event: 'blocked-network' });
    throw new Error('隔离压测禁止访问非本机网络');
  }
}
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const options = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (typeof options === 'object' && options !== null) {
    checkHost(options.host);
    assert(!options.path, '隔离压测禁止 Unix Socket 出站连接');
    assert(ports.has(Number(options.port)), '隔离压测禁止连接其他本机服务');
  } else {
    if (typeof args[1] === 'string') checkHost(args[1]);
    assert(ports.has(Number(options)), '隔离压测禁止连接其他本机服务');
  }
  return originalConnect.apply(this, args);
};
const lookup = dns.lookup;
dns.lookup = function (host, ...args) {
  checkHost(host);
  return lookup.call(this, host, ...args);
};
const originalFetch = globalThis.fetch;
globalThis.fetch = function (input, options) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  checkHost(url.hostname);
  assert(ports.has(Number(url.port)), '隔离压测禁止请求其他本机服务');
  return originalFetch.call(this, input, options);
};
function sample() {
  if (!process.connected) return;
  process.send({
    event: 'process-sample',
    at: performance.now(),
    memory: process.memoryUsage(),
    usage: process.resourceUsage(),
  });
}
setInterval(sample, 100).unref();
process.on('message', (message) => {
  if (message === 'sample') sample();
});
