import * as path from "node:path";

import * as dotenv from "dotenv";

/**
 * 🎞️ SNS 取り込み（external_embed）のテストデータを dev API 経由で用意する（#1375）
 *
 * ## 何をするか
 * `POST /v1/dish-media/imports/resolve` で URL を解決し、候補の先頭
 * （店舗 / 料理カテゴリ）で `POST /v1/dish-media/imports` を叩いて
 * **テストユーザーの「食べたい」として保存**する。
 *
 * ## 何度呼んでも安全な理由
 * create はサービス側が冪等に作られている（dish-media-imports.service.ts）:
 * 既に同じ (provider, external_content_id, dish) の行があれば **新しい行は作らず**、
 * `reactions(save)` だけを呼び出しユーザーの分だけ必ず用意する。
 * つまり 2 回目以降の実行は「テストユーザーの食べたいを保証する」だけの読み等価になる。
 *
 * ## なぜ座標を渡さないのか
 * この URL のキャプションには「📍 住所：…」が入っており、サーバが国土地理院 API で
 * ジオコーディングして店舗候補を返す（#1375 4 巡目で実測済みの経路）。
 * 座標を渡さないことで、その経路自体もテストで通ることになる。
 */

/** キャプションに住所が入っており、座標なしで店舗候補が出ることを実測済みのリール（#1375） */
export const EXTERNAL_EMBED_IMPORT_URL = "https://www.instagram.com/reel/DZFdePPzzLI/";

/**
 * 🎬 **埋め込みの中で実際に映像が動くリール**（#1641）
 *
 * ## なぜ 2 本目が要るのか
 *
 * `EXTERNAL_EMBED_IMPORT_URL`（`DZFdePPzzLI`）は **権利ブロックされた投稿**で、
 * 埋め込みページに `<video>` 要素が 1 つも作られない（#1375 のコメント 5418882999 で実測）。
 * **どんな実装でも再生できない**ので、このリールだけで回している限り
 * `external-embed-feed.test.ts` が緑でも「アプリ内で再生できた」の根拠にはならない。
 *
 * `CDg3owdFa6W` は公式 `@instagram` の Original audio のリールで、埋め込みに実体の
 * `<video>`（実 MP4）が入っていることを実測済み。実 Chrome 152 / WebKit で
 * `muted + play()` により再生が始まり `currentTime` が進むことも確認している（#1641）。
 *
 * ## 店舗・料理カテゴリはブロック側のリールから借りる
 *
 * このリールのキャプションには住所が無いため、`resolve` は店舗候補を返さない。
 * `create` は `restaurantId` / `dishCategoryId` を明示で受け取るので、
 * **住所解決は `EXTERNAL_EMBED_IMPORT_URL` で行い、その結果をこのリールにも使う。**
 * 結果、同じお店フィードに «再生できる» と «再生できない» が並び、
 * 1 本の録画で両方とスワイプ送りを示せる。
 */
export const EXTERNAL_EMBED_PLAYABLE_URL = "https://www.instagram.com/reel/CDg3owdFa6W/";

/**
 * 🍢 **オーナーが実際に踏んだリール**（#1641 / 焼鳥たぬき）
 *
 * ⚠️ **いまは spec から取り込んでいない。** 埋め込みセルを 5 本並べたところ、
 *    Android エミュレータが `lowmemorykiller` でアプリを殺した（run 33133043261 で実測。
 *    クラッシュではなくプロセス消滅で、失敗時のスクショはランチャーだった）。
 *    中身は `EXTERNAL_EMBED_PLAYABLE_URL` と同じ «再生できる Instagram リール» なので、
 *    provider ごとの判定には要らない。手で確かめたいときにだけ使う。
 *
 * オーナーが dev の共有リンク（`/s/s1_QjJ0MUxoWy_zzOS60AU9OQ`）で «再生されない» と
 * 報告した投稿そのもの。web では 2 タップ要る（iframe には注入できない）ため、
 * **ネイティブでは本当にタップ無しで動くのか**を、この投稿で示すために取り込む。
 *
 * ⚠️ 素材のせいではないことは確認済み。埋め込みの SSR HTML に `video_url` があり、
 * これは «再生できる» を 9/9 で言い当てる指標である（`DZFdePPzzLI` には無い）。
 */
export const EXTERNAL_EMBED_OWNER_REPORTED_URL = "https://www.instagram.com/reel/Dcfhw8wFFm4/";

/**
 * 🎵 **TikTok の投稿**（#1641 オーナー報告「TikTok をアプリ内再生必須」）
 *
 * 埋め込み（`https://www.tiktok.com/embed/v2/{id}`）へ自動再生スクリプトを注入すると
 * 無音で再生が始まることを実 Chrome で確認済み（`currentTime` が 10 秒台まで進んだ）。
 * コード内に残っていた「TikTok は 1 タップ要る」という記述は**誤りだった**。
 *
 * オーナーが共有した短縮 URL（`vt.tiktok.com/ZSVpxS1xe/`）が指す投稿そのもの。
 */
export const EXTERNAL_EMBED_TIKTOK_URL =
	"https://www.tiktok.com/@moto_gurume/video/7588462458633735445";

/**
 * ▶️ **YouTube の動画**（#1641 オーナー報告「YouTube shorts がアプリ内再生出来ない」）
 *
 * ## なぜオーナーが踏んだ Short ではないのか
 *
 * オーナーの `8KJDwppL0qg` は **YouTube 側が埋め込みを許さない**（正しい iframe に
 * 置いても `playerState` が -1 → 3 のまま進まず「このコンテンツはご利用いただけません」）。
 * これを素材にすると、**こちらの実装が正しくても永久に赤**になる
 * （#1375 で権利ブロックされたリールを素材にして «再生を検証できていなかった» のと同じ轍）。
 *
 * `dQw4w9WgXcQ` は **誰でも埋め込めることが広く知られている**動画なので、
 * これが再生できなければ原因は必ずこちら側にある、と言い切れる。
 * 料理の動画ではないが、ここで見たいのは «YouTube がアプリ内で再生できるか» の一点である。
 */
export const EXTERNAL_EMBED_YOUTUBE_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

/**
 * ⚠️ **オーナーが実機で «再生できない» と踏んだ Short**（#1641）。
 *
 * ⚠️ **«埋め込み不可» ではない。** 一時そう結論していたが**誤りだった**（2026-08-28 訂正）。
 *
 *     GET https://www.youtube.com/oembed?url=...8KJDwppL0qg&format=json → **200**
 *
 * 埋め込みを許可していない動画は oEmbed が **401** を返す。200 が返る ＝ 埋め込み可能で、
 * web のプレビューでは実際に再生できている（オーナー実測）。
 *
 * CI のエミュレータで再生できなかったのは**環境側の疑いが濃い**（データセンター IP ＋
 * WebView の UA は YouTube の bot 判定に当たりやすく、実際に「ログインして bot では
 * ないことを確認してください」が出ていた）。実機で同じことが起きるかは未確認。
 *
 * 合否には使わない。**その状態のセルがどう見えるかを実機のコマで残す**ために取り込む
 * （オーナー要望: 3 PF の権利分岐ごとのレイアウトをエビデンスで見たい）。
 */
export const EXTERNAL_EMBED_YOUTUBE_BOT_CHECKED_URL = "https://www.youtube.com/shorts/8KJDwppL0qg";

/**
 * 🔒 **投稿ごとの料理カテゴリを固定する表**（#1641）
 *
 * ## なぜ固定するのか — 実測で «毎回増えていた»
 *
 * 以前は «どの投稿をどの料理へ入れるか» を実行のたびにサーバの状態から決め直していた。
 * その結果、dev には **同じ投稿の行が積み上がっていた**
 * （`scripts/db-checks/audit_e2e_external_embed_rows.py` / run 33454802552 実測）:
 *
 *     tiktok    7588462458633735445  生存 4 行   ← 08-28 に 3 つ、08-31 にもう 1 つ
 *     instagram DZFdePPzzLI          生存 2 行
 *     instagram CDg3owdFa6W          生存 2 行
 *     youtube   dQw4w9WgXcQ          生存 2 行
 *     youtube   8KJDwppL0qg          生存 2 行
 *
 * さらに **1 つの料理（dish 2de719c4 / Q1365868）に 5 本の埋め込みが相乗り**していた。
 *
 * 崩れていたのは «再利用» の判定である。判定材料が 2 つとも実行ごとに動く:
 *
 * - **候補プール**は `resolve` が返す料理カテゴリ（サーバ側の並びが変わる）
 * - **占有状況**は `GET /v1/restaurants/:id/dish-media` で、この API は
 *   **«各料理につき、いいね数が最大の 1 件» しか返さない**
 *   （`ROW_NUMBER() OVER (PARTITION BY dish_id ...) WHERE rn = 1`）
 *
 * どちらかがずれた瞬間に «前回の割り当て» を見失い、空いている別の料理へもう 1 行作る。
 * 一意制約は `(provider, external_content_id, dish_id)` なので、dish が違えば止まらない。
 * しかも増えた行がさらに «見えない相乗り» を生むので、**放っておくと増え続ける**。
 *
 * ## 直し方
 *
 * **サーバの状態を一切参照せずに、投稿 → 料理カテゴリを固定する。**
 * `create` は `(provider, external_content_id, dish)` で冪等なので、
 * 割り当てが動かない限り 2 回目以降は 1 行も増えない。
 *
 * ここに書いた ID は、上の棚卸しで **その投稿だけが入っている料理**として実在を確認済み
 * （2026-09-01 / dev）。したがって初回から新しい行を作らない。
 *
 * ⚠️ **値を «空いていそうな ID» で書き換えないこと。** 相乗りしている料理を指すと、
 *    お店フィードは 1 件しか返さないのでこちらのセルが隠れ、
 *    spec は «アプリが再生できない» と誤読する。変えるときは棚卸しを回してから。
 * ⚠️ 取り込む URL を増やしたら、**この表にも 1 行足すこと**（足さないと下で落ちる）。
 */
/**
 * 🏠 **取り込み先の店（dev）**。`resolve` が Instagram の取得に失敗したときの逃げ道。
 *
 * ## なぜ要るのか
 *
 * 料理カテゴリは固定表にしたので、フィクスチャで動くのは **店だけ**になった。
 * その店はキャプションのジオコーディングで毎回決まるため、`resolve` が
 * Instagram の埋め込みページを取得できないと **spec が 1 行も走らずに落ちる**。
 *
 * 実測（2026-09-01）: `POST /v1/dish-media/imports/resolve` → 201 で
 *
 *     {"status":"unknown","reason":"metadata_fetch_failed", ...}
 *
 * 02:47（iOS）と 04:00（Android）に発生。04:00 は 10 秒あけた撃ち直しでも同じだった。
 * つまり **相手側が断続的に取れなくなる**。取り込みの検証はそれ専用の spec の仕事で、
 * «同時に鳴らない» を見るこの経路まで巻き込んで止める理由は無い。
 *
 * ここは成功した run が返してきた実際の値（`八王子ラーメンよしだ`）。
 *
 * ⚠️ **逃げ道を使ったことは必ずログへ大きく残す。** 黙って通すと
 *    «取り込みの経路が生きている» と読み違える。
 * ⚠️ dev を作り直したら、この ID は消える。そのときは `create` が 4xx で落ちるので、
 *    成功した run のログ（`[import] restaurantId=`）から取り直すこと。
 */
const FALLBACK_RESTAURANT_ID = "5a9c5c91-0274-476a-bb32-9234dbb62378";

const DISH_CATEGORY_BY_URL: Readonly<Record<string, string>> = Object.freeze({
	[EXTERNAL_EMBED_IMPORT_URL]: "Q1204605",
	[EXTERNAL_EMBED_PLAYABLE_URL]: "Q17605220",
	[EXTERNAL_EMBED_TIKTOK_URL]: "Q11391553",
	[EXTERNAL_EMBED_YOUTUBE_URL]: "Q753910",
	[EXTERNAL_EMBED_YOUTUBE_BOT_CHECKED_URL]: "Q41415",
});

type FeedResponse = {
	data?: {
		// ⚠️ API は camelCase で返す（`dish` / `dish_media` の中だけ snake_case が混ざる）。実測で確認した形
		data?: {
			dish?: { category_id?: string };
			dish_media?: {
				externalEmbed?: {
					externalContentId?: string;
					/** #1641 サーバが取り込み時に判定した再生可否（unknown / playable / not_playable） */
					playbackStatus?: string;
					playbackReason?: string | null;
				} | null;
			};
		}[];
	};
};

/** 取り込み URL から «埋め込みの ID»（投稿を一意に指す部分）を取り出す。判別できなければ null */
function externalContentIdOf(url: string): string | null {
	const instagram = /instagram\.com\/(?:p|reel|reels|tv)\/([^/?#]+)/.exec(url);
	if (instagram) return instagram[1];
	const youtube =
		/[?&]v=([^&#]+)/.exec(url) ??
		/youtu\.be\/([^/?#]+)/.exec(url) ??
		/youtube\.com\/shorts\/([^/?#]+)/.exec(url);
	if (youtube) return youtube[1];
	const tiktok = /tiktok\.com\/[^/]*\/?video\/(\d+)/.exec(url);
	if (tiktok) return tiktok[1];
	// 短縮 URL（vt.tiktok.com/...）はサーバ側で展開されるので、ここでは判別しない
	return null;
}

type ResolveResponse = {
	data?: {
		/** #1641 サーバが «この投稿を解決できたか» を返す。`unknown` のとき `reason` に理由が入る */
		status?: string;
		/** 例: `metadata_fetch_failed`（Instagram の埋め込みページをサーバが取得できなかった） */
		reason?: string | null;
		candidates?: {
			dishCategories?: { dishCategoryId?: string }[];
			restaurants?: { restaurantId?: string }[];
		};
		prefill?: { dishCategoryId?: string | null; restaurantId?: string | null };
	};
};

function backendBaseUrl(): string {
	// globalSetup が読み込み済みだが、ワーカー単独起動でも動くよう同じ 2 ファイルを読む
	// （dotenv は既存値を上書きしないため CI の secrets が常に優先される。savedDishCategory.ts と同じ）
	dotenv.config({ path: path.resolve(__dirname, "../../app-expo/.env") });
	dotenv.config({ path: path.resolve(__dirname, "../.env") });
	const base = process.env.EXPO_PUBLIC_BACKEND_BASE_URL;
	if (!base) {
		throw new Error(
			"EXPO_PUBLIC_BACKEND_BASE_URL が未設定です。ローカルでは `cd app-expo && pnpx eas-cli env:pull development --path .env` を実行してください。",
		);
	}
	return base;
}

/**
 * external_embed の記録がテストユーザーの「食べたい」に存在する状態を保証し、
 * 保存先の restaurantId を返す（spec はこれでお店フィードへ deep link する）。
 *
 * @param accessToken 認証済みテストユーザーの access token（E2E_AUTH_ACCESS_TOKEN）
 */
export async function ensureExternalEmbedImported(
	accessToken: string,
	options: {
		alsoImportPlayable?: boolean;
		alsoImportOtherProviders?: boolean;
		/** «権利で再生できない» 側のコマを残すために、埋め込み不可の動画も取り込む */
		alsoImportUnplayable?: boolean;
	} = {},
): Promise<{ restaurantId: string }> {
	const base = backendBaseUrl();
	const headers = { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` };

	/*
	#1641 **resolve は «外部サイトの取得» を含むので、空振りしたら 1 度だけ撃ち直す。**

	run 33461431366（iOS）で、resolve は 201 を返したのに候補が空だった。中身を見ると

	    {"status":"unknown","reason":"metadata_fetch_failed", ...}

	で、**サーバが Instagram の埋め込みページを取得できなかった**ことが理由だった
	（こちらのコードでも、ジオコーディングでも、店舗照合でもない）。同じ日の 00:34 と 01:19 の
	run では同じ URL がきちんと解決できているので、**相手側の一過性の失敗**である。

	⚠️ 撃ち直しは 1 回だけにする。恒常的に取れなくなっているなら、待っても変わらない。
	⚠️ 失敗を «経路が壊れている» と決めつけないこと。`status` / `reason` をそのまま出す。
	   前はここが «キャプション住所→ジオコーディング→店舗照合を確認してください» とだけ
	   書いており、**まったく別の場所を探させた**。
	*/
	const resolveOnce = async (): Promise<ResolveResponse> => {
		const response = await fetch(`${base}/v1/dish-media/imports/resolve`, {
			method: "POST",
			headers,
			body: JSON.stringify({ url: EXTERNAL_EMBED_IMPORT_URL }),
			signal: AbortSignal.timeout(90_000),
		});
		if (!response.ok) {
			throw new Error(`SNS 取り込みの resolve に失敗しました（status=${response.status}）`);
		}
		return (await response.json()) as ResolveResponse;
	};
	const pickIds = (r: ResolveResponse) => ({
		restaurantId: r.data?.prefill?.restaurantId ?? r.data?.candidates?.restaurants?.[0]?.restaurantId,
		dishCategoryId: r.data?.prefill?.dishCategoryId ?? r.data?.candidates?.dishCategories?.[0]?.dishCategoryId,
	});

	let resolved = await resolveOnce();
	let ids = pickIds(resolved);
	/*
	⚠️ 見るのは **店だけ**である。料理カテゴリは `DISH_CATEGORY_BY_URL` で固定したので、
	   `resolve` が候補を返さなくても困らない。ここで両方を要求すると、
	   店が取れているのに «空振り» と読んで無駄に撃ち直す。
	*/
	if (!ids.restaurantId) {
		// eslint-disable-next-line no-console -- 1 回目が空振りしたことを run のログへ残す
		console.log(
			`[import] resolve が空振りしました（status=${String(resolved.data?.status)} / reason=${String(resolved.data?.reason)}）。10 秒待って 1 度だけ撃ち直します`,
		);
		await new Promise((resolve) => setTimeout(resolve, 10_000));
		resolved = await resolveOnce();
		ids = pickIds(resolved);
	}
	/*
	2 回とも空振りしたときの扱いを **理由で分ける**。

	- `metadata_fetch_failed` … **相手側が取れないだけ**（こちらのコードでもジオコーディングでも
	  店舗照合でもない）。既知の店へ逃がして spec を続ける。取り込み経路そのものの検証は
	  それ専用の spec の仕事であって、«同時に鳴らない» を見るこの経路を道連れにしない
	- それ以外 … 逃がさずに落とす。こちら側の経路が壊れている可能性がある
	*/
	let restaurantId = ids.restaurantId;
	if (!restaurantId) {
		if (resolved.data?.reason !== "metadata_fetch_failed") {
			throw new Error(
				`resolve は 2 回とも候補を返しませんでした（status=${String(resolved.data?.status)} / reason=${String(resolved.data?.reason)}）。` +
					" `metadata_fetch_failed` 以外なので逃がしません。" +
					" キャプション住所→国土地理院ジオコーディング→店舗照合の経路を疑ってください。",
			);
		}
		// eslint-disable-next-line no-console -- 逃げ道を使ったことは黙って通さない
		console.log(
			"[import] ⚠️ resolve が 2 回とも metadata_fetch_failed でした（サーバが Instagram の埋め込みページを取得できていない）。" +
				` 既知の店（${FALLBACK_RESTAURANT_ID}）へ逃がして続行します。**この run は «取り込み経路が生きている» の根拠にはなりません。**`,
		);
		restaurantId = FALLBACK_RESTAURANT_ID;
	}

	const create = async (url: string, categoryId: string) => {
		const response = await fetch(`${base}/v1/dish-media/imports`, {
			method: "POST",
			headers,
			body: JSON.stringify({ url, restaurantId, dishCategoryId: categoryId }),
			signal: AbortSignal.timeout(90_000),
		});
		if (!response.ok) {
			throw new Error(`SNS 取り込みの create に失敗しました（url=${url} / status=${response.status}）`);
		}
	};

	/*
	#1641 ⚠️ **料理カテゴリは表（`DISH_CATEGORY_BY_URL`）で固定する。サーバの状態から決め直さない。**

	お店フィード（`GET /v1/restaurants/:id/dish-media`）は
	**«各料理につき、いいね数が最大の 1 件» しか返さない**
	（`dish-media.repository.ts` の `findDishMediaByRestaurant`:
	`ROW_NUMBER() OVER (PARTITION BY dish_id ...) ... WHERE rn = 1`）。
	取り込みは (restaurantId, dishCategoryId) で料理を決めるので、複数本を同じカテゴリで
	入れると **全部が同じ料理になり、フィードに出るのは 1 本だけ**になる。

	実測（run 33146739657）: 4 本取り込んだのにフィードは 2 件、`nextCursor` も null。
	spec は «TikTok のセルへ一度も着けなかった» と報告したが、**そもそもフィードに無かった**。

	⚠️ **以前はここで «空いているカテゴリ» を実行のたびに選び直していた。それが行を増やしていた。**
	   判定材料（`resolve` の候補の並び / フィードの代表 1 件）が両方とも実行ごとに動くため、
	   前回の割り当てを見失って別の料理へもう 1 行作る。実測で tiktok が 4 行、
	   1 つの料理に 5 本相乗り（run 33454802552）。経緯は `DISH_CATEGORY_BY_URL` の注記にある。
	*/
	const readFeed = async (): Promise<Map<string, string>> => {
		const response = await fetch(`${base}/v1/restaurants/${restaurantId}/dish-media?languageTag=ja-JP`, {
			headers,
			signal: AbortSignal.timeout(90_000),
		});
		if (!response.ok) {
			throw new Error(`お店フィードの取得に失敗しました（status=${response.status}）`);
		}
		const feed = (await response.json()) as FeedResponse;
		const byCategory = new Map<string, string>();
		for (const entry of feed.data?.data ?? []) {
			const categoryId = entry.dish?.category_id;
			const embed = entry.dish_media?.externalEmbed;
			const contentId = embed?.externalContentId;
			if (categoryId && contentId) byCategory.set(categoryId, contentId);
			/*
			#1641 **サーバがこの投稿をどう判定したかを run のログへ残す。**

			アプリの高速パス（not_playable なら WebView を作らない）が効くかどうかは、
			**API がこの値を返しているか**で決まる。実機のコマだけを見ていると
			«たまたま再生されなかった» と区別が付かない。
			*/
			if (contentId) {
				// eslint-disable-next-line no-console -- run のログへ残すことが目的
				console.log(
					`[playback] ${contentId} → ${embed?.playbackStatus ?? "(APIが返していない)"}` +
						(embed?.playbackReason ? ` (${embed.playbackReason})` : ""),
				);
			}
		}
		return byCategory;
	};

	/*
	取り込みたいもの。**それぞれ専用の料理カテゴリを持つ**（`DISH_CATEGORY_BY_URL`）ので、
	«席の取り合い» は起きない。以前あった `required`（席が足りなければ諦める）は、
	席という概念ごと無くなったので削除した。
	*/
	const wanted: string[] = [];
	if (options.alsoImportPlayable) wanted.push(EXTERNAL_EMBED_PLAYABLE_URL);
	if (options.alsoImportOtherProviders) {
		wanted.push(EXTERNAL_EMBED_TIKTOK_URL);
		wanted.push(EXTERNAL_EMBED_YOUTUBE_URL);
	}
	if (options.alsoImportUnplayable) {
		wanted.push(EXTERNAL_EMBED_YOUTUBE_BOT_CHECKED_URL);
	}
	wanted.push(EXTERNAL_EMBED_IMPORT_URL);

	const plan = wanted.map((url) => {
		const categoryId = DISH_CATEGORY_BY_URL[url];
		if (!categoryId) {
			/*
			表に無い URL は **黙って飛ばさない**。飛ばすと «素材が足りない» 状態のまま spec が回り、
			アプリの不具合として読み違える。取り込む URL を増やしたら表にも足すこと。
			*/
			throw new Error(
				`${url} の料理カテゴリが DISH_CATEGORY_BY_URL に登録されていません。` +
					" 取り込む URL を増やしたら、同じファイルの表にも 1 行足してください" +
					"（サーバの状態から選び直すと、同じ投稿の行が実行のたびに増えます）。",
			);
		}
		return { url, categoryId };
	});

	/*
	#1641 **解決した店を run のログへ残す。**

	料理カテゴリは固定表で決め打つが、**店はキャプションのジオコーディングで毎回決まる**。
	店が変われば (restaurant, category) の料理も変わり、固定表があっても新しい行が 1 セット作られる。
	増え方を後から追えるように、どの店に入れたのかをここで書き出しておく。
	*/
	// eslint-disable-next-line no-console -- run のログへ残すことが目的
	console.log(`[import] restaurantId=${restaurantId} / ${plan.length} 本を固定の料理カテゴリへ取り込みます`);

	for (const { url, categoryId } of plan) {
		await create(url, categoryId);
	}

	/*
	#1641 **取り込んだものが «お店フィードに出ている» ところまで確かめる。**

	`create` が 200 を返すことと、フィードにセルが並ぶことは別である。ここを見ずに spec を
	回すと、素材が足りない状態を **アプリが再生できない**と読み違える。実際に 2 往復無駄にした。
	*/
	const visible = new Set((await readFeed()).values());
	const missing = plan
		.map(({ url }) => ({ url, contentId: externalContentIdOf(url) }))
		.filter(({ contentId }) => contentId !== null && !visible.has(contentId));
	if (missing.length > 0) {
		throw new Error(
			`取り込みは成功したのに、お店フィードに出ていない投稿があります: ${missing.map((m) => m.url).join(", ")}。` +
				` フィードに出ているのは ${[...visible].join(", ") || "なし"} です。` +
				" お店フィードは «各料理につき 1 件» しか返さないので、料理が重なっていないか確認してください。",
		);
	}

	return { restaurantId };
}
