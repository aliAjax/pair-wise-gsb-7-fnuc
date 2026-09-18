import React, { useEffect, useReducer, useRef, useState } from 'react';
import { loadState, saveState, STORAGE_KEY, isValidState } from './model/store.js';
import { useHashRoute } from './router.jsx';
import Workbench from './components/Workbench.jsx';
import { VisitorList, VisitorCode, VisitorSnapshotDetail } from './components/Visitor.jsx';

function reducer(state, action) {
  switch (action.type) {
    case 'commit': return action.state; // planPublish / addExhibit 在组件外算出的新状态
    case 'update':
      return {
        ...state,
        exhibits: state.exhibits.map((e) => (e.id === action.id ? { ...e, ...action.patch } : e)),
      };
    case 'toggle':
      return {
        ...state,
        exhibits: state.exhibits.map((e) => (e.id === action.id ? { ...e, included: !e.included } : e)),
      };
    case 'hydrate':
      return action.state;
    default:
      return state;
  }
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);
  const route = useHashRoute();
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);
  const notify = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3600);
  };

  // 草稿/发布状态持久化：刷新后三者（草稿、发布状态、访客结果）保持一致
  useEffect(() => { saveState(state); }, [state]);

  // 多标签页同步：一个标签发布后，另一个标签的访客预览也读到新快照
  useEffect(() => {
    const onStorage = (ev) => {
      if (ev.key !== STORAGE_KEY || !ev.newValue) return;
      try {
        const next = JSON.parse(ev.newValue);
        if (isValidState(next)) dispatch({ type: 'hydrate', state: next });
      } catch { /* 忽略损坏数据 */ }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  let page;
  switch (route.name) {
    case 'visitor':
      page = <VisitorList state={state} />;
      break;
    case 'snapshot':
      page = <VisitorList state={state} version={route.version} />;
      break;
    case 'snapshot-detail':
      page = <VisitorSnapshotDetail state={state} version={route.version} code={route.code} />;
      break;
    case 'code':
      page = <VisitorCode state={state} code={route.code} />;
      break;
    default:
      page = <Workbench state={state} dispatch={dispatch} notify={notify} />;
  }

  return (
    <>
      {page}
      {toast && <div className="toast" onClick={() => setToast('')}>{toast}</div>}
    </>
  );
}
