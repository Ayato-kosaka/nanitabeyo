import { IsNotEmpty, IsString, MaxLength } from "class-validator";

/**
 * GET /v1/maps/embed のクエリ。
 *
 * #1810 PL レビュー: このエンドポイントには認証ガードを付けられない（WebView / iframe は
 * URL を「文書として」読むため Authorization ヘッダを送れない）。代わりに、認証必須の
 * POST /v1/maps/embed-token（CreateMapsEmbedTokenDto）が発行した短命の署名付きトークンを
 * 受け取り、検証だけを行う。mode/q/center/zoom/hl は生のクエリとしては受け取らない
 * （トークンの中に署名付きで入っている）。
 */
export class QueryMapsEmbedDto {
	@IsString()
	@IsNotEmpty()
	@MaxLength(2000)
	token!: string;
}
