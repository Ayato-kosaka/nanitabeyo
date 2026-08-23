import {
	ArrayMaxSize,
	ArrayMinSize,
	IsArray,
	IsIn,
	IsObject,
	IsOptional,
	IsString,
	IsUUID,
	ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { PUBLIC_LOCALES, type PublicLocale } from "../../constants/publicLocales";
import {
	SHARE_LINK_MAX_DISH_MEDIA_IDS,
	SHARE_LINK_TARGET_TYPES,
	type ShareLinkTargetType,
} from "../../constants/shareLinks";

/**
 * 📮 `POST /v1/share-links` のリクエスト（#721）。
 *
 * ## 任意 URL を受け取らない理由
 * 「path と query を保存して redirect する」汎用サービスにすると、validation が
 * 「文字列であること」まで薄まり、Open Redirect とコンテンツ偽装の入口になる。
 * `target.type` ごとに DTO を分け、**その type が要求する params だけ**を受ける。
 *
 * ## title / image をクライアントから受け取らない理由
 * preview（OGP）の生成責務は server-side の Resolver に置く。
 * 任意の title / image URL を保存できると、共有カードで別サービスを騙る
 * phishing が作れてしまう。
 */

/**
 * `dish_media` 共有の params。
 *
 * 既存の共有 URL `/{locale}/posts?ids=a,b,c` と同じ集合を受ける。
 * 先頭の ID が OGP の対象（サムネイル・タイトル）になる。
 */
export class ShareTargetDishMediaParamsDto {
	@IsArray()
	@ArrayMinSize(1)
	@ArrayMaxSize(SHARE_LINK_MAX_DISH_MEDIA_IDS)
	/**
	 * ⚠️ **バージョンを固定しないこと（`@IsUUID("4")` にしない）。**
	 * `dish_media.id` は `gen_random_uuid()`（v4）だけでできているわけではなく、
	 * 実データには v5 の ID が混ざっている（dev で実測: `358cb297-da34-52b8-...`）。
	 * v4 に固定すると、**実在する投稿の共有が必ず 400 になる**。
	 * 同じ ID 集合を受ける `QueryDishMediaByIdsDto` も版を指定していない。
	 */
	@IsUUID(undefined, { each: true })
	ids!: string[];
}

/**
 * `dish_category_group_vote_sessions`（友達投票）共有の params。
 *
 * ⚠️ ここで受けるのは **既存の `share_token`** であって session の UUID ではない。
 * 友達投票は #705 の時点で既に share_token を持ち、
 * `GET /v1/dish-category-group-votes/:shareToken` で解決できる。
 * 共有リンクはその上に OGP と入口を足す層なので、識別子は既存のものを使う。
 */
export class ShareTargetGroupVoteParamsDto {
	@IsString()
	shareToken!: string;
}

/**
 * 共有対象。`type` による discriminated union を class-validator で表現したもの。
 *
 * class-validator は TS の union をそのまま検証できないため、params は
 * 「どちらの形も受けうる 1 つのクラス」ではなく **Service 側で type ごとに再検証**する
 * （`ShareLinksService.validateTarget`）。ここでの責務は「type が既知であること」と
 * 「params がオブジェクトであること」まで。
 */
export class ShareTargetDto {
	@IsIn(SHARE_LINK_TARGET_TYPES)
	type!: ShareLinkTargetType;

	/**
	 * type ごとの params。実体は `ShareTargetDishMediaParamsDto` か
	 * `ShareTargetGroupVoteParamsDto` のいずれか。
	 *
	 * ⚠️ **`@IsObject()` を外さないこと。** `main.ts` の ValidationPipe は
	 * `whitelist: true` なので、**デコレータが 1 つも付いていないプロパティは
	 * 黙って削除される**。外すと `params` が undefined のまま Service へ渡り、
	 * 正しいリクエストが必ず `target.params.ids is required` で 400 になる。
	 * 型検査もユニットテスト（Service を直接呼ぶ）も通ってしまうので、
	 * 実際に HTTP を通さないと気づけない。
	 */
	@IsObject()
	params!: Record<string, unknown>;
}

export class CreateShareLinkDto {
	@ValidateNested()
	@Type(() => ShareTargetDto)
	target!: ShareTargetDto;

	/**
	 * 共有カードの言語。**共有した時点の言語で固定**し、以後は閲覧者の言語に関わらず変えない。
	 *
	 * SNS は URL 単位で OGP をキャッシュするため、同じ URL が閲覧者ごとに別の OGP を
	 * 返す設計は成立しない（誰かが最初に踏んだ言語で固定されるだけ）。
	 * TikTok 等も同じ挙動。
	 */
	@IsOptional()
	@IsIn(PUBLIC_LOCALES)
	locale?: PublicLocale;
}
