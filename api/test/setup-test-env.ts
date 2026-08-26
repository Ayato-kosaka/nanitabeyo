// api/test/setup-test-env.ts
//
// #1596 jest の `setupFiles` から、**テストファイルより前に**実行される。
//
// ## なぜ要るのか
//
// `core/config/env.ts` は import された瞬間に `process.env` を zod で検証し、
// 足りなければ throw する。logger → ほぼ全ての service が推移的にこれを読むため、
// **実 DB にも実 API にも触れない純粋な単体テストでも `.env` が無いと suite ごと落ちる。**
//
// そのせいで `pnpm --filter api test` は「env 起因で 9 suite が赤」の状態が常態化し、
// PR ゲート（.github/workflows/pr-check.yml）から api の jest が丸ごと外されていた。
// ゲートが無い間に、本体の変更へ追随し忘れたモックが 3 つの suite（26 件）を
// «1 度も実行されないまま» にしていた（アカウント削除と通知設定の回帰テスト）。
//
// 個々の spec が `jest.mock('../../core/config/env')` で塞ぐ作法もリポジトリ内に既にあるが、
// **spec を 1 本足すたびに書き忘れられる**ので、ここ 1 箇所で塞ぐ。
//
// ## 約束
//
// - **既に値があるものは絶対に上書きしない。** 実 `.env` や CI の secret がある環境では
//   そちらが勝つ（この形でないと、意図せず本物の設定を隠してしまう）。
// - 埋めるのは「zod schema で必須（optional でも default でもない）」ものだけ。
// - 値はすべて明らかにダミーと分かる形にする。ここの値に依存するテストを書かせないため。

import * as dotenv from 'dotenv';

// 実 .env があるならそれを先に読む（この後の穴埋めより優先させる）。
dotenv.config();

/**
 * `core/config/env.ts` の envSchema で必須（optional でも default でも無い）なキー。
 *
 * ⚠️ envSchema へ必須キーを足したら、ここにも足すこと。足し忘れると
 * `pnpm --filter api test` が「Invalid environment variables」で赤くなるので、
 * 黙って壊れることはない。
 */
const REQUIRED_TEST_ENV: Readonly<Record<string, string>> = {
  API_COMMIT_ID: 'test-commit',
  API_NODE_ENV: 'test',
  CORS_ORIGIN: 'https://test.invalid',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test?schema=test',
  DB_SCHEMA: 'test',
  SUPABASE_JWT_SECRET: 'test-supabase-jwt-secret',
  GOOGLE_PLACE_API_KEY: 'test-google-place-api-key',
  GCS_BUCKET_NAME: 'test-bucket',
  GCS_BUCKET_PUBLIC_NAME: 'test-bucket-public',
  GCS_STATIC_MASTER_DIR_PATH: 'test/static-master',
  CLAUDE_API_KEY: 'test-claude-api-key',
  GOOGLE_API_KEY: 'test-google-api-key',
  GOOGLE_SEARCH_ENGINE_ID: 'test-search-engine-id',
  GCP_PROJECT: 'test-project',
  TASKS_LOCATION: 'asia-northeast1',
  TRANSCODER_LOCATION: 'asia-northeast1',
  TRANSCODER_PUBSUB_TOPIC: 'test-transcoder-topic',
  CLOUD_RUN_URL: 'https://test-run.invalid',
  TASKS_INVOKER_SA: 'test-tasks-invoker@test.invalid',
  PUBSUB_PUSH_SA: 'test-pubsub-push@test.invalid',
  CDN_HOST: 'test-cdn.invalid',
  CDN_KEY_NAME: 'test-cdn-key',
  // base64 として読める必要があるので、実際に base64 な文字列にしておく
  CDN_KEY_SECRET_B64: Buffer.from('test-cdn-key-secret').toString('base64'),
  CDN_PUBLIC_HOST: 'test-cdn-public.invalid',
};

for (const [key, value] of Object.entries(REQUIRED_TEST_ENV)) {
  if (process.env[key] === undefined || process.env[key] === '') {
    process.env[key] = value;
  }
}
