// #1120 【設計】投票完了モーダルが「ログイン判定が確定する前にゲスト向け UI を描かない」ことを固定するテスト。
//
// 背景（Issue #1120）:
// このモーダルは BlurModal が open した瞬間に初めてマウントされるため、
// `useEnsureOwnProfileLoaded()` のプロフィール取得もそこから始まる。旧実装は
// `profile?.display_name ?? ""` だけを見て分岐していたので、ログイン済みユーザーでも
//   1. profile === null の間 → ゲスト向けの絵文字候補が描かれる
//   2. profile 到着 → nickname が初期入力され、候補が消える
// という「一瞬だけ絵文字が出る」ちらつきになっていた。
//
// 固定する不変条件:
//   ログイン状態（および nickname）が未確定の間は、ゲスト向けの絵文字候補を一度も描画しない。
//
// 遅延（setTimeout / opacity）で隠す実装に差し替えると、下の「未確定の間に一度も描かれない」
// アサーションは通らない（未確定の時点で要素はツリーに存在してしまうため）。
import React, { act } from "react";
import { TextInput } from "react-native";
import TestRenderer, { type ReactTestRenderer } from "react-test-renderer";

// ---- 観測対象（ログイン状態の分岐）以外はすべてスタブ化する ----
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/components/LoadingIndicator", () => ({ LoadingIndicator: () => null }));
jest.mock("@/components/PrimaryButton", () => ({ PrimaryButton: () => null }));

/** useAuth() の戻り値。各テストが describe 内で書き換える */
let mockAuthState: { user: { is_anonymous?: boolean } | null; isAuthResolved: boolean };
jest.mock("@/contexts/AuthProvider", () => ({ useAuth: () => mockAuthState }));

/** useEnsureOwnProfileLoaded() の戻り値（プロフィール取得が決着したか） */
let mockIsProfileResolved: boolean;
jest.mock("@/features/profile/hooks/useEnsureOwnProfileLoaded", () => ({
	useEnsureOwnProfileLoaded: () => ({ isProfileResolved: mockIsProfileResolved }),
}));

/** ストアに載っているプロフィール（未ロード時は null） */
let mockProfile: { display_name: string } | null;
jest.mock("@/features/profile/stores/useProfileStore", () => ({
	useProfileStore: (selector: (state: { profile: unknown }) => unknown) => selector({ profile: mockProfile }),
}));

import { DishCategoryGroupVoteCompletionModal } from "./DishCategoryGroupVoteCompletionModal";

// React 19 では初期描画がスケジューラのタスクへ回されるため、act() で包む必要がある
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SUGGESTIONS_TEST_ID = "dish-category-group-vote-name-suggestions";
const LOADING_TEST_ID = "dish-category-group-vote-completion-loading";

const renderModal = () => {
	let renderer!: ReactTestRenderer;
	act(() => {
		renderer = TestRenderer.create(
			<DishCategoryGroupVoteCompletionModal usedDisplayNames={["🐶"]} isSubmitting={false} onSubmit={jest.fn()} />,
		);
	});
	return renderer;
};

/** 絵文字候補（ゲスト向け UI）が今ツリーに存在するか */
const hasNameSuggestions = (renderer: ReactTestRenderer) =>
	renderer.root.findAllByProps({ testID: SUGGESTIONS_TEST_ID }).length > 0;

/** ログイン判定の確定待ちローディングが出ているか */
const hasIdentityLoading = (renderer: ReactTestRenderer) =>
	renderer.root.findAllByProps({ testID: LOADING_TEST_ID }).length > 0;

/** 表示名入力欄の現在値 */
const displayNameValue = (renderer: ReactTestRenderer) => renderer.root.findAllByType(TextInput)[0]?.props.value;

beforeEach(() => {
	mockAuthState = { user: null, isAuthResolved: false };
	mockIsProfileResolved = false;
	mockProfile = null;
});

describe("DishCategoryGroupVoteCompletionModal のログイン判定", () => {
	it("認証がまだ確定していない間は、ゲスト向けの絵文字候補を描画しない", () => {
		// user === null は isGuestUser() ではゲストへ倒れる。それでも「未確定」であることを優先する
		mockAuthState = { user: null, isAuthResolved: false };

		const renderer = renderModal();

		expect(hasNameSuggestions(renderer)).toBe(false);
		expect(hasIdentityLoading(renderer)).toBe(true);
	});

	it("ログイン済みでプロフィール取得が終わっていない間は、ゲスト向けの絵文字候補を描画しない", () => {
		mockAuthState = { user: { is_anonymous: false }, isAuthResolved: true };
		mockIsProfileResolved = false;
		mockProfile = null;

		const renderer = renderModal();

		expect(hasNameSuggestions(renderer)).toBe(false);
		expect(hasIdentityLoading(renderer)).toBe(true);
	});

	it("ログイン済みユーザーには、絵文字候補を一度も描かずに nickname だけを見せる（#1120 のちらつき）", () => {
		// 実際の流れを再現する: マウント時は profile 未取得 → あとから display_name が届く
		mockAuthState = { user: { is_anonymous: false }, isAuthResolved: true };
		mockIsProfileResolved = false;
		mockProfile = null;

		const renderer = renderModal();
		expect(hasNameSuggestions(renderer)).toBe(false);

		act(() => {
			mockIsProfileResolved = true;
			mockProfile = { display_name: "ログイン太郎" };
			renderer.update(
				<DishCategoryGroupVoteCompletionModal usedDisplayNames={["🐶"]} isSubmitting={false} onSubmit={jest.fn()} />,
			);
		});

		// 確定後もゲスト向け候補は出ず、nickname が初期入力されている
		expect(hasNameSuggestions(renderer)).toBe(false);
		expect(hasIdentityLoading(renderer)).toBe(false);
		expect(displayNameValue(renderer)).toBe("ログイン太郎");
	});

	it("ゲスト確定なら、プロフィール取得を待たずに絵文字候補を出す", () => {
		// ゲストは display_name を参照しないため、プロフィールの決着を待つ理由がない
		mockAuthState = { user: { is_anonymous: true }, isAuthResolved: true };
		mockIsProfileResolved = false;
		mockProfile = null;

		const renderer = renderModal();

		expect(hasIdentityLoading(renderer)).toBe(false);
		expect(hasNameSuggestions(renderer)).toBe(true);
		expect(displayNameValue(renderer)).toBe("");
	});

	it("プロフィール取得が失敗して profile が null のままでも、ローディングで固まらない", () => {
		// 決着済み（= これ以上待っても display_name は来ない）なら、匿名と同じ入力導線へフォールバックする
		mockAuthState = { user: { is_anonymous: false }, isAuthResolved: true };
		mockIsProfileResolved = true;
		mockProfile = null;

		const renderer = renderModal();

		expect(hasIdentityLoading(renderer)).toBe(false);
		expect(hasNameSuggestions(renderer)).toBe(true);
	});
});
