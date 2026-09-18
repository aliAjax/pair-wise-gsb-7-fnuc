import React, { useMemo, useState } from 'react';
import {
  addExhibit, planPublish,
  latestRelease, exhibitView,
} from '../model/store.js';
import { go, shareUrl, fmtTime } from '../router.jsx';
import { copyText } from '../utils.js';
import QR from './QR.jsx';

const STATUS_META = {
  live: { cls: 'live', label: '已发布' },
  draft: { cls: 'draft', label: '草稿' },
  withdrawn: { cls: 'off', label: '已撤回' },
};

function badge(view) {
  const base = STATUS_META[view.status];
  if (view.change === 'updated') return { cls: 'warn', label: '已发布 · 有未发布修改' };
  if (view.change === 'removed') return { cls: 'warn', label: '已发布 · 将撤回' };
  if (view.change === 'readded') return { cls: 'warn', label: '已撤回 · 将恢复' };
  if (view.change === 'added') return { cls: 'warn', label: '草稿 · 将发布' };
  return base;
}

const FILTERS = [
  { key: '全部', test: () => true },
  { key: '已发布', test: (v) => v.status === 'live' },
  { key: '草稿', test: (v) => v.status === 'draft' },
  { key: '已撤回', test: (v) => v.status === 'withdrawn' },
];

export default function Workbench({ state, dispatch, notify }) {
  const [selected, setSelected] = useState(() => state.exhibits[0]?.id ?? null);
  const [filter, setFilter] = useState('全部');
  const [showPublish, setShowPublish] = useState(false);
  const [form, setForm] = useState({ title: '', room: '', type: '装置', desc: '' });

  const latest = latestRelease(state);
  const current = state.exhibits.find((x) => x.id === selected) || state.exhibits[0] || null;
  const currentView = current ? exhibitView(state, current) : null;
  const rows = useMemo(() => state.exhibits.map((e) => ({ e, v: exhibitView(state, e) })), [state]);
  const visible = rows.filter(({ v }) => (FILTERS.find((f) => f.key === filter) || FILTERS[0]).test(v));

  const setField = (k, val) => dispatch({ type: 'update', id: current.id, patch: { [k]: val } });
  const saveNew = () => {
    const r = addExhibit(state, form);
    if (!r.ok) { notify(r.reason); return; }
    dispatch({ type: 'commit', state: r.state });
    setSelected(r.exhibit.id);
    setForm({ title: '', room: '', type: '装置', desc: '' });
    notify('展项已保存为草稿（未发布，访客暂不可见）');
  };

  const plan = useMemo(() => (showPublish ? planPublish(state) : null), [showPublish, state]);
  const confirmPublish = () => {
    if (!plan?.ok) return;
    dispatch({ type: 'commit', state: plan.state });
    setShowPublish(false);
    notify(`已发布 v${plan.release.version}：${plan.release.note}。访客页与二维码已切换到新快照。`);
  };

  const exportJson = () => {
    if (!latest) { notify('还没有发布过任何快照，暂无可导出的发布内容。'); return; }
    const payload = { version: latest.version, publishedAt: latest.publishedAt, items: latest.items };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    a.download = `exhibition-guide-v${latest.version}.json`;
    a.click();
    setShowPublish(false);
    notify(`已导出当前线上快照 v${latest.version}`);
  };

  const copyLink = async (code) => {
    const url = shareUrl(`/c/${code}`);
    notify((await copyText(url)) ? `访客链接已复制：${url}` : '复制失败，请手动复制链接');
  };

  return (
    <div className="app">
      <aside>
        <div className="brand"><span className="mark">M</span><span>展览工作台</span></div>
        <div className="side-label">当前项目</div>
        <div className="project"><span className="project-dot" /><div><strong>潮汐之后</strong><small>2024 春季展</small></div><span>⌄</span></div>
        <nav>
          <button className="active" type="button">▧ <span>展项内容</span><b>{state.exhibits.length}</b></button>
          <button type="button">⌁ <span>展厅动线</span></button>
          <button type="button">◉ <span>二维码</span></button>
        </nav>
        <div className="side-foot">
          <button type="button">⚙ 设置</button>
          <small>草稿已自动保存{latest ? ` · 线上版本 v${latest.version}` : ' · 尚未发布'}</small>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">EXHIBITION BUILDER</span>
            <h1>展项内容</h1>
          </div>
          <div className="top-actions">
            <button className="secondary" onClick={exportJson}>↓ 导出现行快照</button>
            <button className="secondary" onClick={() => go('/visitor')}>◉ 访客预览</button>
            <button className="primary" onClick={() => setShowPublish(true)}>发布更新 <span>↗</span></button>
          </div>
        </header>

        <div className="content">
          <section className="list-pane">
            <div className="list-head">
              <div><h2>全部展项</h2><span>{state.exhibits.length} 个展项</span></div>
            </div>
            <div className="filters">
              {FILTERS.map((f) => (
                <button key={f.key} className={filter === f.key ? 'selected' : ''} onClick={() => setFilter(f.key)}>{f.key}</button>
              ))}
            </div>
            <div className="exhibit-list">
              {visible.map(({ e, v }) => {
                const b = badge(v);
                return (
                  <div className={'exhibit-row ' + (current?.id === e.id ? 'chosen' : '')} key={e.id} onClick={() => setSelected(e.id)} role="button" tabIndex={0}>
                    <span className="thumb" style={{ background: e.color }}>{e.shortCode ? e.shortCode.slice(0, 2) : '草稿'}</span>
                    <span className="row-copy">
                      <strong>{e.title}</strong>
                      <small>{e.room} · {e.type}{e.shortCode ? ` · 短码 ${e.shortCode}` : ''}</small>
                    </span>
                    <label className="pick" title="纳入下一次发布" onClick={(ev) => ev.stopPropagation()}>
                      <input type="checkbox" checked={e.included} onChange={() => dispatch({ type: 'toggle', id: e.id })} />
                      <span>发布</span>
                    </label>
                    <span className={`status ${b.cls}`}>{b.label}</span>
                    <span className="chev">›</span>
                  </div>
                );
              })}
              {visible.length === 0 && <p className="empty-line">该筛选下暂无展项</p>}
            </div>

            <div className="history">
              <div className="history-head"><h3>发布记录</h3><small>访客与二维码只读取最后一条</small></div>
              {state.releases.slice().reverse().map((r) => (
                <div className={'history-row' + (r.version === latest.version ? ' current' : '')} key={r.version}>
                  <button className="history-link" onClick={() => go(`/v/${r.version}`)}>
                    <strong>v{r.version}{r.version === latest.version && <em> · 访客正在看</em>}</strong>
                    <small>{fmtTime(r.publishedAt)} · {r.items.length} 项 · {r.note}</small>
                  </button>
                </div>
              ))}
              {state.releases.length === 0 && <p className="empty-line">还没有发布过任何快照。</p>}
            </div>
          </section>

          <section className="form-panel">
            {current && currentView && (
              <>
                <div className="panel-title">
                  <div><span className="eyebrow">EDIT EXHIBIT</span><h2>编辑展项</h2></div>
                  <span className={`status ${badge(currentView).cls}`}>{badge(currentView).label}</span>
                </div>

                <div className={`draft-banner ${currentView.status}-${currentView.change || 'clean'}`}>
                  {currentView.status === 'draft' && currentView.change !== 'added' && '草稿展项 · 尚未对访客公开。编辑完成后勾选“纳入下一次发布”。'}
                  {currentView.status === 'draft' && currentView.change === 'added' && '已纳入下一次发布；发布前访客仍看不到该展项。'}
                  {currentView.status === 'live' && currentView.change === 'updated' && `以下修改只在草稿中，访客当前看到的仍是 v${latest.version} 的线上内容；发布后才会更新。`}
                  {currentView.status === 'live' && currentView.change === 'removed' && '已从下一次发布中移除；发布后该展项将撤回，短码失效（历史快照仍可核对）。'}
                  {currentView.status === 'live' && currentView.change === null && `已发布在最新快照 v${latest.version}，访客看到的就是当前内容。`}
                  {currentView.status === 'withdrawn' && currentView.change === 'readded' && '该展项目前处于撤回状态；本次发布将恢复上线，沿用原短码。'}
                  {currentView.status === 'withdrawn' && currentView.change !== 'readded' && `已撤回 · 短码 ${current.shortCode} 已失效，访客扫码会看到撤回提示。勾上“纳入下一次发布”可恢复（同一短码，不分给其他展项）。`}
                </div>

                <div className="editor">
                  <label className="include-line">
                    <input type="checkbox" checked={current.included} onChange={() => dispatch({ type: 'toggle', id: current.id })} />
                    <span>纳入下一次发布（取消勾选并发布即为撤回）</span>
                  </label>
                  <label>展项标题<input value={current.title} onChange={(e) => setField('title', e.target.value)} /></label>
                  <div className="two">
                    <label>所在展厅<input value={current.room} onChange={(e) => setField('room', e.target.value)} /></label>
                    <label>内容类型
                      <select value={current.type} onChange={(e) => setField('type', e.target.value)}>
                        {['装置', '档案', '互动', '绘画'].map((t) => <option key={t}>{t}</option>)}
                      </select>
                    </label>
                  </div>
                  <label>展项介绍<textarea rows="5" value={current.desc} onChange={(e) => setField('desc', e.target.value)} /></label>
                  <label>语音导览 URL<input value={current.audio} placeholder="https://…" onChange={(e) => setField('audio', e.target.value)} />
                    <small className="hint">访客扫描二维码后可播放</small>
                  </label>

                  <div className="preview-block">
                    <div className="preview-heading"><span>访客二维码</span></div>
                    {currentView.liveItem ? (
                      <div className="qr-preview">
                        <QR text={shareUrl(`/c/${current.shortCode}`)} size={96} />
                        <div>
                          <strong>短码 {current.shortCode}</strong>
                          <small>/c/{current.shortCode}</small>
                          <button className="copy-btn" onClick={() => copyLink(current.shortCode)}>复制访客链接</button>
                        </div>
                      </div>
                    ) : current.shortCode ? (
                      <div className="qr-preview disabled">
                        <div className="qr-stub">失效</div>
                        <div>
                          <strong>短码 {current.shortCode}（已撤回）</strong>
                          <small>二维码不再显示内容；恢复发布后原码重新生效</small>
                          <button className="copy-btn" onClick={() => go(`/v/${latest?.version ?? 1}`)}>查看最近快照记录</button>
                        </div>
                      </div>
                    ) : (
                      <div className="qr-preview pending">
                        <div className="qr-stub">待发布</div>
                        <div><strong>发布后自动生成短码与二维码</strong><small>短码一经分配永不复用给其他展项</small></div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            <div className="new-form">
              <div className="panel-title"><div><span className="eyebrow">NEW ENTRY</span><h2>快速添加展项</h2></div></div>
              <div className="two">
                <input placeholder="展项标题（必填）" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                <input placeholder="展厅编号" value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} />
              </div>
              <textarea placeholder="一句话介绍…" rows="2" value={form.desc} onChange={(e) => setForm({ ...form, desc: e.target.value })} />
              <button className="primary full" onClick={saveNew}>保存为草稿</button>
            </div>
          </section>
        </div>
      </main>

      {showPublish && plan && (
        <div className="modal-mask" onClick={() => setShowPublish(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div><span className="eyebrow">PUBLISH SNAPSHOT</span><h2>{plan.ok ? `发布 v${plan.release.version}` : '无法发布'}</h2></div>
              <button className="modal-x" onClick={() => setShowPublish(false)}>✕</button>
            </div>

            {!plan.ok && (
              <>
                <div className="publish-block">⛔ {plan.reason}</div>
                <p className="publish-hint">访客页与二维码在成功发布前保持现有内容不变。</p>
                <div className="modal-foot"><button className="secondary" onClick={() => setShowPublish(false)}>返回继续编辑</button></div>
              </>
            )}

            {plan.ok && (
              <>
                <p className="publish-intro">将生成一份不可变快照；发布后你仍可继续修改草稿，但已分享出去的链接与二维码永远指向各自发布时的快照。</p>
                <PlanGroup title="新增上线" items={plan.changes.added} state={state} release={plan.release} tone="add" />
                <PlanGroup title="内容更新" items={plan.changes.updated} state={state} release={plan.release} tone="upd" />
                <PlanGroup title="撤回下线（短码失效，旧快照保留）" items={plan.changes.removed} state={state} release={null} tone="rm" />
                <div className="modal-foot">
                  <button className="secondary" onClick={() => setShowPublish(false)}>取消</button>
                  <button className="primary" onClick={confirmPublish}>确认发布 v{plan.release.version} ↗</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PlanGroup({ title, items, state, release, tone }) {
  if (!items || items.length === 0) return null;
  // 发布后该 id 在新快照中的条目（用于显示新分配的短码）
  const after = (id) => (release ? release.items.find((i) => i.id === id) : null);
  return (
    <div className={`plan-group ${tone}`}>
      <h4>{title} <b>{items.length}</b></h4>
      <ul>
        {items.map((it) => {
          const name = it.title || state.exhibits.find((e) => e.id === it.id)?.title;
          const a = after(it.id);
          return (
            <li key={it.id}>
              <span>{name}</span>
              {tone === 'add' && a && <code>{a.shortCode}（新分配）</code>}
              {tone === 'rm' && <code>{it.shortCode} 将失效</code>}
              {(tone === 'upd') && <code>{it.shortCode}</code>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
