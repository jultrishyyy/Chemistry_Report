import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOrderInfo } from './external-orders.ts';

test('interface 1.1 keeps StartDate/EndDate and merges dates from duplicate project tasks', () => {
  const { order, warnings } = parseOrderInfo({
    OrderNumber: 'ORDER-1',
    CompanyName: '客户',
    SendDate: '2026-09-01T09:00:00',
    SampleList: [{
      SampleName: '样品A',
      BarCode: 'S-A',
      TaskList: [
        { TaskId: 'T-1', ProjectName: '密度', StartDate: null, EndDate: '2026-09-18T12:00:00' },
        { TaskId: 'T-2', ProjectName: '密度', StartDate: '2026-09-16T08:00:00', EndDate: '2026-09-17T18:00:00' },
      ],
    }],
  });

  assert.equal(order.samples[0].test_infos.length, 1);
  assert.equal(order.samples[0].test_infos[0].start_date, '2026-09-16');
  assert.equal(order.samples[0].test_infos[0].end_date, '2026-09-18');
  assert.match(warnings[0], /保留日期等有效字段/);
});

test('interface 1.1 leaves test dates empty when upstream sends null', () => {
  const { order } = parseOrderInfo({
    OrderNumber: 'ORDER-2',
    SampleList: [{ SampleName: '样品A', TaskList: [{ ProjectName: '密度', StartDate: null, EndDate: null }] }],
  });
  assert.equal(order.samples[0].test_infos[0].start_date, undefined);
  assert.equal(order.samples[0].test_infos[0].end_date, undefined);
});
