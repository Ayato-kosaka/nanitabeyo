import { IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import { Transform, Type } from "class-transformer";

/**
 * `POST /v1/dish-media/imports/resolve` のリクエスト。
 *
 * #1399 「SNS の URL を解決して候補を返す」。**このエンドポイントは DB へ 1 行も書かない。**
 * 返すのは候補だけで、確定も保存もしない（保存は #1399 の別 PR。Blocker B-1 の判断待ち）。
 */
export class ResolveDishMediaImportDto {
	/**
	 * ユーザーが貼った文字列。**URL 単体でも、共有シートが渡す説明文つきでもよい。**
	 *
	 * 解釈は `shared/utils/snsUrl.ts` の `parseSnsUrl()` が行う。ここでは長さだけを見る。
	 * 上限 4096 は `snsUrl.ts` の `MAX_INPUT_LENGTH` と揃えてある（片方だけ緩いと、
	 * 通る入力と通らない入力の境目が 2 か所にできる）。
	 */
	@IsString()
	@MinLength(1)
	@MaxLength(4096)
	url!: string;

	/**
	 * 店舗候補を探すエリアの中心（緯度）。
	 *
	 * **SNS の URL には座標が無い**ので、エリアは呼び出し側が渡す（設計 骨子 Q-3）。
	 * `lat` / `lng` / `radius` が揃って渡されたときだけ店舗候補を探し、
	 * 揃っていなければ**店舗候補は空**で返す（エラーにはしない）。
	 */
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(-90)
	@Max(90)
	lat?: number;

	/** 店舗候補を探すエリアの中心（経度）。`lat` / `radius` とセットで使う */
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(-180)
	@Max(180)
	lng?: number;

	/**
	 * 店舗候補を探す半径（メートル）。
	 *
	 * 上限 50km は設計 §5-4 の「現在地から半径 50km 以内」に合わせた。
	 * これ以上広げると `restaurants` の近傍検索がバウンディングボックスで拾う件数が跳ね、
	 * 照合対象の上限（200 件）で頭打ちになるだけで精度が上がらない。
	 */
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(1)
	@Max(50_000)
	radius?: number;

	/**
	 * 返す候補の上限（料理カテゴリ・店舗それぞれ）。既定 5。
	 */
	@IsOptional()
	@Transform(({ value }) => (typeof value === "string" ? Number(value) : value))
	@Type(() => Number)
	@IsNumber()
	@Min(1)
	@Max(20)
	limit?: number;
}
