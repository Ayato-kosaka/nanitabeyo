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
