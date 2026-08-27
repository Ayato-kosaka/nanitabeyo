import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Appearance, Text } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColorScheme } from "@/hooks/useColorScheme";
import {
	ThemeProvider,
	THEME_PREFERENCE_STORAGE_KEY,
	isThemePreference,
	resolveScheme,
	useAppTheme,
	type ThemePreference,
} from "./ThemeProvider";
import { Palettes } from "@/constants/Palette";

/**
 * 🌗 #1509 SET-05 テーマ設定の単体テスト。
 *
 * ## ここで固定したい不変条件
 * 1. **既定はシステム追従**であること（設定を一度も触っていない端末で OS の設定に従う）
 * 2. 保存した設定が**再起動後も復元される**こと（AsyncStorage の読み書き）
 * 3. 壊れた値・未知の値が入っていても `"system"` へ倒れ、**ライトの見た目を壊さない**こと
 * 4. Provider の**外**では常にライト固定であること
 *    （既存の suite は Provider を張らずにコンポーネントを描画する。ここが dark へ倒れると
 *     main と見た目が変わってしまうため、既定値の設計をテストで固定しておく）
 */

jest.mock("@react-native-async-storage/async-storage", () => ({
	getItem: jest.fn(async () => null),
	setItem: jest.fn(async () => undefined),
	removeItem: jest.fn(async () => undefined),
}));

jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: jest.fn(() => "light") }));

const mockedAsyncStorage = AsyncStorage as unknown as { getItem: jest.Mock; setItem: jest.Mock };
const mockedUseColorScheme = useColorScheme as unknown as jest.Mock;

/** Context の値を外から読むための踏み台。描画結果ではなく値そのものを検査する */
function captureTheme() {
	const seen: { current: ReturnType<typeof useAppTheme> | null } = { current: null };
	function Probe() {
		seen.current = useAppTheme();
		return <Text>probe</Text>;
	}
	return { seen, Probe };
}

async function renderWithProvider() {
	const { seen, Probe } = captureTheme();
	let renderer: TestRenderer.ReactTestRenderer | null = null;
	await act(async () => {
		renderer = TestRenderer.create(
			<ThemeProvider>
				<Probe />
			</ThemeProvider>,
		);
	});
	return { seen, renderer: renderer as unknown as TestRenderer.ReactTestRenderer };
}

beforeEach(() => {
	mockedAsyncStorage.getItem.mockResolvedValue(null);
	mockedAsyncStorage.setItem.mockResolvedValue(undefined);
	mockedUseColorScheme.mockReturnValue("light");
});

describe("resolveScheme", () => {
	it("system は OS のスキームに従う", () => {
		expect(resolveScheme("system", "dark")).toBe("dark");
		expect(resolveScheme("system", "light")).toBe("light");
	});

	// OS が報告しない環境（web の hydration 前など）で dark へ倒れると
	// 「勝手に暗くなった」に見えるため、必ずライトへ倒す
	it("system で OS のスキームが不明ならライトへ倒す", () => {
		expect(resolveScheme("system", null)).toBe("light");
		expect(resolveScheme("system", undefined)).toBe("light");
	});

	it("light / dark は OS のスキームより優先される", () => {
		expect(resolveScheme("light", "dark")).toBe("light");
		expect(resolveScheme("dark", "light")).toBe("dark");
	});
});

describe("isThemePreference", () => {
	it("3 択だけを受け付ける", () => {
		expect(isThemePreference("system")).toBe(true);
		expect(isThemePreference("light")).toBe(true);
		expect(isThemePreference("dark")).toBe(true);
		expect(isThemePreference("sepia")).toBe(false);
		expect(isThemePreference(null)).toBe(false);
		expect(isThemePreference(undefined)).toBe(false);
	});
});

describe("ThemeProvider", () => {
	it("保存値が無ければ system（既定）で、OS がライトならライトで解決される", async () => {
		const { seen } = await renderWithProvider();
		expect(seen.current?.preference).toBe("system");
		expect(seen.current?.scheme).toBe("light");
		expect(seen.current?.colors).toEqual(Palettes.light);
	});

	it("保存値が無く OS がダークならダークで解決される", async () => {
		mockedUseColorScheme.mockReturnValue("dark");
		const { seen } = await renderWithProvider();
		expect(seen.current?.preference).toBe("system");
		expect(seen.current?.scheme).toBe("dark");
		expect(seen.current?.colors).toEqual(Palettes.dark);
	});

	it("保存済みの設定を復元する（再起動しても保持される）", async () => {
		mockedAsyncStorage.getItem.mockResolvedValue("dark");
		const { seen } = await renderWithProvider();
		expect(mockedAsyncStorage.getItem).toHaveBeenCalledWith(THEME_PREFERENCE_STORAGE_KEY);
		expect(seen.current?.preference).toBe("dark");
		// OS がライトでも、明示的な dark 設定が勝つ
		expect(seen.current?.scheme).toBe("dark");
	});

	// 端末ローカルの値は一度壊れるとコード修正では直せないため、読み出し側で必ず倒す
	it("壊れた保存値は system へ倒す", async () => {
		mockedAsyncStorage.getItem.mockResolvedValue("{not a preference}");
		const { seen } = await renderWithProvider();
		expect(seen.current?.preference).toBe("system");
		expect(seen.current?.scheme).toBe("light");
	});

	it("setPreference は即時に反映し、同じ値を永続化する", async () => {
		const { seen } = await renderWithProvider();
		await act(async () => {
			seen.current?.setPreference("dark");
		});
		expect(seen.current?.preference).toBe("dark");
		expect(seen.current?.scheme).toBe("dark");
		expect(mockedAsyncStorage.setItem).toHaveBeenCalledWith(THEME_PREFERENCE_STORAGE_KEY, "dark");
	});

	it("system へ戻すと OS のスキームに追従する", async () => {
		mockedAsyncStorage.getItem.mockResolvedValue("light");
		mockedUseColorScheme.mockReturnValue("dark");
		const { seen } = await renderWithProvider();
		expect(seen.current?.scheme).toBe("light");
		await act(async () => {
			seen.current?.setPreference("system");
		});
		expect(seen.current?.scheme).toBe("dark");
	});

	// #1509 絶対条件: ライトの見た目を変えない。Provider を張らない既存 suite が
	// dark へ倒れないことをここで固定する
	it("Provider の外ではライト固定（既存のテスト・カタログの見た目を変えない）", () => {
		const { seen, Probe } = captureTheme();
		act(() => {
			TestRenderer.create(<Probe />);
		});
		expect(seen.current?.preference).toBe("system");
		expect(seen.current?.scheme).toBe("light");
		expect(seen.current?.colors).toEqual(Palettes.light);
	});
});

describe("Palette（#1509 絶対条件: ライトの色を 1 つも変えない）", () => {
	/**
	 * main のリテラルをそのまま写した値。ここが 1 つでもズレたら、
	 * どこかの画面のライトモードの見た目が変わっている。
	 * （出典は `constants/Palette.ts` の light 側コメントを参照）
	 */
	const LIGHT_SNAPSHOT: Record<string, string | readonly string[]> = {
		background: "#F8F9FA",
		backgroundGradient: ["#FFFFFF", "#F8F9FA"],
		surface: "#FFFFFF",
		surfaceMuted: "#F8F9FA",
		surfaceSubtle: "#F3F4F6",
		surfaceSelected: "#E5E5E5",
		appShellBackdrop: "#F3F4F6",
		// #1629 友達投票 / オンボーディングのトークン化で追加。light はいずれも
		// 対象ファイルに直書きされていたリテラルの写しなので、ライトの見た目は 1px も変わらない。
		surfacePlaceholder: "#E5E7EB",
		surfaceSelectedTint: "#EEF2FF",
		// #1629 共通コンポーネント（スケルトン / 動画 / 地図 / web バナー）のトークン化で追加。
		// light はいずれも対象ファイルに直書きされていたリテラルの写しなので、ライトの見た目は 1px も変わらない。
		skeletonBase: "#E9ECEF",
		skeletonBandGradient: [
			"rgba(255,255,255,0)",
			"rgba(255,255,255,0.25)",
			"#FFFFFF",
			"rgba(255,255,255,0.25)",
			"rgba(255,255,255,0)",
		],
		promoBannerSurface: "#FBEEDD",
		inverseSurface: "#1A1A1A",
		onInverseSurface: "#FFFFFF",
		// #1629 言語切替の «切り替えています» の幕。light は language.tsx に直書きされていた値の写し
		busyScrim: "rgba(255, 255, 255, 0.85)",
		textPrimaryDim: "#1F2937",
		brandTrack: "#FBD9D0",
		// #1629 OS 許可ダイアログの複製（#1486 §5）。iOS のシステム値をそのまま持つ
		alertSurface: "#F5F5F7",
		alertMessage: "#48484A",
		alertSeparator: "#C6C6C8",
		alertAction: "#007AFF",
		divider: "#F3F4F6",
		border: "#C9C9C9",
		borderContrast: "#000000",
		trackMuted: "#D1D5DB",
		textPrimary: "#1A1A1A",
		textPrimaryAlt: "#111827",
		textStrong: "#000000",
		textSecondary: "#6B7280",
		textSecondaryAlt: "#4B5563",
		textTertiary: "#9CA3AF",
		// #1469 で追加（light は #1469 の画面に書かれていたリテラルの写し。出典は Palette.ts のコメント）
		textSecondaryStrong: "#374151",
		textMuted: "#666666",
		textPlaceholder: "#A0A0A0",
		iconPlaceholder: "#999999",
		link: "#357AFF",
		linkAlt: "#2563EB",
		borderMuted: "#E5E7EB",
		dividerMuted: "#EEEEEE",
		surfaceFaint: "#F9FAFB",
		brand: "#F05537",
		brandTint: "#FDEBE7",
		brandTintSoft: "#FFF7F5",
		brandTintAlt: "#FDE7E1",
		brandBorder: "#F6DCD5",
		// #1509 SET-06（プロフィール / 認証 / ウォレット系のトークン化）で追加。
		// いずれも対象ファイルに書かれていたリテラルの写しなので、ライトの見た目は 1px も変わらない。
		borderFaint: "#E5E5E5",
		borderNeutral: "#D1D5DB",
		surfaceChip: "#F5F5F5",
		surfaceChipAlt: "#EDEFF1",
		// #1502 地点確定 ✓ 用に追加。値は LocationAutocomplete に直書きされていた #16A34A の移設
		success: "#16A34A",
		danger: "#DC2626",
		dangerStrong: "#EF4444",
		dangerTint: "#FEE2E2",
		// FeedbackForm / ProfileEditForm のエラーバナー・エラー時の入力欄の地（main のリテラルの写し）
		dangerTintSoft: "#FEF2F2",
		destructive: "#FF3E33",
		// #1514 通報受付の CircleCheck。ReportContentSheet.tsx が直書きしていた
		// リテラルの写しなので、ライトの見た目は 1px も変わらない。
		// #1577 確認ダイアログの見出し・本文。どちらも DialogProvider.tsx が
		// 直書きしていたリテラルの写しなので、ライトの見た目は 1px も変わらない。
		dialogTitle: "#1C1B1F",
		dialogMessage: "#49454F",
		dangerEmphasis: "#B91C1C",
		// #1510 通知設定カードの «OS 通知が拒否されています» バナー。
		// 3 つとも NotificationSettingsCard.tsx が直書きしていたリテラルを
		// そのまま写しただけなので、ライトの見た目は 1px も変わらない。
		warningTint: "#FEF3C7",
		warningText: "#92400E",
		warningAction: "#B45309",
		// #1629 社内タスク画面（contribution-tasks）のトークン化で追加。light はいずれも
		// 対象ファイルに直書きされていたリテラルの写しなので、ライトの見た目は 1px も変わらない。
		backgroundAlt: "#F5F5F5",
		surfaceSunken: "#EEEEEE",
		surfaceFaintAlt: "#F9F9F9",
		surfaceDisabled: "#E0E0E0",
		surfaceDisabledStrong: "#BDBDBD",
		surfaceSelectedInfo: "#E3F2FD",
		surfaceSunkenStrong: "#DDDDDD",
		surfacePlaceholderAlt: "#C9C9C9",
		borderSoft: "#DDDDDD",
		borderPale: "#E0E0E0",
		borderSubtle: "#CCCCCC",
		textPrimarySoft: "#333333",
		textPrimaryMuted: "#444444",
		textSecondaryDim: "#555555",
		successStrong: "#22C55E",
		successFill: "#22C55E",
		successAlt: "#4CAF50",
		brandAlt: "#FF6B35",
		accentCoral: "#FF6B6B",
		dangerAlt: "#D32F2F",
		dangerVivid: "#FF3B30",
		dangerBright: "#F44336",
		warningAccent: "#FF9800",
		buttonNeutralGradient: ["#6B7280", "#4B5563"],
		buttonDisabledGradient: ["#9CA3AF", "#6B7280"],
		buttonSuccessGradient: ["#22C55E", "#16A34A"],
		ctaBackground: "#000000",
		ctaBackgroundDisabled: "#999999",
		ctaLabel: "#FFFFFF",
		ctaLabelDisabled: "#FFFFFF",
		ctaSurface: "#FFFFFF",
	};

	it("light の全トークンが main のリテラルと一致する", () => {
		expect(Palettes.light).toEqual(LIGHT_SNAPSHOT);
	});

	it("dark は light と同じトークンを過不足なく持つ", () => {
		expect(Object.keys(Palettes.dark).sort()).toEqual(Object.keys(Palettes.light).sort());
	});

	it("dark の面と文字が反転している（白い面・黒い文字が残っていない）", () => {
		expect(Palettes.dark.background).not.toBe(Palettes.light.background);
		expect(Palettes.dark.surface).not.toBe(Palettes.light.surface);
		expect(Palettes.dark.textPrimary).not.toBe(Palettes.light.textPrimary);
		// ブランド色は暗面でも AA を満たすため据え置く（#1509 設計判断）
		expect(Palettes.dark.brand).toBe(Palettes.light.brand);
	});
});

describe("THEME_PREFERENCES", () => {
	it("設定画面が並べる順は システム追従 → ライト → ダーク", () => {
		const expected: ThemePreference[] = ["system", "light", "dark"];
		expect([...(require("./ThemeProvider").THEME_PREFERENCES as ThemePreference[])]).toEqual(expected);
	});
});

/*
#1629【27】アプリ内の 3 択を «ネイティブ部品» にも効かせる。

RN の Switch・キーボード・日付ピッカー・Alert などは **OS が描く**ので、
JS 側をいくら直しても `OS = ライト / アプリ設定 = ダーク` でそこだけ白いまま残る。
`Appearance.setColorScheme` はアプリ単位の外観を上書きする JS の API で、
ネイティブ差分を生まないため OTA で配れる。

ここで固定するのは «呼び方» である。**system のときに null を渡す**ことが要で、
渡し忘れると「一度 dark にした端末がシステム追従へ戻しても暗いまま」になる。
*/
describe("#1629 ネイティブ部品への反映（Appearance.setColorScheme）", () => {
	const setColorScheme = jest.spyOn(Appearance, "setColorScheme").mockImplementation(() => {});

	beforeEach(() => setColorScheme.mockClear());

	it("dark を選ぶと dark で上書きする", async () => {
		mockedAsyncStorage.getItem.mockResolvedValue("dark");
		await renderWithProvider();
		expect(setColorScheme).toHaveBeenCalledWith("dark");
	});

	it("light を選ぶと light で上書きする", async () => {
		mockedAsyncStorage.getItem.mockResolvedValue("light");
		await renderWithProvider();
		expect(setColorScheme).toHaveBeenCalledWith("light");
	});

	it("**system では null を渡して上書きを外す**（これを忘れると暗いまま戻らない）", async () => {
		mockedAsyncStorage.getItem.mockResolvedValue("system");
		await renderWithProvider();
		expect(setColorScheme).toHaveBeenCalledWith(null);
	});

	/*
	⚠️ **react-native-web は `setColorScheme` を実装していない。**

	無条件に呼ぶと `TypeError: setColorScheme is not a function` が
	ThemeProvider（＝ アプリ全体の親）で投げられ、**web が真っ白になって何も描かれない**。
	preview デプロイで実測し、起動・直リンクの smoke が全滅した。
	*/
	it("setColorScheme が無い環境（react-native-web）でも落ちず、テーマは効く", async () => {
		const original = Appearance.setColorScheme;
		// web の Appearance には存在しないことを再現する
		delete (Appearance as { setColorScheme?: unknown }).setColorScheme;
		try {
			mockedAsyncStorage.getItem.mockResolvedValue("dark");
			const { seen } = await renderWithProvider();
			// 落ちないだけでなく、JS 側のテーマはちゃんと dark になっていること
			expect(seen.current?.scheme).toBe("dark");
		} finally {
			Appearance.setColorScheme = original;
		}
	});

	it("設定を読み終わる前には触らない（起動直後にライトへ振れるのを防ぐ）", async () => {
		// getItem を解決させないまま描画する
		mockedAsyncStorage.getItem.mockReturnValue(new Promise(() => {}));
		const { Probe } = captureTheme();
		act(() => {
			TestRenderer.create(
				<ThemeProvider>
					<Probe />
				</ThemeProvider>,
			);
		});
		expect(setColorScheme).not.toHaveBeenCalled();
	});
});
