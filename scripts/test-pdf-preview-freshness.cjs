// Deterministic component-state test for debounce, stale responses and downloads.
const assert = require('node:assert/strict');
const React = require('../client/node_modules/react');
const axios = require('../client/node_modules/axios').default;
// PDF canvas layout is outside this state/transport test.
const previewPath = require.resolve('../client/src/components/TypstViewer/PdfPreview.tsx');
require.cache[previewPath] = { id: previewPath, filename: previewPath, loaded: true, exports: { default: () => null } };
const Viewer = require('../client/src/components/TypstViewer/index.tsx').default;
const original = { state: React.useState, ref: React.useRef, effect: React.useEffect, callback: React.useCallback, imperative: React.useImperativeHandle, post: axios.post, timer: global.setTimeout, clear: global.clearTimeout };
let slots = [], cursor = 0, effects = [], timers = new Map(), id = 0, requests = [];
React.useState = initial => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; };
React.useRef = initial => React.useState(() => ({ current: initial }))[0];
React.useCallback = (fn, deps) => { const i = cursor++; if (!slots[i] || deps.some((d, j) => d !== slots[i].deps[j])) slots[i] = { fn, deps }; return slots[i].fn; };
React.useEffect = (fn, deps) => { const i = cursor++; if (!slots[i] || deps.some((d, j) => d !== slots[i].deps[j])) { slots[i]?.cleanup?.(); slots[i] = { deps }; effects.push(() => { slots[i].cleanup = fn(); }); } };
let handle;
React.useImperativeHandle = (_ref, create) => { handle = create(); };
global.setTimeout = fn => { timers.set(++id, fn); return id; }; global.clearTimeout = id => timers.delete(id);
axios.post = () => new Promise((resolve, reject) => requests.push({ resolve, reject }));
const nodes = n => Array.isArray(n) ? n.flatMap(nodes) : n?.props ? [n, ...nodes(n.props.children)] : [];
const download = tree => nodes(tree).find(n => n.type === 'a' && n.props.download);
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const props = { source: 'A', mode: 'view', enableSync: false };
const render = () => { cursor = 0; const tree = Viewer.render(props, null); effects.splice(0).forEach(fn => fn()); return tree; };
const runTimer = () => { const tasks = [...timers.values()]; timers.clear(); tasks.forEach(fn => fn()); };
(async () => {
  try {
    let tree = render(); assert.equal(download(tree), undefined); runTimer();
    props.source = 'B'; tree = render();
    requests[0].resolve({ data: new Uint8Array([1]) }); await flush();
    tree = render(); assert.equal(download(tree), undefined, 'old request cannot become downloadable during next debounce');
    runTimer(); requests[1].resolve({ data: new Uint8Array([2]) }); await flush();
    tree = render(); assert.ok(download(tree));
    props.source = 'C'; tree = render(); assert.equal(download(tree), undefined, 'editing immediately removes stale download'); runTimer();
    props.source = 'D'; tree = render(); runTimer();
    requests[3].resolve({ data: new Uint8Array([4]) }); await flush();
    tree = render(); const latest = download(tree).props.href;
    requests[2].resolve({ data: new Uint8Array([3]) }); await flush();
    assert.equal(download(render()).props.href, latest, 'out-of-order response cannot overwrite latest PDF');
    props.source = 'E'; render(); runTimer(); requests[4].reject(new Error('compile failed')); await flush();
    assert.equal(download(render()), undefined, 'failed compile never offers stale download');
    slots.forEach(slot => slot?.cleanup?.());
    slots = []; effects = []; timers.clear(); requests = [];
    props.enableSync = true; props.source = 'sync-A';
    tree = render(); runTimer();
    handle.scrollToMarker('proj1::body', 'proj1::group', { mode: 'text' });
    requests[0].resolve({ data: new Uint8Array([5]) }); await flush();
    requests[1].resolve({ data: { markers: [
      { kind: 'field', code: 'proj0::body', page: 1, y: 20 },
      { kind: 'field', code: 'proj1::body', page: 3, y: 60 },
    ] } }); await flush();
    tree = render();
    const preview = nodes(tree).find(node => node.props.apiRef && node.props.onApiReady);
    assert.ok(preview);
    const jumps = [];
    preview.props.apiRef.current = { scrollToPdfPoint: (page, y) => jumps.push([page, y]), highlightPdfPoint() {}, clearHighlight() {} };
    preview.props.onApiReady();
    assert.deepEqual(jumps, [[3, 60]], 'pending focus survives PDF API mount and respects project prefix');
    handle.scrollToMarker('proj1::body', 'proj1::group');
    assert.equal(jumps.length, 2, 'repeated clicks can request another scroll');
    props.source = 'sync-B'; render();
    handle.scrollToMarker('proj1::body', 'proj1::group');
    assert.equal(jumps.length, 2, 'new source must not use stale marker coordinates');
    runTimer(); requests[2].resolve({ data: new Uint8Array([6]) }); await flush();
    requests[3].resolve({ data: { markers: [{ kind: 'field', code: 'proj1::body', page: 4, y: 80 }] } }); await flush();
    assert.deepEqual(jumps.at(-1), [4, 80], 'new compilation applies pending focus using fresh positions');
    slots.forEach(slot => slot?.cleanup?.());
    console.log('PDF preview: debounce invalidation, latest response, pending/failed download protection passed');
    console.log('PDF focus: repeated requests, delayed API mount, project isolation and fresh marker coordinates passed');
  } finally {
    React.useState = original.state; React.useRef = original.ref; React.useEffect = original.effect; React.useCallback = original.callback; React.useImperativeHandle = original.imperative;
    axios.post = original.post; global.setTimeout = original.timer; global.clearTimeout = original.clear;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
