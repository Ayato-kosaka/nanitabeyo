import * as path from "node:path";

import * as dotenv from "dotenv";

import { ensureFreshSession } from "./freshSession";
import { fetchDishCategoryIds } from "./savedDishCategory";

/**
 * 🔔🗳 「ホストに投票完了通知が 1 件届いている」という前提を **テスト自身が作る**（#1506 GRP-04）
 *
 * ## なぜ Node 側から API を叩くのか
 * 検証したいのは「ホストの通知一覧に投票通知が出て、押すと投票結果画面へ行く」だが、
 * その通知が生まれるには **ホストとは別のユーザーが投票を完了する**必要がある。
 * Detox にはネットワークを差し替える仕組みが無い（`page.route()` 相当が無い。
 * tests/authenticated/dish-category-group-vote-completion-identity.test.ts に既述）ので、
 * 通知一覧をモックして固定することはできない。
 *
 * 一方このワークスペースには「前提を API で作ってから端末を起動する」という先例がある
 * （utils/shareLink.ts が共有リンクを、utils/savedDishCategory.ts が保存済みカテゴリを作る）。
 * ここでも同じ方式を採り、**2 人ぶんの実セッションで実 API を叩いて**前提を用意する:
 *
 * 1. ホスト = `authenticated`（テストユーザー）が投票セッションを作る
 * 2. 参加者 = `anon`（匿名ユーザー。**ホストとは別の user_id**）がそのセッションへ投票する
 * 3. サーバが Cloud Tasks へ通知ジョブを enqueue し、ホスト宛の通知行ができる
 *
 * ホスト自身が投票しても通知は出ない（NotificationJobService が自己通知を skip する）ため、
 * 「別ユーザーであること」がこの設計の肝である。匿名セッションは globalSetup が run 全体で
 * 1 つだけ確立したものを使い回すので、匿名サインインのクォータ（30 回/時/IP）は消費しない。
 *
 * ## ⚠️ dev DB への影響（不可逆）
 * この関数は dev DB へ **投票セッション 1 件 + 参加者 1 件 + 投票 1 件 + 通知 1 件**を追加する。
 * 削除導線は無い（tests/mutation/dish-categories-group-vote-double-tap.test.ts と同じ性質）。
 * 呼び出し側は必ず `describeMutation` の下に置くこと。
 *
 * ## セキュリティ
 * トークンはログへ出さない（このモジュールが出力するのは成否と id だけ）。
 */

/** 作った前提の識別に使う値。dev DB を人が覗いたとき E2E 由来と分かるようにする */
const E2E_MARKER = "E2E1506";

/**
 * 投票セッションの検索条件スナップショット。
 *
 * 中身は候補の再検索（「店を見る」）にしか使われず、この spec は結果画面を開くだけなので
 * 当たり外れの無い都心の座標を固定で置く（utils/shareLink.ts の SEARCH_LOCATION と同じ東京駅）。
 */
const SEARCH_CONTEXT = {
	location: { latitude: 35.681236, longitude: 139.767125 },
	radius: 5000,
	priceLevels: [] as string[],
	localLanguageCode: "ja",
};

/** 種まきの結果。spec 側はこれを使って遷移先を検証する */
export type SeededGroupVoteNotification = {
	/** 投票セッションの内部 id */
	sessionId: string;
	/** 通知タップ後に開く結果画面の route param */
	shareToken: string;
};

/** 環境変数から API のベース URL を読む（utils/shareLink.ts と同じ手順） */
function apiBase(): string {
	dotenv.config({ path: path.resolve(__dirname, "../../app-expo/.env") });
	dotenv.config({ path: path.resolve(__dirname, "../.env") });

	const base = process.env.EXPO_PUBLIC_BACKEND_BASE_URL;
	if (!base) {
		throw new Error(
			[
				"EXPO_PUBLIC_BACKEND_BASE_URL が未設定です。",
				"  ローカルでは `cd app-expo && pnpx eas-cli env:pull development --path .env` を実行してください。",
			].join("\n"),
		);
	}
	return base.replace(/\/+$/, "");
}

/** 指定したセッションの Authorization ヘッダを組み立てる */
function authHeaders(accessToken: string): Record<string, string> {
	return { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
}

/**
 * ホスト（テストユーザー）として投票セッションを 1 件作る。
 *
 * 候補は 1 件だけにする。参加者側は API を直接叩くので UI の 3〜6 件制約に縛られず、
 * 候補が少ないほど投票 API へ渡す配列も短くて済む。
 * `dishCategoryId` は実在する必要があるため推薦 API から取る（savedDishCategory.ts の解説参照）。
 */
async function createSessionAsHost(base: string, hostAccessToken: string): Promise<SeededGroupVoteNotification> {
	const [dishCategoryId] = await fetchDishCategoryIds(hostAccessToken, 1);

	const response = await fetch(`${base}/v1/dish-category-group-votes`, {
		method: "POST",
		headers: authHeaders(hostAccessToken),
		body: JSON.stringify({
			searchContext: SEARCH_CONTEXT,
			candidates: [
				{
					dishCategoryId,
					displayName: `${E2E_MARKER} 候補`,
					tagline: `${E2E_MARKER}`,
					imageUrl: "https://example.invalid/e2e-1506.jpg",
				},
			],
		}),
		signal: AbortSignal.timeout(60_000),
	});

	if (!response.ok) {
		throw new Error(
			`投票セッションの作成に失敗しました（status=${response.status}）。API（${base}）が起きているか確認してください。`,
		);
	}

	const body = (await response.json()) as { data?: { id?: string; shareToken?: string } };
	const sessionId = body.data?.id;
	const shareToken = body.data?.shareToken;
	if (!sessionId || !shareToken) {
		throw new Error("投票セッションの作成レスポンスに id / shareToken がありません。");
	}

	return { sessionId, shareToken };
}

/**
 * 参加者（匿名ユーザー）としてそのセッションへ投票する。
 *
 * 投票対象の候補 id は detail API から取る。作成レスポンスは id と shareToken しか返さないため。
 * この POST がホストへの通知 enqueue の起点そのものである。
 */
async function submitVoteAsParticipant(base: string, participantAccessToken: string, shareToken: string): Promise<void> {
	const detailResponse = await fetch(`${base}/v1/dish-category-group-votes/${shareToken}`, {
		method: "GET",
		headers: authHeaders(participantAccessToken),
		signal: AbortSignal.timeout(60_000),
	});
	if (!detailResponse.ok) {
		throw new Error(`投票セッションの取得に失敗しました（status=${detailResponse.status}）。`);
	}

	const detail = (await detailResponse.json()) as {
		data?: { session?: { id?: string }; candidates?: { id?: string }[] };
	};
	const sessionId = detail.data?.session?.id;
	const candidateIds = (detail.data?.candidates ?? []).map((candidate) => candidate.id).filter(Boolean) as string[];
	if (!sessionId || candidateIds.length === 0) {
		throw new Error("投票セッションの詳細に sessionId / 候補がありません（作成直後の取得に失敗している）。");
	}

	const voteResponse = await fetch(`${base}/v1/dish-category-group-votes/${sessionId}/vote`, {
		method: "POST",
		headers: authHeaders(participantAccessToken),
		body: JSON.stringify({
			displayName: E2E_MARKER,
			votes: candidateIds.map((candidateId) => ({ candidateId, reaction: "like" })),
		}),
		signal: AbortSignal.timeout(60_000),
	});

	// 409 は「既に投票済み」。同じ匿名ユーザーで再実行したときに起きるが、
	// **通知は最初の投票で既に作られている**ので前提としては満たされている
	if (!voteResponse.ok && voteResponse.status !== 409) {
		throw new Error(`投票の送信に失敗しました（status=${voteResponse.status}）。`);
	}
}

/**
 * 「テストユーザーがホストの投票セッションに、別ユーザーが投票を完了した」状態を作る。
 *
 * @returns 作ったセッションの id と shareToken
 * @失敗時 日本語メッセージで例外を投げる（fail-loud）。前提が作れないまま本体を走らせても
 *         「通知が 0 件」という分かりにくい失敗になるだけなので、ここで止める
 */
export async function seedGroupVoteNotification(): Promise<SeededGroupVoteNotification> {
	// ⚠️ 鮮度保証つきで読むこと（run が長いと access token が切れて 401 になる。utils/freshSession.ts）
	const host = await ensureFreshSession("authenticated");
	if (!host) {
		throw new Error(
			"認証済みセッションが確立されていません。TEST_USER_EMAIL / TEST_USER_PASSWORD を設定してください（describeAuthenticated で skip されるはずの経路です）。",
		);
	}
	const participant = await ensureFreshSession("anon");
	if (!participant) {
		throw new Error("匿名セッションが確立されていません（fixtures/globalSetup.ts を確認してください）。");
	}
	if (participant.userId === host.userId) {
		// #1506 自己通知は NotificationJobService が skip するため、同一ユーザーでは前提が作れない
		throw new Error(
			"参加者とホストが同一ユーザーです。自己通知は skip されるため投票完了通知が作られません（セッションの確立方法を確認してください）。",
		);
	}

	const base = apiBase();
	const seeded = await createSessionAsHost(base, host.accessToken);
	await submitVoteAsParticipant(base, participant.accessToken, seeded.shareToken);

	return seeded;
}
