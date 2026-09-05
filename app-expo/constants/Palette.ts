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
	/**
	 * #1629 マーカービットマップ（`features/mapMarkers`）の «アクティブなふち» の青。
	 * 上の `mapMarkerSurface` と対で 1 セットで、同じ理由（地図タイルが常にライト）で
	 * テーマ非追従。この 2 値は生成した PNG のキャッシュキーにも入るため、
	 * テーマで振るとキャッシュが総入れ替えになる。
	 */
	mapMarkerBorderActive: "#3477F8",
	/**
	 * #1629 マーカービットマップの、写真が届くまでの下地の灰。
	 * これも地図タイルの上に焼き込まれるので固定（暗い灰にすると «穴» に見える）。
	 */
	mapMarkerImagePlaceholder: "#E0E0E0",
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
	#1509 ウォレット（デポジット / 収益）の «状態» を表すチップの地色。

	上の通知バッジと同じで、これは面の色ではなく **識別子** である。
	緑 = 進行中 / 支払済、青 = 完了、橙 = 返金 / 保留 の対応が
	ライトとダークで振れると、同じ行が別の状態に見えてしまう。
	チップは «塗り潰し» で、上に載る字は `onFilled`（＝白）。
	*/
	/** active（デポジット進行中）/ paid（支払済） */
	walletStatusActive: "#4CAF50",
	/** completed（デポジット完了） */
	walletStatusCompleted: "#2196F3",
	/** refunded（返金済）/ pending（支払待ち） */
	walletStatusPending: "#FF9800",
	/** 未知の status が来たときのフォールバック。灰の塗り潰しなので白字が載る */
	walletStatusUnknown: "#666666",
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
	/*
	#1629 メディア（写真・動画）の上に載る «副次的な» 文字・アイコン。

	`onMedia`（純白）は本文用で、レビューの日時・いいね数・星・通報アイコンまで純白にすると
	本文と主従が付かない。メディアの上なので地は常に暗く、ライトでも同じ淡いグレーでよい
	（`onMedia` と同じ理由でテーマに追従させない）。
	*/
	onMediaMuted: "#CCCCCC",
	/**
	 * #1629 地図の読み込み前・読み込み失敗時に、地図と同じ寸法で置く «場所だけ確保した» 面
	 * （`components/MapView.web.tsx`）。ここに出るのは Google のタイルで、タイルは
	 * アプリのテーマに追従せず常にライト配色である。暗い面にすると、読み込み完了の瞬間に
	 * 暗 → 明のちらつきが出るため、`mapMarkerSurface` と同じ理由で固定にする。
	 */
	mapPlaceholderSurface: "#E9E9E9",
	/**
	 * #1629 Android の通知チャンネルの LED 色（`components/PushTokenRegistration.tsx`）。
	 * これはアプリが描く «画面の色» ではなく、OS へ渡す ARGB のパラメータである。
	 * 端末のインジケータが光る色なので、アプリのテーマとは無関係に固定でなければならない。
	 */
	notificationLed: "#FF231F7C",
	/**
	 * #1629 半透明の «白い» 箱の上の文字（web の「アプリで開く」バナーの補助行）。
	 * 箱の地は `rgba(255,255,255,0.92)` の固定で、下のページが透けることに意味がある
	 * （テーマで暗くすると、その上の濃い文字と一緒に反転させる必要が出て絵が壊れる）。
	 * 地が固定なので、その上の文字も振らない。
	 */
	onTranslucentWhite: "#333333",
	confettiPieces: ["#F05537", "#FFB03A", "#FFE066", "#4ECDC4", "#8E7DFF", "#FF8FA3", "#3BC46A"],
	/*
	#1375 my-dishes の «食べたい / 食べた» を表す状態オレンジと、その相方の白。
	#1834 続き（11 巡目・オーナー指示）から **«食べたい» 側**の塗り（🟢 = 完了 を «食べた» へ渡した）。

	`notificationLike` 等と同じ «識別子としての色» である（塗りの有無で状態を表し、
	上に載る字と縁を 1 組で配る）。値の意味と «明るくしてはいけない» 理由は
	`features/myDishes/statusColors.ts` の JSDoc にある。
	#1629 検査対象を .ts へ広げたのに伴い、固定色の正本であるここへ値を移した
	（statusColors.ts はこの値を組にして配るだけになる）。
	*/
	myDishStatusOrange: "#ED6C02",
	/*
	#1834【オーナー指示】**«食べた» 側**の塗り。«食べたい»（オレンジ）と **色相で** 分ける。

	チーム指摘「食べたい、食べたはオレンジ、オレンジ囲みで色分けされてるが、食べたいのボタンは
	緑色にするとか、色を変えたほうが視覚的に見分けられやすいと思った」→ オーナー指示
	「食べたい は緑塗りにして欲しい。合う色で」で緑を足した（10 巡目）。
	その後 **«🟢 は完了の色だから «食べた» の方へ»**（11 巡目・2026-09-05）で当てる状態を入れ替えた。
	値は動かしていない。判断ログは `statusColors.ts` の JSDoc。

	⚠️ **これより明るい緑へ動かさないこと。** `#2E7D32` は白との対比 **5.13:1** で、
	   上に載る白文字・白枠が読める。相方のオレンジ `#ED6C02`（3.11:1）より余裕がある。
	   Material の Green 500 相当（`#4CAF50` = 2.78:1）まで明るくすると、
	   **UI 部品の下限 3:1 を割って白文字が読めなくなる**。
	*/
	myDishStatusGreen: "#2E7D32",
	/** 上の 2 つと 1 組。どちらの塗りの上にも載る字・縁の色 */
	myDishStatusOn: "#FFFFFF",
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
	/**
	 * スケルトン（読み込み中のプレースホルダ）の地。#1629
	 * ライトでは «地よりわずかに暗い» 灰、ダークでは «地よりわずかに明るい» 面になる。
	 */
	skeletonBase: string;
	/**
	 * スケルトンを流れる光帯のグラデーション（5 段。LinearGradient の colors にそのまま渡す）。#1629
	 * 両端は透明で `skeletonBase` に溶け、中心が最も明るい。ダークでは «白く光る» と
	 * そこだけ穴が開いたように見えるため、白の不透明度を大きく落としてある。
	 */
	skeletonBandGradient: readonly [string, string, string, string, string];
	/** web の «アプリで開く» バナーの地（#1629。クリーム色の帯） */
	promoBannerSurface: string;
	/**
	 * 面を反転させた塗り潰し（ライトでは黒に近い面、ダークでは白に近い面）。#1629
	 * 「アプリを入手」のような «地の上でさらに目立たせる» ボタンに使う。
	 * Material の inverseSurface と同じ役割で、上に載る字は `onInverseSurface`。
	 */
	inverseSurface: string;
	/** 反転した面の上の文字（#1629。`inverseSurface` と 1 セット） */
	onInverseSurface: string;
	/**
	 * 処理中に画面へかぶせる半透明の幕（#1629 言語切替の「切り替えています」）。
	 *
	 * ⚠️ 幕の上には `textPrimary` の文字が載る。テーマに依らず白い幕にすると、
	 * ダークでは «白い幕の上に明るい文字» になって読めない（オーナー報告の再発源）。
	 * メディアの上のスクリム（`FixedColors` 側）とは別物で、こちらは **アプリの面の上**
	 * にかぶせるものなので必ずテーマで振る。
	 */
	busyScrim: string;

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
	/** 弱い罫線（`#E5E5E5` 系統。ライトでは borderMuted と別値のため分けてある） */
	borderFaint: string;
	/** 中庸の罫線（アウトラインのボタン・チェックボックス・引用の縦罫） */
	borderNeutral: string;
	/** 未選択チップの地（`#F5F5F5` 系統。ライトでは surfaceMuted と別値のため分けてある） */
	surfaceChip: string;
	/** 未選択チップの地（`#EDEFF1` 系統。ライトでは surfaceChip と別値のため分けてある） */
	surfaceChipAlt: string;

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
	/** さらに淡い注意の地（エラーバナー・エラー時の入力欄。ライトでは dangerTint より薄いため分けてある） */
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

	// ───────── 社内タスク画面（contribution-tasks）由来（#1629） ─────────
	/**
	 * `app/[locale]/contribution-tasks/*` は #1363 で公開アプリから隔離した社内ツールで、
	 * 公開画面とは別世代の配色（`#333` / `#DDD` / `#F5F5F5` 系）を持っている。
	 * ライトの値は各画面に直書きされていたリテラルの写しなので、既存トークンと
	 * «同じような色» に見えても値が違う。丸めて既存トークンへ寄せるとライトの見た目が変わるため、
	 * 役割ごとに別トークンとして持つ（暗面では既存トークンと同じ値へ収束するものが多い）。
	 */
	/** 社内タスク画面の下地（`#F5F5F5` 系統。ライトでは background と別値） */
	backgroundAlt: string;
	/** 地の上のわずかに沈んだ面（進捗トラック・アバターの地・順位カードの地。`#EEE` 系統） */
	surfaceSunken: string;
	/** さらに淡い補助面（引用ブロック・未選択の選択肢。`#F9F9F9` 系統） */
	surfaceFaintAlt: string;
	/** 副次的な（灰の）ボタン・無効なボタンの地（`#E0E0E0` 系統） */
	surfaceDisabled: string;
	/** 送信中のボタンの地（`#BDBDBD` 系統。surfaceDisabled より一段濃い） */
	surfaceDisabledStrong: string;
	/** 選択済みの選択肢の淡い青地（`#E3F2FD` 系統） */
	surfaceSelectedInfo: string;
	/** 一段深く沈んだ面（画像プレースホルダ・進捗ドットの地。`#DDD` 系統） */
	surfaceSunkenStrong: string;
	/** 画像の読み込み前に見えるカードの地（`#C9C9C9` 系統。ライトでは surfacePlaceholder より濃い） */
	surfacePlaceholderAlt: string;
	/** 罫線（`#DDD` 系統。ライトでは borderNeutral / borderFaint と別値） */
	borderSoft: string;
	/** 罫線（`#E0E0E0` 系統。ライトでは borderSoft と borderFaint の中間） */
	borderPale: string;
	/** 罫線（`#CCC` 系統。チェックボックスの縁） */
	borderSubtle: string;
	/** 主要な文字（`#333` 系統。ライトでは textPrimary より淡く textSecondaryStrong より濃い） */
	textPrimarySoft: string;
	/** 主要な文字（`#444` 系統。ライトでは textPrimarySoft よりわずかに淡い） */
	textPrimaryMuted: string;
	/** 副次的な文字（`#555` 系統。ライトでは textPrimaryMuted と textMuted の中間） */
	textSecondaryDim: string;
	/** 選択済みを示す緑のアイコン・枠（`#22C55E` 系統。ライトでは success より明るい） */
	successStrong: string;
	/** 上の緑で «塗り潰した» バッジの地（白のチェックが載るので暗面では沈ませる） */
	successFill: string;
	/** 完了・確定を示す緑（`#4CAF50` 系統。ライトでは successStrong と別値） */
	successAlt: string;
	/** 社内タスク画面のアクセント（`#FF6B35` 系統。ブランドの `#F05537` とは別値） */
	brandAlt: string;
	/** 社内タスク画面のアクセント（`#FF6B6B` 系統。進捗バー・ローディング） */
	accentCoral: string;
	/** エラー文字（`#D32F2F` 系統） */
	dangerAlt: string;
	/** エラー文字（`#FF3B30` 系統。iOS のシステムレッド） */
	dangerVivid: string;
	/** エラー文字（`#F44336` 系統。Material のレッド 500） */
	dangerBright: string;
	/** 未回答を示す橙のアイコン（`#FF9800` 系統） */
	warningAccent: string;
	/** 副次操作（リセット等）のグレーのボタンのグラデ。白文字が載るので暗面でも沈んだ値を保つ */
	buttonNeutralGradient: readonly [string, string];
	/** 未充足のボタンのグラデ。同上 */
	buttonDisabledGradient: readonly [string, string];
	/** 確定操作（承認・送信）の緑のボタンのグラデ。同上 */
	buttonSuccessGradient: readonly [string, string];

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
	skeletonBase: "#E9ECEF", // #1629 SkeletonShimmer の baseColor 既定値の写し
	skeletonBandGradient: [
		"rgba(255,255,255,0)",
		"rgba(255,255,255,0.25)",
		"#FFFFFF",
		"rgba(255,255,255,0.25)",
		"rgba(255,255,255,0)",
	], // #1629 SkeletonShimmer が組んでいた 5 段をそのまま写した（描画される色は完全に同一）
	promoBannerSurface: "#FBEEDD", // #1629 OpenInAppBanner のバナーの地
	inverseSurface: "#1A1A1A", // #1629 OpenInAppBanner の「アプリを入手」ボタンの地
	onInverseSurface: "#FFFFFF", // 同ボタンの文字
	busyScrim: "rgba(255, 255, 255, 0.85)", // #1629 profile/language.tsx の切替中オーバーレイ（リテラルの写し）

	divider: "#F3F4F6", // SettingsMenuItem の区切り線
	border: "#C9C9C9", // ScreenHeader.tsx borderBottom / SelectableChip.tsx
	borderContrast: "#000000", // SelectableChip.tsx / SelectableGridItem.tsx selected border
	trackMuted: "#D1D5DB", // DistanceSlider.tsx track（ムードの円 #C9C9C9 とは別値のため統合しない）
	borderMuted: "#E5E7EB", // #1469 sns-import.tsx の入力欄・カードの枠線
	dividerMuted: "#EEEEEE", // #1469 my-dishes/index.tsx 等の区切り。元表記は #EEE（描画される色は完全に同一）
	surfaceFaint: "#F9FAFB", // #1469 ReviewForm.tsx 入力欄の地
	brandTintAlt: "#FDE7E1", // #1469 my-dishes/filters.tsx / sns-import.tsx のブランド淡地
	brandBorder: "#F6DCD5", // #1469 my-dishes/index.tsx アクティブタブ下のborderBottom
	borderFaint: "#E5E5E5", // #1509 wallet/DepositsTab.tsx 未選択チップの枠線
	borderNeutral: "#D1D5DB", // アウトラインのボタン・チェックボックス・引用の縦罫・入力欄の枠線
	surfaceChip: "#F5F5F5", // #1509 wallet/DepositsTab.tsx 未選択のステータスチップの地
	surfaceChipAlt: "#EDEFF1", // #1509 wallet/EarningsTab.tsx 未選択のステータスチップの地

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
	dangerTintSoft: "#FEF2F2", // エラーバナー / エラー時の入力欄 / 候補を削除ボタンの地（main のリテラルの写し）
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

	// #1629 社内タスク画面（contribution-tasks）のトークン化で追加。
	// すべて対象ファイルに直書きされていたリテラルの写しで、ライトの見た目は 1px も変わらない。
	backgroundAlt: "#F5F5F5", // dish-copy-survey / dish-ranking-summary / manual-*-supply の container
	surfaceSunken: "#EEEEEE", // dish-ranking-summary の順位カード・アバター・進捗の地。元表記は #eee
	surfaceFaintAlt: "#F9F9F9", // dish-copy-survey の未選択の選択肢 / dish-ranking-summary の引用ブロック
	surfaceDisabled: "#E0E0E0", // manual-text-supply の「スキップ」「閉じる」ボタンの地
	surfaceDisabledStrong: "#BDBDBD", // manual-text-supply の送信中（押せない）ボタンの地
	surfaceSelectedInfo: "#E3F2FD", // dish-copy-survey の選択済みの選択肢
	surfaceSunkenStrong: "#DDDDDD", // dish-ranking-summary の画像プレースホルダ / 進捗ドットの地。元表記は #DDD / #ddd
	surfacePlaceholderAlt: "#C9C9C9", // dish-category-image-optimizer / -review の候補画像カードの地
	borderSoft: "#DDDDDD", // dish-copy-survey / dish-ranking-summary の入力欄・区切り。元表記は #DDD / #ddd
	borderPale: "#E0E0E0", // manual-image-supply の入力欄 / dish-copy-survey のフッター上罫
	borderSubtle: "#CCCCCC", // dish-copy-survey のチェックボックスの縁。元表記は #CCC
	textPrimarySoft: "#333333", // manual-*-supply / dish-copy-survey / dish-ranking-summary の本文。元表記は #333
	textPrimaryMuted: "#444444", // dish-ranking-summary のモーダル本文。元表記は #444
	textSecondaryDim: "#555555", // dish-ranking-summary の引用ブロックの本文。元表記は #555
	successStrong: "#22C55E", // dish-category-image-optimizer / -review の選択済みアイコン・枠
	successFill: "#22C55E", // 同上の «塗り潰した» チェックバッジ（ライトでは successStrong と同値）
	successAlt: "#4CAF50", // dish-copy-survey の回答済みアイコン / manual-text-supply の進捗バー
	brandAlt: "#FF6B35", // manual-text-supply のアクセント
	accentCoral: "#FF6B6B", // manual-image-supply のローディング・進捗バー
	dangerAlt: "#D32F2F", // manual-text-supply / dish-ranking-summary のエラー文字。元表記は #D32F2F / #d32f2f
	dangerVivid: "#FF3B30", // manual-image-supply のエラー文字
	dangerBright: "#F44336", // dish-copy-survey のエラー文字
	warningAccent: "#FF9800", // dish-copy-survey の «未回答» アイコン
	buttonNeutralGradient: ["#6B7280", "#4B5563"], // dish-category-image-optimizer / -review の「リセット」
	buttonDisabledGradient: ["#9CA3AF", "#6B7280"], // dish-category-image-review の未充足時の送信
	buttonSuccessGradient: ["#22C55E", "#16A34A"], // 同 充足時の送信

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
	skeletonBase: "#2A2A2A", // schemes.dark.surfaceContainerHigh（地 #141313 からわずかに浮かせる）
	skeletonBandGradient: [
		"rgba(255,255,255,0)",
		"rgba(255,255,255,0.03)",
		"rgba(255,255,255,0.08)",
		"rgba(255,255,255,0.03)",
		"rgba(255,255,255,0)",
	], // 暗面で白い帯をそのまま流すと «そこだけ白く光る»。#2A2A2A の上で約 #383838 に収まる不透明度まで落とす
	promoBannerSurface: "#332B1D", // クリーム(#FBEEDD)の色相を保ったまま暗面へ混色（brandTint と同じ作法）
	inverseSurface: "#E5E2E1", // schemes.dark.inverseSurface
	onInverseSurface: "#313030", // schemes.dark.inverseOnSurface
	busyScrim: "rgba(20, 19, 19, 0.85)", // background(#141313) の 85%。暗面では «暗い幕 + 明るい文字» でなければ読めない

	divider: "#2A2A2A", // schemes.dark.surfaceContainerHigh
	border: "#444748", // schemes.dark.outlineVariant
	borderContrast: "#E5E2E1", // schemes.dark.onSurface（暗面では「白縁」が選択の強調になる）
	trackMuted: "#444748", // schemes.dark.outlineVariant
	borderMuted: "#444748", // schemes.dark.outlineVariant（border と同値へ収束。暗面ではこれ以上淡い罫線が見えない）
	dividerMuted: "#2A2A2A", // schemes.dark.surfaceContainerHigh（divider と同値へ収束）
	surfaceFaint: "#1C1B1B", // schemes.dark.surfaceContainerLow（surfaceMuted と同値へ収束）
	brandTintAlt: "#3A241F", // brandTint と同じ暗面混色（暗面ではこの階調差が出ない）
	brandBorder: "#3A241F", // brandTint の暗面混色を罫線に転用（ブランド色の淡い下線を保つ）
	borderFaint: "#444748", // schemes.dark.outlineVariant（borderMuted と同値へ収束。暗面ではこれ以上淡い罫線が見えない）
	borderNeutral: "#444748", // schemes.dark.outlineVariant（暗面では border 系がこの 1 値へ収束する）
	surfaceChip: "#2A2A2A", // schemes.dark.surfaceContainerHigh（未選択チップを地からわずかに浮かせる）
	surfaceChipAlt: "#2A2A2A", // schemes.dark.surfaceContainerHigh（surfaceChip と同値へ収束）

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
	dangerTintSoft: "#331E1C", // dangerTint よりさらに淡い暗面混色（地なので沈ませる。ライトの階調差は保つ）
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

	// #1629 社内タスク画面（contribution-tasks）。面・罫線・文字は既存トークンと同じ
	// schemes.dark の値へ収束させる（暗面ではライト側の階調差がそもそも見えない）。
	backgroundAlt: "#141313", // schemes.dark.background（background と同値へ収束）
	surfaceSunken: "#2A2A2A", // schemes.dark.surfaceContainerHigh
	surfaceFaintAlt: "#1C1B1B", // schemes.dark.surfaceContainerLow
	surfaceDisabled: "#2A2A2A", // schemes.dark.surfaceContainerHigh（無効な面を地からわずかに浮かせる）
	surfaceDisabledStrong: "#4A4A4A", // ctaBackgroundDisabled と同値（«押せない» を示す一段明るい灰）
	surfaceSelectedInfo: "#1C2B36", // 青を暗面へ混色（brandTint と同じ作法。選択の «色の手掛かり» を残す）
	surfaceSunkenStrong: "#353434", // schemes.dark.surfaceContainerHighest（surfaceSunken より一段浮かせる）
	surfacePlaceholderAlt: "#2A2A2A", // schemes.dark.surfaceContainerHigh（surfacePlaceholder と同値へ収束）
	borderSoft: "#444748", // schemes.dark.outlineVariant
	borderPale: "#444748", // 同上（暗面では border 系がこの 1 値へ収束する）
	borderSubtle: "#444748", // 同上
	textPrimarySoft: "#E5E2E1", // schemes.dark.onSurface（ライトの #333 も暗面では «主要な文字» へ収束する）
	textPrimaryMuted: "#E5E2E1", // 同上
	textSecondaryDim: "#C4C7C7", // schemes.dark.onSurfaceVariant
	successStrong: "#5FBF7F", // 暗面では明度を上げないとアイコン・枠として見えない（success と同じ方針）
	successFill: "#2E7D46", // 塗り潰しは逆に沈ませる。上に載る白のチェック（FixedColors.onFilled）が 4.4:1 で読める
	successAlt: "#5FBF7F", // successStrong と同値へ収束（ライトの 2 つの緑は暗面で同じ役割になる）
	brandAlt: "#FF6B35", // 据え置き（#141313 上でコントラスト比 約 6:1、AA 可）
	accentCoral: "#FF8A80", // danger と同値。#FF6B6B は暗面でやや濁るため一段明るくする
	dangerAlt: "#FF8A80", // danger と同値へ収束（暗面では明度を上げないと文字用途で AA を割る）
	dangerVivid: "#FF8A80", // 同上
	dangerBright: "#FF8A80", // 同上
	warningAccent: "#FFB86B", // warningAction と同値（暗面で読める橙はこの明度へ収束する）
	buttonNeutralGradient: ["#5A5A5A", "#4A4A4A"], // 白文字（PrimaryButton の label）が読める暗い灰に保つ
	buttonDisabledGradient: ["#4A4A4A", "#3A3A3A"], // ctaBackgroundDisabled 系。押せないことを暗さで示す
	buttonSuccessGradient: ["#2E7D46", "#256B3A"], // successFill と同じ «沈めた緑»。白文字が読める

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
