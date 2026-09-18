// 展览导览：草稿 / 发布快照核心模型（框架无关，可在 Node 中单测）
//
// 核心约定：
// - exhibits 是编辑工作区（草稿），任何修改都不会触及已发布内容。
// - releases 是一串不可变快照，访客页与二维码永远只解析最后一条。
// - 短码在展项“首次被发布”时分配，计数器编码保证永不复用给其他展项；
//   撤回后短码不在最新快照中（解析为 withdrawn），但旧快照依旧可核对；
//   同一展项重新发布时恢复其原短码。

export const STORAGE_KEY = 'guide-state-v2';
const LEGACY_KEY = 'guide-exhibits';

// 去掉易混淆字符（0/o,1/l/i）的 31 进制字母表
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const CODE_START = 100000; // 让初始短码就是 4~5 位

// 快照中冻结的内容字段（id / shortCode 之外）
export const FIELDS = ['title', 'room', 'type', 'desc', 'audio', 'color'];

export const PALETTE = ['#e6b45d', '#ef8f84', '#83b9b1', '#9ba7dc'];

const SEED_TIME = '2024-03-16T10:00:00.000Z';
const SEED = [
  { title: '潮汐之后', room: 'A01 · 主展厅', type: '装置', desc: '一件记录海岸线变化的沉浸式影像装置。', audio: 'https://example.com/audio.mp3', color: '#e6b45d', included: true },
  { title: '未寄出的信', room: 'B02 · 纸上时间', type: '档案', desc: '来自三代人的手写信件与声音档案。', audio: '', color: '#ef8f84', included: false },
  { title: '柔软的边界', room: 'C01 · 新媒介', type: '互动', desc: '观众的移动会改变墙面上的光影。', audio: '', color: '#83b9b1', included: true },
];

/* ---------------- 短码 ---------------- */

export function encodeCode(n) {
  let s = '';
  do {
    s = CODE_ALPHABET[n % CODE_ALPHABET.length] + s;
    n = Math.floor(n / CODE_ALPHABET.length);
  } while (n > 0);
  return s.padStart(4, CODE_ALPHABET[0]);
}

// 历史上（含所有快照 + 草稿）已经用过的短码，分配时绝不重复
export function usedCodes(state) {
  const set = new Set();
  state.exhibits.forEach((e) => e.shortCode && set.add(e.shortCode));
  state.releases.forEach((r) => r.items.forEach((i) => set.add(i.shortCode)));
  return set;
}

/* ---------------- 快照工具 ---------------- */

export function snapshotItem(e) {
  const item = { id: e.id, shortCode: e.shortCode };
  FIELDS.forEach((k) => { item[k] = e[k]; });
  return item;
}

// 稳定序列化：内容相同 => 字符串相同（字段顺序固定）
export function stableItems(items) {
  return JSON.stringify(items.map((it) => {
    const o = { id: it.id, shortCode: it.shortCode };
    FIELDS.forEach((k) => { o[k] = it[k]; });
    return o;
  }));
}

const contentSig = (it) => FIELDS.map((k) => it[k] ?? '').join('');

function djb2(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/* ---------------- 选择器 ---------------- */

export const latestRelease = (s) => (s.releases.length ? s.releases[s.releases.length - 1] : null);
export const releaseByVersion = (s, v) => s.releases.find((r) => r.version === v) || null;

// 短码解析：访客二维码永远先查“最新快照”
export function resolveCode(state, code) {
  const key = String(code || '').toLowerCase();
  const latest = latestRelease(state);
  const live = latest && latest.items.find((i) => i.shortCode === key);
  if (live) return { status: 'live', release: latest, item: live };
  // 最新快照里没有 => 已撤回；向旧快照找最后一次出现的位置用于核对
  for (let k = state.releases.length - 1; k >= 0; k--) {
    const item = state.releases[k].items.find((i) => i.shortCode === key);
    if (item) return { status: 'withdrawn', release: state.releases[k], item };
  }
  return { status: 'unknown', code: key };
}

// 展项在编辑视角下的状态：
//   live      已发布且在最新快照中
//   withdrawn 曾发布但不在最新快照（短码已失效）
//   draft     从未发布
// change: added / readded / updated / removed / null —— 相对下一次发布的待处理变化
export function exhibitView(state, e) {
  const latest = latestRelease(state);
  const live = latest && latest.items.find((i) => i.id === e.id);
  const everPublished = !!e.shortCode || state.releases.some((r) => r.items.some((i) => i.id === e.id));
  const status = live ? 'live' : everPublished ? 'withdrawn' : 'draft';
  let change = null;
  if (!live && e.included) change = everPublished ? 'readded' : 'added';
  else if (live && !e.included) change = 'removed';
  else if (live && e.included && contentSig(snapshotItem(e)) !== contentSig(live)) change = 'updated';
  return { status, change, liveItem: live || null };
}

// 下一次发布相对最新快照的变化分组（供发布确认弹窗）
export function planChanges(state) {
  const latest = latestRelease(state);
  const prev = latest ? latest.items : [];
  const next = state.exhibits.filter((e) => e.included);
  const prevMap = new Map(prev.map((i) => [i.id, i]));
  const nextIds = new Set(next.map((e) => e.id));
  return {
    added: next.filter((e) => !prevMap.has(e.id)),
    updated: next.filter((e) => { const p = prevMap.get(e.id); return p && contentSig(snapshotItem(e)) !== contentSig(p); }),
    removed: prev.filter((i) => !nextIds.has(i.id)),
    unchanged: next.filter((e) => { const p = prevMap.get(e.id); return p && contentSig(snapshotItem(e)) === contentSig(p); }),
    latest,
    next,
  };
}

/* ---------------- 动作（纯函数，返回新状态） ---------------- */

export function addExhibit(state, input) {
  const title = (input.title || '').trim();
  if (!title) return { ok: false, reason: '请填写展项标题后再保存。' };
  const id = state.seq.id + 1;
  const exhibit = {
    id,
    shortCode: null,
    title,
    room: (input.room || '').trim() || '待分配展厅',
    type: input.type || '装置',
    desc: (input.desc || '').trim(),
    audio: (input.audio || '').trim(),
    color: PALETTE[state.exhibits.length % PALETTE.length],
    included: false, // 新展项默认只是草稿，需显式纳入并发布
  };
  return {
    ok: true,
    state: { ...state, exhibits: [...state.exhibits, exhibit], seq: { ...state.seq, id } },
    exhibit,
  };
}

export function updateExhibit(state, id, patch) {
  const allowed = {};
  FIELDS.forEach((k) => { if (k in patch) allowed[k] = patch[k]; });
  return {
    ...state,
    exhibits: state.exhibits.map((e) => (e.id === id ? { ...e, ...allowed } : e)),
  };
}

export function toggleInclude(state, id) {
  return {
    ...state,
    exhibits: state.exhibits.map((e) => (e.id === id ? { ...e, included: !e.included } : e)),
  };
}

// 发布：生成不可变快照。两道闸门：
// 1) 发布集合为空（含“把全部展项撤回”）→ 阻止并说明
// 2) 与最新快照内容完全一致 → 阻止（没有需要发布的更改）
export function planPublish(state, now = new Date().toISOString()) {
  const included = state.exhibits.filter((e) => e.included);
  if (included.length === 0) {
    return { ok: false, reason: '无法发布：当前没有任何展项被纳入下一次发布，发布后访客页将为空。请至少勾选一个展项。' };
  }

  // 给首次发布的展项分配新短码（计数器 + 历史集合双重保证不复用）
  let codeNo = state.seq.code;
  const used = usedCodes(state);
  const allocate = (e) => {
    if (e.shortCode) return e.shortCode;
    let code;
    do { codeNo += 1; code = encodeCode(codeNo); } while (used.has(code));
    used.add(code);
    return code;
  };
  const items = included.map((e) => snapshotItem({ ...e, shortCode: e.shortCode || allocate(e) }));

  const latest = latestRelease(state);
  if (latest && stableItems(items) === stableItems(latest.items)) {
    return { ok: false, reason: `无需发布：选中的展项与最近一次发布（v${latest.version}）内容完全一致，没有需要发布的更改。` };
  }

  const prevMap = new Map((latest ? latest.items : []).map((i) => [i.id, i]));
  const nextIds = new Set(items.map((i) => i.id));
  const added = items.filter((i) => !prevMap.has(i.id));
  const updated = items.filter((i) => { const p = prevMap.get(i.id); return p && contentSig(i) !== contentSig(p); });
  const removed = latest ? latest.items.filter((i) => !nextIds.has(i.id)) : [];

  let note;
  if (!latest) {
    note = `首次发布 ${items.length} 个展项`;
  } else {
    const parts = [];
    if (added.length) parts.push(`新增 ${added.length}`);
    if (updated.length) parts.push(`更新 ${updated.length}`);
    if (removed.length) parts.push(`撤回 ${removed.length}`);
    note = parts.join(' · ') || '内容更新';
  }

  const release = {
    version: latest ? latest.version + 1 : 1,
    publishedAt: now,
    note,
    items,
    hash: djb2(stableItems(items)),
  };
  const exhibits = state.exhibits.map((e) => {
    const it = items.find((i) => i.id === e.id);
    return it ? { ...e, shortCode: it.shortCode } : e;
  });
  return {
    ok: true,
    state: { exhibits, seq: { ...state.seq, code: codeNo }, releases: [...state.releases, release] },
    release,
    changes: { added, updated, removed },
  };
}

/* ---------------- 初始状态 / 持久化 ---------------- */

export function createInitialState(now = SEED_TIME) {
  const base = {
    exhibits: SEED.map((d, i) => ({ id: i + 1, shortCode: null, ...d })),
    seq: { id: SEED.length, code: CODE_START },
    releases: [],
  };
  const r = planPublish(base, now);
  return r.ok ? r.state : base;
}

export function isValidState(s) {
  return !!s && Array.isArray(s.exhibits) && Array.isArray(s.releases) && s.seq && typeof s.seq === 'object';
}

// 迁移 v1 原型数据（guide-exhibits，status 字段）：已发布项进入 v1 快照
function migrateLegacy(old) {
  if (!Array.isArray(old)) return null;
  const exhibits = [];
  let maxId = 0;
  old.forEach((x, i) => {
    const id = Number(x.id) || i + 1;
    maxId = Math.max(maxId, id);
    exhibits.push({
      id,
      shortCode: null,
      title: x.title || '未命名展项',
      room: x.room || '',
      type: x.type || '装置',
      desc: x.desc || '',
      audio: x.audio || '',
      color: x.color || PALETTE[i % PALETTE.length],
      included: x.status === '已发布',
    });
  });
  const base = { exhibits, seq: { id: maxId, code: CODE_START }, releases: [] };
  const r = planPublish(base, new Date().toISOString());
  return r.ok ? r.state : base; // 可能没有已发布项 => 仍是空发布状态
}

function defaultStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

export function loadState(storage = defaultStorage()) {
  try {
    if (storage) {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (isValidState(parsed)) return parsed;
      }
      const legacy = storage.getItem(LEGACY_KEY);
      if (legacy) {
        const migrated = migrateLegacy(JSON.parse(legacy));
        if (migrated) return migrated;
      }
    }
  } catch {
    /* 落回种子数据 */
  }
  return createInitialState();
}

export function saveState(state, storage = defaultStorage()) {
  try { storage && storage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* 忽略写入失败 */ }
}
