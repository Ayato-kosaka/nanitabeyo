import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

import { ensureFreshSession } from "./freshSession";

/**
 * 🍽 「テストユーザーが料理カテゴリを 1 件以上保存している」という前提を **テスト自身が作る**（#1133）
 *
 * ## なぜ要るのか（CI で実際に赤くなった）
 * `tests/profile/saved-dish-category-location-search.test.ts` の入口は
 * **保存した料理カテゴリのカードだけ**で、0 件だとモーダルを開けない。
 * 当初は「TEST_USER_* に 1 件保存しておくこと」を fail-loud のメッセージで人へ依頼していたが、
 * これは **環境に前提を置いたテスト**で、次の 2 つの意味で壊れる:
 *
 * - 誰かがマイページから保存を外すと、コード変更ゼロで CI が赤くなる
 * - 新しく作られた dev 環境／別のテストユーザーでは最初から赤い
 *
 * e2e-web 側は一覧 API をスタブしてこの依存を消しているが、Detox に
 * ネットワークをスタブする手段が無い。そこで **前提そのものをテストが用意する**。
 *
 * ## どうやって保存するか（アプリと同じ経路）
 * 「保存」は API ではなく **supabase の `reactions` へ直接 INSERT** で表現されている
 * （app-expo/lib/reactions.ts / target_type=dish_categories, action_type=save）。
 * 一覧 API 側も `reactions` を引いて `dish_categories` を join するだけ
 * （api/src/v1/dish-categories/dish-categories.repository.ts）。
 * よってここでも同じ形の行を 1 件入れる。RLS は「自分の行だけ」を許可しているので、
 * テストユーザーのアクセストークンをそのまま使えば、他人のデータには触れない。
 *
 * ## カテゴリ ID の入手先
 * `dish_categories` は RLS 有効かつポリシー未定義（= anon/authenticated からは読めない）ため、
 * supabase 経由では 1 件も引けない。実在する ID は
 * `GET /v1/dish-categories/recommendations` から取る（アプリの検索画面と同じ API）。
 * 適当な UUID を入れても一覧 API の join で消えるだけなので、**実在の ID である必要がある**。
 *
 * ## ⚠️ 入れた行は «消さない»（後始末をしない方が正しい理由）
 * 最初は `afterAll` で自分が入れた 1 件を消す設計にしていたが、これは壊れる。
 * `e2e-mobile-test.yml` は Android と iOS の 2 ジョブを **同時に**走らせるため、
 *
 * - 両方が同じカテゴリを引くと 2 本目の INSERT が UNIQUE 制約に当たる
 * - 片方の `afterAll` が、まだ走っている **もう片方が使っている行**を消してしまう
 *
 * という競合が起きる。そもそもここで作りたいのは「テストユーザーが料理カテゴリを
 * 1 件以上保存している」という **恒常的な前提**であって、run ごとの一時データではない。
 * 消さなければ状態は «前提が満たされている» に収束し、2 回目以降の run は
 * 「元から保存がある」経路を通って **書き込みすら発生しない**。
 *
 * 残るのは dev のテストユーザーに保存が 1 件増えることだけで、これは
 * 以前この spec が «人手でやっておいてください» と依頼していた状態そのものである。
 *
 * ## セキュリティ
 * トークンは **ログへ出さない**（このモジュールは成否と件数しか出力しない）。
 */

/** 保存リアクションの形（アプリ側 lib/reactions.ts と同じ組み合わせ） */
const SAVE_REACTION = {
	target_type: "dish_categories",
	action_type: "save",
} as const;

/**
 * 推薦 API へ渡す住所トークン。
 *
 * 実在の料理カテゴリを 1 件返してくれさえすればよいので、候補が枯れない都市を固定で使う。
 * `country:` だけだと候補の当たり外れが大きいため locality まで指定する
 * （形式は QueryDishCategoryRecommendationsDto の doc コメントに準拠）。
 */
const SEED_ADDRESS = "country:JP, administrative_area_level_1:Tokyo, locality:Tokyo";

/** PostgreSQL の unique_violation。「既に保存済み」＝ 前提が満たされている、と読み替える */
const UNIQUE_VIOLATION = "23505";

/** 種まきの結果。`null` は「元から保存があったので何もしなかった」を意味する（ログ用） */
export type SeededDishCategory = { categoryId: string } | null;

type SeedEnv = {
	supabaseUrl: string;
	supabaseAnonKey: string;
	dbSchema: string;
	backendBaseUrl: string;
};

/**
 * 接続情報を環境変数から読む。
 *
 * globalSetup が既に読み込み済みだが、ワーカー単独起動でも動くよう同じ 2 ファイルを読む
 * （dotenv は既存値を上書きしないため CI の secrets が常に優先される。utils/disposableSession.ts と同じ）。
 */
function loadSeedEnv(): SeedEnv {
	dotenv.config({ path: path.resolve(__dirname, "../../app-expo/.env") });
	dotenv.config({ path: path.resolve(__dirname, "../.env") });

	const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
	const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
	// ⚠️ アプリの supabase client は `db.schema` を Env.DB_SCHEMA で切り替える（app-expo/lib/supabase.ts）。
	// ここで同じスキーマを見ないと「書いたのにアプリからは見えない」という最悪の食い違いになる
	const dbSchema = process.env.EXPO_PUBLIC_DB_SCHEMA;
	const backendBaseUrl = process.env.EXPO_PUBLIC_BACKEND_BASE_URL;

	const missing = [
		["EXPO_PUBLIC_SUPABASE_URL", supabaseUrl],
		["EXPO_PUBLIC_SUPABASE_ANON_KEY", supabaseAnonKey],
		["EXPO_PUBLIC_DB_SCHEMA", dbSchema],
		["EXPO_PUBLIC_BACKEND_BASE_URL", backendBaseUrl],
	]
		.filter(([, value]) => !value)
		.map(([name]) => name);

	if (missing.length > 0) {
		throw new Error(
			[
				`保存済み料理カテゴリの種まきに必要な環境変数が足りません: ${missing.join(", ")}`,
				"  ローカルでは `cd app-expo && pnpx eas-cli env:pull development --path .env` を実行してください。",
			].join("\n"),
		);
	}

	return {
		supabaseUrl: supabaseUrl!,
		supabaseAnonKey: supabaseAnonKey!,
		dbSchema: dbSchema!,
		backendBaseUrl: backendBaseUrl!,
	};
}

/**
 * テストユーザーとして PostgREST を叩く client を作る。
 *
 * `setSession()` ではなく **Authorization ヘッダ直挿し**にしているのは、
 * client にセッションを持たせると refresh token をローテーションしてしまい、
 * 端末へ注入済みのセッションを失効させうるため（utils/disposableSession.ts の M-4 と同じ理由）。
 */
function createUserScopedClient(env: SeedEnv, accessToken: string) {
	return createClient(env.supabaseUrl, env.supabaseAnonKey, {
		auth: { persistSession: false, autoRefreshToken: false },
		db: { schema: env.dbSchema },
		global: { headers: { Authorization: `Bearer ${accessToken}` } },
	});
}

/**
 * 推薦 API から実在する料理カテゴリ ID を取る。
 *
 * ⚠️ `dish_categories` は RLS 有効かつポリシー未定義（anon/authenticated からは 1 件も読めない）ため、
 * **実在の ID を得る経路はこの API しかない**。共有リンクの spec（utils/shareLink.ts）も
 * dish_media の検索に categoryId が要るのでこれを使う。だから export している。
 *
 * @param max 返す件数の上限。呼び出し側が «当たり» を探して回れるように複数返せるようにしている
 */
export async function fetchDishCategoryIds(accessToken: string, max = 5): Promise<string[]> {
	const env = loadSeedEnv();
	const url = new URL(`${env.backendBaseUrl}/v1/dish-categories/recommendations`);
	url.searchParams.set("address", SEED_ADDRESS);
	url.searchParams.set("languageTag", "ja-JP");
	url.searchParams.set("localLanguageCode", "ja");

	const response = await fetch(url, {
		method: "GET",
		headers: { Authorization: `Bearer ${accessToken}` },
		// 推薦はスコアリング + 翻訳を挟むので素の fetch の既定より長めに待つ
		signal: AbortSignal.timeout(60_000),
	});

	if (!response.ok) {
		throw new Error(
			`料理カテゴリの推薦取得に失敗しました（status=${response.status}）。` +
				` API（${env.backendBaseUrl}）が起きているか、EXPO_PUBLIC_BACKEND_BASE_URL の向き先を確認してください。`,
		);
	}

	const body = (await response.json()) as { data?: { categoryId?: string }[] };
	const ids = (body.data ?? [])
		.map((item) => item.categoryId)
		.filter((id): id is string => typeof id === "string" && id.length > 0)
		.slice(0, max);

	if (ids.length === 0) {
		throw new Error(
			"料理カテゴリの推薦が 0 件でした。dev の dish_categories / dish_category_features が空でないか確認してください。",
		);
	}

	return ids;
}

/**
 * テストユーザーに保存済み料理カテゴリが 1 件以上ある状態を保証する。
 *
 * @returns このテストが入れた行（`{ categoryId }`）。元から保存があった場合は `null`
 * @失敗時 日本語メッセージで例外を投げる（fail-loud）。前提が作れないまま本体を走らせても
 *         「保存が 0 件」と同じ分かりにくい失敗になるだけなので、ここで止める
 */
export async function ensureSavedDishCategory(): Promise<SeededDishCategory> {
	// 鮮度保証つきで読む（iOS の長時間 run で期限切れ 401 になった。utils/freshSession.ts）
	const session = await ensureFreshSession("authenticated");
	if (!session) {
		throw new Error(
			"認証済みセッションが確立されていません。TEST_USER_EMAIL / TEST_USER_PASSWORD を設定してください（describeAuthenticated で skip されるはずの経路です）。",
		);
	}

	const env = loadSeedEnv();
	const client = createUserScopedClient(env, session.accessToken);

	// 既に保存があるなら書かない。dev DB を触る回数は少ないほどよい
	const { data: existing, error: selectError } = await client
		.from("reactions")
		.select("target_id")
		.eq("user_id", session.userId)
		.eq("target_type", SAVE_REACTION.target_type)
		.eq("action_type", SAVE_REACTION.action_type)
		.limit(1);

	if (selectError) {
		throw new Error(`保存済み料理カテゴリの確認に失敗しました: ${selectError.message}`);
	}
	if (existing && existing.length > 0) return null;

	const [categoryId] = await fetchDishCategoryIds(session.accessToken, 1);

	const { error: insertError } = await client.from("reactions").insert({
		user_id: session.userId,
		target_type: SAVE_REACTION.target_type,
		target_id: categoryId,
		action_type: SAVE_REACTION.action_type,
		created_at: new Date().toISOString(),
		// アプリは Env.APP_VERSION を入れる。ここは「E2E が入れた行」だと一目で分かる値にする
		created_version: "e2e-mobile",
		lock_no: 0,
	});

	// ⚠️ Android / iOS ジョブが同時に同じカテゴリを引くと UNIQUE (user_id, target_type,
	// target_id, action_type) に当たる。これは «既に前提が満たされた» と同じ意味なので成功扱いにする
	if (insertError && insertError.code !== UNIQUE_VIOLATION) {
		throw new Error(`保存済み料理カテゴリの種まきに失敗しました: ${insertError.message}`);
	}

	return insertError ? null : { categoryId };
}
