import React, { useState } from 'react';
import { go, shareUrl, fmtTime } from '../router.jsx';
import { latestRelease, releaseByVersion, resolveCode } from '../model/store.js';
import QR from './QR.jsx';

/* ---------- 访客头部 / 横幅 ---------- */

function VisitorHeader({ onBack = '/edit' }) {
  return (
    <header>
      <div className="brand"><span className="mark">M</span><span>潮汐美术馆</span></div>
      <button className="ghost" onClick={() => go(onBack)}>返回编辑工作台</button>
    </header>
  );
}

function SnapshotBanner({ release, latest, variant }) {
  if (variant === 'live') return null;
  if (variant === 'snapshot' || variant === 'snapshot-detail') {
    const old = release.version !== latest.version;
    return (
      <div className={'snap-banner ' + (old ? 'archived' : 'current')}>
        {old
          ? <>你正在查看历史快照 <b>v{release.version}</b>（{fmtTime(release.publishedAt)}）· 当前线上为 v{latest.version}，<button onClick={() => go('/visitor')}>查看最新发布 →</button></>
          : <>本页为已发布快照 <b>v{release.version}</b> 的固定内容，发布后的草稿修改不会影响此页。</>}
      </div>
    );
  }
  return null;
}

/* ---------- 展项卡片网格 ---------- */

function ExhibitGrid({ items, onOpen }) {
  return (
    <div className="visitor-grid">
      {items.map((x, i) => (
        <article className="visitor-card" key={x.shortCode} onClick={() => onOpen(x)}>
          <div className="art" style={{ background: x.color }}>
            <span>{x.shortCode || String(i + 1).padStart(2, '0')}</span><i>↗</i>
          </div>
          <div className="card-meta">
            <small>{x.room} · {x.type}</small>
            <h3>{x.title}</h3>
            <p>{x.desc}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

/* ---------- 列表页（最新 / 历史快照） ---------- */

export function VisitorList({ state, version = null }) {
  const latest = latestRelease(state);
  const release = version == null ? latest : releaseByVersion(state, version);
  const archived = version != null && latest && version !== latest.version;
  const variant = version == null ? 'live' : 'snapshot';
  const openItem = (x) => go(archived ? `/v/${version}/c/${x.shortCode}` : `/c/${x.shortCode}`);

  return (
    <div className="visitor">
      <VisitorHeader />
      <SnapshotBanner release={release} latest={latest} variant={variant} />
      <main className="visitor-main">
        {!release || release.items.length === 0 ? (
          <div className="visitor-empty">
            <span className="eyebrow">VISITOR GUIDE / 2024</span>
            <h1>尚未发布<em>任何展项</em></h1>
            <p className="lead">编辑完成并成功发布后，访客才会在这里看到内容。</p>
          </div>
        ) : (
          <>
            <span className="eyebrow">VISITOR GUIDE / 2024{version != null ? ` · SNAPSHOT v${version}` : ` · v${release.version}`}</span>
            <h1>沿着作品，<em>走进</em>另一种时间。</h1>
            <p className="lead">当你靠近一件作品，它的故事就开始流动。选择一个展项开始探索。</p>
            <ExhibitGrid items={release.items} onOpen={openItem} />
          </>
        )}
      </main>
    </div>
  );
}

/* ---------- 展项详情（快照冻结内容） ---------- */

function DetailBody({ item, release, variant, backPath, banner }) {
  const [playing, setPlaying] = useState(false);
  const path = variant === 'snapshot-detail'
    ? `/v/${release.version}/c/${item.shortCode}`
    : `/c/${item.shortCode}`;
  return (
    <div className="visitor">
      <VisitorHeader />
      {banner}
      <main className="detail">
        <div className="detail-art" style={{ background: item.color }}>
          <span>{item.shortCode}</span>
        </div>
        <div className="detail-copy">
          <span className="eyebrow">{item.room} / {item.type} · 短码 {item.shortCode}</span>
          <h1>{item.title}</h1>
          <p>{item.desc}</p>
          {item.audio && (
            <button className="audio" onClick={() => setPlaying(true)}>
              {playing ? '⏸ 正在播放导览音频…' : '▶ 播放语音导览'}
            </button>
          )}
          <div className="qr">
            <QR text={shareUrl(path)} size={84} />
            <div>
              <strong>分享这个展项</strong>
              <small>扫码打开的是 v{release.version} 快照，不会随之后的编辑改变</small>
            </div>
          </div>
          <button className="ghost detail-back" onClick={() => go(backPath)}>← 全部展项</button>
        </div>
      </main>
    </div>
  );
}

// 最新快照里的展项（访客二维码入口）
export function VisitorCode({ state, code }) {
  const res = resolveCode(state, code);
  const latest = latestRelease(state);
  if (res.status === 'live') {
    return (
      <DetailBody
        item={res.item} release={res.release} variant="live" backPath="/visitor"
        banner={<SnapshotBanner release={res.release} latest={latest} variant="live" />}
      />
    );
  }
  return <InvalidCode state={state} result={res} code={code} />;
}

// 指定历史快照中的展项（核对 / 旧分享链接）
export function VisitorSnapshotDetail({ state, version, code }) {
  const release = releaseByVersion(state, version);
  const item = release && release.items.find((i) => i.shortCode === code);
  const latest = latestRelease(state);
  if (!release || !item) {
    return (
      <InvalidCode
        state={state}
        result={{ status: 'unknown', code }}
        code={code}
        hint={`快照 v${version} 中不存在短码 ${code}。`}
      />
    );
  }
  return (
    <DetailBody
      item={item} release={release} variant="snapshot-detail" backPath={`/v/${version}`}
      banner={<SnapshotBanner release={release} latest={latest} variant="snapshot-detail" />}
    />
  );
}

/* ---------- 失效 / 未知短码 ---------- */

function InvalidCode({ state, result, code, hint }) {
  const latest = latestRelease(state);
  return (
    <div className="visitor">
      <VisitorHeader />
      <main className="visitor-main invalid">
        <span className="eyebrow">VISITOR GUIDE / 2024</span>
        {result.status === 'withdrawn' ? (
          <>
            <h1>该展项<em>已撤回</em></h1>
            <p className="lead">{`短码 ${result.item.shortCode}（${result.item.title}）已不在当前发布中，此二维码不再展示内容。你仍可在最后包含它的发布快照 v${result.release.version}（${fmtTime(result.release.publishedAt)}）中核对当时的内容。`}</p>
            <div className="invalid-actions">
              <button className="primary" onClick={() => go(`/v/${result.release.version}/c/${result.item.shortCode}`)}>{`查看 v${result.release.version} 中的记录 →`}</button>
              {latest && <button className="secondary" onClick={() => go('/visitor')}>浏览当前展览</button>}
            </div>
          </>
        ) : (
          <>
            <h1>找不到该<em>展项</em></h1>
            <p className="lead">{hint || `短码 ${code} 从未出现在任何已发布快照中。`}</p>
            <div className="invalid-actions">
              {latest && <button className="primary" onClick={() => go('/visitor')}>浏览当前展览 →</button>}
              <button className="secondary" onClick={() => go('/edit')}>返回编辑工作台</button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
