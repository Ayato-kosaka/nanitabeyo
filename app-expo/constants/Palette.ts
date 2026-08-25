/**
 * 🎨 #1509 SET-05 セマンティックパレット（ライト / ダーク）
 *
 * ## 目的
 * 画面に直書きされている色リテラル（main 実測で 1,087 箇所）を「役割の名前」へ寄せ、
 * ライト / ダークの 2 値を 1 箇所で持つ。ここが色の正本になる。
 *
 * ## 絶対条件（#1509 オーナー確定事項）
 * **ライトモードのピクセルを 1 つも変えない。**
 * - `light` の値は、置換元のファイルに書かれていたリテラルを **そのまま写している**。
 *   「近い色だから」で丸めたり寄せたりしていない。
 * - 役割が違えば、値が同じでもトークンを分けてある（例: `divider` と `surfaceSubtle` は
 *   どちらもライトでは `#F3F4F6` だが、ダークで別の値を持てるように分けている）。
 *   統合したのは「同じ役割・同じ値」の組み合わせだけ。
 * - 唯一の表記の正規化は `#fff` → `#FFFFFF` と `#000` → `#000000`（`(tabs)/_layout.tsx` の
 *   タブバー背景と各所の影）。**描画される色は完全に同一**で、見た目は変わらない。
 *
 * ## dark 値の出典
 * 面・文字・罫線は `constants/MaterialColor.ts` の `MaterialTheme.schemes.dark`
 * （seed `#5E5E5E` のグレースケール）から採っている。react-native-paper の Dialog /
 * Snackbar は `constants/PaperTheme.ts` 経由で同じスキームを使うため、自動的に調和する。
 * ブランド色・セマンティック色は dark スキームに対応値が無いため手で決めている
 * （`#F05537` は `#141313` 上でコントラスト比 約 5:1 で AA を満たすので据え置き）。
 *
 * ## 使い方
 * `StyleSheet.create` はモジュール評価時に 1 度だけ走るのでテーマを追従できない。
 * **`createStyles(colors)` のファクトリをモジュールスコープに置き、画面側で
 * `useThemedStyles(createStyles)` を呼ぶ**（`contexts/ThemeProvider.tsx`）。
 *
 * ## 新しい色を足すとき
 * ここに無い色を画面へ直接書かない。役割の名前を付けてこの表へ追加する。
 * ライト値は「その画面に既にある値」を写すこと（新しいライト値を発明しない）。
 */

/** 解決済みのカラースキーム（"system" は解決前の *設定値* であってスキームではない） */
export type ColorScheme = "light" | "dark";

/**
 * テーマ非追従の固定色。
 *
 * #1509 【設計】写真・動画の上に載る要素と、選択済みバッジのように
 * 「常に同じ見え方であること」自体が意味を持つものはライト / ダークで振らない。
 * メディアの上は常に暗いので、ライトで黒文字にすると読めなくなる。
 */
export const FixedColors = {
	/** メディア（写真・動画）の上に載る文字・アイコン */
	onMedia: "#FFFFFF",
	/** 選択済みチェックマーク（黒地バッジの上） */
	checkMark: "#FFFFFF",
	/** 選択済みバッジの地色（黒地・白縁・白チェックの組で 1 セット） */
	badgeBackground: "#000000",
	/** 選択済みバッジの縁（暗い面でもバッジの輪郭を保つ） */
	badgeBorder: "#FFFFFF",
	/**
	 * 濃いセマンティック色で塗り潰した領域の上の文字（例: 選択された除外条件チップ）。
	 * 地の色（`danger` 系）がライト / ダークで大きく変わらないため、文字も振らない。
	 */
	onFilled: "#FFFFFF",
	/** 影。ダークでは実質見えないが、値としては黒のままでよい */
	shadow: "#000000",
	/** 主要 CTA の影（`components/PrimaryButton` へ渡す） */
	ctaShadow: "rgba(0, 0, 0, 0.45)",
} as const;

export interface Palette {
	// ───────── 面（背景・カード） ─────────
	/** 画面全体の下地 */
	background: string;
	/** 画面下地のグラデーション（LinearGradient の colors にそのまま渡す） */
	backgroundGradient: readonly [string, string];
	/** カード・ヘッダー・タブバーなど「1 段手前の面」 */
	surface: string;
	/** 面の上に置くわずかに沈んだ領域（未選択チップの地など） */
	surfaceMuted: string;
	/** さらに沈んだ補助領域（推定値の行など） */
	surfaceSubtle: string;
	/** 選択された領域の地 */
	surfaceSelected: string;
	/** web の中央カラムの外側（アプリの外の余白） */
	appShellBackdrop: string;

	// ───────── 罫線・区切り ─────────
	/** カード内の行区切り */
	divider: string;
	/** 通常の枠線 */
	border: string;
	/** 選択状態を示す強い枠線 */
	borderContrast: string;
	/** スライダーの未通過トラック / 円形スウォッチの地 */
	trackMuted: string;

	// ───────── 文字・アイコン ─────────
	/** 主要な文字（見出し・本文） */
	textPrimary: string;
	/** 主要な文字（`#111827` 系統。ライトでは textPrimary と別値のため分けてある） */
	textPrimaryAlt: string;
	/** 面の上の強い文字・アイコン（ライトでは純黒） */
	textStrong: string;
	/** 副次的な文字（説明・単位） */
	textSecondary: string;
	/** 副次的な文字（`#4B5563` 系統。ライトでは textSecondary と別値のため分けてある） */
	textSecondaryAlt: string;
	/** さらに弱い文字・装飾アイコン（シェブロン等） */
	textTertiary: string;

	// ───────── ブランド ─────────
	/** ブランド色（CTA アイコン・アクティブタブ・強調文字） */
	brand: string;
	/** ブランドの淡い地（詳細フィルタのトグル等） */
	brandTint: string;
	/** ブランドのさらに淡い地（おすすめ行のハイライト） */
	brandTintSoft: string;

	// ───────── セマンティック ─────────
	/** 成功・確定を示すアイコン（地点確定の ✓ 等） */
	success: string;
	/** 注意・必須バッジの文字 */
	danger: string;
	/** 選択された除外条件チップの地など、より強い警告色 */
	dangerStrong: string;
	/** 注意の淡い地（必須バッジ） */
	dangerTint: string;
	/** 破壊的操作の文字（ログアウト） */
	destructive: string;

	// ───────── 主要 CTA（検索ボタン） ─────────
	/** CTA の地（充足時） */
	ctaBackground: string;
	/** CTA の地（未充足時） */
	ctaBackgroundDisabled: string;
	/** CTA の文字・アイコン（充足時） */
	ctaLabel: string;
	/** CTA の文字・アイコン（未充足時） */
	ctaLabelDisabled: string;
	/** CTA の矩形を浮かせるための下地 */
	ctaSurface: string;
}

/**
 * ライト。**すべて main のリテラルをそのまま写した値**（丸めなし）。
 * 右のコメントは、その値がどのファイルから来たかの出典。
 */
const light: Palette = {
	background: "#F8F9FA", // search/index.tsx container
	backgroundGradient: ["#FFFFFF", "#F8F9FA"], // profile/settings.tsx LinearGradient
	surface: "#FFFFFF", // components/Card.tsx / ScreenHeader.tsx / (tabs)/_layout.tsx(#fff)
	surfaceMuted: "#F8F9FA", // SelectableChip.tsx chip
	surfaceSubtle: "#F3F4F6", // DistanceSlider.tsx estimateRow
	surfaceSelected: "#E5E5E5", // SelectableChip.tsx / SelectableGridItem.tsx selected
	appShellBackdrop: "#F3F4F6", // CenteredAppShell.web.tsx outer

	divider: "#F3F4F6", // profile/settings.tsx separator
	border: "#C9C9C9", // ScreenHeader.tsx borderBottom / SelectableChip.tsx
	borderContrast: "#000000", // SelectableChip.tsx / SelectableGridItem.tsx selected border
	trackMuted: "#D1D5DB", // DistanceSlider.tsx track（ムードの円 #C9C9C9 とは別値のため統合しない）

	textPrimary: "#1A1A1A", // ScreenHeader.tsx title / search headerTitle
	textPrimaryAlt: "#111827", // DistanceSlider.tsx estimateLabel
	textStrong: "#000000", // search moodLabel / SelectableChip label / 現在地アイコン
	textSecondary: "#6B7280", // search restrictionChipText / タブバー非アクティブ
	textSecondaryAlt: "#4B5563", // DistanceSlider.tsx estimateValue
	textTertiary: "#9CA3AF", // profile/settings.tsx シェブロン

	brand: "#F05537",
	brandTint: "#FDEBE7", // search advancedToggle / DistanceSlider badge
	brandTintSoft: "#FFF7F5", // DistanceSlider recommendedRow

	success: "#16A34A", // LocationAutocomplete 地点確定の ✓（#1502）
	danger: "#DC2626", // search requiredText
	dangerStrong: "#EF4444", // search selectedRestrictionChip
	dangerTint: "#FEE2E2", // search requiredBadge
	destructive: "#FF3E33", // profile/settings.tsx ログアウト

	ctaBackground: "#000000", // search searchFab gradient(充足)
	ctaBackgroundDisabled: "#999999", // search searchFab gradient(未充足)
	ctaLabel: "#FFFFFF",
	ctaLabelDisabled: "#FFFFFF", // ライトでは充足時と同値。ダークで分けたいので別トークンにしてある
	ctaSurface: "#FFFFFF", // search searchFab 背景
};

/**
 * ダーク。中立色は `MaterialTheme.schemes.dark` から、ブランド / セマンティックは手動。
 * 右のコメントは出典（`schemes.dark.*` か、手で決めた根拠）。
 */
const dark: Palette = {
	background: "#141313", // schemes.dark.background
	backgroundGradient: ["#1C1B1B", "#141313"], // surfaceContainerLow → background
	surface: "#201F1F", // schemes.dark.surfaceContainer
	surfaceMuted: "#1C1B1B", // schemes.dark.surfaceContainerLow
	surfaceSubtle: "#2A2A2A", // schemes.dark.surfaceContainerHigh
	surfaceSelected: "#353434", // schemes.dark.surfaceContainerHighest
	appShellBackdrop: "#0E0E0E", // schemes.dark.surfaceContainerLowest（カラムより暗い外側）

	divider: "#2A2A2A", // schemes.dark.surfaceContainerHigh
	border: "#444748", // schemes.dark.outlineVariant
	borderContrast: "#E5E2E1", // schemes.dark.onSurface（暗面では「白縁」が選択の強調になる）
	trackMuted: "#444748", // schemes.dark.outlineVariant

	textPrimary: "#E5E2E1", // schemes.dark.onSurface
	textPrimaryAlt: "#E5E2E1", // 同上（ライトの #111827 / #1A1A1A はダークでは同じ役割に収束する）
	textStrong: "#E5E2E1", // 同上
	textSecondary: "#A8ABAB", // onSurfaceVariant(#C4C7C7) をやや落として主従を保つ
	textSecondaryAlt: "#C4C7C7", // schemes.dark.onSurfaceVariant
	textTertiary: "#8E9192", // schemes.dark.outline

	brand: "#F05537", // 据え置き（#141313 上でコントラスト比 約 5:1、AA 可）
	brandTint: "#3A241F", // brand を暗面へ混色
	brandTintSoft: "#2A1D1A", // brandTint よりさらに淡い混色

	success: "#81C995", // 暗面では明度を上げないと視認性を保てない（danger と同じ方針で手動調整）
	danger: "#FF8A80", // 暗面では明度を上げないと文字用途で AA を割る
	dangerStrong: "#FF6B6B",
	dangerTint: "#4A2320", // danger を暗面へ混色
	destructive: "#FF8A80",

	ctaBackground: "#E5E2E1", // 暗面では CTA を反転させる（黒地の CTA は背景に沈む）
	ctaBackgroundDisabled: "#4A4A4A",
	ctaLabel: "#141313",
	ctaLabelDisabled: "#8E9192",
	ctaSurface: "#201F1F",
};

export const Palettes: Record<ColorScheme, Palette> = { light, dark };

/** スキームからパレットを引く。未知の値はライトへ倒す（ライトが既定の見た目であるため） */
export function getPalette(scheme: ColorScheme | null | undefined): Palette {
	return scheme === "dark" ? dark : light;
}
