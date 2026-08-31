import * as dotenv from 'dotenv';
import { z } from 'zod';
import { parseCorsOrigins } from './cors-origin';

// .env ファイルから環境変数を読み込む
dotenv.config();

/**
 * 環境変数のスキーマ定義。
 * すべての必須変数を型安全に定義し、起動時にチェックできるようにする。
 */
const envSchema = z.object({
  API_COMMIT_ID: z.string(),
  API_NODE_ENV: z.string(),
  // カンマ区切りで複数オリジンを許可する（例: "https://app.example.com,http://localhost:4173"）
  // 単一値もそのまま 1 要素の配列になるため後方互換
  // `*` を含む項目は RegExp へ展開される（Firebase Hosting の preview チャンネルのように
  // URL の一部が毎回変わる配信先を許可するため）。詳細は cors-origin.ts を参照。
  CORS_ORIGIN: z.string().transform(parseCorsOrigins),
  DATABASE_URL: z.string(),
  DB_SCHEMA: z.string(),
  // #904 【設計】Prisma 7 driver adapterではPool設定をDATABASE_URLではなくpg.Poolへ渡す
  //
  // #1629 【設計】**既定を 1 から 5 へ上げた。** 1 だと API インスタンス全体で
  // «同時に走れる DB クエリが 1 本» になる。
  //
  // オーナー実機（2026-08-29）で「この範囲で再検索」が 40 秒かかった件の真因がこれだった。
  // 「お店を選ぶ」画面は地図を動かすたびに近傍検索を投げ（400ms デバウンス）、
  // ボタンで保存済み検索も投げる。実ログでは 30 秒間に SearchRestaurants が 7 本走っており、
  // **SQL 自体は実座標でも 28〜32 ms** なのに、1 本の接続に並んだ結果
  // app_ms が 41〜42 秒まで膨らんでいた（同時刻の全リクエストが一斉に終わるのが特徴）。
  //
  // ⚠️ **クライアントの `AbortController` はサーバのクエリを止めない。**
  //    Node/Nest は切断を検知して Prisma のクエリを中断しないので、
  //    ユーザーが諦めたリクエストも接続を占有し続ける。だから «投げる数を減らす» 側
  //    （select-restaurant.tsx の表示域チェック）と両輪で直す必要がある。
  //
  // 戻し方: この既定値を 1 に戻すか、環境変数 DB_POOL_MAX=1 を与える。
  // 上限を 10 にしているのは Cloud Run のインスタンス数 × プール数が
  // Supabase の接続上限を超えないようにするため（上限そのものは変えていない）。
  DB_POOL_MAX: z.coerce.number().int().min(1).max(10).default(5),
  DB_POOL_CONNECTION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(60_000)
    .default(60_000),
  DB_POOL_IDLE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(300_000)
    .default(300_000),
  DB_POOL_MAX_LIFETIME_SECONDS: z.coerce
    .number()
    .int()
    .min(0)
    .max(3_600)
    .default(0),
  SUPABASE_JWT_SECRET: z.string(),
  GOOGLE_PLACE_API_KEY: z.string(),
  GCS_BUCKET_NAME: z.string(),
  GCS_BUCKET_PUBLIC_NAME: z.string(),
  GCS_STATIC_MASTER_DIR_PATH: z.string(),
  CLAUDE_API_KEY: z.string(),
  GOOGLE_API_KEY: z.string(),
  GOOGLE_SEARCH_ENGINE_ID: z.string(),
  GCP_PROJECT: z.string(),
  TASKS_LOCATION: z.string(),
  TRANSCODER_LOCATION: z.string(),
  TRANSCODER_PUBSUB_TOPIC: z.string(),
  CLOUD_RUN_URL: z.string(),
  TASKS_INVOKER_SA: z.string(),
  PUBSUB_PUSH_SA: z.string(),
  GCS_DEV_SERVICE_ACCOUNT_BASE64: z.string().optional(),
  LOG_BATCH_MAX: z.string().transform(Number).default('200'),
  LOG_SPILL_THRESHOLD: z.string().transform(Number).default('500'),
  PRISMA_OPEN_BASE_MS: z
    .string()
    .default('5000')
    .transform((v) => Number(v)),
  PRISMA_OPEN_CAP_MS: z
    .string()
    .default('120000')
    .transform((v) => Number(v)),
  PRISMA_MAX_RETRIES: z
    .string()
    .default('3')
    .transform((v) => Number(v)),
  PRISMA_TX_MAX_WAIT: z
    .string()
    .default('60000')
    .transform((v) => Number(v)),
  PRISMA_TX_TIMEOUT: z
    .string()
    .default('60000')
    .transform((v) => Number(v)),
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_REPO_OWNER: z.string().default('Ayato-kosaka'),
  GITHUB_REPO_NAME: z.string().default('nanitabeyo'),
  DEV_AUTH_IS_ANONYMOUS: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  CDN_HOST: z.string(),
  CDN_KEY_NAME: z.string(),
  CDN_KEY_SECRET_B64: z.string(),
  CDN_SIGNED_COOKIE_TTL_SECONDS: z
    .string()
    .default('600')
    .transform((v) => Number(v)),
  CDN_PUBLIC_HOST: z.string(),
  /**
   * #721 共有リンク（`/s/:token`）の絶対 URL を組み立てるための Web の配信元。
   *
   * ⚠️ **development / staging では必ず上書きすること。** 既定のままだと、開発環境で
   * 作った共有リンクが本番ドメインを指す（開いても対象が存在しない）。
   * 必須にしない（default を置く）のは、未設定で API が起動不能になる方が害が大きいため。
   * app 側の `EXPO_PUBLIC_WEB_BASE_URL` と同じ値を入れる。
   */
  WEB_BASE_URL: z.string().url().default('https://app.nanitabeyo.net'),
  /**
   * #1511 アカウント削除で Supabase Auth のユーザーを **物理削除**するために使う。
   *
   * `SUPABASE_URL` はプロジェクトの API エンドポイント（例: https://xxxx.supabase.co）、
   * `SUPABASE_SERVICE_ROLE_KEY` は admin API（`/auth/v1/admin/users/:id`）を呼べる鍵。
   *
   * ⚠️ **optional にしてある。** service_role 鍵を Cloud Run へ持たせるのは権限の拡大であり、
   * オーナーの承認を得てから配線する（#1511 のリーダー判断で保留になっている 2 点のうちの 1 つ）。
   * 未設定でも API 全体が起動不能にならないようにし、
   * 「アカウント削除だけが 503 になる」形で失敗を局所化する（supabase-admin.service.ts 参照）。
   */
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // ──────────────────────────────────────────────────────────────────────────
  // #1764 【設計】Remote Config（API 側）。
  //
  // かつては Supabase `config` テーブル → GCS `config.json`（5 分 TTL）で読んでいたが、
  // Cloud Run の環境変数へ移行した。値の変更は `cloud-run-env-update.yml` を dispatch する
  // （イメージ再ビルド不要。スモークゲートを通ってリビジョンが差し替わる）。
  //
  // - 既定値は移行時点の config.json と同値。**env 未設定でも挙動が変わらない**ように
  //   全キーに default を置く（必須にすると env の設定漏れで API 全体が起動不能になる）
  // - アプリ（app-expo）が CDN から直接読むキーはここに置かない。それらは従来どおり
  //   `config.json` が正（このリストと重複して見える `v1_search_result_restaurants_number`
  //   だけは両側で使われる。API 側は bulk import のページサイズ用で、変えるときは
  //   config テーブル側と両方を揃えること）
  // - 読み口は RemoteConfigService（api/src/core/remote-config/）。call site から
  //   直接 `env.dish_category_...` を参照しない
  // ──────────────────────────────────────────────────────────────────────────
  is_maintenance: z.string().default('false'),
  minimum_supported_version: z.string().default('1.0.0'),
  v1_search_result_restaurants_number: z.string().default('5'),
  v1_bulk_import_preflight_enabled: z.string().default('true'),
  TOOLS_DISH_CATEGORIES_POPULAR_EXCLUDED_CATEGORY_IDS: z
    .string()
    .default(
      'Q177378,Q1063096,Q471866,Q1061856,Q220964,Q188788,Q11771087,Q549713,Q182940,Q134992253,Q187495,Q1827035,Q112818476,Q1381277,Q1317601,Q2089240,Q1051155,Q182940,Q30524428,Q2089240,Q842566,Q202677,Q4833218,Q2078349,Q1477592,Q614448,Q866153,Q29330,Q477248,Q1105215',
    ),
  dish_category_recommendation_weight_time_slot: z.string().default('1.5'),
  dish_category_recommendation_weight_scene: z.string().default('1.1'),
  dish_category_recommendation_weight_satiety: z.string().default('1'),
  dish_category_recommendation_weight_taste: z.string().default('5'),
  dish_category_recommendation_weight_budget_intent: z.string().default('2.2'),
  dish_category_recommendation_weight_dining_pace: z.string().default('2.2'),
  dish_category_recommendation_weight_core_ingredient: z.string().default('8'),
  dish_category_recommendation_weight_market_salience: z
    .string()
    .default('0.05'),
  dish_category_recommendation_weight_dine_out_orderability: z
    .string()
    .default('0.1'),
  // #737 季節補正の重み。値の根拠と効き方の実測は shared/remoteConfig/remoteConfig.schema.ts の
  // 同名キーの doc comment を参照（0.25 は最悪条件のシミュレーションで決めた値）
  dish_category_recommendation_weight_season: z.string().default('0.25'),
  dish_category_recommendation_score_jitter_ratio: z.string().default('0.12'),
  dish_category_recommendation_penalty_weight_core_ingredient: z
    .string()
    .default('0.003'),
  dish_category_recommendation_penalty_weight_taste: z
    .string()
    .default('0.0005'),
  dish_category_recommendation_penalty_weight_cooking_method: z
    .string()
    .default('0.003'),
});

/**
 * 環境変数を検証し、型付きで取得する関数。
 * 必須変数が不足・誤設定されている場合はエラーを投げてアプリ起動を中断する。
 *
 * @returns {z.infer<typeof envSchema>} 検証済みの環境変数オブジェクト
 */
function loadValidatedEnv(): z.infer<typeof envSchema> {
  const parsedEnv = envSchema.safeParse(process.env);

  if (!parsedEnv.success) {
    console.error('❌ Failed to validate environment variables:');
    console.table(parsedEnv.error.flatten().fieldErrors);
    throw new Error(
      'Invalid environment variables. Please check your .env file or runtime environment.',
    );
  }

  return parsedEnv.data;
}

/**
 * 型安全かつ検証済みの環境変数オブジェクト。
 * 他のモジュールからはこの `env` を使って値にアクセスする。
 */
export const env = loadValidatedEnv();
