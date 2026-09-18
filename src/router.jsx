// hash 路由：刷新后停留在同一视图，访客链接/二维码可直接打开
//   #/edit  #/visitor  #/v/:version  #/v/:version/c/:code  #/c/:code

import React from 'react';

export function parseHash(hash) {
  const h = (hash || '').replace(/^#/, '');
  const parts = h.split('/').filter(Boolean);
  if (parts[0] === 'visitor') return { name: 'visitor' };
  if (parts[0] === 'v' && parts[1]) {
    const version = Number(parts[1]);
    if (!Number.isInteger(version)) return { name: 'visitor' };
    if (parts[2] === 'c' && parts[3]) return { name: 'snapshot-detail', version, code: parts[3].toLowerCase() };
    return { name: 'snapshot', version };
  }
  if (parts[0] === 'c' && parts[1]) return { name: 'code', code: parts[1].toLowerCase() };
  return { name: 'edit' };
}

export function useHashRoute() {
  const [route, setRoute] = React.useState(() => parseHash(window.location.hash));
  React.useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function go(path) {
  window.location.hash = path;
}

export function shareUrl(path) {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#${path}`;
}

export function fmtTime(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
