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
	/**
	 * #1509 SVG マスクの **チャンネル値**。これは «色» ではない。
	 *
	 * `features/tutorial/components/SpotlightTutorial.tsx` のスポットライトは、
	 * 画面全体を覆う矩形を白（= 覆う）で塗り、対象の矩形を黒（= 抜く）で描いた
	 * `<Mask>` を通して描画している。テーマで振ると **穴が開かなくなる**ので、
	 * ライト / ダークのどちらでも白と黒でなければならない。
	 */
	maskOpaque: "#FFFFFF",
	maskHole: "#000000",
	/** 主要 CTA の影（`components/PrimaryButton` へ渡す） */
	ctaShadow: "rgba(0, 0, 0, 0.45)",
	/*
	#1513 レビュー編集シートの「保存」CTA の地（塗り潰し）。

	彩度の高い赤で塗り潰した面は、ライトでもダークでも同じだけ目立ち判読できる。
	ここをテーマで振ると「保存＝この赤」という手掛かりが崩れるうえ、
	既存の見た目（#FF3040）が変わってしまう。上に載る字は `onFilled`（＝白）。
	*/
	submitFilled: "#FF3040",
	/**
	 * メディアビューア（全画面 Feed / カルーセル）の地。
	 * 「メディアを引き立てる黒背景」（DishMediaFeed.tsx）が仕様であり、
	 * ライトでも黒のまま。動画・写真の余白は常に黒であること自体に意味がある。
	 */
	mediaBackground: "#000000",
	/**
	 * いいね済みハート（メディアの上）。SNS 慣習の固定色で、
	 * 載る先が常に暗いメディアなのでライト / ダークで振らない。
	 */
	likeActive: "#FF3040",
	/** 固定黒のメディアビューア上のエラーメッセージ。地が固定なので文字も振らない */
	errorOnMedia: "#FF6B6B",
	/**
	 * 星評価（アクティブ）の金。「金の星」であること自体が評価の記号であり、
	 * ライトの面でもダークの面でも判読できるため振らない。
	 */
	ratingActive: "#FFD700",
	/**
	 * 地図タイルの上に直接載るマーカーバブルの地。Google Map のタイルはアプリの
	 * テーマに追従せず常にライト配色なので、その上のバブルも固定でライトの白を使う
	 * （テーマで暗くすると明るい地図の上で浮いてしまう）。
	 */
	mapMarkerSurface: "#FFFFFF",
	/**
	 * 地図タイルの上に直接載る文字（マーカーの店名ラベル）。
	 * 地図は常にライト配色なので、テーマに追従させず濃い墨色で固定する
	 * （暗面テーマで白文字にすると、明るい地図の上で読めなくなる）。
	 */
	mapMarkerLabel: "#111827",
	/**
	 * 同上の «選択中» の文字色。#1375 の状態オレンジ（`#ED6C02`）を、
	 * 白フチ越しでも読めるよう一段濃くしたもの（白との比 4.2:1）。
	 */
	mapMarkerLabelActive: "#B4400F",
	/** 地図上のブランド色（ピンの縁・「Google マップで開く」の文字）。地図が常にライトなので固定 */
	brandOnMap: "#F05537",
	/** 地図上のブランド淡地（フローティングボタンのグラデ）。地図が常にライトなので固定 */
	brandTintOnMap: "#FDEBE7",
	/*
	#1513 通知の «種別» を表すバッジの地色（いいね = 赤 / 保存 = 紫 / 投票 = 緑）。

	これは面の色ではなく **識別子** である。ライトとダークで色を振ると
	「赤 = いいね」という手掛かりが崩れ、同じ通知が別物に見える。
	上の `badgeBackground` と同じ理由でテーマ非追従にしている。
	この上に載る字は `onFilled`（＝白）。
	*/
	notificationLike: "#FF3040",
	notificationSave: "#5856D6",
	notificationVote: "#34C759",
	/*
	#1629 オンボーディング（#1486）の «全面写真» 画面の下地。

	この画面は共感写真を `StyleSheet.absoluteFill` で全面に敷き、その上に白文字・
	白い円形ボタンだけを載せる ＝ 構造としてメディアビューアと同じである（`mediaBackground`
	と同じ理由でテーマに追従させない）。写真が出るまでの一瞬と、写真の外側に見える墨色で、
	ここをライトで明るくすると白文字と白い円が読めなくなる。
	白丸ボタンの中の矢印（白地の上の文字）にも同じ値を使う ＝ 地と字で 1 セット。
	*/
	photoBackdrop: "#1A1A1A",
	/*
	#1629 Welcome 画面（#1486 §7）の紙吹雪の色。

	情報を持たない純粋な装飾で、«パーティの紙片» という見立てそのものが意味である。
	テーマで振ると彩度の違う 7 色を 2 セット持つことになり、根拠の無い色が増えるだけで
	絵としては良くならない。`notificationLike` 等と同じく «識別子としての色» 扱いにする。
	*/
	confettiPieces: ["#F05537", "#FFB03A", "#FFE066", "#4ECDC4", "#8E7DFF", "#FF8FA3", "#3BC46A"],
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
	/** 画像の読み込み前に見えるプレースホルダの地・進捗トラックの未通過部（`#E5E7EB` 系統） */
	surfacePlaceholder: string;
	/** 選択された «候補チップ» の淡い藍地（#1629 友達投票の名前候補） */
	surfaceSelectedTint: string;

	// ───────── 罫線・区切り ─────────
	/** カード内の行区切り */
	divider: string;
	/** 通常の枠線 */
	border: string;
	/** 選択状態を示す強い枠線 */
	borderContrast: string;
	/** スライダーの未通過トラック / 円形スウォッチの地 */
	trackMuted: string;
	/** 弱い枠線（`#E5E7EB` 系統。ライトでは border より淡いため分けてある） */
	borderMuted: string;
	/** 弱い区切り線（`#EEE` 系統。ライトでは divider と別値のため分けてある） */
	dividerMuted: string;
	/** ごくわずかに沈んだ面（入力欄の地など。ライトでは background より淡い） */
	surfaceFaint: string;
	/** ブランドの淡い地（`#FDE7E1` 系統。ライトでは brandTint と別値のため分けてある） */
	brandTintAlt: string;
	/** ブランドの淡い罫線（アクティブタブの下線部など） */
	brandBorder: string;
	/** 入力欄の枠線（`#D1D5DB` 系統。ライトでは borderMuted より濃いため分けてある） */
	borderInput: string;

	// ───────── 文字・アイコン ─────────
	/** 主要な文字（見出し・本文） */
	textPrimary: string;
	/** 主要な文字（`#111827` 系統。ライトでは textPrimary と別値のため分けてある） */
	textPrimaryAlt: string;
	/** 主要な文字（`#1F2937` 系統。ライトでは textPrimaryAlt よりわずかに淡いため分けてある） */
	textPrimaryDim: string;
	/** 面の上の強い文字・アイコン（ライトでは純黒） */
	textStrong: string;
	/** 副次的な文字（説明・単位） */
	textSecondary: string;
	/** 副次的な文字（`#4B5563` 系統。ライトでは textSecondary と別値のため分けてある） */
	textSecondaryAlt: string;
	/** さらに弱い文字・装飾アイコン（シェブロン等） */
	textTertiary: string;
	/** フォームのラベル・操作アイコン（`#374151` 系統。ライトでは textSecondaryAlt より濃いため分けてある） */
	textSecondaryStrong: string;
	/** 補足文字（`#666` 系統。ライトでは textSecondary と別値のため分けてある） */
	textMuted: string;
	/** 入力欄のプレースホルダ */
	textPlaceholder: string;
	/** 画像が無いときのプレースホルダアイコン（`#999` 系統） */
	iconPlaceholder: string;
	/** リンク・情報系アクション（「現在地で再検索」「詳細を見る」等の青） */
	link: string;
	/** リンク文字（`#2563EB` 系統。ライトでは link と別値のため分けてある） */
	linkAlt: string;

	// ───────── ブランド ─────────
	/** ブランド色（CTA アイコン・アクティブタブ・強調文字） */
	brand: string;
	/** ブランドの淡い地（詳細フィルタのトグル等） */
	brandTint: string;
	/** ブランドのさらに淡い地（おすすめ行のハイライト） */
	brandTintSoft: string;
	/** ブランド色で進む進捗バーの «未通過» 側（#1629 オンボーディングの権限画面） */
	brandTrack: string;

	// ───────── セマンティック ─────────
	/** 成功・確定を示すアイコン（地点確定の ✓ #1502 / 通報の受付完了 #1514） */
	success: string;
	/** 注意・必須バッジの文字 */
	danger: string;
	/** 選択された除外条件チップの地など、より強い警告色 */
	dangerStrong: string;
	/** 注意の淡い地（必須バッジ） */
	dangerTint: string;
	/** 注意のさらに淡い地（削除ボタンの地。`#FEF2F2` 系統） */
	dangerTintSoft: string;
	/** 破壊的操作の文字（ログアウト） */
	destructive: string;
	/** 確認ダイアログの見出し（Material の onSurface 系。#1577） */
	dialogTitle: string;
	/** 確認ダイアログの本文（Material の onSurfaceVariant 系。#1577） */
	dialogMessage: string;
	/** 濃い警告文字（`#B91C1C` 系統。ライトでは danger より濃いため分けてある） */
	dangerEmphasis: string;
	/** 注意喚起バナーの地（OS 通知が拒否されている等） */
	warningTint: string;
	/** 注意喚起バナーの本文 */
	warningText: string;
	/** 注意喚起バナーの操作リンク */
	warningAction: string;

	// ───────── OS 許可ダイアログの複製（#1629 / #1486 §5） ─────────
	/**
	 * オンボーディングの権限画面は、中央に **OS の許可ダイアログを模したダミー**を置く
	 * （実物はこのダミーの上へ重なって出る）。だから他の面・文字トークンへ寄せてはいけない。
	 * 寄せた瞬間に «実物とそっくり» という唯一の存在理由が消える。値は iOS のアラートの
	 * システム値をライト / ダークそれぞれから採る。
	 */
	/** ダミーダイアログの地 */
	alertSurface: string;
	/** ダミーダイアログの本文 */
	alertMessage: string;
	/** ダミーダイアログのボタン区切り線 */
	alertSeparator: string;
	/** ダミーダイアログのボタン文字（iOS のシステムブルー） */
	alertAction: string;

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
	backgroundGradient: ["#FFFFFF", "#F8F9FA"], // マイページ / 端末設定 / なに食べよについて の LinearGradient
	surface: "#FFFFFF", // components/Card.tsx / ScreenHeader.tsx / (tabs)/_layout.tsx(#fff)
	surfaceMuted: "#F8F9FA", // SelectableChip.tsx chip
	surfaceSubtle: "#F3F4F6", // DistanceSlider.tsx estimateRow
	surfaceSelected: "#E5E5E5", // SelectableChip.tsx / SelectableGridItem.tsx selected
	appShellBackdrop: "#F3F4F6", // CenteredAppShell.web.tsx outer
	surfacePlaceholder: "#E5E7EB", // #1629 友達投票の候補画像プレースホルダ / 投票プログレスの未通過部
	surfaceSelectedTint: "#EEF2FF", // #1629 友達投票の «選択中の名前候補» の地

	divider: "#F3F4F6", // SettingsMenuItem の区切り線
	border: "#C9C9C9", // ScreenHeader.tsx borderBottom / SelectableChip.tsx
	borderContrast: "#000000", // SelectableChip.tsx / SelectableGridItem.tsx selected border
	trackMuted: "#D1D5DB", // DistanceSlider.tsx track（ムードの円 #C9C9C9 とは別値のため統合しない）
	borderMuted: "#E5E7EB", // #1469 sns-import.tsx の入力欄・カードの枠線
	dividerMuted: "#EEEEEE", // #1469 my-dishes/index.tsx 等の区切り。元表記は #EEE（描画される色は完全に同一）
	surfaceFaint: "#F9FAFB", // #1469 ReviewForm.tsx 入力欄の地
	brandTintAlt: "#FDE7E1", // #1469 my-dishes/filters.tsx / sns-import.tsx のブランド淡地
	brandBorder: "#F6DCD5", // #1469 my-dishes/index.tsx アクティブタブ下のborderBottom
	borderInput: "#D1D5DB", // #1629 友達投票の完了入力（名前・コメント）の枠線

	textPrimary: "#1A1A1A", // ScreenHeader.tsx title / search headerTitle
	textPrimaryAlt: "#111827", // DistanceSlider.tsx estimateLabel
	textPrimaryDim: "#1F2937", // #1629 友達投票の結果ヘッダー（参加者数・人数アイコン）
	textStrong: "#000000", // search moodLabel / SelectableChip label / 現在地アイコン
	textSecondary: "#6B7280", // search restrictionChipText / タブバー非アクティブ
	textSecondaryAlt: "#4B5563", // DistanceSlider.tsx estimateValue
	textTertiary: "#9CA3AF", // SettingsMenuItem のシェブロン
	textSecondaryStrong: "#374151", // #1469 my-dishes/filters.tsx / sns-import.tsx のフォームラベル
	textMuted: "#666666", // #1469 restaurant 系の補足文字。元表記は #666（描画される色は完全に同一）
	textPlaceholder: "#A0A0A0", // #1469 ReviewForm.tsx placeholderTextColor
	iconPlaceholder: "#999999", // ProfileHeader.tsx アバター無しのアイコン。元表記は #999（描画される色は完全に同一）
	link: "#357AFF", // #1469 my-dishes 系の青系アクション（現在地で再検索・全画面表示 等）
	linkAlt: "#2563EB", // #1469 post/[id].tsx / ReviewForm.tsx のリンク文字

	brand: "#F05537",
	brandTint: "#FDEBE7", // search advancedToggle / DistanceSlider badge
	brandTintSoft: "#FFF7F5", // DistanceSlider recommendedRow
	brandTrack: "#FBD9D0", // #1629 オンボーディング権限画面の進捗バーの地

	success: "#16A34A", // 地点確定の ✓（#1502）/ 通報受付の CircleCheck（#1514）。白地の上で AA 可
	danger: "#DC2626", // search requiredText
	dangerStrong: "#EF4444", // search selectedRestrictionChip
	dangerTint: "#FEE2E2", // search requiredBadge
	dangerTintSoft: "#FEF2F2", // #1629 友達投票の «候補を削除» ボタンの地
	destructive: "#FF3E33", // マイページのログアウト行
	dialogTitle: "#1C1B1F", // #1577 DialogProvider が直書きしていた値の写し（M3 onSurface）
	dialogMessage: "#49454F", // 同上（M3 onSurfaceVariant）
	dangerEmphasis: "#B91C1C", // #1469 MyDishesCalendarView.tsx footerErrorText
	warningTint: "#FEF3C7", // #1510 OS 通知拒否バナーの地
	warningText: "#92400E", // 同バナーの本文（#FEF3C7 の上で AA 可）
	warningAction: "#B45309", // 同バナーのリンク・アイコン

	alertSurface: "#F5F5F7", // #1629 iOS ライトのアラートの地（すりガラスの代替）
	alertMessage: "#48484A", // 同 secondaryLabel 相当
	alertSeparator: "#C6C6C8", // 同 separator（不透明化した値）
	alertAction: "#007AFF", // 同 systemBlue（ライト）

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
	surfacePlaceholder: "#2A2A2A", // schemes.dark.surfaceContainerHigh（暗面では «まだ何も無い» 面はここへ収束する）
	surfaceSelectedTint: "#242737", // 藍を暗面へ混色（brandTint と同じ作法。選択の «色の手掛かり» を残す）

	divider: "#2A2A2A", // schemes.dark.surfaceContainerHigh
	border: "#444748", // schemes.dark.outlineVariant
	borderContrast: "#E5E2E1", // schemes.dark.onSurface（暗面では「白縁」が選択の強調になる）
	trackMuted: "#444748", // schemes.dark.outlineVariant
	borderMuted: "#444748", // schemes.dark.outlineVariant（border と同値へ収束。暗面ではこれ以上淡い罫線が見えない）
	dividerMuted: "#2A2A2A", // schemes.dark.surfaceContainerHigh（divider と同値へ収束）
	surfaceFaint: "#1C1B1B", // schemes.dark.surfaceContainerLow（surfaceMuted と同値へ収束）
	brandTintAlt: "#3A241F", // brandTint と同じ暗面混色（暗面ではこの階調差が出ない）
	brandBorder: "#3A241F", // brandTint の暗面混色を罫線に転用（ブランド色の淡い下線を保つ）
	borderInput: "#444748", // schemes.dark.outlineVariant（暗面では入力欄の枠も outline へ収束する）

	textPrimary: "#E5E2E1", // schemes.dark.onSurface
	textPrimaryAlt: "#E5E2E1", // 同上（ライトの #111827 / #1A1A1A はダークでは同じ役割に収束する）
	textPrimaryDim: "#E5E2E1", // 同上（ライトの #1F2937 も暗面では同じ «主要な文字» へ収束する）
	textStrong: "#E5E2E1", // 同上
	textSecondary: "#A8ABAB", // onSurfaceVariant(#C4C7C7) をやや落として主従を保つ
	textSecondaryAlt: "#C4C7C7", // schemes.dark.onSurfaceVariant
	textTertiary: "#8E9192", // schemes.dark.outline
	textSecondaryStrong: "#C4C7C7", // schemes.dark.onSurfaceVariant（textSecondaryAlt と同じ役割に収束する）
	textMuted: "#A8ABAB", // textSecondary と同値（ライトの #666 / #6B7280 は暗面では同じ役割に収束する）
	textPlaceholder: "#8E9192", // schemes.dark.outline
	iconPlaceholder: "#8E9192", // schemes.dark.outline（textPlaceholder と同じ弱さへ収束）
	link: "#357AFF", // 据え置き（#141313 上でコントラスト比 約 4.7:1、AA 可）
	linkAlt: "#357AFF", // #2563EB は #141313 上でコントラスト比 約 3.6:1 と AA を割るため link と同値へ収束

	brand: "#F05537", // 据え置き（#141313 上でコントラスト比 約 5:1、AA 可）
	brandTint: "#3A241F", // brand を暗面へ混色
	brandTintSoft: "#2A1D1A", // brandTint よりさらに淡い混色
	brandTrack: "#3A241F", // brandTint と同値。暗面で明るいピンクの帯を残すと画面から浮く

	success: "#81C995", // 暗面では明度を上げないと視認性を保てない（danger と同じ方針で手動調整）。#1502 / #1514 共用
	danger: "#FF8A80", // 暗面では明度を上げないと文字用途で AA を割る
	dangerStrong: "#FF6B6B",
	dangerTint: "#4A2320", // danger を暗面へ混色
	dangerTintSoft: "#3A1E1D", // dangerTint よりさらに淡い混色（ライトの階調差を暗面でも保つ）
	destructive: "#FF8A80",
	dialogTitle: "#E5E2E1", // schemes.dark.onSurface
	dialogMessage: "#C4C7C7", // schemes.dark.onSurfaceVariant
	dangerEmphasis: "#FF8A80", // danger と同値へ収束（暗面では明度を上げないと文字用途で AA を割る）
	warningTint: "#3A2E12", // 暗面へ混色した琥珀。明るい箱が浮かないようにする
	warningText: "#FFD9A0", // #3A2E12 の上で AA を満たす明度まで上げる
	warningAction: "#FFB86B",

	alertSurface: "#2C2C2E", // iOS ダークのアラートの地
	alertMessage: "#AEAEB2", // 同 secondaryLabel 相当（不透明化した値）
	alertSeparator: "#545458", // 同 separator（不透明化した値）
	alertAction: "#0A84FF", // 同 systemBlue（ダーク）

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
