import type { CreateShareLinkDto } from "@shared/api/v1/dto";
import type { CreateShareLinkResponse } from "@shared/api/v1/res";

/** `useAPICall().callBackend` の必要な部分だけ（hook を渡さずに済ませるため） */
type CallBackend = <TRequest extends Record<string, any> | FormData, R>(
	endpointName: string,
	options: { method?: "GET" | "POST" | "PATCH" | "DELETE"; requestPayload: TRequest },
) => Promise<R>;

/**
 * 🔗 共有リンク `/s/:token` を発行する（#721）。
 *
 * ## なぜ URL をここで組み立てないか
 * 完成した URL は API が返す。**app 側でも組み立てると、development で共有した
 * リンクが本番ドメインを指す（またはその逆）という形でずれる。**
 * base URL の出どころを 1 つに保つ。
 *
 * ## 失敗しても共有そのものは止めない
 * 共有リンクの発行に失敗したら、呼び出し側は**既存の URL 形式へフォールバック**する。
 * 「共有ボタンを押したのに何も起きない」より、「OGP は既定だが共有はできる」方が良い。
 * 既存 `/{locale}/posts?ids=...` は互換のため残してあるので、着地先は同じ画面になる。
 *
 * @param callBackend `useAPICall()` の callBackend
 * @param dto 共有対象と言語
 * @returns 共有できる絶対 URL。失敗したら null
 */
export async function createShareLink(
	callBackend: CallBackend,
	dto: CreateShareLinkDto,
): Promise<string | null> {
	try {
		const response = await callBackend<CreateShareLinkDto, CreateShareLinkResponse>(
			"v1/share-links",
			{ method: "POST", requestPayload: dto },
		);
		return response.url ?? null;
	} catch {
		return null;
	}
}
