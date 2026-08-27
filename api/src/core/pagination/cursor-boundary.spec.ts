// api/src/core/pagination/cursor-boundary.spec.ts
//
// #1599 **ページングのカーソルを自前で組み立てさせない**ラチェット。
//
// ## なぜ要るのか
//
// `WHERE created_at < :cursor ORDER BY created_at DESC` は、同時刻の行がページ境界を
// またぐとその時刻の行をまとめて飛ばす。**9 本のエンドポイントが全部この形だった。**
//
// しかも `content-reports.repository.ts` は `orderBy` にだけ id を足し、
// 「同着が起きうるので id を第 2 キーに入れて安定させる」とコメントまで書いてあった。
// 並びは安定したが **カーソル側は時刻のままなので飛ぶのは直っていない**。
// つまり «気をつける» では防げていない。機械的に禁じるしかない。
//
// ## 落ちたときにやること
//
// `new Date(cursor)` を手で書かず、`buildCursorFilter()` / `buildCursorOrderBy()` /
// `formatCompositeCursor()` を使う。カーソル列が `created_at` でないなら第 2 引数で渡す。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const API_SRC = join(__dirname, '..', '..');
const REPO_API_ROOT = join(API_SRC, '..');

/**
 * 自前で組み立ててよい場所。**理由を必ず書くこと。**
 */
const EXCLUSIONS: Readonly<Record<string, string>> = {
  // ヘルパー本体。ここだけが `new Date(cursor)` を書いてよい。
  'src/core/pagination/composite-cursor.ts': 'カーソル解釈の実装そのもの',
};

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full));
      continue;
    }
    if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts')) continue;
    out.push(full);
  }
  return out;
}

/** コメントを同じ長さの空白へ潰す（行番号を保つ。説明文を実コードと誤認しないため） */
function blankComments(text: string): string {
  const out = text.split('');
  let quote: string | null = null;
  const blank = (from: number, to: number) => {
    for (let i = from; i < to && i < out.length; i += 1) {
      if (out[i] !== '\n') out[i] = ' ';
    }
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (quote) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '/' && next === '/') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      blank(i, stop); i = stop; continue;
    }
    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      blank(i, stop); i = stop - 1; continue;
    }
  }
  return out.join('');
}

/**
 * `new Date(cursor)` / `new Date(options.cursor)` / `new Date(dto.cursor)` を素で書いている箇所。
 *
 * ⚠️ 最初これを `[A-Za-z_$][\w$.?]*[Cc]ursor` と書いていて、**素の `new Date(cursor)` を
 * 取りこぼした**（識別子の先頭 1 文字を別に食わせていたので "cursor" 単体に一致しなかった）。
 * 「壊した状態で赤くなること」を実測して初めて気づけた。検査は必ずそれを確かめてから入れる。
 */
const HAND_ROLLED_CURSOR = /new\s+Date\s*\(\s*[\w$.?]*[Cc]ursor\b/;

describe('#1599 ページングのカーソルは共通ヘルパーを通す', () => {
  const files = listSourceFiles(API_SRC);

  it('検査対象のソースを実際に走査できている（0 件なら検査自体が壊れている）', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('`new Date(cursor)` を手で書いている場所が無い', () => {
    const violations: string[] = [];

    for (const file of files) {
      const relPath = relative(REPO_API_ROOT, file).split(sep).join('/');
      if (EXCLUSIONS[relPath]) continue;

      const text = blankComments(readFileSync(file, 'utf8'));
      text.split('\n').forEach((line, index) => {
        if (HAND_ROLLED_CURSOR.test(line)) {
          violations.push(`${relPath}:${index + 1} → ${line.trim()}`);
        }
      });
    }

    expect(violations).toEqual([]);
  });
});
