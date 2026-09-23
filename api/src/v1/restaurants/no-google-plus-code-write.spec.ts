import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * #1779 【設計】**Google の `plusCode` を `restaurants` へ保存しない。**
 *
 * 読み手が 1 つも無い（API レスポンス型にも app-expo にも参照ゼロ）うえ、
 * ToS 3.2.3 が無期限の保存を許すのは `place_id` だけである。
 *
 * 同じ経路の `image_url` / `address_components` は «値を作らない» へ移行済みだったのに、
 * `plus_code` だけが Google の値を書き続けていた（2026-09-23 実測で発見）。
 * 個別の行ではなく **«Google 由来の値を plus_code へ入れる» という形**を縛る。
 */

const API_SRC = join(__dirname, '..', '..');

/** `plus_code:` へ «Prisma へ渡す Google 由来の値» を入れている行を拾う */
// ⚠️ 空白を **先読みの中**へ入れること。`plus_code:\s*(?!…)` と書くと `\s*` が 0 文字へ
// バックトラックし、`: ` の直後で先読みが走って **許可した値まで違反扱いになる**（実際に踏んだ）。
const FORBIDDEN = /plus_code:(?![ \t]*(?:Prisma\.DbNull|null)\b)/;

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts'))
      acc.push(full);
  }
  return acc;
}

describe('#1779 Google の plusCode を保存しない', () => {
  const files = walk(API_SRC);

  it('走査対象のファイルが見つかる（探し方が壊れていないこと）', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('plus_code へ Prisma.DbNull / null 以外を入れている箇所が無い', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        // 型宣言（`plus_code: JsonValue;` など）は書き込みではないので除く
        if (/plus_code\??:\s*(Prisma\.)?(Json|Input|string|unknown|any)/.test(line))
          return;
        if (FORBIDDEN.test(line)) {
          offenders.push(`${relative(API_SRC, file)}:${i + 1} ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
