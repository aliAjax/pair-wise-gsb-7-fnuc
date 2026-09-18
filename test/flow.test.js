import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState, addExhibit, updateExhibit, toggleInclude, planPublish,
  latestRelease, releaseByVersion, resolveCode, exhibitView,
} from '../src/model/store.js';

// 完整用户旅程：编辑 → 空发布被拦 → 发布 → 发布后再改不动旧链接 → 撤回 → 核对 → 恢复
test('端到端：完整发布闭环', () => {
  // 1) 初始：v1 已发布 2 项，访客页非空
  let s = createInitialState();
  const item1 = latestRelease(s).items.find((i) => i.title === '潮汐之后');
  const item3 = latestRelease(s).items.find((i) => i.title === '柔软的边界');
  assert.equal(latestRelease(s).items.length, 2);

  // 2) 新增草稿并修改已发布项；不发布时访客结果不变
  const add = addExhibit(s, { title: '夜间回声', room: 'D02' });
  s = add.state;
  s = updateExhibit(s, item1.id, { title: '潮汐之后（修订稿）' });
  assert.equal(resolveCode(s, item1.shortCode).item.title, '潮汐之后');
  assert.equal(exhibitView(s, s.exhibits.find((e) => e.id === add.exhibit.id)).status, 'draft');

  // 3) 试图在新草稿未勾选时发布 —— 但因为 item1 有内容更新，发布会被允许？
  //    闸门只在“结果为空”或“完全一致”时阻止；这里确有更新，可以发布。
  //    先验证“撤回全部导致空发布”被拦：
  let blocked = planPublish(withdrawAll(s));
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /至少勾选一个展项/);
  assert.equal(s.releases.length, 1, '阻止后没有新版本');

  // 4) 正常发布：item1 更新生效，新展项因未勾选仍不可见
  const pub = planPublish(s);
  assert.equal(pub.ok, true);
  assert.deepEqual(pub.changes.added.map((x) => x.id), []);
  assert.deepEqual(pub.changes.updated.map((x) => x.id), [item1.id]);
  s = pub.state;
  assert.equal(latestRelease(s).version, 2);
  assert.equal(resolveCode(s, item1.shortCode).item.title, '潮汐之后（修订稿）');
  // 5) v1 快照里的旧分享内容仍然是旧标题
  assert.equal(releaseByVersion(s, 1).items.find((i) => i.id === item1.id).title, '潮汐之后');

  // 6) 勾选新展项发布 v3，短码全新且不复用
  s = toggleInclude(s, add.exhibit.id);
  const pub3 = planPublish(s);
  assert.deepEqual(pub3.changes.added.map((x) => x.id), [add.exhibit.id]);
  s = pub3.state;
  const newCode = latestRelease(s).items.find((i) => i.id === add.exhibit.id).shortCode;
  assert.ok(newCode);
  assert.notEqual(newCode, item1.shortCode);
  assert.notEqual(newCode, item3.shortCode);
  assert.equal(resolveCode(s, newCode).status, 'live');

  // 7) 无变化再发布 => 阻止
  assert.equal(planPublish(s).ok, false);

  // 8) 撤回 item3（保留其他两项，发布被允许）
  s = toggleInclude(s, item3.id);
  const pub4 = planPublish(s);
  assert.deepEqual(pub4.changes.removed.map((x) => x.id), [item3.id]);
  s = pub4.state; // v4
  assert.equal(resolveCode(s, item3.shortCode).status, 'withdrawn');
  assert.equal(resolveCode(s, item3.shortCode).release.version, 3, '旧码可在最后包含它的 v3 快照核对');
  assert.equal(releaseByVersion(s, 1).items.some((i) => i.shortCode === item3.shortCode), true, 'v1 也保留有记录');
  assert.equal(latestRelease(s).items.length, 2);

  // 9) 再撤回一项导致“全空发布” => 阻止
  blocked = planPublish(withdrawAll(s));
  assert.equal(blocked.ok, false);
  assert.equal(latestRelease(s).version, 4);

  // 10) 恢复 item3：沿用原短码
  s = toggleInclude(s, item3.id);
  const pub5 = planPublish(s);
  assert.equal(pub5.ok, true);
  s = pub5.state; // v5
  assert.equal(latestRelease(s).items.find((i) => i.id === item3.id).shortCode, item3.shortCode);
  assert.equal(resolveCode(s, item3.shortCode).status, 'live');

  // 11) 全部历史快照冻结
  assert.equal(releaseByVersion(s, 1).items.length, 2);
  assert.equal(releaseByVersion(s, 2).items.length, 2);
  assert.equal(releaseByVersion(s, 3).items.length, 3);
  assert.equal(releaseByVersion(s, 4).items.length, 2);
  assert.equal(releaseByVersion(s, 5).items.length, 3);
});

test('从未发布过的空账号：必须先有已发布展项', () => {
  const s = { exhibits: [], seq: { id: 0, code: 100000 }, releases: [] };
  assert.equal(planPublish(s).ok, false);
  const r = addExhibit(s, { title: '第一件' });
  let next = r.state;
  assert.equal(planPublish(next).ok, false, '只有草稿，阻止');
  next = toggleInclude(next, r.exhibit.id);
  const pub = planPublish(next);
  assert.equal(pub.ok, true, '勾选后可首次发布');
  next = pub.state;
  assert.equal(latestRelease(next).version, 1);
  assert.equal(latestRelease(next).items[0].title, '第一件');
});

function withdrawAll(s) {
  let out = s;
  out.exhibits.forEach((e) => { if (e.included) out = toggleInclude(out, e.id); });
  return out;
}
