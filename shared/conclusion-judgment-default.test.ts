import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateConclusionJudgment, judgmentChoiceValue } from './conclusion-judgment-default';

test('主项目、子项目及旧版结论的判定要求均为可自定义单选，其余字段不变', () => {
  const input: any = [{ name: '结论', section_role: 'conclusion', fields: [
    { id: 'a', code: 'judgment_req', label: '判定要求', type: 'text', default_value: ' 旧要求\n详情' },
    { id: 'b', code: 'child', type: 'textarea', conclusion_role: 'judgment_requirement' },
    { id: 'c', code: 'limit', label: '限值', type: 'text' },
  ] }];
  const original = structuredClone(input);
  const result = updateConclusionJudgment(input);
  for (const field of result[0].fields.slice(0, 2)) {
    assert.equal(field.type, 'select');
    assert.equal(field.allow_multiple, false);
    assert.equal(field.allow_custom, true);
    assert.deepEqual(field.options, ['标准要求', '客户要求']);
  }
  assert.deepEqual(result[0].fields[0].default_value, { custom: ' 旧要求\n详情' });
  assert.deepEqual(result[0].fields[2], original[0].fields[2]);
  assert.deepEqual(input, original);
  assert.deepEqual(updateConclusionJudgment(result), result);
});
test('迁移保留现有标准选项、自定义内容及旧多选内容', () => {
  assert.equal(judgmentChoiceValue('客户要求'), '客户要求');
  assert.equal(judgmentChoiceValue(''), '');
  assert.deepEqual(judgmentChoiceValue({ custom: '原始值' }), { custom: '原始值' });
  assert.deepEqual(judgmentChoiceValue(['其他要求', '客户要求']), { custom: '其他要求、客户要求' });
});

test('初始化模板应用新判定要求默认配置，保持导出快照不变', async () => {
  const { BASE_TEMPLATES } = await import('./base-templates.ts');
  const { RECORD_SEED_SNAPSHOTS } = await import('./seed-record-templates.data.ts');
  const original = JSON.stringify(RECORD_SEED_SNAPSHOTS);
  for (const entry of BASE_TEMPLATES.filter(entry => entry.seed)) {
    const template = entry.build();
    assert.deepEqual(updateConclusionJudgment(template.groups), template.groups, entry.label);
  }
  assert.equal(JSON.stringify(RECORD_SEED_SNAPSHOTS), original);
});

test('旧结构化结论的总项目与子项目选项也更新，旧判定文本不变', () => {
  const groups: any = [{ id: 'g', fields: [{ id: 'f', code: 'f', type: 'record_conclusion', record_conclusion: {
    mode: 'children', project_name: '项目', project_summary: { judgment_requirement: '旧总要求', judgment_options: ['旧选项'] },
    items: [{ id: 'i', code: 'i', judgment_requirement: '旧子要求', judgment_options: ['旧选项'] }],
  } }] }];
  const updated = updateConclusionJudgment(groups);
  const cfg = updated[0].fields[0].record_conclusion!;
  assert.deepEqual(cfg.project_summary!.judgment_options, ['标准要求', '客户要求']);
  assert.deepEqual(cfg.items[0].judgment_options, ['标准要求', '客户要求']);
  assert.equal(cfg.project_summary!.judgment_requirement, '旧总要求');
  assert.equal(cfg.items[0].judgment_requirement, '旧子要求');
  assert.deepEqual(updateConclusionJudgment(updated), updated);
});
