// TSX_TSCONFIG_PATH=client/tsconfig.app.json node --import tsx scripts/test-formula-arguments.cjs
const assert = require('node:assert/strict');
const React = require('../client/node_modules/react');
const { Select, InputNumber, Button } = require('../client/node_modules/antd');
const Arguments = require('../client/src/components/FieldEditor/MatrixEditor/FormulaArguments.tsx').default;
const original = React.useState;
let slots = [], cursor = 0, inserted;
React.useState = initial => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; };
const sources = [{ value: 'B2', label: 'B2' }, { value: 'B5', label: 'B5' }];
function nodes(node) { if (Array.isArray(node)) return node.flatMap(nodes); if (!node || typeof node !== 'object' || !node.props) return []; return [node, ...nodes(node.props.children)]; }
let item, available = sources;
const render = () => { cursor = 0; return nodes(Arguments({ item, sources: available, onInsert: value => { inserted = value; }, onBack() {} })); };
const select = label => render().find(n => n.type === Select && n.props['aria-label'] === label);
const insert = () => render().find(n => n.type === Button && n.props.children === '插入公式');
function reset(next, list = sources) { slots = []; inserted = undefined; item = { description: '', minSources: 1, ...next }; available = list; }
try {
  reset({ category: '幂与根', name: '平方根', signature: 'SQRT(数值)', example: a => `SQRT(${a[0]})` });
  assert.equal(select('函数参数1').props.value, undefined);
  assert.equal(insert().props.disabled, true, 'multiple sources require an explicit unary choice');
  select('函数参数1').props.onChange('B5');
  assert.equal(insert().props.disabled, false); insert().props.onClick(); assert.equal(inserted, 'SQRT(B5)');
  reset(item, sources.slice(1)); assert.equal(select('函数参数1').props.value, 'B5');
  reset({ category: '统计', name: '求和', signature: 'SUM(数值1, 数值2, …)', example: a => `SUM(${a.join(', ')})` });
  assert.deepEqual(select('函数来源').props.value, ['B2', 'B5']);
  select('函数来源').props.onChange(['B5']); insert().props.onClick(); assert.equal(inserted, 'SUM(B5)');
  select('函数来源').props.onChange([]); assert.equal(insert().props.disabled, true);
  reset({ category: '幂与根', name: 'n 次方', signature: 'POWER(数值, 次数)', example: a => `POWER(${a[0]}, ${a[1]})` });
  assert.equal(select('函数参数1').props.value, undefined);
  assert.equal(select('函数参数2').props.value, '__constant__');
  select('函数参数1').props.onChange('B5'); insert().props.onClick(); assert.equal(inserted, 'POWER(B5, 3)');
  select('函数参数2').props.onChange('B2'); insert().props.onClick(); assert.equal(inserted, 'POWER(B5, B2)');
  select('函数参数2').props.onChange('__constant__');
  render().find(n => n.type === InputNumber).props.onChange(0); insert().props.onClick(); assert.equal(inserted, 'POWER(B5, 0)');
  reset({ category: '幂与根', name: '平方', signature: '数值 ^ 2', example: a => `${a[0]}^2` }, []);
  select('函数参数1').props.onChange('__constant__'); render().find(n => n.type === InputNumber).props.onChange(-2);
  insert().props.onClick(); assert.equal(inserted, '(-2)^2', 'negative constants preserve precedence');
  reset({ category: '比例与常量', name: '圆周率', signature: 'PI()', minSources: 0, example: () => 'PI()' }, []);
  assert.equal(insert().props.disabled, false); insert().props.onClick(); assert.equal(inserted, 'PI()');
  console.log('Formula arguments: explicit unary choice, aggregate subset, multiple parameters, constants and precedence passed');
} finally { React.useState = original; }
