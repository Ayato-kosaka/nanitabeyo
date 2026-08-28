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

type FeedResponse = {
	data?: {
		// ⚠️ API は camelCase で返す（`dish_media` の中だけ snake_case が混ざる）。実測で確認した形
		data?: { dish_media?: { externalEmbed?: { externalContentId?: string } | null } }[];
	};
};

/** 取り込み URL から «埋め込みの ID»（投稿を一意に指す部分）を取り出す。判別できなければ null */
function externalContentIdOf(url: string): string | null {
	const instagram = /instagram\.com\/(?:p|reel|reels|tv)\/([^/?#]+)/.exec(url);
	if (instagram) return instagram[1];
	const youtube = /[?&]v=([^&#]+)/.exec(url) ?? /youtu\.be\/([^/?#]+)/.exec(url);
	if (youtube) return youtube[1];
	const tiktok = /tiktok\.com\/[^/]*\/?video\/(\d+)/.exec(url);
	if (tiktok) return tiktok[1];
	// 短縮 URL（vt.tiktok.com/...）はサーバ側で展開されるので、ここでは判別しない
	return null;
}

type ResolveResponse = {
	data?: {
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
	options: { alsoImportPlayable?: boolean; alsoImportOtherProviders?: boolean } = {},
): Promise<{ restaurantId: string }> {
	const base = backendBaseUrl();
	const headers = { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` };

	// resolve は Instagram の embed ページ取得（サーバ側）+ ジオコーディングを挟むため長めに待つ
	const resolveResponse = await fetch(`${base}/v1/dish-media/imports/resolve`, {
		method: "POST",
		headers,
		body: JSON.stringify({ url: EXTERNAL_EMBED_IMPORT_URL }),
		signal: AbortSignal.timeout(90_000),
	});
	if (!resolveResponse.ok) {
		throw new Error(`SNS 取り込みの resolve に失敗しました（status=${resolveResponse.status}）`);
	}
	const resolved = (await resolveResponse.json()) as ResolveResponse;
	const candidates = resolved.data?.candidates;
	const restaurantId = resolved.data?.prefill?.restaurantId ?? candidates?.restaurants?.[0]?.restaurantId;
	const dishCategoryId = resolved.data?.prefill?.dishCategoryId ?? candidates?.dishCategories?.[0]?.dishCategoryId;
	if (!restaurantId || !dishCategoryId) {
		throw new Error(
			`resolve は成功したが候補が空です（restaurantId=${String(restaurantId)}, dishCategoryId=${String(dishCategoryId)}）。` +
				" キャプション住所→国土地理院ジオコーディング→店舗照合の経路が壊れていないか確認してください。",
		);
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

	const urls = [EXTERNAL_EMBED_IMPORT_URL];
	// #1641 «実際に再生できる» ことを録画で示すには、映像が入っているリールが要る
	if (options.alsoImportPlayable) urls.push(EXTERNAL_EMBED_PLAYABLE_URL);
	// #1641 provider ごとに «アプリ内で再生できるか» を 1 本のフィードで示す
	if (options.alsoImportOtherProviders) urls.push(EXTERNAL_EMBED_TIKTOK_URL, EXTERNAL_EMBED_YOUTUBE_URL);

	/*
	#1641 ⚠️ **料理カテゴリを取り込みごとに分ける。ここを揃えると、フィードには 1 本しか出ない。**

	お店フィード（`GET /v1/restaurants/:id/dish-media`）は
	**«各料理につき、いいね数が最大の 1 件» しか返さない**
	（`dish-media.repository.ts` の `findDishMediaByRestaurant`:
	`ROW_NUMBER() OVER (PARTITION BY dish_id ...) ... WHERE rn = 1`）。
	取り込みは (restaurantId, dishCategoryId) で料理を決めるので、4 本を同じカテゴリで
	入れると **4 本が同じ料理になり、フィードに出るのは 1 本だけ**になる。

	実測（run 33146739657 / dev の当該店舗）: 4 本を取り込んだのにフィードは
	**2 件**（YouTube と、以前の Instagram）で `nextCursor` も null だった。
	spec は «TikTok のセルへ一度も着けなかった» と報告するが、**そもそもフィードに無い**。
	アプリの不具合と読み違えるので、素材の側で分ける。
	*/
	const categoryIds = [
		...new Set(
			[dishCategoryId, ...(candidates?.dishCategories ?? []).map((c) => c?.dishCategoryId)].filter(
				(id): id is string => typeof id === "string" && id.length > 0,
			),
		),
	];
	if (categoryIds.length < urls.length) {
		throw new Error(
			`料理カテゴリの候補が ${categoryIds.length} 種類しかなく、${urls.length} 本を別々の料理へ入れられません。` +
				" 同じ料理へ入れるとお店フィードに 1 本しか出ず、spec が «セルへ着けなかった» と誤報します。",
		);
	}

	for (const [index, url] of urls.entries()) {
		await create(url, categoryIds[index]);
	}

	/*
	#1641 **取り込んだものが «お店フィードに出ている» ところまで確かめる。**

	`create` が 200 を返すことと、フィードにセルが並ぶことは別である（上のとおり、
	同じ料理へ入れると 1 本しか出ない）。ここを見ずに spec を回すと、素材が足りない状態を
	**アプリが再生できない**と読み違える。実際に run 33146739657 で 1 往復無駄にした。
	*/
	const feedResponse = await fetch(
		`${base}/v1/restaurants/${restaurantId}/dish-media?languageTag=ja-JP`,
		{ headers, signal: AbortSignal.timeout(90_000) },
	);
	if (!feedResponse.ok) {
		throw new Error(`お店フィードの取得に失敗しました（status=${feedResponse.status}）`);
	}
	const feed = (await feedResponse.json()) as FeedResponse;
	const visible = new Set(
		(feed.data?.data ?? [])
			.map((entry) => entry.dish_media?.externalEmbed?.externalContentId)
			.filter((id): id is string => typeof id === "string"),
	);
	const missing = urls.filter((url) => {
		const id = externalContentIdOf(url);
		return id !== null && !visible.has(id);
	});
	if (missing.length > 0) {
		throw new Error(
			`取り込みは成功したのに、お店フィードに出ていない投稿があります: ${missing.join(", ")}。` +
				` フィードに出ているのは ${[...visible].join(", ") || "なし"} です。` +
				" お店フィードは «各料理につき 1 件» しか返さないので、料理が重なっていないか確認してください。",
		);
	}

	return { restaurantId };
}
