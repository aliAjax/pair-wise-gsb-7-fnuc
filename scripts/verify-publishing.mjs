// 发布闭环核心规则的无依赖验证：复刻 main.jsx 中的纯逻辑（短码 / 快照 / 发布阻止）
import assert from 'node:assert';

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
const FIELDS=['title','room','type','desc','audio','color'];
const same=(a,b)=>!!a&&!!b&&FIELDS.every(k=>(a[k]??'')===(b[k]??''));
const strip=x=>Object.fromEntries(['uid','code',...FIELDS].map(k=>[k,x[k]]));

function makeStore(){
  return {counter:1,usedCodes:{},exhibits:[],snapshots:[]};
}
function addDraft(s,over={}){
  const used=new Set(Object.keys(s.usedCodes));
  const code=genCode(s.counter,used);
  const x={uid:'e-'+s.counter,code,title:'展项'+s.counter,room:'A0'+s.counter,
    type:'装置',desc:'d',audio:'',color:'#000',live:false,...over};
  s.counter++;s.usedCodes[code]={assignedAt:Date.now(),uid:x.uid};s.exhibits.push(x);
  return x;
}
function publishBlock(s){
  const will=s.exhibits.filter(x=>x.live);const latest=s.snapshots.at(-1);
  if(!will.length)return {ok:false,reason:'EMPTY'};
  if(latest){
    const nc=new Set(will.map(x=>x.code)),oc=new Set(latest.items.map(x=>x.code));
    const map=Object.fromEntries(latest.items.map(x=>[x.code,x]));
    const added=will.filter(x=>!oc.has(x.code));
    const removed=latest.items.filter(x=>!nc.has(x.code));
    const changed=will.filter(x=>map[x.code]&&!same(x,map[x.code]));
    if(!added.length&&!removed.length&&!changed.length)return {ok:false,reason:'NOCHANGE'};
    return {ok:true,added,removed,changed};
  }
  return {ok:true};
}
function publish(s){
  const b=publishBlock(s);assert.ok(b.ok,'应可发布，实际被阻止: '+b.reason);
  const snap={id:'s'+(s.snapshots.length+1),publishedAt:Date.now(),items:s.exhibits.filter(x=>x.live).map(strip)};
  s.snapshots.push(snap);return snap;
}

let pass=0;const t=(name,fn)=>{fn();pass++;console.log('  ✓',name)};

console.log('1) 短码唯一且不复用');
t('连续创建 200 个展项，短码全局唯一',()=>{
  const s=makeStore();const codes=new Set();
  for(let i=0;i<200;i++){const x=addDraft(s);assert.ok(!codes.has(x.code));codes.add(x.code)}
  assert.equal(codes.size,200);
});
t('撤回后再新建展项，不会拿到旧短码',()=>{
  const s=makeStore();const keep=addDraft(s,{live:true});const a=addDraft(s,{live:true});
  publish(s);a.live=false;publish(s); // 至少保留一个在开展项，发布才不被阻止
  const before=new Set(Object.keys(s.usedCodes));
  for(let i=0;i<50;i++){const x=addDraft(s);assert.ok(!before.has(x.code))}
});

console.log('2) 发布前必须有待发布展项');
t('空草稿发布被阻止并给出原因',()=>{
  const s=makeStore();assert.equal(publishBlock(s).ok,false);assert.equal(publishBlock(s).reason,'EMPTY');
});
t('全部撤回后再发布被阻止',()=>{
  const s=makeStore();addDraft(s,{live:true});publish(s);
  s.exhibits.forEach(x=>x.live=false);
  assert.equal(publishBlock(s).reason,'EMPTY');
});
t('无改动重复发布被阻止',()=>{
  const s=makeStore();addDraft(s,{live:true});publish(s);
  assert.equal(publishBlock(s).ok,false);
});

console.log('3) 快照不可变：发布后改草稿不影响已分享内容');
t('访客读取旧快照，草稿后续修改不可见',()=>{
  const s=makeStore();const a=addDraft(s,{live:true,title:'原版标题'});
  const snap1=publish(s);
  a.title='草稿里的新标题'; // 只改草稿
  const visitorSees=s.snapshots[0].items.find(x=>x.code===a.code);
  assert.equal(visitorSees.title,'原版标题');
  assert.equal(snap1.items[0].title,'原版标题'); // 快照对象本身未被引用污染
  assert.equal(publishBlock(s).changed.length,1); // 检测到待发布改动
  publish(s);
  assert.equal(s.snapshots[0].items[0].title,'原版标题'); // 旧快照依旧
  assert.equal(s.snapshots[1].items[0].title,'草稿里的新标题');
});

console.log('4) 撤回：短码在最新快照失效，旧快照可核对');
t('撤回后最新快照不含该码，但历史快照仍包含',()=>{
  const s=makeStore();const a=addDraft(s,{live:true});const b=addDraft(s,{live:true});
  publish(s);a.live=false;publish(s);
  assert.ok(!s.snapshots.at(-1).items.some(x=>x.code===a.code));
  assert.ok(s.snapshots[0].items.some(x=>x.code===a.code));
  assert.ok(s.usedCodes[a.code]); // 短码仍登记，不回收
  const lastContaining=[...s.snapshots].reverse().find(sn=>sn.items.some(i=>i.code===a.code));
  assert.equal(lastContaining.id,'s1');
  assert.ok(s.snapshots.at(-1).items.some(x=>x.code===b.code));
});

console.log('5) 重新发布同一展项沿用原短码');
t('撤回后重新发布，短码不变',()=>{
  const s=makeStore();const keep=addDraft(s,{live:true});const a=addDraft(s,{live:true});
  publish(s);a.live=false;publish(s);a.live=true;publish(s);
  assert.ok(s.snapshots.at(-1).items.some(x=>x.code===a.code));
  assert.equal(s.snapshots.length,3);
});

console.log('6) 快照是深拷贝，外部改动无法污染历史');
t('strip 生成独立对象',()=>{
  const s=makeStore();const a=addDraft(s,{live:true});publish(s);
  a.desc='changed after';
  assert.notEqual(s.snapshots[0].items[0],a);
  assert.equal(s.snapshots[0].items[0].desc,'d');
});

console.log(`\n全部 ${pass} 组规则验证通过`);
