import { act } from "react";
import TestRenderer from "react-test-renderer";
import { useProfile } from "./useProfile";

/**
 * #1233 プロフィール作成の check-then-insert 競合のテスト。
 *
 * `createUserProfile` はサインイン直後に複数箇所（auth/callback.tsx /
 * useEnsureOwnProfileLoaded.ts）から並走して呼ばれる。「SELECT で無いことを確認 → INSERT」の
 * 間に別の呼び出しが割り込むと後発が users_pkey で落ち、**その回のアバター反映が
 * catch へ落ちて丸ごとスキップ**されていた（レコード自体は先着が作っているので気付きにくい）。
 *
 * ここでは
 * 1. 衝突しても throw しない（= user_profile_creation_error を出さない）
 * 2. 衝突してもアバターのアップロードと v1/users/me への反映は続行する
 * 3. 衝突「以外」の INSERT エラーは従来どおり error で記録する（握り潰しの横漏れ防止）
 * を固定する。3 が無いと「INSERT のエラーを全部無視する」修正に退化しても赤くならない。
 */

const mockSingle = jest.fn();
const mockInsert = jest.fn();
const mockCallBackend = jest.fn();
const mockUploadFile = jest.fn();
const mockGetSession = jest.fn();
const mockLogFrontendEvent = jest.fn();

// ⚠️ モック変数の参照は必ずクロージャの中に置くこと。factory の実行時に触ると
//    （例: `insert: mockInsert`）const の初期化前に評価されて TDZ で落ちる
jest.mock("@/lib/supabase", () => ({
	supabase: {
		from: () => ({
			select: () => ({ eq: () => ({ single: () => mockSingle() }) }),
			insert: (payload: unknown) => mockInsert(payload),
		}),
	},
}));
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: mockLogFrontendEvent }) }));
jest.mock("@/hooks/useFileUploader", () => ({ useFileUploader: () => ({ uploadFile: mockUploadFile }) }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP" }) }));
jest.mock("@/contexts/AuthProvider", () => ({ useAuth: () => ({ getSession: mockGetSession }) }));

const USER_ID = "11111111-1111-1111-1111-111111111111";
const AVATAR_URI = "https://example.com/avatar.jpg";
const UPLOADED_AVATAR_PATH = "uploads/tmp/user-uploads/user-1/image-jpeg/avatar.jpg";

/** 先着の INSERT が通った直後に後発が受け取るエラー（実ログと同じ形） */
const uniqueViolation = {
	code: "23505",
	message: 'duplicate key value violates unique constraint "users_pkey"',
};

/** 衝突ではない INSERT エラー。これは握り潰してはいけない */
const rlsViolation = {
	code: "42501",
	message: 'new row violates row-level security policy for table "users"',
};

type CreateUserProfile = ReturnType<typeof useProfile>["createUserProfile"];

/** フックを 1 回だけレンダリングして createUserProfile を取り出す */
const renderCreateUserProfile = (): CreateUserProfile => {
	let createUserProfile: CreateUserProfile | undefined;
	const Probe = () => {
		createUserProfile = useProfile().createUserProfile;
		return null;
	};
	act(() => {
		TestRenderer.create(<Probe />);
	});
	return createUserProfile!;
};

/** 指定イベント名で記録されたログを取り出す */
const loggedEvents = (eventName: string) =>
	mockLogFrontendEvent.mock.calls.map(([event]) => event).filter((event) => event.event_name === eventName);

describe("#1233 createUserProfile は並走した同時作成を正常系として扱う", () => {
	beforeEach(() => {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

		mockGetSession.mockReturnValue({ user: { id: USER_ID } });
		// PGRST116 = 0 rows。「まだ存在しない」と見えている状態＝競合が起きうる状態
		mockSingle.mockResolvedValue({ data: null, error: { code: "PGRST116" } });
		mockInsert.mockResolvedValue({ error: null });
		mockUploadFile.mockResolvedValue(UPLOADED_AVATAR_PATH);
		mockCallBackend.mockResolvedValue(undefined);

		globalThis.fetch = jest.fn(async () => ({
			ok: true,
			blob: async () => ({ type: "image/jpeg" }),
			headers: { get: () => "image/jpeg" },
		})) as unknown as typeof fetch;
	});

	describe("先着の INSERT と衝突したとき", () => {
		beforeEach(() => {
			mockInsert.mockResolvedValue({ error: uniqueViolation });
			// #1599 users_pkey で 23505 が返るのは、先着の行が **commit 済み**のときだけ
			// （未 commit なら INSERT は待たされる）。PostgREST は 1 リクエスト 1
			// トランザクションなので、衝突した後の再確認では必ずその行が見える。
			// 先読みの SELECT は «まだ無い»、衝突後の再確認は «ある» が実際の並びになる。
			mockSingle
				.mockResolvedValueOnce({ data: null, error: { code: "PGRST116" } })
				.mockResolvedValue({ data: USER_ID, error: null });
		});

		it("throw もエラーログもせずに完了する", async () => {
			const createUserProfile = renderCreateUserProfile();

			await expect(createUserProfile({ displayName: "Ayato", avatar: AVATAR_URI })).resolves.toBeUndefined();
			expect(loggedEvents("user_profile_creation_error")).toHaveLength(0);
		});

		it("アバターのアップロードと v1/users/me への反映を続行する", async () => {
			// ここが Issue の実害。衝突で throw していた頃は両方ともスキップされていた
			const createUserProfile = renderCreateUserProfile();
			await createUserProfile({ displayName: "Ayato", avatar: AVATAR_URI });

			expect(mockUploadFile).toHaveBeenCalledWith(AVATAR_URI, {
				mimeType: "image/jpeg",
				baseFileName: "user-avatar",
			});
			expect(mockCallBackend).toHaveBeenCalledWith("v1/users/me", {
				method: "POST",
				requestPayload: { avatar_path: UPLOADED_AVATAR_PATH },
			});
		});

		it("既存プロフィールの display_name は上書きしない", async () => {
			// 先着が引数なしの useEnsureOwnProfileLoaded だと行の display_name は "nickname"。
			// 逆に先着が名前を持っていた場合、後発が上書きすると名前を潰す方向にしか働かない。
			// どちらが先着かは呼び出し側から観測できないので、名前は触らないと決めている
			const createUserProfile = renderCreateUserProfile();
			await createUserProfile({ displayName: "Ayato", avatar: AVATAR_URI });

			const [, options] = mockCallBackend.mock.calls[0];
			expect(options.requestPayload).toEqual({ avatar_path: UPLOADED_AVATAR_PATH });
			expect(options.requestPayload).not.toHaveProperty("display_name");
		});

		it("作成していないので user_profile_created は出さず、衝突を warn で残す", async () => {
			const createUserProfile = renderCreateUserProfile();
			await createUserProfile({ displayName: "Ayato" });

			expect(loggedEvents("user_profile_created")).toHaveLength(0);
			const conflicts = loggedEvents("user_profile_create_conflict");
			expect(conflicts).toHaveLength(1);
			expect(conflicts[0].error_level).toBe("warn");
			expect(conflicts[0].payload.user_id).toBe(USER_ID);
		});
	});

	describe("衝突以外のエラー", () => {
		it("INSERT の失敗は従来どおり user_profile_creation_error を error で出す", async () => {
			// 衝突を通すために INSERT のエラーを一律で無視する実装に退化すると、ここが赤くなる
			mockInsert.mockResolvedValue({ error: rlsViolation });
			const createUserProfile = renderCreateUserProfile();

			await createUserProfile({ displayName: "Ayato", avatar: AVATAR_URI });

			const errors = loggedEvents("user_profile_creation_error");
			expect(errors).toHaveLength(1);
			expect(errors[0].error_level).toBe("error");
			expect(errors[0].payload.error).toBe(rlsViolation.message);
			// 行が作られていない以上、アバターの反映先も無い
			expect(mockUploadFile).not.toHaveBeenCalled();
			expect(mockCallBackend).not.toHaveBeenCalled();
		});

		it("SELECT の失敗（PGRST116 以外）も従来どおり error で出す", async () => {
			mockSingle.mockResolvedValue({ data: null, error: { code: "PGRST301", message: "JWT expired" } });
			const createUserProfile = renderCreateUserProfile();

			await createUserProfile({});

			expect(mockInsert).not.toHaveBeenCalled();
			expect(loggedEvents("user_profile_creation_error")).toHaveLength(1);
		});
	});

	describe("競合していない通常の経路", () => {
		it("INSERT が通れば user_profile_created を log で出す", async () => {
			const createUserProfile = renderCreateUserProfile();
			await createUserProfile({ displayName: "Ayato" });

			const created = loggedEvents("user_profile_created");
			expect(created).toHaveLength(1);
			expect(created[0].error_level).toBe("log");
			expect(loggedEvents("user_profile_create_conflict")).toHaveLength(0);
			expect(mockInsert).toHaveBeenCalledWith(
				expect.objectContaining({ id: USER_ID, display_name: "Ayato", preferred_locale: "ja-JP" }),
			);
		});

		it("SELECT で既存プロフィールが見つかれば INSERT しない", async () => {
			mockSingle.mockResolvedValue({ data: { id: USER_ID }, error: null });
			const createUserProfile = renderCreateUserProfile();

			await createUserProfile({ displayName: "Ayato", avatar: AVATAR_URI });

			expect(mockInsert).not.toHaveBeenCalled();
			expect(mockUploadFile).not.toHaveBeenCalled();
		});
	});
});

/**
 * #1599 23505 は users_pkey とは限らない。
 *
 * `users` には UNIQUE が 2 本ある（`users_pkey` = id / `uq_users_username` = username）。
 * PostgREST はどちらでも `code: "23505"` を返すので、コードだけで #1233 の正常系
 * （別の呼び出しが一足先に自分の行を作った）と決めつけると、
 * **別ユーザーと username がぶつかっただけ**のときにも INSERT を諦めてしまう。
 *
 * その人は users 行が無いまま先へ進み、useEnsureOwnProfileLoaded の再取得が 404 →
 * 「プロフィールを読み込めません」に落ちる。サインアップ直後の画面で起きる。
 *
 * 2 つは「自分の行ができているか」で見分けられることを、ここで固定する。
 */
const usernameViolation = {
	code: "23505",
	message: 'duplicate key value violates unique constraint "uq_users_username"',
};

describe("#1599 createUserProfile は id 衝突と username 衝突を見分ける", () => {
	beforeEach(() => {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		jest.clearAllMocks();
		mockGetSession.mockReturnValue({ user: { id: USER_ID } });
		mockSingle.mockResolvedValue({ data: null, error: { code: "PGRST116" } });
		mockInsert.mockResolvedValue({ error: null });
		mockUploadFile.mockResolvedValue(UPLOADED_AVATAR_PATH);
		mockCallBackend.mockResolvedValue(undefined);
	});

	it("username 衝突（行がまだ無い）なら、名前を採り直して入れ直す", async () => {
		// 1 回目の INSERT は username でぶつかる。行はまだ無い（PGRST116 のまま）。
		mockInsert.mockResolvedValueOnce({ error: usernameViolation }).mockResolvedValueOnce({ error: null });

		const createUserProfile = renderCreateUserProfile();
		await act(async () => {
			await createUserProfile({});
		});

		expect(mockInsert).toHaveBeenCalledTimes(2);
		const first = mockInsert.mock.calls[0][0] as { username: string; id: string };
		const second = mockInsert.mock.calls[1][0] as { username: string; id: string };
		// 採り直した名前は別物でなければ、入れ直しても同じところでぶつかる
		expect(second.username).not.toBe(first.username);
		expect(second.id).toBe(USER_ID);

		// 諦めていない = 「先着が作った」という誤った警告を出さない
		expect(loggedEvents("user_profile_create_conflict")).toHaveLength(0);
		expect(loggedEvents("user_profile_creation_error")).toHaveLength(0);
		expect(loggedEvents("user_profile_username_conflict")).toHaveLength(1);
		// 入れ直して作れているので created は出る
		expect(loggedEvents("user_profile_created")).toHaveLength(1);
	});

	it("id 衝突（行ができている）なら #1233 どおり諦めて先へ進む", async () => {
		mockInsert.mockResolvedValueOnce({ error: uniqueViolation });
		// 先読みの SELECT は 0 行、衝突後の再確認では自分の行が見える
		mockSingle
			.mockResolvedValueOnce({ data: null, error: { code: "PGRST116" } })
			.mockResolvedValueOnce({ data: USER_ID, error: null });

		const createUserProfile = renderCreateUserProfile();
		await act(async () => {
			await createUserProfile({});
		});

		// 採り直して入れ直さない（先着が作っているので何度やっても同じ）
		expect(mockInsert).toHaveBeenCalledTimes(1);
		expect(loggedEvents("user_profile_create_conflict")).toHaveLength(1);
		expect(loggedEvents("user_profile_username_conflict")).toHaveLength(0);
		// 「作った」は 1 人 1 行に対して 2 件出さない
		expect(loggedEvents("user_profile_created")).toHaveLength(0);
		expect(loggedEvents("user_profile_creation_error")).toHaveLength(0);
	});

	it("採り直しても通らないときは握り潰さず error として残す", async () => {
		mockInsert.mockResolvedValue({ error: usernameViolation });

		const createUserProfile = renderCreateUserProfile();
		await act(async () => {
			await createUserProfile({});
		});

		// 無限に粘らない
		expect(mockInsert).toHaveBeenCalledTimes(3);
		expect(loggedEvents("user_profile_creation_error")).toHaveLength(1);
		// 作れていないのに created を出さない
		expect(loggedEvents("user_profile_created")).toHaveLength(0);
	});

	it("衝突以外の INSERT エラーは採り直さず、そのまま error にする", async () => {
		mockInsert.mockResolvedValue({ error: rlsViolation });

		const createUserProfile = renderCreateUserProfile();
		await act(async () => {
			await createUserProfile({});
		});

		expect(mockInsert).toHaveBeenCalledTimes(1);
		expect(loggedEvents("user_profile_creation_error")).toHaveLength(1);
	});
});
