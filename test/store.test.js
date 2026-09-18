import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState, addExhibit, updateExhibit, toggleInclude, planPublish,
  latestRelease, releaseByVersion, resolveCode, exhibitView, planChanges,
  loadState, saveState, encodeCode,
} from '../src/model/store.js';

const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), _m: m };
};

test('初始种子：已发布展项进入 v1 快照并分配不复用短码', () => {
  const s = createInitialState();
  assert.equal(s.releases.length, 1);
  assert.equal(latestRelease(s).version, 1);
  assert.equal(latestRelease(s).items.length, 2);
  const codes = latestRelease(s).items.map((i) => i.shortCode);
  assert.ok(codes.every(Boolean), '已发布项必须有短码');
  assert.equal(new Set(codes).size, codes.length, '短码不能重复');
  assert.equal(s.exhibits[1].shortCode, null, '草稿项未分配短码');
});

test('短码编码：计数器单调、只用安全字符', () => {
  const a = encodeCode(100000);
  const b = encodeCode(100001);
  assert.notEqual(a, b);
  assert.match(a, /^[abcdefghjkmnpqrstuvwxyz23456789]+$/);
  assert.ok(a.length >= 4);
});

test('编辑只落在草稿：发布后继续修改不改变已分享快照', () => {
  let s = createInitialState();
  const before = latestRelease(s).items.find((i) => i.title === '潮汐之后');
  // 修改草稿 + 不发布
  s = updateExhibit(s, before.id, { title: '潮汐之后（改标题）' });
  const after = latestRelease(s).items.find((i) => i.id === before.id);
  assert.equal(after.title, '潮汐之后', '快照标题保持不变');
  // 访客解析结果仍是旧内容
  assert.equal(resolveCode(s, before.shortCode).item.title, '潮汐之后');
  // 下一次发布确实检测到更新
  const changes = planChanges(s);
  assert.ok(changes.updated.some((e) => e.id === before.id));
});

test('发布闸门：从未发布且无已发布项时阻止并说明原因', () => {
  // 构造空发布状态
  let s = { exhibits: [], seq: { id: 0, code: 100000 }, releases: [] };
  const r = planPublish(s);
  assert.equal(r.ok, false);
  assert.match(r.reason, /没有任何展项/, '必须给出可读原因');

  // 有展项但都没勾选（全是草稿）同样阻止
  s = addExhibit(s, { title: '只有草稿' }).state;
  const r2 = planPublish(s);
  assert.equal(r2.ok, false);
  assert.match(r2.reason, /至少勾选一个展项/);
});

test('发布闸门：撤回全部会导致空访客页，阻止', () => {
  let s = createInitialState();
  s.exhibits.forEach((e) => { if (e.included) s = toggleInclude(s, e.id); });
  const changes = planChanges(s);
  assert.equal(changes.removed.length, 2);
  const r = planPublish(s);
  assert.equal(r.ok, false);
  assert.match(r.reason, /没有任何展项/);
  assert.equal(s.releases.length, 1, '阻止后不得新增快照');
});

test('发布闸门：内容与最新快照一致时阻止（无意义发布）', () => {
  const s = createInitialState();
  const r = planPublish(s);
  assert.equal(r.ok, false);
  assert.match(r.reason, /完全一致/);
});

test('撤回：短码失效，但旧快照仍可核对；恢复发布复用同一短码', () => {
  let s = createInitialState();
  const target = latestRelease(s).items.find((i) => i.title === '柔软的边界');
  const code = target.shortCode;

  // 取消勾选并发布（此时仍有另一个展项，闸门放行）
  s = toggleInclude(s, target.id);
  const v = exhibitView(s, s.exhibits.find((e) => e.id === target.id));
  assert.equal(v.status, 'live');
  assert.equal(v.change, 'removed');
  const r = planPublish(s);
  assert.equal(r.ok, true);
  s = r.state;
  assert.equal(latestRelease(s).version, 2);

  // 短码在最新快照解析为 withdrawn
  const res = resolveCode(s, code);
  assert.equal(res.status, 'withdrawn');
  assert.equal(res.item.title, '柔软的边界', '旧快照内容仍可核对');
  assert.equal(res.release.version, 1, '指向包含它的最后一个快照 v1');
  // 旧快照仍可直接访问
  const v1 = releaseByVersion(s, 1);
  assert.ok(v1.items.some((i) => i.shortCode === code));

  // 编辑视角为“已撤回”，尚未勾回时没有待处理变化（草稿与最新快照一致：不在发布集合）
  let after = exhibitView(s, s.exhibits.find((e) => e.id === target.id));
  assert.equal(after.status, 'withdrawn');
  assert.equal(after.change, null);
  // 勾回 => 待重新发布（readded），不发布仍处于撤回态
  s = toggleInclude(s, target.id);
  after = exhibitView(s, s.exhibits.find((e) => e.id === target.id));
  assert.equal(after.status, 'withdrawn');
  assert.equal(after.change, 'readded');
  assert.equal(resolveCode(s, code).status, 'withdrawn', '发布前短码仍失效');

  // 重新发布：恢复同一短码，且不分配新码
  const r2 = planPublish(s);
  assert.equal(r2.ok, true);
  s = r2.state;
  assert.equal(resolveCode(s, code).status, 'live');
  assert.equal(resolveCode(s, code).item.title, '柔软的边界');
  assert.equal(latestRelease(s).items.find((i) => i.id === target.id).shortCode, code);
});

test('短码永不复用给其他展项，即使旧码已失效', () => {
  let s = createInitialState();
  const target = latestRelease(s).items[0];
  const oldCode = target.shortCode;
  // 撤回 target 并发布
  s = toggleInclude(s, target.id);
  s = planPublish(s).state;
  // 新增一个展项并发布
  const added = addExhibit(s, { title: '新作品', room: 'D01' });
  s = added.state;
  s = toggleInclude(s, added.exhibit.id);
  const r = planPublish(s);
  s = r.state;
  const newItem = latestRelease(s).items.find((i) => i.id === added.exhibit.id);
  assert.notEqual(newItem.shortCode, oldCode, '新展项不能拿到失效短码');
  // 所有曾出现的短码仍只属于同一 id
  latestRelease(s).items.forEach((i) => {
    if (i.id !== target.id) assert.notEqual(i.shortCode, oldCode);
  });
});

test('新增展项：默认草稿 → 勾选 → 发布才对访客可见', () => {
  let s = createInitialState();
  const r = addExhibit(s, { title: '夜间回声', room: 'D02 · 声音' });
  s = r.state;
  const id = r.exhibit.id;
  assert.equal(exhibitView(s, r.exhibit).status, 'draft');
  assert.equal(exhibitView(s, r.exhibit).change, null, '未勾选时不算待发布');
  // 访客看不到
  assert.equal(latestRelease(s).items.some((i) => i.id === id), false);
  // 勾选但不发布仍不可见
  s = toggleInclude(s, id);
  assert.equal(exhibitView(s, s.exhibits.find((e) => e.id === id)).change, 'added');
  assert.equal(latestRelease(s).items.some((i) => i.id === id), false);
  // 发布后可见且有新短码
  const pub = planPublish(s);
  s = pub.state;
  assert.equal(pub.changes.added.length, 1);
  assert.ok(latestRelease(s).items.find((i) => i.id === id).shortCode);
});

test('历史快照不可变：连续发布产生 v1/v2/v3，旧版本内容冻结', () => {
  let s = createInitialState();
  const a = s.exhibits[0];
  s = updateExhibit(s, a.id, { desc: '更新后的介绍' });
  s = planPublish(s).state; // v2
  s = updateExhibit(s, a.id, { title: '再次改名' });
  s = planPublish(s).state; // v3

  const v1 = releaseByVersion(s, 1);
  const v2 = releaseByVersion(s, 2);
  const v3 = releaseByVersion(s, 3);
  assert.equal(v1.items.find((i) => i.id === a.id).desc, '一件记录海岸线变化的沉浸式影像装置。');
  assert.equal(v2.items.find((i) => i.id === a.id).desc, '更新后的介绍');
  assert.equal(v2.items.find((i) => i.id === a.id).title, '潮汐之后');
  assert.equal(v3.items.find((i) => i.id === a.id).title, '再次改名');
  assert.notEqual(v1.hash, v2.hash);
});

test('持久化：保存后重新加载，草稿/发布状态完全保持', () => {
  const storage = memStorage();
  let s = createInitialState();
  s = toggleInclude(s, s.exhibits[1].id); // 草稿勾上但不发布
  saveState(s, storage);
  const loaded = loadState(storage);
  assert.deepEqual(loaded.seq, s.seq);
  assert.equal(loaded.releases.length, 1);
  assert.equal(loaded.exhibits.find((e) => e.id === 2).included, true, '待发布勾选状态保持');
});

test('迁移 v1 原型数据：已发布/草稿状态被正确导入', () => {
  const storage = memStorage();
  storage.setItem('guide-exhibits', JSON.stringify([
    { id: 1, title: '旧作品A', room: 'A', type: '装置', desc: 'x', audio: '', status: '已发布', color: '#fff' },
    { id: 2, title: '旧作品B', room: 'B', type: '绘画', desc: 'y', audio: '', status: '草稿', color: '#eee' },
  ]));
  const s = loadState(storage);
  assert.equal(latestRelease(s).items.length, 1);
  assert.equal(latestRelease(s).items[0].title, '旧作品A');
  assert.equal(s.exhibits.find((e) => e.id === 2).included, false);
});

test('损坏的持久化数据回落到种子', () => {
  const storage = memStorage();
  storage.setItem('guide-state-v2', '{not-json');
  const s = loadState(storage);
  assert.ok(isValidShape(s));
  function isValidShape(x) { return Array.isArray(x.exhibits) && Array.isArray(x.releases); }
});

test('未知短码解析为 unknown', () => {
  const s = createInitialState();
  assert.equal(resolveCode(s, 'zzzz').status, 'unknown');
});
