// #1590 【設計】e2e の spec に «test()/it() の入れ子» が無いことを保証する。
//
// 入れ子になった test は **1 度も実行されない**（Playwright / Jest とも、
// 外側の test の実行中に登録された test は無視される）。構文としては正しいので
// tsc も eslint も気づかず、CI は緑のまま «検証しているつもり» になる。
//
// このリポジトリで実際に 2 度起きた:
//   - e2e-web/tests/profile/settings.spec.ts
//     «バージョン情報が表示される» の中へ «匿名時は通知カードが表示されない» が入れ子になり、
//     バージョンも通知カードもどちらも assert されていなかった
//   - e2e-mobile/tests/profile/settings.test.ts
//     ハプティクスの it が閉じられないまま通知の it が入れ子になっていた
//
// どちらもマージ後にベース取り込みで偶然見つかったもので、
// «見つからなければそのまま出ていた» 類の欠陥である。
//
// 使い方: node ./scripts/assert-no-nested-e2e-tests.mjs [走査するディレクトリ...]

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = process.argv.slice(2).length ? process.argv.slice(2) : ["e2e-web/tests", "e2e-mobile/tests"];
const findings = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(spec|test)\.ts$/.test(name)) scan(p);
  }
}

/** 文字列・テンプレート・コメントを同じ長さの空白へ潰す（行番号を保つ） */
function blank(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length))
    .replace(/`(?:\\.|[^`\\])*`/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/"(?:\\.|[^"\\])*"/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/'(?:\\.|[^'\\])*'/g, (m) => m.replace(/[^\n]/g, " "));
}

function scan(file) {
  const src = readFileSync(file, "utf8");
  const s = blank(src);
  const lineOf = (i) => s.slice(0, i).split("\n").length;

  // test( / it( の呼び出しを «開始 index → 対応する ) の index» で範囲化する
  const calls = [];
  const re = /(^|[^\w.$])(test|it)\s*\(/g;
  let m;
  while ((m = re.exec(s))) {
    const open = m.index + m[0].length - 1; // '(' の位置
    let depth = 0;
    let end = -1;
    for (let i = open; i < s.length; i++) {
      if (s[i] === "(") depth++;
      else if (s[i] === ")") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end !== -1) calls.push({ start: m.index + m[0].length - m[2].length - 1, open, end });
  }

  for (const c of calls) {
    const outer = calls.find((o) => o !== c && o.open < c.start && c.end < o.end);
    if (outer) findings.push({ file, line: lineOf(c.start), outerLine: lineOf(outer.start) });
  }
}

for (const r of ROOTS) walk(r);
if (findings.length) {
  console.error("❌ test()/it() の入れ子を検出しました（内側の中身は 1 度も実行されません）:");
  for (const f of findings) console.error(`   ${f.file}:${f.line}（外側の test は ${f.outerLine} 行目）`);
  process.exit(1);
}
console.log(`✅ e2e の spec に test()/it() の入れ子はありません`);
