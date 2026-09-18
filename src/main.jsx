import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import './styles.css';

/* ---------- 存储与种子 ---------- */

const STORE_KEY='guide-store-v2';
const COLORS=['#e6b45d','#ef8f84','#83b9b1','#9ba7dc'];

const seedExhibits=[
  {uid:'e-seed-1',code:'TIDAL1',title:'潮汐之后',room:'A01 · 主展厅',type:'装置',desc:'一件记录海岸线变化的沉浸式影像装置。',audio:'https://example.com/audio.mp3',live:true,color:'#e6b45d',createdAt:1710000000000},
  {uid:'e-seed-2',code:'LETTR2',title:'未寄出的信',room:'B02 · 纸上时间',type:'档案',desc:'来自三代人的手写信件与声音档案。',audio:'',live:false,color:'#ef8f84',createdAt:1710100000000},
  {uid:'e-seed-3',code:'SOFTB3',title:'柔软的边界',room:'C01 · 新媒介',type:'互动',desc:'观众的移动会改变墙面上的光影。',audio:'',live:true,color:'#83b9b1',createdAt:1710200000000},
];
const seedSnapshots=[{
  id:'s-seed-1',publishedAt:1710300000000,note:'开馆首版发布',
  items:seedExhibits.filter(x=>x.live).map(({uid,code,title,room,type,desc,audio,color})=>({uid,code,title,room,type,desc,audio,color})),
}];

function seedState(){
  return {counter:4,usedCodes:Object.fromEntries(seedExhibits.map(x=>[x.code,{assignedAt:x.createdAt,uid:x.uid}])),
    exhibits:seedExhibits,snapshots:seedSnapshots};
}

/* 兼容 v1 原型：旧数据迁移为“草稿 + 首个发布快照” */
function migrateV1(raw){
  let list=[];
  try{list=JSON.parse(raw)||[]}catch{return null}
  if(!Array.isArray(list)||!list.length)return null;
  const exhibits=list.map((x,i)=>{
    const code=genCode(i+1,new Set());
    return {uid:'e-mig-'+x.id,code,title:x.title||'未命名展项',room:x.room||'',type:x.type||'装置',
      desc:x.desc||'',audio:x.audio||'',live:x.status==='已发布',color:x.color||COLORS[i%COLORS.length],
      createdAt:1710000000000+i};
  });
  const live=exhibits.filter(x=>x.live);
  const snapshots=live.length?[{id:'s-mig-1',publishedAt:1710300000000,note:'从旧版本迁移的发布',
    items:live.map(stripDraft)}]:[];
  return {counter:exhibits.length+1,
    usedCodes:Object.fromEntries(exhibits.map(x=>[x.code,{assignedAt:x.createdAt,uid:x.uid}])),
    exhibits,snapshots};
}

function loadState(){
  try{
    const raw=localStorage.getItem(STORE_KEY);
    if(raw){const s=JSON.parse(raw);if(s&&Array.isArray(s.exhibits))return s;}
  }catch{}
  const old=localStorage.getItem('guide-exhibits');
  const migrated=old?migrateV1(old):null;
  return migrated||seedState();
}

/* ---------- 短码：分配后永不复用 ---------- */

const CODE_ALPHABET='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function genCode(seq,used){
  let n=seq*2654435761>>>0;
  for(let attempt=0;attempt<50;attempt++){
    let v=n+attempt*0x9e3779b9>>>0,out='';
    for(let i=0;i<6;i++){out+=CODE_ALPHABET[v%CODE_ALPHABET.length];v=(v/CODE_ALPHABET.length)|0;}
    if(!used.has(out))return out;
  }
  let out;
  do{out='X'+Math.random().toString(36).slice(2,7).toUpperCase()}while(used.has(out));
  return out;
}

function stripDraft(x){
  return {uid:x.uid,code:x.code,title:x.title,room:x.room,type:x.type,desc:x.desc,audio:x.audio,color:x.color};
}
const SNAP_FIELDS=['title','room','type','desc','audio','color'];
const sameContent=(a,b)=>!!a&&!!b&&SNAP_FIELDS.every(k=>(a[k]??'')===(b[k]??''));

/* ---------- 时间与链接 ---------- */

function fmtTime(t){
  const d=new Date(t),p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
const origin=()=>location.origin+location.pathname;
const liveLink=code=>`${origin()}#/g/${code}`;
const auditLink=id=>`${origin()}#/snap/${id}`;

/* ---------- 路由（hash，刷新与二维码直达均可用） ---------- */

function parseHash(){
  const h=location.hash||'';
  let m=h.match(/^#\/g\/([A-Za-z0-9]+)/);
  if(m)return {name:'visitor-detail',code:m[1].toUpperCase()};
  m=h.match(/^#\/snap\/([\w-]+)(?:\/([A-Za-z0-9]+))?/);
  if(m)return {name:'snapshot',id:m[1],code:m[2]?m[2].toUpperCase():null};
  if(h==='#/visitor')return {name:'visitor'};
  return {name:'edit'};
}

/* ---------- 主应用 ---------- */

function App(){
  const [state,setState]=useState(loadState);
  const [route,setRoute]=useState(parseHash);
  const [tab,setTab]=useState('content');
  const [selected,setSelected]=useState(()=>state.exhibits[0]?.uid);
  const [filter,setFilter]=useState('全部');
  const [form,setForm]=useState({title:'',room:'',desc:''});
  const [notice,setNotice]=useState(null);
  const toastTimer=useRef(0);

  /* 草稿自动保存（快照不可变，不会被写覆盖） */
  useEffect(()=>{localStorage.setItem(STORE_KEY,JSON.stringify(state))},[state]);

  /* 路由与跨标签页同步：刷新 / 切换预览 / 另一标签页发布后结果一致 */
  useEffect(()=>{
    const onHash=()=>setRoute(parseHash());
    window.addEventListener('hashchange',onHash);
    const onStorage=e=>{if(e.key===STORE_KEY&&e.newValue){try{setState(JSON.parse(e.newValue))}catch{}}};
    window.addEventListener('storage',onStorage);
    return ()=>{window.removeEventListener('hashchange',onHash);window.removeEventListener('storage',onStorage)};
  },[]);

  const say=useCallback(msg=>{
    setNotice(msg);clearTimeout(toastTimer.current);
    toastTimer.current=setTimeout(()=>setNotice(null),3600);
  },[]);

  const navigate=useCallback((hash,extra)=>{
    if(hash===null){
      history.pushState(null,'',location.pathname+location.search);
      setRoute({name:'edit'});
    }else location.hash=hash;
    if(extra&&extra.tab!==undefined)setTab(extra.tab);
    if(extra&&extra.selected!==undefined)setSelected(extra.selected);
  },[]);

  const {exhibits,snapshots,counter,usedCodes}=state;
  const latest=snapshots[snapshots.length-1]||null;
  const liveItems=latest?latest.items:[];

  const snapByCode=useMemo(()=>{
    const m={};liveItems.forEach(x=>{m[x.code]=x});return m;
  },[latest]);

  const itemState=x=>{
    const live=x.live,snap=snapByCode[x.code];
    if(live&&snap&&sameContent(x,snap))return 'published';      // 已发布，内容一致
    if(live&&snap)return 'changed';                            // 已发布，草稿有改动待发布
    if(live)return 'queued';                                   // 新增，待发布
    if(snap)return 'withdrawn';                                // 已撤回，短码失效
    return 'draft';                                            // 草稿
  };

  /* ---- 草稿编辑：永不触碰已发布快照 ---- */
  const update=(k,v)=>{
    if(!selected)return;
    setState(s=>({...s,exhibits:s.exhibits.map(x=>x.uid===selected?{...x,[k]:v}:x)}));
  };
  const toggleLive=uid=>setState(s=>({...s,exhibits:s.exhibits.map(x=>x.uid===uid?{...x,live:!x.live}:x)}));

  const add=()=>{
    if(!form.title.trim()){say('请先填写展项标题');return}
    const used=new Set([...Object.keys(usedCodes)]);
    const code=genCode(counter,used);
    const uid='e-'+Date.now();
    const item={uid,code,title:form.title.trim(),room:form.room.trim(),type:'装置',
      desc:form.desc.trim(),audio:'',live:false,color:COLORS[exhibits.length%COLORS.length],createdAt:Date.now()};
    setState(s=>({...s,counter:s.counter+1,
      usedCodes:{...s.usedCodes,[code]:{assignedAt:Date.now(),uid}},
      exhibits:[...s.exhibits,item]}));
    setSelected(uid);setForm({title:'',room:'',desc:''});
    say(`已保存草稿，短码 ${code} 已预分配，发布后生效`);
  };

  /* ---- 发布：生成不可变快照；没有任何待发布展项则阻止 ---- */
  const publishBlock=useMemo(()=>{
    const will=exhibits.filter(x=>x.live);
    if(!will.length)return {ok:false,reason:'没有任何展项标记为发布：请在展项列表或编辑面板中打开“待发布”开关，至少保留一个展项，然后再发布。'};
    if(!latest)return {ok:true,reason:'',added:will,removed:[],changed:[]};
    const newCodes=new Set(will.map(x=>x.code)),oldCodes=new Set(liveItems.map(x=>x.code));
    const added=will.filter(x=>!oldCodes.has(x.code));
    const removed=liveItems.filter(x=>!newCodes.has(x.code));
    const changed=will.filter(x=>{const o=snapByCode[x.code];return o&&!sameContent(x,o)});
    if(!added.length&&!removed.length&&!changed.length)
      return {ok:false,reason:'草稿与当前线上快照完全一致，没有需要发布的改动。'};
    return {ok:true,reason:'',added,removed,changed};
  },[exhibits,latest,snapByCode]);

  const publish=()=>{
    if(!publishBlock.ok){say('发布已阻止：'+publishBlock.reason);return}
    const snap={id:'s-'+Date.now(),publishedAt:Date.now(),
      note:latest?`第 ${snapshots.length+1} 次发布`:'首次发布',
      items:exhibits.filter(x=>x.live).map(stripDraft)};
    setState(s=>({...s,snapshots:[...s.snapshots,snap]}));
    const parts=[];
    if(publishBlock.added.length)parts.push(`上线 ${publishBlock.added.length}`);
    if(publishBlock.changed.length)parts.push(`更新 ${publishBlock.changed.length}`);
    if(publishBlock.removed.length)parts.push(`撤回 ${publishBlock.removed.length}`);
    say(`已发布新快照，访客页与二维码已切换（${parts.join('、')}）`);
  };

  const exportSnapshot=()=>{
    if(!latest){say('还没有已发布快照，无法导出');return}
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([JSON.stringify(latest,null,2)],{type:'application/json'}));
    a.download=`snapshot-${latest.id}.json`;a.click();
    say('已导出最近一次发布快照');
  };

  const copyLink=async url=>{
    try{await navigator.clipboard.writeText(url);say('链接已复制：'+url)}
    catch{say('复制失败，请手动复制：'+url)}
  };

  const current=exhibits.find(x=>x.uid===selected)||exhibits[0]||null;
  const visible=filter==='全部'?exhibits:exhibits.filter(x=>{
    const st=itemState(x);
    if(filter==='已发布')return st==='published'||st==='changed';
    if(filter==='草稿')return st==='draft'||st==='queued';
    if(filter==='已撤回')return st==='withdrawn';
    return true;
  });

  /* ---- 访客解析：始终只读最近一次发布快照 ---- */
  if(route.name==='visitor')
    return <VisitorHome items={liveItems} latest={latest} onOpen={code=>navigate('#/g/'+code)}
      onEdit={()=>navigate(null)} notice={notice}/>;

  if(route.name==='visitor-detail'){
    const code=route.code,item=snapByCode[code]||null;
    const assignment=usedCodes[code];
    /* 已撤回的短码：找到包含它的最后一份快照，供核对旧内容 */
    const containingSnap=item?latest:[...snapshots].reverse().find(s=>s.items.some(i=>i.code===code));
    return <VisitorDetail code={code} item={item} everAssigned={!!assignment}
      latestAt={latest?.publishedAt||null}
      onBack={()=>navigate('#/visitor')}
      onAudit={containingSnap?()=>navigate('#/snap/'+containingSnap.id+'/'+code):null}
      onEdit={()=>navigate(null,{tab:'content'})}
      onAudio={()=>say('正在播放导览音频…')} notice={notice}/>;
  }

  if(route.name==='snapshot'){
    const snap=snapshots.find(s=>s.id===route.id);
    return <SnapshotView snap={snap} code={route.code} isLatest={snap===latest}
      onBackLatest={()=>navigate('#/visitor')} onEdit={()=>navigate(null,{tab:'publish'})}/>;
  }

  /* ---- 编辑工作台 ---- */
  return <div className="app">
    <aside>
      <div className="brand"><span className="mark">M</span><span>展览工作台</span></div>
      <div className="side-label">当前项目</div>
      <div className="project"><span className="project-dot"></span>
        <div><strong>潮汐之后</strong><small>2024 春季展</small></div><span>⌄</span></div>
      <nav>
        <button className={tab==='content'?'active':''} onClick={()=>setTab('content')}>▧ <span>展项内容</span><b>{exhibits.length}</b></button>
        <button>⌁ <span>展厅动线</span></button>
        <button className={tab==='publish'?'active':''} onClick={()=>setTab('publish')}>◉ <span>发布与二维码</span><b>{snapshots.length}</b></button>
      </nav>
      <div className="side-foot">
        <button>⚙ 设置</button>
        <small>草稿已自动保存{latest?<> · 最近发布 {fmtTime(latest.publishedAt)}</>:<> · 尚未发布</>}</small>
      </div>
    </aside>

    <main className="workspace">
      <header className="topbar">
        <div><span className="eyebrow">EXHIBITION BUILDER</span>
          <h1>{tab==='content'?'展项内容':'发布与二维码'}</h1></div>
        <div className="top-actions">
          <button className="secondary" onClick={exportSnapshot}>↓ 导出现行快照</button>
          <button className="secondary" onClick={()=>navigate('#/visitor')}>◉ 访客预览</button>
          <button className={'primary'+(publishBlock.ok?'':' blocked')} onClick={publish}>
            发布更新 <span>↗</span>
          </button>
        </div>
      </header>

      {tab==='content'
        ? <ContentTab {...{exhibits,visible,filter,setFilter,current,selected,setSelected,form,setForm,add,
            update,toggleLive,itemState,latest,publishBlock,publish,say,copyLink,liveLink}}/>
        : <PublishTab {...{exhibits,snapshots,latest,usedCodes,itemState,publishBlock,publish,
            copyLink,liveLink,auditLink,fmtTime,say,navigate}}/>}
    </main>
    {notice&&<div className="toast">{notice}</div>}
  </div>;
}

/* ---------- 编辑：内容页 ---------- */

const STATE_LABEL={published:'已发布',changed:'已改待发',queued:'待发布',draft:'草稿',withdrawn:'已撤回'};
function StatePill({st,live,onToggle}){
  return <span className={'pill-toggle '+st} onClick={onToggle} role="switch" aria-checked={live}
    title={live?'标记为发布（包含进下次发布）':'取消发布标记'}>
    <span className={'status '+st}>{STATE_LABEL[st]}</span>
    <em>{live?'发布中':'草稿中'} · 点击{live?'撤回':'发布'}</em>
  </span>;
}

function ContentTab(p){
  const {visible,filter,setFilter,current,setSelected,form,setForm,add,update,toggleLive,
    itemState,latest,publishBlock,publish,copyLink,liveLink}=p;
  return <div className="content">
    <section className="list-pane">
      <div className="list-head">
        <div><h2>全部展项</h2><span>{p.exhibits.length} 个展项</span></div>
        <button className="add-btn" onClick={()=>document.querySelector('.new-form').scrollIntoView({behavior:'smooth'})}>＋ 添加展项</button>
      </div>
      <div className="filters">{['全部','已发布','草稿','已撤回'].map(x=>
        <button className={filter===x?'selected':''} key={x} onClick={()=>setFilter(x)}>{x}</button>)}</div>
      <div className="exhibit-list">{visible.map(x=>{
        const st=itemState(x);
        return <button className={'exhibit-row '+(current?.uid===x.uid?'chosen':'')} key={x.uid} onClick={()=>setSelected(x.uid)}>
          <span className="thumb code-thumb" style={{background:x.color}}>{x.code.slice(0,4)}</span>
          <span className="row-copy"><strong>{x.title}</strong>
            <small>{x.code} · {x.room} · {x.type}</small></span>
          <span className={'status '+st}>{STATE_LABEL[st]}</span>
          <span className="chev">›</span>
        </button>;
      })}</div>
    </section>

    <section className="form-panel">
      {current&&<>
        <div className="panel-title">
          <div><span className="eyebrow">EDIT EXHIBIT</span><h2>编辑展项（草稿）</h2></div>
          <StatePill st={itemState(current)} live={current.live} onToggle={()=>toggleLive(current.uid)}/>
        </div>
        {itemState(current)==='changed'&&<div className="edit-note">线上仍为上次发布的内容；你的修改保存在草稿中，点击右上角「发布更新」后访客才能看到。</div>}
        {itemState(current)==='withdrawn'&&<div className="edit-note warn">该展项已撤回：短码 {current.code} 已在线上失效，重新打开“待发布”并发布后，短码重新生效（不会分配新码）。</div>}
        <div className="editor">
          <label>展项标题<input value={current.title} onChange={e=>update('title',e.target.value)}/></label>
          <div className="two">
            <label>所在展厅<input value={current.room} onChange={e=>update('room',e.target.value)}/></label>
            <label>内容类型<select value={current.type} onChange={e=>update('type',e.target.value)}>
              <option>装置</option><option>档案</option><option>互动</option><option>绘画</option></select></label>
          </div>
          <label>展项介绍<textarea rows="5" value={current.desc} onChange={e=>update('desc',e.target.value)}/></label>
          <label>语音导览 URL<input value={current.audio} placeholder="https://…" onChange={e=>update('audio',e.target.value)}/>
            <small className="hint">访客扫描二维码后可播放</small></label>

          <div className="preview-block">
            <div className="preview-heading"><span>二维码 / 短链</span>
              <button onClick={()=>copyLink(liveLink(current.code))}>复制链接</button></div>
            <div className="qr-preview">
              <div className="qr-box big">▦</div>
              <div>
                <strong className="code-line">{current.code}</strong>
                <small>/g/{current.code}</small>
                <small className={current.live&&latest?'code-live':'code-dead'}>
                  {current.live&&latest?`现行快照 · ${fmtTime(latest.publishedAt)}`:'尚未上线：二维码此刻指向失效提示页'}
                </small>
              </div>
            </div>
            <small className="hint">二维码始终打开最近一次发布快照中该短码的内容；继续编辑草稿不会改变已分享链接的内容。</small>
          </div>
        </div>
      </>}

      <div className="new-form">
        <div className="panel-title"><div><span className="eyebrow">NEW ENTRY</span><h2>快速添加展项</h2></div></div>
        <div className="two">
          <input placeholder="展项标题" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/>
          <input placeholder="展厅编号" value={form.room} onChange={e=>setForm({...form,room:e.target.value})}/>
        </div>
        <textarea placeholder="一句话介绍…" rows="2" value={form.desc} onChange={e=>setForm({...form,desc:e.target.value})}/>
        <button className="primary full" onClick={add}>保存新展项（草稿）</button>
      </div>

      <div className={'publish-card '+(publishBlock.ok?'':'publish-blocked')}>
        <div className="pc-head"><strong>发布到访客页</strong>
          {latest&&<small>当前线上：{fmtTime(latest.publishedAt)} · {latest.items.length} 个展项</small>}</div>
        {publishBlock.ok?<>
          <div className="pc-diff">
            {!!publishBlock.added.length&&<span className="diff add">新上线 {publishBlock.added.length}</span>}
            {!!publishBlock.changed.length&&<span className="diff chg">内容更新 {publishBlock.changed.length}</span>}
            {!!publishBlock.removed.length&&<span className="diff rm">撤回 {publishBlock.removed.length}</span>}
          </div>
          <button className="primary full" onClick={publish}>生成新发布快照 ↗</button>
        </>:<>
          <div className="block-reason">⛔ {publishBlock.reason}</div>
          <button className="primary full disabled-btn" disabled>无法发布</button>
        </>}
      </div>
    </section>
  </div>;
}

/* ---------- 编辑：发布与二维码 / 短码审计 ---------- */

function PublishTab({exhibits,snapshots,latest,usedCodes,itemState,publishBlock,publish,
  copyLink,liveLink,auditLink,fmtTime,say,navigate}){
  const liveCount=exhibits.filter(x=>x.live).length;
  return <div className="publish-tab">
    <section className="pub-section">
      <div className="panel-title"><div><span className="eyebrow">RELEASE</span><h2>下一次发布</h2></div></div>
      {!latest&&<div className="edit-note warn">还没有任何发布。首次发布至少要包含一个标记为“待发布”的展项。</div>}
      <ul className="queue-list">
        {exhibits.map(x=>{const st=itemState(x);
          return <li key={x.uid} className={'q-row '+st}>
            <code>{x.code}</code>
            <span className="q-title">{x.title}</span>
            <span className={'status '+st}>{STATE_LABEL[st]}</span>
            <button className="link-btn" onClick={()=>copyLink(liveLink(x.code))}>复制短链</button>
          </li>;})}
      </ul>
      <div className={'publish-card inline '+(publishBlock.ok?'':'publish-blocked')}>
        <small>待发布展项 {liveCount} / {exhibits.length}</small>
        {publishBlock.ok
          ? <button className="primary" onClick={publish}>发布更新 ↗</button>
          : <><div className="block-reason">⛔ {publishBlock.reason}</div>
            <button className="primary disabled-btn" disabled>无法发布</button></>}
      </div>
    </section>

    <section className="pub-section">
      <div className="panel-title"><div><span className="eyebrow">SNAPSHOTS</span><h2>发布记录（不可变，可核对）</h2></div></div>
      {!snapshots.length&&<p className="empty-line">暂无发布快照。</p>}
      <ul className="snap-list">
        {[...snapshots].reverse().map(s=>{
          const codes=s.items.map(x=>x.code);
          const revoked=codes.filter(c=>!latest.items.some(i=>i.code===c));
          return <li key={s.id} className={'snap-row'+(s===latest?' is-latest':'')}>
            <div className="snap-main">
              <strong>{s.note}{s===latest&&<span className="now-tag">现行</span>}</strong>
              <small>{fmtTime(s.publishedAt)} · {s.id} · {s.items.length} 个展项</small>
              <div className="snap-codes">{codes.map(c=><code key={c} className={revoked.includes(c)?'revoked':''}>{c}</code>)}</div>
            </div>
            <div className="snap-actions">
              <button className="link-btn" onClick={()=>navigate('#/snap/'+s.id)}>核对快照</button>
              <button className="link-btn" onClick={()=>copyLink(auditLink(s.id))}>复制核对链接</button>
            </div>
          </li>;})}
      </ul>
    </section>

    <section className="pub-section">
      <div className="panel-title"><div><span className="eyebrow">SHORT CODES</span><h2>短码台账（永不复用）</h2></div></div>
      <table className="code-table">
        <thead><tr><th>短码</th><th>展项</th><th>分配时间</th><th>现行快照状态</th></tr></thead>
        <tbody>
          {Object.entries(usedCodes).sort((a,b)=>a[1].assignedAt-b[1].assignedAt).map(([code,meta])=>{
            const ex=exhibits.find(x=>x.uid===meta.uid);
            const online=latest?.items.some(i=>i.code===code);
            return <tr key={code}>
              <td><code>{code}</code></td>
              <td>{ex?ex.title:<span className="muted">（草稿已删除）</span>}</td>
              <td className="muted">{fmtTime(meta.assignedAt)}</td>
              <td>{online
                ? <span className="status published">生效中</span>
                : <span className="status withdrawn">已失效 / 未上线</span>}</td>
            </tr>;})}
        </tbody>
      </table>
      <small className="hint">短码在展项创建时即分配并登记；撤回只令其在线上失效，短码本身不回收、不再分配给任何新展项。</small>
    </section>
  </div>;
}

/* ---------- 访客页：只读最近一次发布快照 ---------- */

function VisitorChrome({children,onEdit}){
  return <div className="visitor">
    <header>
      <div className="brand"><span className="mark">M</span><span>潮汐美术馆</span></div>
      <button className="ghost" onClick={onEdit}>返回编辑台</button>
    </header>
    {children}
  </div>;
}

function VisitorHome({items,latest,onOpen,onEdit,notice}){
  return <VisitorChrome onEdit={onEdit}>
    <main className="visitor-main">
      <span className="eyebrow">VISITOR GUIDE / 2024{latest?<> · 发布于 {fmtTime(latest.publishedAt)}</>:null}</span>
      <h1>沿着作品，<em>走进</em>另一种时间。</h1>
      <p className="lead">当你靠近一件作品，它的故事就开始流动。选择一个展项开始探索。</p>
      {items.length
        ? <div className="visitor-grid">{items.map(x=>
            <article className="visitor-card" key={x.uid} onClick={()=>onOpen(x.code)}>
              <div className="art" style={{background:x.color}}><span>{x.code}</span><i>↗</i></div>
              <div className="card-meta"><small>{x.room}</small><h3>{x.title}</h3><p>{x.desc}</p></div>
            </article>)}</div>
        : <div className="visitor-empty">展览尚未发布任何展项，请等待编辑台发布后再访问。</div>}
    </main>
    {notice&&<div className="toast">{notice}</div>}
  </VisitorChrome>;
}

function VisitorDetail({code,item,everAssigned,latestAt,onBack,onAudit,onEdit,onAudio,notice}){
  const reason=!everAssigned?'该短码从未被分配，链接可能有误。'
    :item?'':'该展项目前不在已发布内容中（可能已被撤回）。此短码已失效，不会重新分配给其他展项。';
  return <VisitorChrome onEdit={onEdit}>
    {item
      ? <main className="detail">
          <div className="detail-art" style={{background:item.color}}><span>{item.code}</span></div>
          <div className="detail-copy">
            <span className="eyebrow">{item.room} / {item.type}</span>
            <h1>{item.title}</h1><p>{item.desc}</p>
            {item.audio&&<button className="audio" onClick={onAudio}>▶ 播放语音导览</button>}
            <div className="qr">
              <div className="qr-box">▦</div>
              <div><strong>分享这个展项 · {item.code}</strong>
                <small>扫码或用短链 {liveLink(item.code)} 继续阅读{latestAt?<> · 快照 {fmtTime(latestAt)}</>:null}</small></div>
            </div>
            <div className="detail-links">
              <button className="ghost" onClick={onBack}>← 全部展项</button>
              {onAudit&&<button className="ghost" onClick={onAudit}>查看本版本核对快照</button>}
            </div>
          </div>
        </main>
      : <main className="invalid-page">
          <code className="big-code">{code}</code>
          <h1>内容不可用</h1>
          <p>{reason}</p>
          <div className="detail-links">
            <button className="ghost" onClick={onBack}>← 查看在开展项</button>
            {onAudit&&<button className="ghost" onClick={onAudit}>核对包含该短码的旧快照</button>}
          </div>
        </main>}
    {notice&&<div className="toast">{notice}</div>}
  </VisitorChrome>;
}

/* ---------- 历史快照只读核对页 ---------- */

function SnapshotView({snap,code,isLatest,onBackLatest,onEdit}){
  if(!snap)return <VisitorChrome onEdit={onEdit}><main className="invalid-page">
    <h1>找不到该发布快照</h1><p>链接中的快照编号不存在，可能已被清理。</p>
    <div className="detail-links"><button className="ghost" onClick={onBackLatest}>← 回到访客页</button></div>
  </main></VisitorChrome>;

  const item=code?snap.items.find(x=>x.code===code):null;
  const banner=isLatest
    ? <>这是<b>当前线上版本</b>，访客页与二维码读取的就是此快照。</>
    : <>你正在核对一份<b>历史发布快照</b>（{fmtTime(snap.publishedAt)}）。它已不可变，后续编辑或撤回都不会改变本页内容。</>;

  return <VisitorChrome onEdit={onEdit}>
    <main className="visitor-main audit">
      <div className="audit-banner">{banner}
        <div className="audit-actions">
          <button className="ghost" onClick={onBackLatest}>查看现行访客页</button>
          <button className="ghost" onClick={onEdit}>返回编辑台</button>
        </div>
      </div>
      <span className="eyebrow">SNAPSHOT {snap.id} · {snap.note}</span>
      {item
        ? <div className="detail" style={{padding:'40px 0'}}>
            <div className="detail-art" style={{background:item.color}}><span>{item.code}</span></div>
            <div className="detail-copy">
              <span className="eyebrow">{item.room} / {item.type}</span>
              <h1>{item.title}</h1><p>{item.desc}</p>
              <small className="hint">短码 {item.code} 在该快照中的冻结内容。</small>
            </div>
          </div>
        : <>
            <h1 className="audit-title">{snap.note}</h1>
            <p className="lead">{fmtTime(snap.publishedAt)} 发布 · 共 {snap.items.length} 个展项</p>
            <div className="visitor-grid">{snap.items.map(x=>
              <article className="visitor-card audit-card" key={x.uid}>
                <div className="art" style={{background:x.color}}><span>{x.code}</span></div>
                <div className="card-meta"><small>{x.room}</small><h3>{x.title}</h3><p>{x.desc}</p></div>
              </article>)}</div>
          </>}
    </main>
  </VisitorChrome>;
}

createRoot(document.getElementById('root')).render(<App/>);
