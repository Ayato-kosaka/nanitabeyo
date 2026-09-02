import { SupabaseDishes } from "../../../converters/convert_dishes";
import { SupabaseDishMedia } from "../../../converters/convert_dish_media";
import { SupabaseDishReviews } from "../../../converters/convert_dish_reviews";
import { RestaurantsEntity } from "./restaurants.response";

/**
 * #511 【設計】メディア加工ステータスの型定義
 * - 'idle': まだ何もしていない（将来用）
 * - 'processing': 加工中（リサイズ・トランスコードなど）
 * - 'completed': 加工完了（リサイズ or トランスコード済み）
 * - 'failed': 加工失敗（タイムアウト / 形式不正 / 内部エラー等）
 */
export type MediaProcessingStatus = "idle" | "processing" | "completed" | "failed";

/**
 * #1273 §40 / #1395 メディアの実体をどこから描画するか
 * - 'stored'        : 自ストレージ（`media_path` 必須）。従来の投稿はすべてこれ
 * - 'external_embed': SNS の公式埋め込み。`media_path` は NULL で `mediaUrl` も null になる。
 *                     表示は `externalEmbed.canonicalUrl` から provider 別コンポーネントが行う
 */
export type DishMediaRenderType = "stored" | "external_embed";

/**
 * #1273 §14 埋め込み元 SNS。
 *
 * #1395 の仕様追補で SNS import の対象は **TikTok / YouTube Shorts / Instagram の 3 つ**に
 * 確定した（X・threads は対象外）。DB 側も `dmee_provider_check` で同じ 3 値に制限している。
 */
export type ExternalEmbedProvider = "instagram" | "tiktok" | "youtube";

/** #1273 §39 埋め込みの死活 */
export type ExternalEmbedStatus = "unknown" | "available" | "unavailable";

/**
 * #1641 埋め込みの枠の中で**再生できるか**。`ExternalEmbedStatus`（投稿が生きているか）とは直交する。
 *
 * - `unknown`      … 判定していない / 判定できなかった。**従来どおり実際に読み込んで試す**
 * - `playable`     … 再生できると分かっている
 * - `not_playable` … 再生できないと分かっている。**WebView をマウントせずサムネイルを出す**
 */
export type ExternalEmbedPlaybackStatus = "unknown" | "playable" | "not_playable";

/**
 * #1641 `not_playable` の理由。**表示の分岐には使わない**（トリアージ用）。
 *
 * 分岐に使うと «理由が増えたら画面が壊れる» 構造になる。画面が見るのは
 * `playbackStatus` だけで十分である。
 */
export type ExternalEmbedPlaybackReason = "copyright_blocked" | "embedding_disabled" | "no_video_in_embed";

/** #1395 `render_type='external_embed'` の dish_media が指す外部投稿 */
export type DishMediaExternalEmbed = {
	provider: ExternalEmbedProvider;
	externalContentId: string;
	canonicalUrl: string;
	embedStatus: ExternalEmbedStatus;
	lastVerifiedAt: string | null;
	/**
	 * #1399 provider 側のサムネイル URL。**自ストレージへ複製した実体ではない**。
	 * Instagram は複製が規約で禁じられ、TikTok の署名 URL は約 48h で失効するため、
	 * provider によって複製できたりできなかったりする。ここは «参照先» を持つだけである。
	 * 取れなければ null（表示は料理カテゴリ画像へ落ちる）。
	 */
	thumbnailUrl: string | null;
	/**
	 * #1641 埋め込みの枠の中で再生できるか。**取り込みのときにサーバが判定して持っている。**
	 *
	 * これがあると、クライアントは «とりあえず WebView を出して、駄目だったら畳む»
	 * をやらなくて済む（オーナー指摘 2026-08-28「埋め込み時に分岐しているんですね。
	 * それって処理重くなりますよね？」）。`not_playable` のセルは
	 * **WebView を 1 つも作らずに**サムネイル表示へ落ちる。
	 *
	 * ⚠️ `unknown` を `not_playable` と同じに扱わないこと。TikTok は判定材料が無く
	 * 常に `unknown` である。`unknown` は従来どおり実際に読み込んで試す。
	 */
	playbackStatus: ExternalEmbedPlaybackStatus;
	/** `playbackStatus === 'not_playable'` のときだけ入る。**分岐には使わない** */
	playbackReason: ExternalEmbedPlaybackReason | null;
};

/**
 * #1641 `POST /v1/dish-media/imports/:dishMediaId/playback-report` のレスポンス。
 *
 * ## 端末の判定をそのまま保存しない
 *
 * 端末が «再生できなかった» と言う理由は、投稿の側とは限らない（機内モード・
 * 一時的な 5xx・古いビルド・WebView が殺された直後）。それを鵜呑みにして保存すると、
 * **通信が不安定なユーザーが 1 人いるだけで、その投稿が全員の検索から消える**。
 *
 * だから端末の報告は «見に行くきっかけ» としてだけ使い、**判定はサーバがやり直す**。
 * 返るのはやり直した後の状態である。
 */
export type ReportExternalEmbedPlaybackResponse = {
	playbackStatus: ExternalEmbedPlaybackStatus;
	playbackReason: ExternalEmbedPlaybackReason | null;
	/**
	 * サーバが実際に provider へ問い合わせ直したか。
	 * 直近に確認済みだった場合や、埋め込みの行が無い場合は `false`（間引いた）。
	 */
	rechecked: boolean;
};

/** 一つの料理メディア投稿（dish_media）とそれに関連する情報（レストラン、料理、レビュー） */
export type DishMediaEntry = {
	restaurant: RestaurantsEntity;
	dish: SupabaseDishes & {
		reviewCount: number;
		averageRating: number;
		/**
		 * #1375 `dish_categories.labels`（言語コード → 表記）。取れなければ null。
		 *
		 * `name` は «その店でのその料理の呼び名» で、SNS 取り込み由来だとローマ字が入る。
		 * 表示は **`labels[言語] → labels["en"] → name`** の順で解決すること
		 * （`app-expo/features/myDishes/dishCategoryLabel.ts`）。
		 */
		categoryLabels: Record<string, string> | null;
	};
	dish_media: SupabaseDishMedia & {
		isMine: boolean;
		isSaved: boolean;
		isLiked: boolean;
		likeCount: number;
		/**
		 * #1375 その料理（dish）に **自分の `dish_reviews` が 1 件でもあるか**。
		 * フィードの「食べたを記録」ボタンを «記録済みの色» にするために使う。
		 *
		 * ⚠️ 詰めているのは `GET /v1/dish-media?ids=` だけ（#1399 の `externalEmbed` と同じ判断）。
		 * このボタンを出すのはその経路で読むフィードだけである。それ以外では `undefined` になるので、
		 * **`false` と `undefined` を同じに扱ってよい**（どちらも «記録済みの色にしない»）。
		 * ボタン自体は常に押せる — 再訪は別の記録として正しいので、済 = 無効化ではない
		 */
		isEaten?: boolean;
		/**
		 * 投稿メディアの署名付きCDN URL（派生サイズ）
		 * - 動画の場合: media_processing_status が 'completed' 以外は null
		 * - 画像の場合: media_processing_status に応じてオリジナル or リサイズ済みパス
		 */
		mediaUrl: string | null;
		/**
		 * 投稿サムネイル画像の署名付きCDN URL（派生サイズ or オリジナル）。
		 * #1399 `render_type='external_embed'` では自ストレージに実体が無いため、
		 * 外部サムネイル URL（oEmbed 由来）が入る。それも無い provider
		 * （Instagram 等）では **null**。
		 */
		thumbnailImageUrl: string | null;
		/**
		 * #1395 `render_type='external_embed'` のときの埋め込み情報。
		 * 既存の組み立て箇所を壊さないため optional。stored の行では null になる。
		 *
		 * ⚠️ **詰めているのは `GET /v1/dish-media?ids=` だけ**（#1399）。
		 * 検索・一覧のような件数の多い経路へは join を広げていない。大多数を占める
		 * stored の行では常に NULL になり、無駄が積み上がるためである。
		 * それらの経路では `undefined` が返るので、**「null だから stored」と判断しないこと**
		 * （判断には `render_type` を使う）。
		 */
		externalEmbed?: DishMediaExternalEmbed | null;
	};
	dish_reviews: (SupabaseDishReviews & {
		username: string;
		isLiked: boolean;
		likeCount: number;
		/**
		 * #1513 閲覧者自身が書いたレビューかどうか。編集・削除の導線を出す判定に使う。
		 *
		 * クライアント側で `user_id === 自分の id` を組み立てさせない。所有判定は
		 * サーバーが持つ（PATCH / DELETE の認可と同じ根拠で返す）ため、
		 * 画面が出す導線と実際に通る操作がズレない。
		 */
		isMine: boolean;
	})[];
};

/** GET /v1/dish-media/search のレスポンス型 */
export type SearchDishMediaResponse = DishMediaEntry[];

/** GET /v1/dish-media?ids=... のレスポンス型 */
export type QueryDishMediaByIdsResponse = {
	items: DishMediaEntry[];
	notFound: string[];
};

/**
 * POST /v1/dish-media のレスポンス型。
 *
 * #1560 `review` を一緒に送ったときだけ `dishReview` が入る。**同じトランザクションで
 * 書かれたもの**なので、これが返っていれば «写真だけ残ってレビューが無い» は起こり得ない。
 * 送らなかった従来の呼び出しでは `undefined`（形は後方互換）。
 */
export type CreateDishMediaResponse = SupabaseDishMedia & {
	dishReview?: SupabaseDishReviews;
};

/** POST /v1/dish-media/view のレスポンス型 */
export type CreateDishMediaViewResponse = {
	/**
	 * #1222 保存できなかった場合は null。
	 *
	 * view は解析用テレメトリなので、参照先 dish_media / impression がまだ存在しない
	 * タイミング障害では 500 ではなく `stored: false` の成功系で返す。
	 */
	id: string | null;
	dish_media_id: string;
	impression_id: string | null;
	stored: boolean;
	analysis_applied: boolean;
};

/* ------------------------------------------------------------------------- */
/*  #1399 SNS URL Import — POST /v1/dish-media/imports/resolve               */
/* ------------------------------------------------------------------------- */

/**
 * 解決の結果。**`null` は返さない。**
 *
 * - `ok`          … provider が確定し、メタデータも取れた
 * - `unknown`     … provider は確定したが**こちらの都合で**メタデータが取れなかった
 *                   （oEmbed が 5xx / タイムアウト / Instagram のように取得手段が無い）。
 *                   **取り込みは続行させてよい**（手入力へ縮退する）
 * - `unavailable` … **相手が消えた**（oEmbed が 400 / 404 / 410）。取り込みを続行させない
 * - `unsupported` … 対応していない URL。provider すら確定していない
 *
 * `unknown` と `unavailable` を混ぜてはいけない（設計 §3-7）。混ぜると
 * TikTok が一時的に落ちただけで取り込みが止まる。
 */
export type ResolveDishMediaImportStatus = "ok" | "unknown" | "unavailable" | "unsupported";

/**
 * なぜその `status` になったか。**UI の文言はこれで分岐する。**
 *
 * 文字列そのものをユーザーへ出さない（英語のままなので）。i18n のキーとして使う。
 */
export type ResolveDishMediaImportReason =
	/** provider 確定・メタデータ取得成功 */
	| "resolved"
	/** `parseSnsUrl()` が `null`。対応外 provider・パス形式が違う・URL ですらない */
	| "unsupported_url"
	/** 短縮 URL の展開に失敗（タイムアウト / リダイレクト上限超過 / 危険な解決先） */
	| "shortlink_expansion_failed"
	/** 展開はできたが、解決先が取り込み対象の形になっていない */
	| "shortlink_target_unsupported"
	/** provider にサーバから取れるメタデータが無い（Instagram）。**想定内の縮退** */
	| "metadata_provider_unsupported"
	/** oEmbed が 5xx / タイムアウト / 壊れた JSON を返した */
	| "metadata_fetch_failed"
	/** oEmbed が 400 / 404 / 410 を返した（削除・非公開） */
	| "metadata_content_unavailable"
	/** oEmbed は成功したが、候補生成に使えるテキストが 1 文字も無かった */
	| "metadata_empty"
	/**
	 * YouTube だが **Shorts ではなかった**（横長の通常動画）。
	 *
	 * 取り込みの対象は Shorts だけ（#1399 リーダー確定 §1）。`/watch?v=` と `youtu.be/` は
	 * URL だけでは判定できないので `HEAD /shorts/{id}` で確定させる。
	 * ⚠️ **判定できなかったとき（ネットワーク失敗など）はこれを返さない。**
	 * 弾かずに通し、`requiresShortsCheck` を立てたままにする（同 §3）。
	 */
	| "youtube_not_shorts";

/** 店舗候補を探したか / 探さなかった理由 */
export type ResolveDishMediaImportRestaurantSearchReason =
	/** エリアが渡され、実際に `restaurants` を引いた */
	| "searched"
	/** `lat` / `lng` / `radius` が渡されていない。**エラーではなく既定の状態** */
	| "area_not_provided"
	/** 3 つのうち一部だけが渡された。呼び出し側の組み立てミスなので区別して返す */
	| "area_incomplete"
	/** 照合できるテキストが無い（メタデータが取れなかった等）ので引かなかった */
	| "no_extracted_text";

/** 候補生成に使ったテキスト。**保存はしない**（provider の仕様変更に追随できなくなるため） */
export type ResolveDishMediaImportExtractedText = {
	/** どのフィールド由来か */
	field: "title" | "description" | "caption" | "hashtag";
	text: string;
};

/** 料理カテゴリ候補 1 件 */
export type ResolveDishMediaImportDishCategoryCandidate = {
	dishCategoryId: string;
	/** `dish_categories.label_en`。取れなければ null */
	labelEn: string | null;
	/** `dish_categories.labels`（言語コード → 表記）。取れなければ null */
	labels: Record<string, string> | null;
	imageUrl: string | null;
	/** 0〜1 */
	confidence: number;
	/** 1 始まり */
	rank: number;
};

/** 店舗候補 1 件 */
export type ResolveDishMediaImportRestaurantCandidate = {
	restaurantId: string;
	name: string;
	googlePlaceId: string;
	latitude: number;
	longitude: number;
	/** 0〜1 */
	confidence: number;
	/** 1 始まり */
	rank: number;
};

/**
 * `POST /v1/dish-media/imports/resolve` のレスポンス。
 *
 * ⚠️ **このエンドポイントは DB へ 1 行も書かない。** 返すのは候補だけで、
 * 確定も保存もしない。ユーザーが確認画面で離脱してもゴミが残らない。
 *
 * ⚠️ **oEmbed が返す `html` は含めない**（#1375 設計の正本 §2 / #1273 §14）。
 * 埋め込みは `canonicalUrl` から provider 別コンポーネントが組み立てる。
 */
export type ResolveDishMediaImportResponse = {
	status: ResolveDishMediaImportStatus;
	reason: ResolveDishMediaImportReason;
	source: {
		/** 確定できなければ null */
		provider: ExternalEmbedProvider | null;
		externalContentId: string | null;
		/** トラッキングパラメータを含まない正規 URL */
		canonicalUrl: string | null;
		/** Instagram カルーセルの `?img_index=N`（1 始まり）。指定が無ければ null */
		mediaIndex: number | null;
		/**
		 * `true` のとき「YouTube だが Shorts かどうかが URL からは確定していない」。
		 * 確定は `HEAD /shorts/{id}` で行うが、**判定できなかったときは弾かず
		 * ユーザーに確認させて通す**（リーダー確定 §3）。
		 */
		requiresShortsCheck: boolean;
		/** 短縮 URL を展開して provider を確定させたか */
		expandedFromShortlink: boolean;
	};
	metadata: {
		title: string | null;
		/**
		 * #1629 説明文（YouTube の動画説明）。
		 *
		 * オーナー報告「YouTube Shorts でキャプションが取れてない気がする」。
		 * **取れてはいた** — サーバは説明文から住所を拾って店舗候補を作っている（実ログで確認）。
		 * 落ちていたのは **返していなかった**こと。`title` しか返さないので、確認画面には
		 * 動画の題名しか出ず、キャプションが無いように見えていた。
		 *
		 * provider ごとの入り方（詳細は `sns-oembed.service.ts` 冒頭の表）:
		 * - YouTube … `title` は動画の題名、**本文はこちら**
		 * - Instagram / TikTok … `title` 自体がキャプション本文なので、こちらは null
		 */
		description: string | null;
		authorName: string | null;
		authorUrl: string | null;
		/**
		 * provider の CDN 上のサムネイル URL。**自ストレージには保存していない。**
		 * TikTok のものは署名付きで約 2 日で期限切れになる（独立レビュー m-4）ので、
		 * 長期保持せず、確認画面の表示にだけ使うこと。
		 */
		thumbnailUrl: string | null;
		extractedTexts: ResolveDishMediaImportExtractedText[];
	};
	candidates: {
		dishCategories: ResolveDishMediaImportDishCategoryCandidate[];
		restaurants: ResolveDishMediaImportRestaurantCandidate[];
	};
	/**
	 * 閾値を超えたときだけ入る。**それでもユーザーが直せる状態で見せること**
	 * （#1399 本文「完全自動確定を前提にしない」）。
	 */
	prefill: {
		dishCategoryId: string | null;
		restaurantId: string | null;
	};
	restaurantSearch: {
		performed: boolean;
		reason: ResolveDishMediaImportRestaurantSearchReason;
		/** 照合対象にした `restaurants` の件数 */
		scannedCount: number;
	};
};

/**
 * `POST /v1/dish-media/imports` のレスポンス。
 *
 * #1399 保存した（または既に在った）1 件を指す。表示に必要なものは
 * `GET /v1/dish-media?ids=` で引き直せるので、ここでは id と «新規かどうか» だけを返す。
 */
export type CreateDishMediaImportResponse = {
	dishMediaId: string;
	dishId: string;
	/**
	 * 同じ SNS 投稿が同じ料理に対して既に取り込まれていたか。
	 *
	 * `false` のとき `dish_media` は作り直さず既存行を指す（自然キー
	 * `(provider, external_content_id, dish_id)` の UNIQUE がそれを保証する）。
	 * この場合でも **`reactions(save)` は呼び出したユーザーの分を必ず用意する**ので、
	 * 「他人が先に取り込んだ投稿を自分の食べたいへ入れる」が成立する。
	 */
	created: boolean;
	/** その dish_media を «食べたい» として保存したか（既に保存済みなら false） */
	saved: boolean;
};

/**
 * DELETE /v1/dish-media/:id のレスポンス型 (#1513)
 *
 * 「投稿」の削除単位は dish_media 1 件と、その dish_media と一緒に作られたレビュー
 * (dish_reviews.created_dish_media_id = :id) である。メディアが消える以上、
 * そのメディアを前提に書かれたレビューだけを残すことはできない。
 * 論理削除なので行は残るが、レスポンスには本文を載せない。
 */
export type DeleteDishMediaResponse = {
	/** 論理削除した dish_media.id */
	id: string;
	/** 論理削除日時 (ISO8601) */
	deletedAt: string;
	/** 巻き添えで論理削除した dish_reviews.id */
	deletedDishReviewIds: string[];
};
