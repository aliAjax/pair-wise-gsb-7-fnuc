import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// ---- jsdom 环境必须在导入 React 之前就位 ----
const here = dirname(fileURLToPath(import.meta.url));
void resolve(here, '..');

// jsdom 环境必须在导入 React 之前就位
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;
globalThis.Event = dom.window.Event;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { act } = await import('react');

// jsdom 下把图片二维码转 dataURL 的 canvas 调用会静默失败，组件有兜底，不影响断言

const container = document.getElementById('root');
let root;
await act(async () => {
  root = createRoot(container);
  const { default: App } = await import('../src/App.jsx');
  root.render(<App />);
});

const find = (sel, el = document) => el.querySelector(sel);
const findAll = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const text = (el) => (el ? el.textContent : '');
const click = async (el) => { await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }); };
const type = async (el, value) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
};
const setHash = async (h) => {
  await act(async () => { window.location.hash = h; });
  await new Promise((r) => setTimeout(r, 0));
};
const flush = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function rowByTitle(t) {
  return findAll('.exhibit-row').find((r) => text(r).includes(t));
}

test('初始：工作台显示 v1 线上标记，访客页只有已发布两项', async () => {
  assert.match(text(find('.side-foot')), /线上版本 v1/);
  assert.ok(text(find('.history-row.current')).includes('访客正在看'));
  await setHash('#/visitor');
  const cards = findAll('.visitor-card');
  assert.equal(cards.length, 2);
  assert.ok(text(document.body).includes('潮汐之后'));
  assert.ok(!text(document.body).includes('未寄出的信'));
  await setHash('#/edit');
});

test('编辑只落草稿：改标题后访客页与二维码内容不变，直到发布', async () => {
  // 选中第一项并改标题
  await click(rowByTitle('潮汐之后'));
  const titleInput = find('.editor label input:not([type=checkbox])');
  await type(titleInput, '潮汐之后（修订稿）');
  assert.ok(text(find('.draft-banner')).includes('未发布修改') || text(find('.draft-banner')).includes('草稿'));
  // 未发布：访客页仍旧
  await setHash('#/visitor');
  assert.ok(text(document.body).includes('潮汐之后'));
  assert.ok(!text(document.body).includes('修订稿'));
  // 二维码短码详情页也是旧标题
  const codeOnCard = text(find('.visitor-card .art span'));
  await setHash(`#/c/${codeOnCard}`);
  assert.ok(text(document.body).includes('潮汐之后'));
  assert.ok(!text(document.body).includes('修订稿'));
  await setHash('#/edit');
});

test('发布闸门：无变化时阻止并说明原因', async () => {
  // 当前有未发布修改，先检查弹窗显示变化组
  await click(find('.top-actions .primary'));
  await flush();
  let modal = find('.modal');
  assert.ok(modal && text(modal).includes('内容更新'), '应列出更新分组');
  // 先发布掉这次修改，便于下一步验证
  await click(find('.modal-foot .primary'));
  await flush();
  assert.ok(text(find('.toast')).includes('已发布 v2'));

  // 再打开发布：完全一致 => 阻止
  await click(find('.top-actions .primary'));
  await flush();
  modal = find('.modal');
  assert.ok(text(modal).includes('无法发布'));
  assert.ok(text(modal).includes('完全一致'));
  await click(find('.modal .secondary'));
});

test('发布后：访客页与短码页读到 v2 新内容', async () => {
  await setHash('#/visitor');
  assert.ok(text(document.body).includes('潮汐之后（修订稿）'));
  const code = text(find('.visitor-card .art span'));
  await setHash(`#/c/${code}`);
  assert.ok(text(document.body).includes('潮汐之后（修订稿）'));
  // 回到列表
  await setHash('#/edit');
});

test('历史快照不被后续修改影响（v1 仍是旧标题）', async () => {
  await setHash('#/v/1');
  assert.ok(text(document.body).includes('历史快照'));
  assert.ok(text(document.body).includes('潮汐之后'));
  assert.ok(!text(document.body).includes('修订稿'));
  // v1 详情链接打开也固定
  const code = text(find('.visitor-card .art span'));
  await setHash(`#/v/1/c/${code}`);
  assert.ok(text(document.body).includes('历史快照'));
  assert.ok(!text(document.body).includes('修订稿'));
  await setHash('#/edit');
});

test('新增展项走草稿 → 勾选 → 发布；新短码不复用', async () => {
  const existingCodes = new Set();
  findAll('.exhibit-row small').forEach((s) => {
    const m = text(s).match(/短码 (\w+)/);
    if (m) existingCodes.add(m[1]);
  });
  const inputs = findAll('.new-form input');
  await type(inputs[0], '夜间回声');
  await type(inputs[1], 'D02 · 声音');
  await click(find('.new-form .primary'));
  await flush();
  const row = rowByTitle('夜间回声');
  assert.ok(row, '新展项出现在列表');
  assert.ok(text(row).includes('草稿'));
  // 发布前访客看不到
  await setHash('#/visitor');
  assert.ok(!text(document.body).includes('夜间回声'));
  await setHash('#/edit');
  // 勾选并发布
  const row2 = rowByTitle('夜间回声');
  await click(find('input[type=checkbox]', row2));
  await click(find('.top-actions .primary'));
  await flush();
  assert.ok(text(find('.modal')).includes('新增上线'));
  await click(find('.modal-foot .primary'));
  await flush();
  const row3 = rowByTitle('夜间回声');
  const m = text(find('small', row3)).match(/短码 (\w+)/);
  assert.ok(m, '发布后分配了短码');
  assert.ok(!existingCodes.has(m[1]), '新短码与既有短码不重复');
  await setHash('#/visitor');
  assert.equal(findAll('.visitor-card').length, 3);
  assert.ok(text(document.body).includes('夜间回声'));
  await setHash('#/edit');
});

test('撤回：发布后短码失效页、旧快照仍可核对、访客列表减少', async () => {
  // 撤回“柔软的边界”（v1 起就存在），另两项保留所以发布允许
  const row = rowByTitle('柔软的边界');
  const codeMatch = text(find('small', row)).match(/短码 (\w+)/);
  const withdrawnCode = codeMatch[1];
  await click(find('input[type=checkbox]', row));
  await click(find('.top-actions .primary'));
  await flush();
  assert.ok(text(find('.modal')).includes('撤回下线'));
  await click(find('.modal-foot .primary'));
  await flush();
  assert.ok(text(find('.toast')).includes('撤回 1'));
  // 列表状态变为已撤回，短码仍显示
  const rowAfter = rowByTitle('柔软的边界');
  assert.ok(text(rowAfter).includes('已撤回'));
  assert.ok(text(rowAfter).includes(withdrawnCode));
  // 访客列表 2 项
  await setHash('#/visitor');
  assert.equal(findAll('.visitor-card').length, 2);
  assert.ok(!text(document.body).includes('柔软的边界'));
  // 短码页：失效提示 + 核对入口
  await setHash(`#/c/${withdrawnCode}`);
  assert.ok(text(document.body).includes('已撤回'));
  assert.ok(text(document.body).includes('不再展示内容'));
  assert.ok(text(document.body).includes('查看'));
  // 点核对入口跳到包含它的最后快照
  await click(find('.invalid-actions .primary'));
  await flush();
  assert.ok(window.location.hash.includes(`/c/${withdrawnCode}`));
  assert.ok(text(document.body).includes('柔软的边界'), '旧快照详情可核对');
  await setHash('#/edit');
});

test('撤回全部：被闸门阻止且线上保持不变', async () => {
  // 在 act 中逐个取消所有勾选
  for (const r of findAll('.exhibit-row')) {
    const cb = find('input[type=checkbox]', r);
    if (cb && cb.checked) await click(cb);
  }
  await click(find('.top-actions .primary'));
  await flush();
  const modal = find('.modal');
  assert.ok(text(modal).includes('无法发布'));
  assert.ok(text(modal).includes('至少勾选一个展项'));
  await click(find('.modal .secondary'));
  // 访客页仍是上一版本的 2 项
  await setHash('#/visitor');
  assert.equal(findAll('.visitor-card').length, 2);
  await setHash('#/edit');
});

test('刷新一致性：重载后草稿勾选、发布状态、访客结果保持', async () => {
  const persisted = JSON.parse(localStorage.getItem('guide-state-v2'));
  assert.ok(persisted.releases.length >= 3, `应有多条发布记录，实际 ${persisted.releases.length}`);
  // 模拟刷新：卸载重建（localStorage 已持久化）
  await act(async () => { root.unmount(); });
  await act(async () => {
      const { createRoot: cr2 } = await import('react-dom/client');
      root = cr2(container);
      const { default: App2 } = await import('../src/App.jsx?t=' + Date.now());
      root.render(<App2 />);
    });
  await flush();
  assert.ok(text(find('.side-foot')).includes(`v${persisted.releases.length}`), '侧栏显示最新版本');
  // 撤回项仍是撤回状态
  assert.ok(text(rowByTitle('柔软的边界')).includes('已撤回'));
  // 访客结果与最新快照一致
  await setHash('#/visitor');
  assert.equal(findAll('.visitor-card').length, persisted.releases[persisted.releases.length - 1].items.length);
});
