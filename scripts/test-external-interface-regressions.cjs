const assert = require('node:assert/strict');
const Module = require('node:module');
const load = Module._load;
const config = { soap_endpoint: 'http://mock.invalid/soap', target_namespace: 'http://tempuri.org/',
  cancel_soap_action: 'http://tempuri.org/IChemistryService/CancelFlowFromDiGui',
  task_state_soap_action: 'http://tempuri.org/IChemistryService/UpdateMaterialTaskState' };
Module._load = function(name, ...rest) {
  if (name === '../../../config/index.js') return { deliveryConfig: config };
  return load.call(this, name, ...rest);
};
const service = require('../server/src/services/external-report-delivery.ts');
Module._load = load;
const fetchBefore = global.fetch;
let response = '', status = 200, request;
global.fetch = async (url, options) => { request = { url, ...options }; return { ok: status === 200, status, text: async () => response }; };
const result = (method, body) => `<s:Envelope><s:Body><${method}Response><${method}Result>${body}</${method}Result></${method}Response></s:Body></s:Envelope>`;
(async () => {
  response = result('CancelFlowFromDiGui', '<![CDATA[{"Msg":"OK","RecordState":"草稿"}]]>');
  assert.equal((await service.cancelReportFlowFromDiGui('S&1', 'J<1')).ok, true);
  assert.ok(request.body.includes('<sysNumber>S&amp;1</sysNumber>'));
  assert.ok(request.body.includes('<jobNo>J&lt;1</jobNo>'));
  assert.equal(request.headers.SOAPAction, '"http://tempuri.org/IChemistryService/CancelFlowFromDiGui"');
  for (const body of ['{"Msg":"FAILED","RecordState":"草稿"}', '{"Msg":"OK","RecordState":"审核通过"}', '', 'not json']) {
    response = result('CancelFlowFromDiGui', body);
    assert.equal((await service.cancelReportFlowFromDiGui('S', 'J')).ok, false);
  }
  response = result('UpdateMaterialTaskState', '{&quot;Msg&quot;:&quot;OK&quot;}');
  assert.equal((await service.updateMaterialTaskState('T', 1)).ok, true);
  assert.ok(request.body.includes('<taskId>T</taskId><testState>1</testState>'));
  response = result('AcceptReportFromDiGui', '{"Msg":"FAILED"}');
  assert.equal((await service.submitReportToDiGui('S', 'JVBER', 'J')).ok, false);
  response = '<html>proxy error</html>';
  assert.equal((await service.submitReportToDiGui('S', 'JVBER', 'J')).ok, false);
  response = result('AcceptReportFromDiGui', '{"Msg":"OK","ref":"received"}');
  assert.equal((await service.submitReportToDiGui('S', 'JVBER', 'J')).ref, 'received');
  assert.equal((await service.submitReportToDiGui('S', 'JVBER', '')).ok, false);
  status = 500;
  assert.equal((await service.cancelReportFlowFromDiGui('S', 'J')).ok, false);
  global.fetch = async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); };
  assert.equal((await service.cancelReportFlowFromDiGui('S', 'J')).ok, false);
  console.log('External SOAP regressions passed: envelopes, CDATA, failure receipts, missing result/jobNo, HTTP errors and timeout. No real network calls.');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { global.fetch = fetchBefore; });
