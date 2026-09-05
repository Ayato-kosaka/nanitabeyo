// api/src/v1/dish-media-imports/dish-category-variant-dictionary.service.ts
//
// `dish_category_variants` を照合用の索引に組み直して**プロセス内に持つ**（読み取りのみ）。
//
// ## なぜキャッシュするか
//
// 照合は `shared/utils/dishCategoryMatch.ts` の純関数が行い、辞書は**引数で渡す**契約になっている。
// 素直に実装すると import のたびに全件読みが走るので、TTL つきで持ち回る。
//
// ## TTL を長くとる理由
//
// `dish_category_variants` は `scripts/20251213T0000_wikidata_food_graph/4_1_generate_variants.py`
// を手で流したときにしか変わらない。`api/src/core/static-master/` は TTL 5 分だが、
// あれは `config` のようにダッシュボードから変わりうる表のための値であって、
// **この表を 5 分ごとに読み直す理由は無い**（独立レビュー M-5）。
//
// ## 起動時ロードにしない理由
//
// `static-master.service.ts` と同じく**初回リクエスト時の遅延ロード**にしてある。
// 起動時ロードにすると、SNS import を一度も使わないインスタンスまで DB を叩く。
// 代わりに「最初の 1 リクエストが辞書ロードを被る」ことになるが、
// import はユーザーが手で行う稀な操作なので許容する。

import { Injectable } from '@nestjs/common';

import { AppLoggerService } from '../../core/logger/logger.service';
import { DishCategoryVariantsRepository } from '../dish-category-variants/dish-category-variants.repository';
import {
  buildDishCategoryVariantIndex,
  type DishCategoryVariantEntry,
  type DishCategoryVariantIndex,
} from '../../../../shared/utils/dishCategoryMatch';
import { normalizeMatchText } from '../../../../shared/utils/textNormalize';

/** 辞書として読む行数の上限。実測見込み（約 5,000 行）の 10 倍を安全余裕として取る */
export const DISH_CATEGORY_VARIANT_LOAD_LIMIT = 50_000;

/**
 * #1273 日本語の表記ゆれ・略称の追い足し（キーは各カテゴリの `labels.ja` の**正規化前の値**）。
 *
 * ## なぜ QID ではなくラベルをキーにするか
 *
 * QID をキーにすると「アプリに存在しない QID を指す幽霊エントリ」が混ざりうる。
 * `labels.ja` をキーにすれば、`buildJapaneseLabelVariants` が **実在するカテゴリにしか**
 * 別名を足せない（キーが一致した行にだけ足す）ので、アプリのカテゴリ集合が変わっても腐らない。
 *
 * ## 収録の基準（precision を落とさないもの «だけ»）
 *
 * ここに入れてよいのは「その料理を**別の綴りで書いただけ**」の表記ゆれと、
 * 誤解の余地がない略称に限る（`焼き鳥`↔`焼鳥`、`唐揚げ`↔`から揚げ`、`牛タン焼き`→`牛タン`）。
 * `カツ` `丼` `鍋` のような **他カテゴリと衝突する断片は入れない**（本文走査で誤爆するため）。
 * 本文走査に載るのは文字種別の最小長（漢字 2 / かな 3 / ラテン 4）を満たすものだけで、
 * `すし` `鮨` のような 2 文字以下は完全一致（ハッシュタグ等）でしか当たらない（誤爆しない）。
 */
export const DISH_CATEGORY_JA_LABEL_SYNONYMS: Record<
  string,
  readonly string[]
> = {
  焼き鳥: ['焼鳥', 'やきとり', 'やき鳥', '焼とり'],
  そば: ['蕎麦', 'そば屋', '蕎麦屋', '手打ちそば', '手打ち蕎麦', '二八そば', '十割そば'],
  唐揚げ: ['から揚げ', 'からあげ', '唐揚', 'カラアゲ', 'ザンギ', '鶏の唐揚げ', '鶏唐'],
  お好み焼き: ['お好み焼'],
  たこ焼き: ['たこ焼', 'タコ焼き', 'タコ焼'],
  とんかつ: ['トンカツ', '豚カツ', 'ヒレカツ', 'ロースカツ'],
  牛タン焼き: ['牛タン', '牛たん'],
  餃子: ['ぎょうざ', 'ギョーザ', 'ギョウザ'],
  ウナギ: ['うなぎ', '鰻', 'うな丼', 'うな重'],
  寿司: ['すし', '鮨', '寿し', 'スシ', 'にぎり', '回転寿司'],
  担担麺: ['担々麺', 'タンタンメン'],
  // #1273 2026-09-03 追加（A13: caption 未判定 3,000 件の分類で «辞書に無い表記» が 15% を占めた。
  // 実コードのハーネスで再現し、未判定の 15.8% が判定に転じることを確認した表記だけを入れる）。
  // 業態語（喫茶/食堂/酒場/割烹/町中華/ビストロ…）は、この app のカテゴリが «カフェ/定食/居酒屋/
  // 和食/中華料理/フレンチ» のように業態そのものを持つので、その業態カテゴリへの別表記として扱う。
  // 他カテゴリと衝突しうる断片（味玉→ラーメン、ハラミ→焼肉、海鮮→海鮮料理 等）は入れない。
  カフェ: ['喫茶', '喫茶店', '純喫茶', '珈琲', 'コーヒースタンド'],
  ラーメン: ['らぁめん', 'らぁ麺', 'らー麺', 'ラァメン', 'ラーメン屋', '中華そば', '中華蕎麦'],
  焼肉: ['焼き肉', 'やきにく'],
  定食: ['定食屋', '食堂', '日替わり定食', 'ランチ定食'],
  居酒屋: ['酒場', '大衆酒場', '立ち飲み', '酒処', '呑み処', '飲み処'],
  和食: ['日本料理', '割烹', '料亭', '小料理', '会席', '和定食'],
  イタリアン: ['イタリア料理', 'トラットリア', 'リストランテ', 'オステリア'],
  フレンチ: ['フランス料理', 'ビストロ'],
  中華料理: ['中国料理', '町中華', '中華屋'],
  ケーキ: ['ケーキ屋', 'パティスリー'],
  チーズケーキ: ['バスチー'],
  ハンバーガー: ['バーガー', 'burger'],
  カレー: ['カリー', 'カレー屋', 'スパイスカレー', '欧風カレー'],
  天ぷら: ['てんぷら', '天婦羅'],
  うどん: ['饂飩', 'うどん屋', '讃岐うどん'],
  おでん: ['関東煮'],
  かき氷: ['カキ氷'],
  アイスクリーム: ['アイス'],
  刺身盛り合わせ: ['さしみ', '刺し身', 'お造り'],
  鍋料理: ['お鍋', 'ちゃんこ', '鍋コース'],
  牡蠣料理: ['牡蠣'],
  蟹料理: ['蟹', 'カニ'],
  ピザ: ['ピッツァ', 'ピッツェリア', 'pizzeria', 'ピザ屋', 'ピザ店'],
  パスタ: ['スパゲティ', 'パスタランチ'],
  サンドイッチ: ['サンドウィッチ'],
  パンケーキ: ['ホットケーキ'],
  沖縄料理: ['ソーキそば', 'ゴーヤチャンプルー'],
  すき焼き: ['すきやき', 'すき焼'],
  もつ鍋: ['モツ鍋'],
  ホルモン焼き: ['ホルモン'],
  串カツ: ['串揚げ'],
  生姜焼き: ['しょうが焼き', '生姜焼'],
  麻婆豆腐: ['麻婆', 'マーボー'],
  チャーハン: ['焼飯'],
  焼きそば: ['やきそば', '焼そば'],
  スペイン料理: ['スペインバル'],
  韓国フライドチキン: ['韓国チキン'],
  懐石料理: ['懐石'],
  釜飯: ['釜めし'],
  素麺: ['そうめん'],
  焼き魚定食: ['焼き魚', '焼魚'],
  ステーキ: ['ステーキハウス'],
  アクアパッツア: ['アクアパッツァ'],
  あじの開き: ['アジの開き', '鯵の開き', 'あじ開き', 'アジ開き'],
  ハヤシライス: ['ハヤシ'],
  豚骨ラーメン: ['豚骨'],
};

/**
 * #1273 各カテゴリの `labels.ja`（＋表記ゆれ）を照合辞書のエントリへ変換する純関数。
 *
 * `dish_category_variants` はグローバル一意化で自分の日本語ラベルを失っているカテゴリがある
 * （`findAllCategoryLabelsForMatching` の doc 参照）。表示名の正である `labels.ja` を
 * 辞書へ足し戻すことで、キャプションに料理名が明記されていれば必ず候補が出るようにする。
 *
 * - `labels` が Json（`{ [lang]: string }`）でないもの、`ja` が空・非文字列のものは黙って捨てる
 * - `source` は `wikidata-label` 相当（本文走査の減点なし）。`labels.ja` は Wikidata の ja ラベルそのもの
 * - 表記ゆれは `DISH_CATEGORY_JA_LABEL_SYNONYMS` を **正規化前の ja ラベル**で引いて足す
 */
export function buildJapaneseLabelVariants(
  categories: readonly { id: string; labels: unknown }[] | null | undefined,
): DishCategoryVariantEntry[] {
  const out: DishCategoryVariantEntry[] = [];
  for (const category of categories ?? []) {
    if (
      !category ||
      typeof category.id !== 'string' ||
      category.id.length === 0
    )
      continue;

    const labels = category.labels;
    if (labels === null || typeof labels !== 'object' || Array.isArray(labels))
      continue;

    const ja = (labels as Record<string, unknown>).ja;
    if (typeof ja !== 'string' || normalizeMatchText(ja).length === 0) continue;

    out.push({
      dishCategoryId: category.id,
      surfaceForm: ja,
      source: 'wikidata-label',
    });

    for (const synonym of DISH_CATEGORY_JA_LABEL_SYNONYMS[ja] ?? []) {
      out.push({
        dishCategoryId: category.id,
        surfaceForm: synonym,
        source: 'wikidata-label',
      });
    }
  }
  return out;
}

/** キャッシュの寿命（ms）。6 時間 */
export const DISH_CATEGORY_VARIANT_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;

type CacheEntry = {
  index: DishCategoryVariantIndex;
  loadedAt: number;
};

@Injectable()
export class DishCategoryVariantDictionaryService {
  private cache: CacheEntry | null = null;

  /** 同時アクセスで全件読みが重ならないようにするための in-flight 共有 */
  private inFlight: Promise<DishCategoryVariantIndex> | null = null;

  constructor(
    private readonly repo: DishCategoryVariantsRepository,
    private readonly logger: AppLoggerService,
  ) {}

  async getIndex(now: number = Date.now()): Promise<DishCategoryVariantIndex> {
    if (
      this.cache !== null &&
      now - this.cache.loadedAt < DISH_CATEGORY_VARIANT_CACHE_TTL_MS
    ) {
      return this.cache.index;
    }

    if (this.inFlight !== null) return this.inFlight;

    this.inFlight = this.load(now).finally(() => {
      this.inFlight = null;
    });

    return this.inFlight;
  }

  private async load(now: number): Promise<DishCategoryVariantIndex> {
    const startedAt = Date.now();
    // #1273 辞書本体（グローバル一意化で日本語ラベルが欠けうる）と、各カテゴリの
    // `labels.ja` を並行で読み、後者で欠落を補ってから索引化する。互いに依存しないので並列。
    const [rows, categoryRows] = await Promise.all([
      this.repo.findAllVariantsForMatching(DISH_CATEGORY_VARIANT_LOAD_LIMIT),
      this.repo.findAllCategoryLabelsForMatching(
        DISH_CATEGORY_VARIANT_LOAD_LIMIT,
      ),
    ]);

    const entries: DishCategoryVariantEntry[] = rows.map((row) => ({
      dishCategoryId: row.dish_category_id,
      surfaceForm: row.surface_form,
      source: row.source,
    }));

    // #1273 各カテゴリの日本語ラベル（＋表記ゆれ）を追い足す。同じ (カテゴリ, 表記) は
    // `buildDishCategoryVariantIndex` の putUnique が冪等に畳むので、二重計上にはならない。
    const japaneseLabelEntries = buildJapaneseLabelVariants(categoryRows);

    const index = buildDishCategoryVariantIndex([
      ...entries,
      ...japaneseLabelEntries,
    ]);
    this.cache = { index, loadedAt: now };

    this.logger.log('DishCategoryVariantIndexBuilt', 'load', {
      rows: rows.length,
      // #1273 labels.ja から足し戻した補助エントリ数（辞書欠落の規模の目安）
      japaneseLabelEntries: japaneseLabelEntries.length,
      // 索引に載らなかった行（同じ表記に複数カテゴリ）の件数。増えていたら辞書側の異常
      ambiguousCount: index.ambiguousCount,
      scannableCount: index.scannable.length,
      elapsedMs: Date.now() - startedAt,
      // 上限に達していたら辞書が想定より大きい。閾値の見直しが要る
      truncated: rows.length >= DISH_CATEGORY_VARIANT_LOAD_LIMIT,
    });

    return index;
  }
}
