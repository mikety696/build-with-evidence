#!/usr/bin/env node
/* 校验门禁：自动发现并运行项目的 test / typecheck / lint / build，附带密钥扫描。
 * 用法：node gate.mjs [项目根] [--only checkA,checkB] [--no-secrets] [--tail N]
 * 标记：✓ 通过；✗ 真失败；⚠ 命令不可用＝该项未执行，不得视为通过。
 * 退出码：0 全部通过；1 有失败或有未执行项；2 未发现任何可运行校验。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const root = path.resolve(argv.find((a) => !a.startsWith('--')) || process.cwd());
const flag = (name, def) => {
  const i = argv.findIndex((a) => a === `--${name}`);
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : def;
};
const only = flag('only', null);
const noSecrets = flag('no-secrets', false);
const TAIL = Number(flag('tail', 40)) || 40;

if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  console.log(`门禁 · 路径无效：${root}`);
  process.exit(2);
}

const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'vendor', '.venv', 'venv', '__pycache__', 'target', '.next', '.nuxt', 'coverage', '.gradle', 'Pods']);
const BIN_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.mov', '.so', '.dll', '.dylib', '.class', '.pyc', '.exe', '.jar', '.lockb']);

/* ── 发现校验命令 ───────────────────────────────── */
function loadOverride(dir) {
  const f = path.join(dir, '.gate.json');
  if (!fs.existsSync(f)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    const list = Array.isArray(j) ? j : j.commands;
    if (!Array.isArray(list)) return null;
    return list.filter((c) => c && c.cmd).map((c) => ({ name: String(c.name || c.cmd).slice(0, 12), cmd: String(c.cmd), why: '.gate.json' }));
  } catch { return null; }
}

function discover(dir) {
  const override = loadOverride(dir);
  if (override && override.length) return override;
  const cmds = [];
  const pj = path.join(dir, 'package.json');
  if (fs.existsSync(pj)) {
    let pkg = {};
    try { pkg = JSON.parse(fs.readFileSync(pj, 'utf8')) || {}; } catch { /* 损坏的 package.json 交给项目自身报错 */ }
    const s = pkg.scripts || {};
    const run = (name) => (name === 'test' ? 'npm test' : `npm run ${name}`);
    if (s.check) cmds.push({ name: 'check', cmd: run('check'), why: 'package.json scripts.check' });
    for (const [key, label] of [['test', 'test'], ['typecheck', 'typecheck'], ['type-check', 'typecheck'], ['tsc', 'typecheck'], ['lint', 'lint'], ['build', 'build']]) {
      if (s[key] && !cmds.some((c) => c.name === label)) cmds.push({ name: label, cmd: run(key), why: `package.json scripts.${key}` });
    }
  }
  for (const mk of ['Makefile', 'makefile', 'GNUmakefile']) {
    if (!fs.existsSync(path.join(dir, mk))) continue;
    const targets = new Set([...fs.readFileSync(path.join(dir, mk), 'utf8').matchAll(/^([A-Za-z0-9_.-]+):(?!!)/gm)].map((m) => m[1]));
    for (const t of ['check', 'test', 'typecheck', 'lint', 'build']) {
      if (targets.has(t) && !cmds.some((c) => c.name === t)) cmds.push({ name: t, cmd: `make ${t}`, why: `${mk} target ${t}` });
    }
  }
  if (fs.existsSync(path.join(dir, 'Cargo.toml'))) {
    if (!cmds.some((c) => c.name === 'test')) cmds.push({ name: 'test', cmd: 'cargo test --all', why: 'Cargo.toml' });
    if (!cmds.some((c) => c.name === 'lint')) cmds.push({ name: 'lint', cmd: 'cargo clippy --all-targets -- -D warnings', why: 'Cargo.toml' });
  }
  if (fs.existsSync(path.join(dir, 'go.mod'))) {
    if (!cmds.some((c) => c.name === 'lint')) cmds.push({ name: 'lint', cmd: 'go vet ./...', why: 'go.mod' });
    if (!cmds.some((c) => c.name === 'test')) cmds.push({ name: 'test', cmd: 'go test ./...', why: 'go.mod' });
  }
  const py = fs.existsSync(path.join(dir, 'pyproject.toml')) || fs.existsSync(path.join(dir, 'setup.py')) || fs.existsSync(path.join(dir, 'requirements.txt'));
  if (py) {
    if (!cmds.some((c) => c.name === 'test')) cmds.push({ name: 'test', cmd: 'python -m pytest -q', why: 'Python 项目' });
    const pyproject = fs.existsSync(path.join(dir, 'pyproject.toml')) ? fs.readFileSync(path.join(dir, 'pyproject.toml'), 'utf8') : '';
    if (/\[tool\.ruff\]|ruff/.test(pyproject) && !cmds.some((c) => c.name === 'lint')) cmds.push({ name: 'lint', cmd: 'ruff check .', why: 'pyproject [tool.ruff]' });
  }
  return cmds;
}

/* ── 密钥扫描 ───────────────────────────────────── */
const RULES = [
  ['private-key', /-----BEGIN (?:[A-Z]+ )?(?:RSA|EC|DSA|OPENSSH|PGP)?\s*PRIVATE KEY(?: BLOCK)?-----/],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['github-token', /\b(?:ghp|gho|ghu|ghs)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['generic-secret', /(?:api[_-]?key|apikey|secret|access[_-]?token|auth[_-]?token|password|passwd|pwd)["']?\s*[:=]\s*["'][^"'\s]{12,}["']/i],
];
const IGNORE_LINE = /<[^<>\n]{2,}>|exam?ple|placeholder|changeme|your[-_]|redacted|dummy|xxxx|not-a-real|\$\{|\{\{|process\.env|os\.environ|require\(|import\s|from\s+|\/\*|\*\s|^\s*#/i;

function* walk(dir) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name) && !e.isSymbolicLink()) yield* walk(full); }
    else if (e.isFile() && !BIN_EXT.has(path.extname(e.name).toLowerCase())) yield full;
  }
}

function scanSecrets(dir) {
  const hits = [];
  let files = 0;
  for (const file of walk(dir)) {
    let st;
    try { st = fs.statSync(file); } catch { continue; }
    if (st.size > 1024 * 1024) continue;
    const text = fs.readFileSync(file, 'latin1');
    if (!/\S/.test(text) || text.includes('\u0000')) continue;
    files++;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (IGNORE_LINE.test(lines[i])) continue;
      for (const [name, re] of RULES) {
        if (re.test(lines[i])) {
          hits.push({ file: path.relative(dir, file), line: i + 1, rule: name, sample: lines[i].trim().slice(0, 70) });
          break;
        }
      }
      if (hits.length >= 40) return { hits, files, truncated: true };
    }
  }
  return { hits, files, truncated: false };
}

/* 输出解码：正常校验工具输出 UTF-8；中文 Windows 的 cmd 报错（「不是内部或外部命令」）走 GBK，
 * 它不是合法 UTF-8，按 utf8 强解会抛错，再退回 gbk。否则中文会变成乱码，⚠/警告 关键字也匹配不上。 */
function decode(buf) {
  if (!buf) return '';
  if (typeof buf === 'string') return buf;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { /* 不是 UTF-8 */ }
  try { return new TextDecoder('gbk').decode(buf); } catch { /* 无 gbk 支持 */ }
  return buf.toString('latin1');
}

const NOT_FOUND = /不是内部或外部命令|command not found|not recognized as (the name|an internal)|No such file or directory|系统找不到指定的文件|ENOENT/i;

/* ── 执行 ───────────────────────────────────────── */
let cmds = discover(root);
if (only) {
  const want = String(only).split(',').map((x) => x.trim());
  cmds = cmds.filter((c) => want.includes(c.name));
}
const results = [];
const outputs = [];

for (const c of cmds) {
  const t0 = Date.now();
  const r = spawnSync(c.cmd, { cwd: root, shell: true, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const out = `${decode(r.stdout)}${decode(r.stderr)}`.split('\n').filter((l) => l.trim());
  const missing = r.status !== 0 && (r.error || NOT_FOUND.test(out.join('\n')));
  const notes = r.status === 0 ? out.filter((l) => /^\s*[⚠✗]|WARN\b|warning:|\bfailure\b|失败|未验证|无法判断/i.test(l)).slice(0, 8) : [];
  results.push({ ...c, ok: r.status === 0, missing, secs, code: r.status, notes });
  if (r.status !== 0) {
    outputs.push(`--- ${c.name} ${missing ? '未运行（命令不可用）' : `失败（exit ${r.status}）`}· ${c.cmd} · 末 ${TAIL} 行 ---\n${out.slice(-TAIL).join('\n') || '(无输出)'}\n`);
  }
}

let secretLine = '密钥扫描            已跳过';
if (!noSecrets) {
  const { hits, files, truncated } = scanSecrets(root);
  secretLine = hits.length === 0
    ? `密钥扫描            ✓ 0 命中（扫描 ${files} 个文件）`
    : `密钥扫描            ✗ ${hits.length} 处疑似${truncated ? '（已截断）' : ''}\n` +
      hits.slice(0, 12).map((h) => `      ${h.file}:${h.line}  [${h.rule}]  ${h.sample.replace(/[^\x20-\x7e一-龥]/g, '·')}`).join('\n');
  results.push({ name: 'secrets', ok: hits.length === 0 });
}

const failed = results.filter((r) => !r.ok && !r.missing);
const skipped = results.filter((r) => r.missing);
const warned = results.filter((r) => r.notes && r.notes.length);
console.log(`门禁 · ${root}`);
if (!cmds.length && !noSecrets) console.log('  未发现可运行的校验命令（无 package.json scripts / Makefile / cargo / go / pytest）。');
for (const r of results) {
  if (r.name === 'secrets') continue;
  console.log(`  ${r.ok ? '✓' : r.missing ? '⚠' : '✗'} ${r.name.padEnd(11)} ${r.cmd}  ${r.secs}s${r.ok ? '' : r.missing ? '  命令不可用' : `  exit ${r.code}`}`);
}
console.log('  ' + secretLine);
for (const r of warned) for (const l of r.notes) console.log(`  ⚠ [${r.name}] ${l.trim().slice(0, 160)}`);
const verdict = failed.length
  ? `失败（${failed.length} 项：${failed.map((f) => f.name).join(', ')}）`
  : skipped.length
    ? `未能验证（${skipped.length} 项未执行：${skipped.map((f) => f.name).join(', ')}）—— 环境缺工具，禁止当作通过`
    : warned.length
      ? `通过，但有 ${warned.reduce((a, b) => a + b.notes.length, 0)} 条警告需要处理（见上方 ⚠）`
      : '全部通过';
console.log(`\n结果：${verdict}`);
if (skipped.length) {
  console.log('下一步：把可执行的校验写进根目录 .gate.json（工具不在 PATH 时用绝对路径，例如 {"commands":[{"name":"verify","cmd":"C:/…/node.exe scripts/verify.mjs"}]}），或安装缺失的工具链。');
}
if (cmds.length === 0 && !noSecrets) {
  console.log('下一步：为项目加一条聚合校验命令（如 package.json 的 "check": "npm run test && npm run lint"），或在 AGENTS.md 里写明已有的校验入口。');
}
for (const o of outputs) console.log('\n' + o);
process.exit(cmds.length === 0 && noSecrets ? 2 : (failed.length || skipped.length) ? 1 : 0);
