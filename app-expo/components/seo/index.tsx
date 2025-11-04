// SEOコンポーネント（Next.jsのHeadに相当）
// ExpoではSEOのためのメタタグを直接操作することはできません。
// ここでは将来の拡張や、Web版でのSEO対策のためにコンポーネントを用意しています。

import { SeoProps } from "./index.web";

export default function SeoHead(props: SeoProps) {
	return <></>;
}
