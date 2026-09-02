import { IsString, IsUUID, MaxLength, MinLength } from "class-validator";

/**
 * `POST /v1/dish-media/imports` のリクエスト。
 *
 * #1399 SNS の URL から取り込んだ 1 件を **保存する**。`resolve` が «候補を返すだけ» なのに対し、
 * こちらは実際に `dishes` / `dish_media` / `dish_media_external_embeddings` / `reactions` を書く。
 *
 * ## 候補はクライアントから受け取らない
 *
 * `resolve` が返した候補（料理カテゴリ・店舗）のうち **ユーザーが選んだ 1 つずつ**だけを受ける。
 * 候補の中身（信頼度・抽出テキスト）は受け取らない。クライアントが計算し直した値を保存側が
 * 信じる形にすると、候補生成の規則を変えたときに「古い規則で作られた値」が混ざるためである。
 *
 * URL も **再度サーバで解決し直す**。クライアントが送ってきた provider / externalContentId を
 * そのまま信じると、任意の値を保存できてしまう。
 */
export class CreateDishMediaImportDto {
	/**
	 * ユーザーが貼った文字列。`resolve` に渡したものと同じでよい。
	 * 上限 4096 は `shared/utils/snsUrl.ts` の `MAX_INPUT_LENGTH` と揃えてある。
	 */
	@IsString()
	@MinLength(1)
	@MaxLength(4096)
	url!: string;

	/** 保存先の店舗。`resolve` の店舗候補から選ぶか、店舗検索で選ぶ */
	@IsUUID()
	restaurantId!: string;

	/**
	 * 保存先の料理カテゴリ（`dish_categories.id`）。
	 * uuid ではなく Wikidata の QID 形式（例 `Q234646`）なので `@IsUUID` は使えない。
	 */
	@IsString()
	@MinLength(1)
	@MaxLength(64)
	dishCategoryId!: string;
}
