import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * #1779 【設計】**contract で落とした列を、生 SQL が参照し続けていないこと。**
 *
 * 2026-09-24 の contract migration（20260924T0100）は 5 列を落としたが、
 * `GET /v1/users/me/dishes` の生 SQL だけが呼び名の列を SELECT したまま残り、
 * dev で `column d.name does not exist`（Postgres 42703）を投げて
 * **2 時間で 44 回 500 を返していた**（2026-10-13 の夜間 E2E で発覚）。
 *
 * ⚠️ **型検査では捕まらない。** 列を落とすと Prisma の生成型からも消えるので
 * 「型を直せば気づく」はずだが、該当の object は `page.map()` を通るため
 * **余剰プロパティ検査が効かない**（object literal の freshness が失われる）。
 * そのため «typecheck と単体テストは緑のまま、実行時だけ落ちる» 状態が作れる。
 *
 * 個別の行ではなく **«落とした列を SQL の列参照として書く» という形**を縛る。
 * 落とす列を増やしたときは、この表に 1 行足すだけで同じ網が張られる。
 */

const API_SRC = __dirname;

/**
 * 落とした列と、その列を持っていたテーブルの別名。
 *
 * ⚠️ **Google の API レスポンスのキーと同名の列がある**（`address_components` /
 * `plus_code`）。`external-api.service.ts` の型や Geocoding の戻り値は «保存した列» では
 * ないので、`<別名>.<列>` の形（= SQL の列参照）だけを違反にする。素の識別子は見ない。
 */
const DROPPED: { column: string; aliases: string[] }[] = [
  { column: 'name', aliases: ['d', 'dishes'] },
  { column: 'data_origin', aliases: ['d', 'dishes'] },
  { column: 'image_url', aliases: ['r', 'restaurants'] },
  { column: 'plus_code', aliases: ['r', 'restaurants'] },
  { column: 'address_components', aliases: ['r', 'restaurants'] },
];

/**
 * コメントを空白へ置き換える（行番号は保つ）。
 *
 * ⚠️ **行単位で `//` を削るだけでは足りない。** このリポジトリの設計コメントは
 * `/* … *\/` の中に «*» を置かない複数行の散文で書かれているため、行だけ見ると
 * «SQL の列参照» と区別が付かない（実際に 7 件の誤検出が出た）。
 * 文字を順に送って、TS の行コメント・ブロックコメント・SQL の `--` をまとめて落とす。
 */
function stripComments(source: string): string {
  const out: string[] = [];
  let mode: 'code' | 'line' | 'block' = 'code';
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '\n') {
      if (mode === 'line') mode = 'code';
      out.push('\n');
      continue;
    }
    if (mode === 'code') {
      if (c === '/' && next === '*') {
        mode = 'block';
        out.push('  ');
        i++;
        continue;
      }
      if ((c === '/' && next === '/') || (c === '-' && next === '-')) {
        mode = 'line';
        out.push('  ');
        i++;
        continue;
      }
      out.push(c);
      continue;
    }
    if (mode === 'block' && c === '*' && next === '/') {
      mode = 'code';
      out.push('  ');
      i++;
      continue;
    }
    out.push(' ');
  }
  return out.join('');
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts'))
      acc.push(full);
  }
  return acc;
}

describe('#1779 落とした列を生 SQL が参照していない', () => {
  const files = walk(API_SRC);

  it('走査対象のファイルが見つかる（探し方が壊れていないこと）', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(DROPPED)(
    '$column を $aliases の列として参照している箇所が無い',
    ({ column, aliases }) => {
      const pattern = new RegExp(
        `(^|[^\\w.])(${aliases.join('|')})\\.${column}\\b`,
      );
      const offenders: string[] = [];
      for (const file of files) {
        const raw = readFileSync(file, 'utf8').split('\n');
        stripComments(readFileSync(file, 'utf8'))
          .split('\n')
          .forEach((line, i) => {
            if (pattern.test(line)) {
              offenders.push(
                `${relative(API_SRC, file)}:${i + 1} ${raw[i].trim()}`,
              );
            }
          });
      }
      expect(offenders).toEqual([]);
    },
  );
});
