// api/src/prisma/create-after-find-boundary.spec.ts
//
// #1599 **同じモデルに対する `findFirst` / `findUnique` → `create` を禁じる**ラチェット。
//
// ## なぜ要るのか
//
// 「無ければ作る」を `findFirst` で確認してから `create` する形は TOCTOU である。
// 同じ自然キーのリクエストが同時に 2 本来ると、**両方の find が空振りして両方が
// create し、後発が UNIQUE 制約に衝突して P2002 → 500** になる。
//
// このリポジトリでは 2026-08-26 に、この 1 つのパターンで 3 箇所が同時に見つかった。
//
//   - `dishes.repository.ts` の `createOrGetDishForCategory`（dishes_restaurant_category_unique）
//   - `dish-media-imports.service.ts` の埋め込み作成（dmee_provider_content_dish_uq）
//   - 同ファイルの reactions(save)（user_id + target_type + target_id + action_type）
//
// 1 つ直しても他が残る性質のものなので、人の注意ではなく機械的な検査で守る。
//
// ## ⚠️ 「P2002 を catch して読み直す」は **$transaction の中では成立しない**
//
// Postgres では P2002 が出た時点でトランザクション全体が aborted 状態になり、
// 同じ tx での後続クエリはすべて `current transaction is aborted` で失敗する。
// **そもそも例外を出さない**形にする必要がある。
//
// ## 落ちたときにどう直すか
//
// | 状況 | 直し方 |
// | --- | --- |
// | 自然キーの UNIQUE がある | `createMany({ data: [...], skipDuplicates: true })`（= `ON CONFLICT DO NOTHING`）で入れて読み直す |
// | 一意キー 1 本で表せる | `upsert({ where: <一意キー>, update: {}, create: ... })` |
// | 自然キーの UNIQUE が無い（PK がランダム UUID 等） | 自然キーで `pg_advisory_xact_lock` を取って区間を直列化する |
//
// どれも当てはまらない（競合しえない）場合だけ、**理由を書いて** EXCLUSIONS へ足す。

import {
  API_SRC,
  lineOf,
  listSourceFiles,
  readCode,
  toRepoPath,
} from '../../test/source-scan';

/** 「存在確認」に使われる読み取り。ここを通ってから create すると TOCTOU になる */
const LOOKUP_METHODS = ['findFirst', 'findUnique'] as const;

/**
 * 存在確認から create までを何行ぶん追うか。
 *
 * 「無ければ作る」は 1 つの関数の中にまとまって書かれる。離れすぎた 2 つを
 * 結びつけると誤検知になるので、実際に見つかった 3 件（最大 13 行）に余裕を見た値にする。
 */
const LOOKAHEAD_LINES = 30;

/**
 * 競合しえないと確認できた場所。**理由を必ず書くこと。**
 * キーは `<api からの相対パス>#<モデル>`。
 */
const EXCLUSIONS: Readonly<Record<string, string>> = {};

/** `tx.dishes.findFirst(` / `this.prisma.prisma.users.findUnique(` からモデル名を取る */
const LOOKUP_PATTERN = new RegExp(
  `\\.([a-z_][a-z0-9_]*)\\.(${LOOKUP_METHODS.join('|')})\\(`,
  'g',
);

type Violation = { path: string; line: number; model: string };

/** `text` の中の「同じモデルへの find → create」を全部返す */
export function findCreateAfterLookup(text: string, path: string): Violation[] {
  const lines = text.split('\n');
  const found: Violation[] = [];

  for (const match of text.matchAll(LOOKUP_PATTERN)) {
    const model = match[1];
    if (EXCLUSIONS[`${path}#${model}`]) continue;

    const line = lineOf(text, match.index);
    const window = lines.slice(line, line + LOOKAHEAD_LINES).join('\n');

    // `createMany` は ON CONFLICT DO NOTHING なので対象外。
    // 単数の `create(` だけを見る（`create(` の直前が `Many` でないこと）。
    if (new RegExp(`\\.${model}\\.create\\(`).test(window)) {
      found.push({ path, line, model });
    }
  }
  return found;
}

describe('#1599 「無ければ作る」を findFirst → create で書かない', () => {
  const files = listSourceFiles(API_SRC);

  it('検査対象のソースを実際に走査できている（0 件なら検査自体が壊れている）', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('【自己検査】修正前の書き方を実際に検出できる', () => {
    // #1604 で直す前の `createOrGetDishForCategory` そのもの。
    // これが検出できないなら、下の検査が緑なのは «壊れていないから» ではなく
    // «見えていないから» になる。
    const before = `
      async createOrGetDishForCategory(tx, dish) {
        const existing = await tx.dishes.findFirst({
          where: {
            restaurant_id: dish.restaurant_id,
            category_id: dish.category_id,
          },
        });

        if (existing) {
          return existing;
        }

        const { id: _omitId, ...createData } = dish;

        return tx.dishes.create({
          data: createData,
        });
      }
    `;
    expect(findCreateAfterLookup(before, 'sample.ts')).toEqual([
      { path: 'sample.ts', line: 3, model: 'dishes' },
    ]);

    // 直した後（createMany + skipDuplicates）は検出されない
    const after = before.replace(
      'return tx.dishes.create({\n          data: createData,\n        });',
      'await tx.dishes.createMany({ data: [createData], skipDuplicates: true });',
    );
    expect(findCreateAfterLookup(after, 'sample.ts')).toEqual([]);
  });

  it('別のモデルへの create は巻き込まない（誤検知しない）', () => {
    const unrelated = `
      const dish = await tx.dishes.findFirst({ where: { id } });
      await tx.dish_media.create({ data: { dish_id: dish.id } });
    `;
    expect(findCreateAfterLookup(unrelated, 'sample.ts')).toEqual([]);
  });

  it('api のどこにも findFirst / findUnique → create が残っていない', () => {
    const violations = files.flatMap((file) => {
      const path = toRepoPath(file);
      return findCreateAfterLookup(readCode(file), path).map(
        ({ line, model }) => `${path}:${line} → ${model} の find → create`,
      );
    });

    expect(violations).toEqual([]);
  });
});
