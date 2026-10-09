#!/usr/bin/env node
/* 项目基线生成：把本 skill 的模板复制进项目，并报告仍需人工/会话补全的占位符。
 * 用法：node bootstrap.mjs [项目根] [--force]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const root = path.resolve(argv.find((a) => !a.startsWith('--')) || process.cwd());
const force = argv.includes('--force');

if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  console.log(`基线 · 路径无效：${root}`);
  process.exit(1);
}

const PLAN = [
  { from: 'assets/AGENTS.md', to: 'AGENTS.md', why: '项目契约：命令、架构约束、安全红线、性能预算' },
  { from: 'assets/feature-spec.md', to: 'docs/feature-spec.md', why: '功能规格模板：每个功能填一次' },
  { from: 'assets/acceptance-checklist.md', to: 'docs/acceptance-checklist.md', why: '合并前验收清单' },
  { from: 'assets/prompt-pack.md', to: 'docs/prompt-pack.md', why: '分阶段提示词库' },
];

function stackHints(dir) {
  const has = (f) => fs.existsSync(path.join(dir, f));
  const out = [];
  if (has('package.json')) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).scripts || {};
      const keys = ['check', 'test', 'typecheck', 'lint', 'build', 'dev'].filter((k) => s[k]);
      out.push(keys.length ? `package.json scripts：${keys.join(', ')}` : 'package.json 存在但没有 check/test/lint/build 脚本');
    } catch { out.push('package.json 解析失败'); }
  }
  if (has('Cargo.toml')) out.push('Rust 项目（cargo test / cargo clippy）');
  if (has('go.mod')) out.push('Go 项目（go test ./... / go vet ./...）');
  if (has('pyproject.toml') || has('requirements.txt') || has('setup.py')) out.push('Python 项目（pytest / ruff）');
  if (has('Makefile') || has('makefile')) out.push('含 Makefile，优先用 make 目标');
  if (!out.length) out.push('未识别技术栈：先确认项目如何安装、启动、测试');
  return out;
}

const written = [];
const skipped = [];
for (const item of PLAN) {
  const src = path.join(SKILL, item.from);
  const dest = path.join(root, item.to);
  if (!fs.existsSync(src)) { skipped.push(`${item.to}（模板缺失：${item.from}）`); continue; }
  if (fs.existsSync(dest) && !force) { skipped.push(`${item.to}（已存在，未覆盖）`); continue; }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  written.push(item.to);
}

const agents = path.join(root, 'AGENTS.md');
let placeholders = 0;
if (fs.existsSync(agents)) {
  const txt = fs.readFileSync(agents, 'utf8');
  placeholders = [...txt.matchAll(/<[^<>\n]{2,}>/g)].length;
}

console.log(`基线 · ${root}`);
console.log(written.length ? `  已写入：${written.join(', ')}` : '  未写入任何文件');
if (skipped.length) console.log(`  跳过：${skipped.join('; ')}`);
console.log(`\n识别到的工程入口：`);
for (const h of stackHints(root)) console.log(`  - ${h}`);
console.log(`\nAGENTS.md 中仍有 ${placeholders} 处 <占位符> 待填。下一步：`);
console.log('  1. 读仓库，把占位符换成真实值（命令、目录、预算、红线、已知的坑）。');
console.log('  2. 确保存在一条聚合校验命令，然后运行 gate.mjs 验证它真的能跑。');
console.log('  3. 第一个功能开始前，用 docs/feature-spec.md 收敛规格；合并前逐项过 docs/acceptance-checklist.md。');
process.exit(0);
