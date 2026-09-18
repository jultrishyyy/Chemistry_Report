const assert = require('node:assert/strict');
const Module = require('node:module');
const { JSDOM } = require('../client/node_modules/jsdom');
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement']) Object.defineProperty(global, key, { configurable: true, value: dom.window[key] });
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('../client/node_modules/react');
const { createRoot } = require('../client/node_modules/react-dom/client');
let modal, input, saved;
const passthrough = props => React.createElement('div', null, props.children);
const Input = props => { input = props; return React.createElement('textarea'); };
Input.TextArea = Input;
const mockAntd = new Proxy({ Input,
  Modal: props => { modal = props; return React.createElement('div', null, props.children); },
  Tabs: props => React.createElement('div', null, props.items.find(item => item.key === props.activeKey)?.children),
}, { get: (object, key) => object[key] || passthrough });
const originalLoad = Module._load;
Module._load = function(name, ...rest) { return name === 'antd' ? mockAntd : originalLoad.call(this, name, ...rest); };
const Picker = require('../client/src/components/ReportEditor/BindingPickerModal.tsx').default;
Module._load = originalLoad;
const { SECTION_PRESETS } = require('../client/src/components/FieldEditor/section-presets.ts');
const { categoriesForEditor } = require('../client/src/components/FieldEditor/field-types.ts');
const root = createRoot(document.getElementById('root'));
(async () => {
  for (const compactFreeGrid of [false, true]) {
    saved = undefined;
    await React.act(async () => root.render(React.createElement(Picker, {
      key: String(compactFreeGrid), open: true, value: { source: 'literal', text: '' }, linkedRecord: { groups: [] },
      compactFreeGrid, contentValuePresent: false, allowedSources: ['literal'], onClose() {}, onChange() {},
      onCombinedChange: value => { saved = value; },
    })));
    await React.act(async () => input.onChange({ target: { value: '自定义表头' } }));
    await React.act(async () => modal.onOk());
    assert.deepEqual(saved, { source: 'literal', text: '自定义表头' }, 'new content must not be discarded on commit');
  }
  let id = 0;
  const result = SECTION_PRESETS.find(p => p.key === 'proj_result').build(() => String(++id));
  assert.equal(result.fields[0].type, 'free_grid');
  assert.equal(result.fields[0].free_table.cells['header::col_item'], '项目');
  assert.equal(categoriesForEditor('report-project').some(c => c.key === 'report_result'), false);
  for (const preset of SECTION_PRESETS.filter(p => p.build(() => String(++id)).section_role === 'images')) {
    const group = preset.build(() => String(++id));
    assert.equal(group.image_layout?.caption, undefined);
    assert.ok(group.fields.every(f => !f.caption));
  }
  await React.act(async () => root.unmount());
  console.log('Project template: normal/compact binding commits, editable literal text, free-grid defaults and caption-free image presets passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
