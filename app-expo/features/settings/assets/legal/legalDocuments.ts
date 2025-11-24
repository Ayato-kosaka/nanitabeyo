// #設定画面 【設計】Legal ドキュメントの内容を文字列として export
// Metro bundler は .md ファイルを直接文字列として読み込めないため、
// 各ドキュメントの内容をここに定義する（実際のファイルから手動でコピー）

import { copyrightEnUs } from "./en-US/copyright";
import { guidelinesEnUs } from "./en-US/guidelines";
import { privacyEnUS } from "./en-US/privacy";
import { termsEnUs } from "./en-US/terms";
import { copyrightJaJp } from "./ja-JP/copyright";
import { guidelinesJaJp } from "./ja-JP/guidelines";
import { privacyJaJp } from "./ja-JP/privacy";
import { termsJaJp } from "./ja-JP/terms";

export const legalDocuments = {
	"ja-JP": {
		guidelines: guidelinesJaJp,
		terms: termsJaJp,
		privacy: privacyJaJp,
		copyright: copyrightJaJp,
	},
	"en-US": {
		guidelines: guidelinesEnUs,
		privacy: privacyEnUS,
		terms: termsEnUs,
		copyright: copyrightEnUs,
	},
};
