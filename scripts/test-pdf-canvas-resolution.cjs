// Actual component lifecycle; PDF.js raster work is mocked to inspect requested pixel sizes.
const assert = require('node:assert/strict');
const { JSDOM } = require('../client/node_modules/jsdom');
const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'ShadowRoot', 'SVGElement', 'getComputedStyle']) Object.defineProperty(global, key, { configurable: true, value: dom.window[key] });
global.IS_REACT_ACT_ENVIRONMENT = true;
let width = 624, observer, renders = [], failLoading = false;
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get: () => width });
Object.defineProperty(window, 'devicePixelRatio', { value: 2 });
window.HTMLCanvasElement.prototype.getContext = () => ({});
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
global.ResizeObserver = class { constructor(callback) { observer = callback; } observe() {} disconnect() {} };
const Module = require('module'), originalLoad = Module._load;
Module._load = function(name, ...rest) {
  if (name.includes('pdf.worker')) return '';
  if (name === 'pdfjs-dist') return { GlobalWorkerOptions: {}, getDocument: () => { if (failLoading) throw Error('simulated PDF load failure'); return ({ destroy: async () => {}, promise: Promise.resolve({ numPages: 1, getPage: async () => ({
    getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }),
    render: ({ canvas }) => { renders.push([canvas.width, canvas.height]); return { promise: Promise.resolve() }; }, getAnnotations: async () => [],
  }) }) }); } };
  return originalLoad.call(this, name, ...rest);
};
const React = require('../client/node_modules/react'), { createRoot } = require('../client/node_modules/react-dom/client');
const Preview = require('../client/src/components/TypstViewer/PdfPreview.tsx').default;
const root = createRoot(document.getElementById('root'));
const settle = () => new Promise(resolve => setTimeout(resolve, 300));
(async () => {
  await React.act(async () => { root.render(React.createElement(Preview, { url: 'mock.pdf' })); await settle(); });
  assert.equal(renders.at(-1)[0], 1200);
  await React.act(async () => { document.querySelector('[aria-label="放大 PDF"]').click(); await settle(); });
  assert.ok(renders.at(-1)[0] > 1200, 'zoom must increase real canvas resolution');
  const count = renders.length;
  width = 0;
  await React.act(async () => { observer(); await settle(); });
  assert.equal(renders.length, count, 'hidden preview must not paint at 200px fallback');
  width = 1024;
  await React.act(async () => { observer(); await settle(); });
  assert.ok(renders.length > count);
  assert.ok(renders.at(-1)[0] >= 2000, 'revealing wider panel must repaint, not stretch');
  failLoading = true;
  await React.act(async () => { root.render(React.createElement(Preview, { url: 'failed.pdf' })); await settle(); });
  assert.ok(document.body.textContent.includes('PDF 显示失败'), 'load failure must be visible, not only logged');
  failLoading = false;
  const retry = [...document.querySelectorAll('button')].find(button => button.textContent.replace(/\s/g, '') === '重试');
  assert.ok(retry);
  await React.act(async () => { retry.click(); await settle(); });
  assert.ok(!document.body.textContent.includes('PDF 显示失败'), 'retry recovers the preview');
  await React.act(async () => root.unmount());
  Module._load = originalLoad; dom.window.close();
  console.log('PDF canvas: zoom resolution, hidden panel, wider reveal, load failure and retry passed'); process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
