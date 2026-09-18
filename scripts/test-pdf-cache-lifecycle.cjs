const assert = require('node:assert/strict');
const axios = require('../client/node_modules/axios').default;
const { compileTypst, clearCompileCache } = require('../client/src/components/TypstViewer/typst-compiler.ts');
let requests = 0;
const original = axios.post;
axios.post = async () => { requests++; return { data: new Uint8Array([37, 80, 68, 70]) }; };
(async () => {
  const first = await compileTypst('same-template');
  URL.revokeObjectURL(first); // closing the first preview
  const reopened = await compileTypst('same-template');
  const other = await compileTypst('same-template');
  assert.notEqual(reopened, first);
  assert.notEqual(other, reopened);
  assert.equal(requests, 1, 'cached PDF bytes avoid recompiling');
  assert.equal(await (await fetch(reopened)).text(), '%PDF');
  URL.revokeObjectURL(reopened);
  assert.equal(await (await fetch(other)).text(), '%PDF', 'closing one preview cannot invalidate another');
  clearCompileCache();
  assert.equal(await (await fetch(other)).text(), '%PDF', 'cache eviction must not invalidate an open preview');
  URL.revokeObjectURL(other);
  axios.post = original;
  console.log('PDF cache: reopen, independent consumers, reuse and eviction passed');
})().catch(error => { axios.post = original; console.error(error); process.exitCode = 1; });
