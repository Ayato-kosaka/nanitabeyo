# SeoContext - SEO Head 管理システム

## 概要

このディレクトリは、Expo Router アプリケーションにおけるSEO管理を Provider/Renderer パターンで実装したものです。

### 主な特徴

1. **単一のHead出力点**: `SeoHeadRenderer` が唯一のHead出力点となり、重複タグを防止
2. **locale同期**: routeから locale を確定し、i18n と必ず同期
3. **自動クリーンアップ**: フォーカス連動でページの上書きを自動管理（残留防止）
4. **defaults常時有効**: 設定漏れでも必ずデフォルト値で動作
5. **PUBLIC_LOCALES**: SEO用途は URL prefix と完全一致する8言語のみ使用

## アーキテクチャ

```
[locale]/_layout.tsx
  └─ SeoProvider (defaults管理)
       └─ SeoHeadRenderer (Head出力)
            └─ Pages
                 └─ useSeo() (上書き)
```

### ファイル構成

- `SeoProvider.tsx` - SEO状態管理（defaults + override stack）
- `useSeo.ts` - ページからSEO上書きを行うhook
- `SeoHeadRenderer.web.tsx` - Web用のHead出力（expo-router/head使用）
- `SeoHeadRenderer.native.tsx` - Native用（null返す）
- `SeoHeadRenderer.tsx` - base file（TypeScript用）
- `index.ts` - export集約

## 使用方法

### 1. Layout側の設定（既に完了）

`app/[locale]/_layout.tsx` で以下を実施:

```tsx
import { SeoProvider, SeoHeadRenderer } from "@/contexts/SeoContext";

export default function RootLayout() {
	const { locale } = useLocale();

	// locale に応じた defaults を生成
	const seoDefaults = useMemo(
		() => ({
			title: isJapanese ? "なに食べよ..." : "Nanitabeyo...",
			description: isJapanese ? "..." : "...",
			image: `${Env.WEB_BASE_URL}/og/${isJapanese ? "ja-JP" : "en-US"}.jpg`,
		}),
		[locale],
	);

	return (
		<SeoProvider initialDefaults={seoDefaults}>
			<SeoHeadRenderer />
			{/* 他のProviders */}
		</SeoProvider>
	);
}
```

### 2. ページ側での上書き

固有のSEO情報が必要なページで `useSeo()` を使用:

```tsx
import { useSeo } from "@/contexts/SeoContext";

export default function PostsScreen() {
	// #717 【設計】useSeo でSEO上書き（フォーカス連動で自動解除）
	useSeo({
		title: "料理の投稿 | なに食べよ",
		description: "ユーザーが投稿した料理の写真とレビューをご覧ください。",
		image: "https://example.com/posts-og.jpg", // 任意
	});

	return <View>...</View>;
}
```

### 3. 上書きなしのページ

何も設定しなければ、defaults が自動的に使用される:

```tsx
export default function SomeScreen() {
	// SEO設定なし → defaults で動作
	return <View>...</View>;
}
```

## 動作原理

### 1. SEO状態の管理

```typescript
type SeoContextValue = {
	defaults: SeoData; // layoutで設定される
	current: SeoData; // defaults + stackTop
	setDefaults: (d: SeoData) => void;
	push: (id: string, data: SeoData) => void;
	pop: (id: string) => void;
};
```

- `defaults`: locale に応じたデフォルト値
- `stack`: ページごとの上書き値の配列
- `current`: defaults + stackTop をマージした最終値

### 2. 上書きのライフサイクル

```typescript
useSeo(data: SeoData) {
  const id = useId(); // ユニークID生成

  // フォーカス時: push
  // ブラー時: pop
  useFocusEffect(() => {
    push(id, data);
    return () => pop(id);
  });

  // unmount時もpop（フォールバック）
  useEffect(() => () => pop(id), [id, pop]);
}
```

**重要**: タブ/スタックなど画面がアンマウントされないケースでも、フォーカスが外れたら上書きを解除します。

### 3. Head出力

`SeoHeadRenderer.web.tsx` が以下を出力:

```html
<!-- 基本 -->
<title>{current.title}</title>
<meta name="description" content="{current.description}" />
<link rel="canonical" href="{canonical}" />

<!-- hreflang (PUBLIC_LOCALES のみ) -->
<link rel="alternate" hreflang="ja-JP" href="..." />
<link rel="alternate" hreflang="en-US" href="..." />
<!-- ... 8言語分 ... -->
<link rel="alternate" hreflang="x-default" href="..." />

<!-- Open Graph -->
<meta property="og:title" content="{current.title}" />
<meta property="og:description" content="{current.description}" />
<meta property="og:image" content="{current.image}" />
<meta property="og:locale" content="ja_JP" />
<!-- og:locale:alternate も PUBLIC_LOCALES のみ -->

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="{current.title}" />
<!-- ... -->
```

## PUBLIC_LOCALES について

SEO用途（hreflang/canonical/og:locale）では、URL prefix と完全一致するロケールのみを使用:

```typescript
// constants/seoLocales.ts
export const PUBLIC_LOCALES = ["ja-JP", "en-US", "fr-FR", "zh-CN", "ar-SA", "ko-KR", "es-ES", "hi-IN"] as const;

export const DEFAULT_PUBLIC_LOCALE = "ja-JP";
```

これにより、`I18N_SUPPORTED_LOCALES` の alias（`ja`, `en`, `fr` 等）がSEOタグに混在することを防ぎます。

## トラブルシューティング

### Q: ページで useSeo を使ったが反映されない

A: 以下を確認:

1. `SeoProvider` が layout に配置されているか
2. `SeoHeadRenderer` が Provider の内側にあるか
3. Web環境で実行しているか（Native は常に null）

### Q: 画面遷移後も前のページのSEOが残る

A: `useFocusEffect` が動作していない可能性:

1. `@react-navigation/native` がインストールされているか確認
2. フォールバックの `useEffect` は常に動作するため、unmount時には必ずpopされます

### Q: hreflang に `ja` や `en` が出力される

A: `I18N_SUPPORTED_LOCALES` ではなく `PUBLIC_LOCALES` を使用しているか確認。
`SeoHeadRenderer.web.tsx` は `PUBLIC_LOCALES` のみを参照します。

## 設計上の決定事項

### なぜ Context + Provider/Renderer パターン？

1. **重複排除**: Head出力が1箇所に集約される
2. **状態管理**: defaults と上書きを明確に分離
3. **自動クリーンアップ**: Context経由でライフサイクル管理

### なぜ useFocusEffect？

タブ/スタックなど画面がアンマウントされないケースでも、フォーカスが外れたら上書きを解除するため。

### なぜ PUBLIC_LOCALES を分離？

`I18N_SUPPORTED_LOCALES` には alias が多数含まれ、SEO用途には不適切。URL prefix と完全一致するロケールのみを使用することで、hreflang/canonical の爆発を防ぎます。

## 参考

- Issue: #717
- Expo Router Head: https://docs.expo.dev/router/reference/head/
- React Navigation useFocusEffect: https://reactnavigation.org/docs/use-focus-effect/
