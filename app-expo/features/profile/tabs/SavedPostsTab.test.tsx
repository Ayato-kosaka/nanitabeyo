/**
 * #1366 `SavedPostsTab` の «非公開表示 / 自分のプロフィール» の出し分けを固定する。
 *
 * 元のコードは `if (!isOwnProfile) return <非公開>;` という早期 return の **後ろ**に
 * 15 個のフックを並べていた（rules-of-hooks が 15 件 error にしていた形）。
 * React 19 の実挙動を測った限り、この形«そのもの»が今すぐ throw するわけではない。
 * 詳細は SavedPostsTab.tsx のコメントにあるが、要点は
 * 「フック 0 本のレンダーとの往復では throw しない代わりに effect の cleanup が捨てられる」
 * 「早期 return の前にフックが 1 本でも入った瞬間に throw する」の 2 つである。
 *
 * したがってこのテストが守るのは «クラッシュしないこと» ではなく、**直し方**である。
 * lint を通すだけならフックを早期 return の前へ移せばよいが、それをやると
 * 他人のプロフィールを開いただけで自分の保存投稿を fetch する（`useEffect` が走る）。
 * 1 つ目のケースがその «誤った直し方» を落とす。
 * 2・3 つ目は、出し分けを外側／内側に割った後もどちらの向きの切り替えでも
 * 期待どおりに描画されることを押さえる。
 */
import React, { act } from "react";
import TestRenderer from "react-test-renderer";

const mockFetchInitialByKey = jest.fn();
const mockFetchMoreByKey = jest.fn();
/** 本体（内側）がマウントされたときだけ書き込まれる。null なら一度も描画されていない */
const mockRenderedGrid: { props: { testID?: string } | null } = { props: null };

jest.mock("@/components/collapsible-tabs/GridList", () => ({
	GridList: (props: { testID?: string }) => {
		mockRenderedGrid.props = props;
		return null;
	},
}));
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn() }) }));
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: jest.fn() }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));

// 保存投稿の «取得» が走ったかどうかが、内側のフックが実際に動いたかの目印になる。
// そのため hasFetchedInitial は false（＝ useEffect が fetch を呼ぶ状態）にしてある。
jest.mock("@/stores/useDishMediaEntriesStore", () => {
	const storeState = {
		fetchInitialByKey: (...args: unknown[]) => mockFetchInitialByKey(...args),
		fetchMoreByKey: (...args: unknown[]) => mockFetchMoreByKey(...args),
	};
	const useDishMediaEntriesStore = (selector: (state: unknown) => unknown) => selector(storeState);
	useDishMediaEntriesStore.getState = () => storeState;
	return {
		useDishMediaEntriesStore,
		selectIdsByKey: () => () => ({
			ids: [],
			isLoading: false,
			isLoadingMore: false,
			error: null,
			hasFetchedInitial: false,
		}),
		selectEntryByMediaId: () => () => undefined,
	};
});

import { SavedPostsTab } from "./SavedPostsTab";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** レンダー結果を JSON 化した文字列。i18n はキーをそのまま返すのでキーで検索できる */
const renderedText = (renderer: TestRenderer.ReactTestRenderer) => JSON.stringify(renderer.toJSON());

describe("SavedPostsTab", () => {
	beforeEach(() => {
		mockRenderedGrid.props = null;
	});

	it("他人のプロフィールでは非公開表示になり、保存投稿の取得も走らない", () => {
		let renderer!: TestRenderer.ReactTestRenderer;
		act(() => {
			renderer = TestRenderer.create(<SavedPostsTab isOwnProfile={false} />);
		});

		expect(renderedText(renderer)).toContain("Profile.privateContent");
		// 本体が一度も描画されておらず、内側のフックも動いていない
		// ＝ 他人のプロフィールで自分の保存投稿を取りに行っていない
		expect(mockRenderedGrid.props).toBeNull();
		expect(mockFetchInitialByKey).not.toHaveBeenCalled();

		act(() => renderer.unmount());
	});

	it("非公開表示から自分のプロフィールへ切り替えると本体がマウントされ、初回取得が走る", () => {
		let renderer!: TestRenderer.ReactTestRenderer;
		act(() => {
			renderer = TestRenderer.create(<SavedPostsTab isOwnProfile={false} />);
		});

		act(() => {
			renderer.update(<SavedPostsTab isOwnProfile />);
		});

		expect(mockRenderedGrid.props?.testID).toBe("save-post-tab-grid");
		expect(renderedText(renderer)).not.toContain("Profile.privateContent");
		// 切り替わった後は内側がマウントされ、初回取得が走る
		expect(mockFetchInitialByKey).toHaveBeenCalledTimes(1);
		expect(mockFetchInitialByKey.mock.calls[0][0]).toBe("profileSavedPosts");

		act(() => renderer.unmount());
	});

	it("自分のプロフィールから非公開へ切り替えると非公開表示へ戻る", () => {
		let renderer!: TestRenderer.ReactTestRenderer;
		act(() => {
			renderer = TestRenderer.create(<SavedPostsTab isOwnProfile />);
		});
		act(() => {
			renderer.update(<SavedPostsTab isOwnProfile={false} />);
		});

		expect(renderedText(renderer)).toContain("Profile.privateContent");

		act(() => renderer.unmount());
	});
});
