const BASE = 'http://127.0.0.1:1690/api/backend';
let cookie = '';
async function login(as) {
  const res = await fetch(`http://127.0.0.1:1690/api/dev/session?as=${as}&next=/`, { redirect: 'manual' });
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || ''];
  cookie = raw.map((v) => v.split(';')[0]).filter(Boolean).join('; ');
}
async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:15889',
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, ...json };
}
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`);
}
const suffix = Date.now().toString().slice(-6);
const created = { lead: 0, customer: 0, opportunity: 0, contract: 0, order: 0, plan: 0, record: 0, product: 0, dataset: 0, chart: 0, dashboard: 0, group: 0 };
try {
  await login('demo_enterprise');
  let r = await api('GET', '/enterprise/crm/workbench?range=month');
  check('CRM workbench', r.code === 0 && r.data?.isMember === true, `code=${r.code}`);

  r = await api('POST', '/enterprise/crm/leads', { name: `冒烟线索${suffix}`, phone: `139${suffix}0000`, source: 'smoke' });
  check('CRM create lead', r.code === 0 && r.data?.id > 0, `code=${r.code}`);
  const leadId = r.data?.id;
  created.lead = leadId;

  r = await api('POST', `/enterprise/crm/leads/${leadId}/convert`, { createOpportunity: true, opportunityName: `冒烟商机${suffix}`, amount: '1000.00' });
  check('CRM convert lead', r.code === 0 && r.data?.customer?.id > 0, `code=${r.code}`);
  const customerId = r.data?.customer?.id;
  created.customer = customerId;
  created.opportunity = r.data?.opportunity?.id || 0;

  r = await api('POST', '/enterprise/crm/contracts', { customerId, name: `冒烟合同${suffix}`, amount: '1000.00', items: [{ name: '服务', qty: '1', price: '1000.00' }] });
  check('CRM create contract', r.code === 0 && r.data?.id > 0, `code=${r.code} msg=${r.message}`);
  const contractId = r.data?.id;
  created.contract = contractId;

  r = await api('GET', `/enterprise/crm/contracts/${contractId}`);
  check('CRM contract detail', r.code === 0 && r.data?.contract?.id === contractId, `code=${r.code}`);
  const approvalStatus = r.data?.contract?.approvalStatus;
  if (approvalStatus && !['APPROVED', 'NONE', ''].includes(approvalStatus)) {
    const todo = await api('GET', '/enterprise/crm/approvals/todo?page=1&pageSize=50');
    const task = (todo.data?.list || []).find((row) => row.status === 'PENDING');
    if (task) {
      const ap = await api('POST', `/enterprise/crm/approvals/${task.instanceId}/approve`, { taskId: task.id, comment: '冒烟通过' });
      check('CRM approve contract', ap.code === 0, `code=${ap.code} msg=${ap.message}`);
    }
  }

  r = await api('POST', '/enterprise/crm/payment-plans', { contractId, name: '首期', planAmount: '300.00' });
  check('CRM payment plan', r.code === 0 && r.data?.id > 0, `code=${r.code} msg=${r.message}`);
  created.plan = r.data?.id || 0;

  r = await api('POST', '/enterprise/crm/payment-records', { contractId, recordAmount: '100.00', receivedAt: new Date().toISOString() });
  check('CRM payment record', r.code === 0 && r.data?.id > 0, `code=${r.code} msg=${r.message}`);
  created.record = r.data?.id || 0;

  r = await api('POST', '/enterprise/crm/orders', { name: `冒烟订单${suffix}`, customerId, contractId, amount: '500.00' });
  check('CRM create order', r.code === 0 && r.data?.id > 0, `code=${r.code} msg=${r.message}`);
  created.order = r.data?.id || 0;

  r = await api('POST', '/enterprise/crm/products', { name: `冒烟产品${suffix}`, price: '10.00' });
  check('CRM create product', r.code === 0 && r.data?.id > 0, `code=${r.code}`);
  created.product = r.data?.id || 0;

  await login('demo_provider');
  r = await api('POST', '/enterprise/crm/products', { id: created.product, name: '越权改名' });
  check('CRM cross-account product update rejected', r.code !== 0, `code=${r.code} status=${r.status}`);

  await login('demo_enterprise');
  r = await api('POST', '/enterprise/bi/datasets', { name: `冒烟数据集${suffix}`, type: 'INTERNAL', internalKey: 'LEADS' });
  check('BI create internal dataset', r.code === 0 && r.data?.id > 0, `code=${r.code} msg=${r.message}`);
  const datasetId = r.data?.id;
  created.dataset = datasetId;

  r = await api('GET', `/enterprise/bi/datasets/${datasetId}/preview?limit=5`);
  check('BI dataset preview', r.code === 0 && Array.isArray(r.data?.columns), `code=${r.code}`);

  r = await api('POST', '/enterprise/bi/charts', { datasetId, name: `冒烟图表${suffix}`, chartType: 'BAR', config: { dimensions: ['stage'], measures: [{ key: 'lead_count' }] } });
  check('BI create chart', r.code === 0 && r.data?.id > 0, `code=${r.code} msg=${r.message}`);
  const chartId = r.data?.id;
  created.chart = chartId;

  r = await api('GET', `/enterprise/bi/charts/${chartId}/data`);
  check('BI chart data', r.code === 0 && Array.isArray(r.data?.columns), `code=${r.code} msg=${r.message}`);

  r = await api('POST', '/enterprise/bi/dashboards', { name: `冒烟仪表板${suffix}`, layout: [], components: [{ chartId, type: 'CHART', title: '图表1', position: { x: 0, y: 0, w: 6, h: 4 }, config: {} }] });
  check('BI create dashboard', r.code === 0 && r.data?.id > 0, `code=${r.code} msg=${r.message}`);
  created.dashboard = r.data?.id || 0;

  r = await api('GET', `/enterprise/bi/dashboards/${created.dashboard}`);
  check('BI dashboard detail', r.code === 0 && (r.data?.components || []).length === 1, `code=${r.code}`);

  r = await api('POST', '/enterprise/bi/datasets', { name: '非法SQL', type: 'SQL', datasourceId: 1, sqlText: 'DELETE FROM crm_leads' });
  check('BI SQL guard rejects write', r.code !== 0 && r.status === 400, `code=${r.code} status=${r.status}`);

  r = await api('POST', '/enterprise/bi/groups', { name: `冒烟分组${suffix}` });
  const groupId = r.data?.id || 0;
  created.group = groupId;
  await login('demo_provider');
  r = await api('POST', '/enterprise/bi/groups', { id: groupId, name: '越权改名' });
  check('BI cross-account group update rejected', r.code !== 0, `code=${r.code} status=${r.status}`);

  await login('demo_enterprise');
  for (const path of ['/enterprise/service-desk/overview', '/enterprise/service-desk/settings', '/enterprise/service-desk/sites', '/enterprise/service-desk/groups', '/enterprise/service-desk/agents', '/enterprise/service-desk/canned', '/enterprise/service-desk/faqs', '/enterprise/service-desk/stats?days=7', '/enterprise/service-desk/conversations?page=1&pageSize=10']) {
    r = await api('GET', path);
    check(`ServiceDesk GET ${path.split('?')[0]}`, r.code === 0, `code=${r.code} status=${r.status}`);
  }
} catch (error) {
  console.error('SMOKE ERROR', error);
  results.push({ name: 'exception', ok: false, detail: String(error) });
} finally {
  try {
    await login('demo_enterprise');
    if (created.order) await api('DELETE', `/enterprise/crm/orders/${created.order}`);
    if (created.record) await api('DELETE', `/enterprise/crm/payment-records/${created.record}`);
    if (created.plan) await api('DELETE', `/enterprise/crm/payment-plans/${created.plan}`);
    if (created.contract) await api('DELETE', `/enterprise/crm/contracts/${created.contract}`);
    if (created.opportunity) await api('DELETE', `/enterprise/crm/opportunities/${created.opportunity}`);
    if (created.lead) await api('DELETE', `/enterprise/crm/leads/${created.lead}`);
    if (created.product) await api('DELETE', `/enterprise/crm/products/${created.product}`);
    if (created.customer) await api('DELETE', `/enterprise/crm/customers/${created.customer}`);
    if (created.dashboard) await api('DELETE', `/enterprise/bi/dashboards/${created.dashboard}`);
    if (created.chart) await api('DELETE', `/enterprise/bi/charts/${created.chart}`);
    if (created.dataset) await api('DELETE', `/enterprise/bi/datasets/${created.dataset}`);
    if (created.group) await api('DELETE', `/enterprise/bi/groups/${created.group}`);
  } catch (error) {
    console.error('CLEANUP ERROR', error);
  }
  const failed = results.filter((row) => !row.ok);
  console.log(`\nSUMMARY total=${results.length} pass=${results.length - failed.length} fail=${failed.length}`);
  if (failed.length) console.log('FAILED:', JSON.stringify(failed, null, 2));
}