// api/test/source-scan.ts
//
// #1599 ラチェット（静的検査テスト）が共通で使うソース走査ユーティリティ。
//
// このリポジトリには「1 箇所漏れれば穴」という性質の不変条件がいくつかあり、
// それらは人の注意ではなく機械的な検査で守っている
// （`soft-delete-read-boundary.spec.ts` / `cursor-boundary.spec.ts` /
//  `create-after-find-boundary.spec.ts`）。
//
// 走査の下ごしらえ（ファイル列挙・コメント潰し・呼び出し引数の切り出し）は
// どのラチェットでも同じなので、ここへ 1 本化する。**同じ事実を 2 箇所に書かない。**

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** `api/src` の絶対パス */
export const API_SRC = join(__dirname, '..', 'src');
/** `api/` の絶対パス。違反の表示を `src/...` から始めるための基準 */
export const REPO_API_ROOT = join(__dirname, '..');

/** `dir` 以下の `.ts` を再帰的に集める。`.spec.ts` は検査対象から外す */
export function listSourceFiles(dir: string = API_SRC): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full));
      continue;
    }
    if (!entry.endsWith('.ts')) continue;
    if (entry.endsWith('.spec.ts')) continue;
    out.push(full);
  }
  return out;
}

/** 違反の表示に使う、`api/` からの相対パス（POSIX 区切り） */
export function toRepoPath(file: string): string {
  return relative(REPO_API_ROOT, file).split(sep).join('/');
}

/** ファイル内のオフセット `at` が何行目かを 1 始まりで返す */
export function lineOf(text: string, at: number): number {
  return text.slice(0, at).split('\n').length;
}

/**
 * `text` の `openIndex`（`(` の位置）に対応する `)` までを返す。
 * 文字列リテラル・テンプレートリテラルの中の括弧は数えない。
 */
export function readCallArguments(text: string, openIndex: number): string {
  let depth = 0;
  let quote: string | null = null;

  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];

    if (quote) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(openIndex, i + 1);
    }
  }
  return text.slice(openIndex);
}

/**
 * コメントを **同じ長さの空白へ置き換える**（改行は残す）。
 *
 * 取り除く（詰める）のではなく空白で潰すのは、**元ファイルの行番号と文字位置を
 * そのまま使える**ようにするため。
 *
 * ⚠️ これが無いと 2 種類の嘘が両方出る。実際に両方踏んだ。
 *   1. 見逃し: 「`deleted_at` について説明したコメント」を絞っている証拠と誤認し、
 *      絞っていないのに緑になる（fix を revert しても赤くならなかった）
 *   2. 誤検知: コメントの中に書かれた `dish_media.findMany(` という **例示**を
 *      本物の呼び出しと誤認し、正しいコードを赤くする
 *      （`notifications.service.ts` の「こう書くと壊れる」という説明で踏んだ）
 *
 * 検査の正しさは「壊した状態で赤くなること」と「正しい状態で緑であること」の
 * 両方でしか確かめられない。
 */
export function blankComments(text: string): string {
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
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }

    if (ch === '/' && next === '/') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }

    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      blank(i, stop);
      i = stop - 1;
      continue;
    }
  }
  return out.join('');
}

/** ファイルを読み、コメントを潰した本文を返す（行番号は元ファイルと一致する） */
export function readCode(file: string): string {
  return blankComments(readFileSync(file, 'utf8'));
}

/**
 * `text` の `openIndex`（`{` の位置）に対応する `}` までを返す。
 * 文字列リテラル・テンプレートリテラルの中の波括弧は数えない。
 *
 * Prisma のネストしたリレーション指定
 * （`include: { dish_reviews: { where: ... } }`）を丸ごと切り出すのに使う。
 */
export function readBraceBlock(text: string, openIndex: number): string {
  let depth = 0;
  let quote: string | null = null;

  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];

    if (quote) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(openIndex, i + 1);
    }
  }
  return text.slice(openIndex);
}
