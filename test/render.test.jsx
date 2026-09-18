import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createInitialState, toggleInclude, planPublish, latestRelease } from '../src/model/store.js';
import Workbench from '../src/components/Workbench.jsx';
import { VisitorList, VisitorCode, VisitorSnapshotDetail } from '../src/components/Visitor.jsx';

// 浏览器 API 存根
globalThis.window = {
  location: { hash: '', origin: 'http://localhost', pathname: '/' },
  addEventListener() {}, removeEventListener() {},
};
globalThis.navigator = { clipboard: { writeText: async () => {} } };
globalThis.document = {
  createElement: () => ({ style: {}, click() {}, remove() {} }),
  execCommand: () => true, body: { appendChild() {}, },
};

const noop = () => {};
let state = createInitialState();
const code = latestRelease(state).items[0].shortCode;

test('工作台渲染：含发布按钮、发布记录、草稿提示', () => {
  const html = renderToString(<Workbench state={state} dispatch={noop} notify={noop} />);
  assert.match(html, /发布更新/);
  assert.match(html, /发布记录/);
  assert.match(html, /访客正在看/);
  assert.match(html, /纳入下一次发布/);
});

test('访客列表渲染最新快照展项', () => {
  const html = renderToString(<VisitorList state={state} />);
  assert.match(html, /潮汐之后/);
  assert.match(html, /柔软的边界/);
  assert.doesNotMatch(html, /未寄出的信/, '草稿不出现在访客页');
});

test('短码解析：有效码展示内容', () => {
  const html = renderToString(<VisitorCode state={state} code={code} />);
  assert.match(html, /潮汐之后/);
  assert.match(html, new RegExp(code));
});

test('短码解析：撤回码显示撤回提示且可核对旧快照', () => {
  const target = latestRelease(state).items.find((i) => i.title === '柔软的边界');
  let s = toggleInclude(state, target.id);
  s = planPublish(s).state;
  const html = renderToString(<VisitorCode state={s} code={target.shortCode} />);
  assert.match(html, /已撤回/);
  assert.match(html, new RegExp(`v1`));
  assert.match(html, /不再展示内容/);
});

test('未知短码页', () => {
  const html = renderToString(<VisitorCode state={state} code="zzzz" />);
  assert.match(html, /找不到该/);
});

test('历史快照页固定为当时内容', () => {
  let s = state;
  const target = s.exhibits[0];
  s = { ...s, exhibits: s.exhibits.map((e) => (e.id === target.id ? { ...e, title: '潮汐之后（草稿修改）' } : e)) };
  s = planPublish(s).state; // v2
  const v1Html = renderToString(<VisitorList state={s} version={1} />);
  assert.match(v1Html, /历史快照/);
  assert.match(v1Html, /潮汐之后</); // 非贪婪意义上的包含旧标题文本
});

test('历史快照详情页可打开', () => {
  const target = latestRelease(state).items[0];
  const html = renderToString(<VisitorSnapshotDetail state={state} version={1} code={target.shortCode} />);
  assert.match(html, /潮汐之后/);
  assert.match(html, /固定内容|历史快照/);
});

test('无任何发布时访客页给出空状态', () => {
  const empty = { exhibits: [], seq: { id: 0, code: 100000 }, releases: [] };
  const html = renderToString(<VisitorList state={empty} />);
  assert.match(html, /尚未发布/);
});
