// 让 Node 测试运行器能够加载 JSX（用 esbuild 转译）
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

// 去掉 ?query / #hash（缓存破坏导入）后映射到磁盘路径
const pathFromFileUrl = (u) => fileURLToPath(u.split(/[?#]/)[0]);

export async function load(url, context, nextLoad) {
  if (url.startsWith('file://') && pathFromFileUrl(url).endsWith('.jsx')) {
    const source = readFileSync(pathFromFileUrl(url), 'utf8');
    const out = await transform(source, { loader: 'jsx', format: 'esm', jsx: 'transform' });
    return { format: 'module', source: out.code, shortCircuit: true };
  }
  return nextLoad(url, context);
}
