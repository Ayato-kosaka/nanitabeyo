// #1092 PR3 AsyncStorage の native モジュールは jest では null なので、import した時点で
// 「NativeModule: AsyncStorage is null」で suite ごと落ちる。
// `lib/remoteConfig.ts` が Remote Config の永続キャッシュ（stale-while-revalidate）で
// AsyncStorage を読むようになったため、パッケージ公式のインメモリ実装へ差し替えておく。
//
// ⚠️ 各 suite で個別に jest.mock するのではなく、ここで一括して差し替える。
//    AsyncStorage は supabase / logQueue など芋づるで読み込まれる位置に居るので、
//    「テストを書き足したら関係ない依存で落ちた」を毎回踏まないようにするため。
//
// 状態（__INTERNAL_MOCK_STORAGE__）は suite 内で共有される。中身に依存するテストは
// beforeEach で `AsyncStorage.clear()` すること。
jest.mock("@react-native-async-storage/async-storage", () =>
	require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
