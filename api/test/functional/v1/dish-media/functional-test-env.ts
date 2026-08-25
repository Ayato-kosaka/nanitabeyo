// api/test/functional/v1/dish-media/functional-test-env.ts
//
// #1257 実 DB 統合テスト用の環境変数ブートストラップ。
//
// api/src/core/config/env.ts は **import された時点** で zod スキーマ検証を走らせるため、
// 検証対象のリポジトリ（→ logger.service → env）を import するより前に値を埋めておく必要がある。
// ES Module の import は宣言順に評価されるので、各 spec の **先頭で** このモジュールを
// 副作用 import すれば、後続の import より確実に先に実行される。
//
// TEST_DATABASE_URL（PostGIS 拡張・infra/supabase/migrations 適用済みの使い捨て DB）が
// 未設定の環境では DATABASE_URL に到達不能な値を入れておき、spec 側で describe.skip させる。

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

process.env.API_COMMIT_ID = 'test-commit';
process.env.API_NODE_ENV = 'test';
process.env.CORS_ORIGIN = '*';
process.env.DATABASE_URL = TEST_DATABASE_URL ?? 'postgresql://invalid/invalid';
process.env.DB_SCHEMA = 'dev';
process.env.SUPABASE_JWT_SECRET = 'secret';
process.env.GOOGLE_PLACE_API_KEY = 'key';
process.env.GCS_BUCKET_NAME = 'bucket';
process.env.GCS_BUCKET_PUBLIC_NAME = 'public-bucket';
process.env.GCS_STATIC_MASTER_DIR_PATH = 'path';
process.env.CLAUDE_API_KEY = 'key';
process.env.GOOGLE_API_KEY = 'key';
process.env.GOOGLE_SEARCH_ENGINE_ID = 'id';
process.env.GCP_PROJECT = 'proj';
process.env.TASKS_LOCATION = 'loc';
process.env.TRANSCODER_LOCATION = 'loc';
process.env.TRANSCODER_PUBSUB_TOPIC = 'topic';
process.env.CLOUD_RUN_URL = 'url';
process.env.TASKS_INVOKER_SA = 'sa';
process.env.PUBSUB_PUSH_SA = 'sa';
process.env.CDN_HOST = 'cdn.example.com';
process.env.CDN_KEY_NAME = 'key-name';
process.env.CDN_KEY_SECRET_B64 = Buffer.from('test-key').toString('base64');
process.env.CDN_PUBLIC_HOST = 'cdn-public.example.com';

/** TEST_DATABASE_URL が無い環境（通常の unit test / CI）ではスイート全体を skip する */
export const maybeDescribe = TEST_DATABASE_URL ? describe : describe.skip;
