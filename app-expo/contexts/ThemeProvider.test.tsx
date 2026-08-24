import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text } from "react-native";
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
		brand: "#F05537",
		brandTint: "#FDEBE7",
		brandTintSoft: "#FFF7F5",
		danger: "#DC2626",
		dangerStrong: "#EF4444",
		dangerTint: "#FEE2E2",
		destructive: "#FF3E33",
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
