/**
 * SEO Head Renderer (Base/Default - Native環境用)
 *
 * #717 【設計】Native環境ではSEOのためのhead出力は不要のため null を返す
 * Web環境では SeoHeadRenderer.web.tsx が自動的に使用される
 */

export default function SeoHeadRenderer() {
	return null;
}
