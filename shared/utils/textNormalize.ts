/**
 * SNS の投稿テキストと、辞書側（`dish_category_variants.surface_form` / `restaurants.name`）を
 * **同じ土俵に乗せる**ための正規化と文字種判定。純粋関数だけで閉じている。
 *
 * #1399（親 #1375）SNS URL Import の「解くべき問い 3 / 4」で使う。
 * `shared/` に置くのは `snsUrl.ts` と同じ理由で、**判定を 2 か所に書くと必ずずれる**ため。
 *
 * ## この関数群がやらないこと（意図的な制約）
 *
 * - **DB を引かない / ネットワークを叩かない / LLM を使わない。** 辞書も候補も引数で受け取る。
 * - **外部ライブラリを使わない。** `jaconv` 相当のかな変換も Unicode の表から自前で書く。
 *   依存を足すと app-expo（React Native）側のバンドルにも影響するため。
 * - **形態素解析をしない。** 分かち書きは rule-based の範囲外（#1399 設計 §6-1）。
 *
 * ## 正規化の規則（辞書側と照合側の両方に、まったく同じ手順を当てる）
 *
 * 辞書側の `surface_form` は BigQuery の生成スクリプト
 * `scripts/20251213T0000_wikidata_food_graph/4_1_generate_variants.py` の `norm_key()` を通っている。
 * `normalizeMatchText()` は **その 3 手順と 1 対 1 に対応させてある**。片側だけ手順を足すと一致しなくなる。
 *
 * | # | 手順 | 内容 | 例 |
 * | --- | --- | --- | --- |
 * | 1 | NFKC 正規化 | 全角英数 → 半角、半角カナ → 全角、互換文字の展開 | `ＲＡＭＥＮ` → `RAMEN` / `ﾗｰﾒﾝ` → `ラーメン` |
 * | 2 | 空白圧縮 | 連続する空白（改行・タブ・U+3000 を含む）を半角スペース 1 個へ。前後は除去 | `" 味噌  ラーメン\n"` → `"味噌 ラーメン"` |
 * | 3 | 小文字化 | `toLowerCase()` | `Ramen` → `ramen` |
 *
 * ### 上の 3 手順に **含めていない**もの（含めない理由つき）
 *
 * | やらないこと | 理由 |
 * | --- | --- |
 * | カタカナ → ひらがな畳み込み | 辞書側に `source='kata2hira'` の行が**既に入っている**（`4_1_generate_variants.py` が ja ラベルから生成する）。照合側でも畳むと同じカテゴリに 2 系統の当たりが立ち、「複数箇所で当たった」加点が二重計上される。**店舗名照合（`restaurants.name`）は辞書側にかな異表記が無いので、そちらでだけ畳む**（`katakanaToHiragana`） |
 * | 記号・空白の除去 | 本文走査でこれをやるとオフセットが原文とずれ、「どこに当たったか」を返せなくなる。**完全一致（ハッシュタグ・店名）でだけ別キーとして併用する**（`stripMatchSymbols`） |
 * | ハッシュタグの `#` 剥がし | 正規化ではなくトークン抽出の仕事。`extractHashtags` が担う |
 */

/** 1 フィールドあたりに受け付ける最大文字数。これを超えたぶんは切り捨てる（例外は投げない） */
export const MATCH_TEXT_MAX_LENGTH = 4096;

/** 受け付けるフィールドの最大件数。超えたぶんは無視する */
export const MATCH_TEXT_MAX_FIELDS = 16;

/**
 * 抽出テキストの出どころ。**信頼度そのものには影響しない**（診断とハイライトのため）。
 *
 * ただし `"hashtag"` だけは扱いが変わる。フィールド全体が `surface_form` と一致したとき、
 * 通常フィールドなら「テキスト全体が料理名」＝最強の根拠だが、ハッシュタグなら
 * 「ハッシュタグが料理名」＝それより 1 段弱い根拠にしかならないからである。
 */
export type ExtractedTextFieldKind = "title" | "description" | "caption" | "hashtag";

/** SNS のメタデータから取れたテキスト 1 本 */
export type ExtractedText = {
	field: ExtractedTextFieldKind;
	text: string;
};

/** 正規化済みのテキスト 1 本。`index` は入力配列の添字で、根拠（evidence）から参照される */
export type NormalizedText = {
	index: number;
	field: ExtractedTextFieldKind;
	/** `normalizeMatchText` を通した本文。**オフセットはすべてこの文字列に対するもの** */
	text: string;
};

// ---------------------------------------------------------------------------
// 正規化
// ---------------------------------------------------------------------------

/**
 * `norm_key()`（NFKC → 空白圧縮 → 小文字化）と同じ結果を返す。
 *
 * 文字列でないもの・空・null は空文字を返す（**例外は投げない**）。
 * 呼び出し側が SNS の生データを素通しできることを優先している。
 */
export function normalizeMatchText(input: string | null | undefined): string {
	if (typeof input !== "string" || input.length === 0) return "";

	const capped = input.length > MATCH_TEXT_MAX_LENGTH ? input.slice(0, MATCH_TEXT_MAX_LENGTH) : input;

	// Python の `" ".join(s.split())` と同じ。`\s` は U+3000 も拾う。
	const parts = capped.normalize("NFKC").split(/\s+/);
	const kept: string[] = [];
	for (const part of parts) {
		if (part.length > 0) kept.push(part);
	}

	return kept.join(" ").toLowerCase();
}

/** 入力配列を正規化し、空になったものを落とす。件数上限もここで当てる。 */
export function normalizeExtractedTexts(texts: readonly ExtractedText[] | null | undefined): NormalizedText[] {
	if (!Array.isArray(texts)) return [];

	const result: NormalizedText[] = [];
	for (let i = 0; i < texts.length && result.length < MATCH_TEXT_MAX_FIELDS; i += 1) {
		const entry = texts[i];
		if (!entry || typeof entry !== "object") continue;

		const text = normalizeMatchText(entry.text);
		if (text.length === 0) continue;

		result.push({ index: result.length, field: entry.field, text });
	}
	return result;
}

/**
 * 記号と空白を落とした照合キーを作る。
 *
 * `カフェ・ド・パリ` と `カフェドパリ`、`AB&C` と `abc`、`ラーメン_太郎` と `ラーメン太郎` を
 * 同じキーへ寄せるためのもの。**辞書側と照合側の両方に同じものを当てて初めて意味を持つ**ので、
 * 片側だけに適用してはいけない。
 *
 * 落とす文字: 空白 / `・` `/` `&` `'` `’` `"` `“` `”` `-` `–` `—` `_` `.` `,` `!` `?`
 * `(` `)` `[` `]` `{` `}` `:` `;` `|` `+` `*` `~` `〜` `` ` `` `^` `#` `@` `。` `、`
 */
export function stripMatchSymbols(input: string): string {
	return input.replace(/[\s・/&'’"“”\-–—_.,!?()[\]{}:;|+*~〜`^#@。、]/g, "");
}

/**
 * カタカナをひらがなへ畳む（`jaconv.kata2hira` 相当）。
 *
 * 変換するのは U+30A1〜U+30F6 と `ヽ` `ヾ` のみ。長音符 `ー`（U+30FC）と `・` は**変えない**。
 * `ー` をひらがなへ写す規則は存在せず、変えると `ラーメン` と `らーめん` が別物になるため。
 */
export function katakanaToHiragana(input: string): string {
	let out = "";
	for (let i = 0; i < input.length; i += 1) {
		const code = input.charCodeAt(i);
		if (code >= 0x30a1 && code <= 0x30f6) {
			out += String.fromCharCode(code - 0x60);
		} else if (code === 0x30fd || code === 0x30fe) {
			out += String.fromCharCode(code - 0x60);
		} else {
			out += input[i];
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// トークン抽出
// ---------------------------------------------------------------------------

/**
 * ハッシュタグの本体。`start` / `end` は**正規化済みテキスト**に対する `#` を含まない範囲。
 */
export type HashtagToken = {
	/** `#` を剥がした本体 */
	tag: string;
	start: number;
	end: number;
};

/**
 * ハッシュタグを抽出する。区切りは #1399 設計 §4-4 の文字クラスに、
 * 実際の日本語キャプションで終端になる括弧類を足したもの。
 *
 * 全角の `＃` は NFKC で `#` になるので、ここでは `#` だけを見ればよい。
 */
const HASHTAG_PATTERN = /#([^\s#、。,.!?！？「」『』（）()【】[\]]+)/g;

/** ハッシュタグ末尾に食い込む記号（`#ラーメン…` `#ramen-` など） */
const HASHTAG_TRAILING_PATTERN = /[\-–—_.,:;!?~〜…・"'’”)\]}]+$/;

export function extractHashtags(normalizedText: string): HashtagToken[] {
	const tokens: HashtagToken[] = [];
	const pattern = new RegExp(HASHTAG_PATTERN.source, "g");

	let matched: RegExpExecArray | null = pattern.exec(normalizedText);
	while (matched !== null) {
		const bodyStart = matched.index + 1;
		const raw = matched[1];
		const trimmed = raw.replace(HASHTAG_TRAILING_PATTERN, "");
		if (trimmed.length > 0) {
			tokens.push({ tag: trimmed, start: bodyStart, end: bodyStart + trimmed.length });
		}
		matched = pattern.exec(normalizedText);
	}

	return tokens;
}

/** `@mention` の本体。SNS のユーザー名に使われる文字だけを受ける。 */
export type MentionToken = {
	mention: string;
	start: number;
	end: number;
};

const MENTION_PATTERN = /@([a-z0-9._]{1,30})/g;

export function extractMentions(normalizedText: string): MentionToken[] {
	const tokens: MentionToken[] = [];
	const pattern = new RegExp(MENTION_PATTERN.source, "g");

	let matched: RegExpExecArray | null = pattern.exec(normalizedText);
	while (matched !== null) {
		const bodyStart = matched.index + 1;
		const body = matched[1].replace(/[._]+$/, "");
		if (body.length > 0) {
			tokens.push({ mention: body, start: bodyStart, end: bodyStart + body.length });
		}
		matched = pattern.exec(normalizedText);
	}

	return tokens;
}

/** `【…】` で囲まれた店名候補。`start` / `end` は括弧を含まない本体の範囲 */
export type BracketedNameToken = {
	name: string;
	start: number;
	end: number;
};

/**
 * `【店名】` の隅付き括弧に囲まれた文字列を切り出す（#1273）。
 *
 * グルメ紹介の実キャプションは **紹介する店の屋号を `【】` に入れる**ことが圧倒的に多い
 * （実測 `out/infl_captions.jsonl`: 「📍住所…の【おかげ庵】さん okagean_official」の形）。
 * この本体はハッシュタグでも `@mention` でもないので、これまでは «完全一致トークン» が
 * 1 つも作れず、店名が丸ごと括弧内に書かれていても含有一致の 0.85 止まりで、
 * 無人取り込みの prefill（0.90 必須）に届かなかった。
 *
 * ## `【】` だけを見る（`『』`『「」』は採らない）
 *
 * 同じキャプションで `『酒蔵の御三時 養老パフェ』`（料理名）や `「行きたい！」`（CTA）に
 * 別の括弧が使われる。`【】` を **店名の目印**として扱い、他の括弧は採らない。
 * 全角のみ（半角にしか無い括弧は日本語店名の文脈に出ない）。
 *
 * 閉じ括弧が無い／本体が長すぎるものは店名ではないので採らない（上限 40 文字）。
 *
 * ## `【店名】` `【住所】` のような «項目ラベル» は採らない
 *
 * 一部のテンプレは `【店名】\nil gotti` のように括弧を **見出しラベル**として使い、
 * 実際の値は次行に書く（実測 `toyamashokujikai` の投稿）。この見出し語をトークンにすると
 * 店名でない「店名」「住所」等が照合へ紛れ込む。既知のラベル語は落とす
 * （正規化後は小文字なので、ラベルの照合も小文字で行う）。
 */
const BRACKETED_NAME_PATTERN = /【([^【】]{1,40})】/g;

/** 括弧を «見出しラベル» に使うテンプレの語。店名ではないので採らない（正規化後は小文字） */
const BRACKET_LABEL_WORDS: ReadonlySet<string> = new Set([
	"店名",
	"住所",
	"所在地",
	"場所",
	"営業時間",
	"営業日",
	"定休日",
	"アクセス",
	"電話",
	"電話番号",
	"メニュー",
	"価格",
	"料金",
	"予約",
	"駐車場",
	"時間",
	"最寄り駅",
]);

export function extractBracketedNames(normalizedText: string): BracketedNameToken[] {
	const tokens: BracketedNameToken[] = [];
	const pattern = new RegExp(BRACKETED_NAME_PATTERN.source, "g");

	let matched: RegExpExecArray | null = pattern.exec(normalizedText);
	while (matched !== null) {
		const bodyStart = matched.index + 1;
		const body = matched[1].trim();
		if (body.length > 0 && !BRACKET_LABEL_WORDS.has(body)) {
			// trim で先頭空白が落ちた分だけ開始位置を進める（オフセットを本体に合わせる）
			const lead = matched[1].length - matched[1].replace(/^\s+/, "").length;
			const start = bodyStart + lead;
			tokens.push({ name: body, start, end: start + body.length });
		}
		matched = pattern.exec(normalizedText);
	}

	return tokens;
}

// ---------------------------------------------------------------------------
// 📍pin 名 / 裸ハンドルの抽出（#1273）
//
// **この 2 関数だけは «正規化前の生テキスト» を受ける。** `normalizeMatchText` は改行を
// 空白へ潰すので、行単位の構造（📍 で始まる店名行 / ハンドルだけの行）を先に見てからでないと
// 拾えない。実キャプション 1,800 件の実測（`resolve_matching_probe.mjs`）で分かったこと:
//
//  - 店ハンドルは `@` なしの «裸行»（`cafe_fune` `shimobehotel`）が 43.8%、`@mention` は 0.4%。
//    現行の `extractMentions`（@ 必須）はここをほぼ全部取りこぼす。
//  - 店名が `📍<店名>` 行にあり、含有一致 0.85 止まりで prefill 閾値 0.90 を越えられないものが
//    «住所あり» population の 11%。📍店名を exact(1.0) へ昇格すれば自動 prefill が成立する。
//
// ここは «切り出し» だけを担い、点数付けは `restaurantNameMatch.ts`（nameHints）が持つ。
// ---------------------------------------------------------------------------

const PIN_MARK = "📍";

/** 📍 の直後が住所・電話等で始まる «住所ピン»。店名ではないので採らない */
const PIN_ADDRESS_LEAD = /^(?:住所|所在地|場所|アクセス|〒|tel|電話|address)/i;

/** 📍 の直後が都道府県名で始まる «住所ピン»（`📍東京都…`） */
const PIN_PREFECTURE_LEAD = /^(?:東京都|北海道|(?:大阪|京都)府|[一-龥]{2,3}県)/;

/** 店名の後ろに続く «住所・電話・営業情報» の始まり。ここで名前を打ち切る */
const PIN_NAME_CUTOFF = /(?:\s住所|住所[:：]|〒|\stel|tel[:：]|☎|営業時間|定休日|アクセス|\s{2,})/i;

/** 📍 直後の先頭に付く区切り記号（`📍：` `📍・` など）を落とす */
const PIN_LEAD_SEPARATOR = /^[\s：:・|｜]+/;

/** 読みの別名など、`｜` / `|` 以降を落とす（`CRESCENT｜松前カフェ` → `CRESCENT`） */
const PIN_ALIAS_SEPARATOR = /[｜|].*$/;

/** 📍店名として採ってよい正規化後の長さの範囲 */
export const PIN_NAME_MIN_LENGTH = 2;
export const PIN_NAME_MAX_LENGTH = 40;

/**
 * 各行の `📍` 直後に書かれた **店名**を切り出す（#1273）。**生キャプションを渡すこと。**
 *
 * 住所ピン（`📍住所：…` `📍東京都…`）は店ではないので落とす。店名のあとに「住所：」「〒」
 * 「TEL」「営業時間」「定休日」等が続く行は、そこで切って屋号だけを返す。`｜`/`|` 以降も切る。
 * 返す値は `normalizeMatchText` を通してあり、長さ 2〜40 に収まるものだけ。**例外は投げない。**
 */
export function extractPinNames(rawText: string | null | undefined): string[] {
	if (typeof rawText !== "string" || rawText.length === 0) return [];

	const capped = rawText.length > MATCH_TEXT_MAX_LENGTH ? rawText.slice(0, MATCH_TEXT_MAX_LENGTH) : rawText;
	const names: string[] = [];

	for (const rawLine of capped.split(/\r?\n/)) {
		const line = rawLine.trim();
		// 1 行に複数の 📍 があっても «店名を指す» のは最後の 1 個（先頭は絵文字装飾のことが多い）
		const pinAt = line.lastIndexOf(PIN_MARK);
		if (pinAt === -1) continue;

		let after = line.slice(pinAt + PIN_MARK.length).replace(PIN_LEAD_SEPARATOR, "").trim();
		if (after.length === 0) continue;

		// 住所・都道府県で始まるなら «住所ピン»。店名ではない
		if (PIN_ADDRESS_LEAD.test(after) || PIN_PREFECTURE_LEAD.test(after)) continue;

		// 名前の後ろに住所・電話・営業情報が続く行は、そこで切る
		const cutoff = after.search(PIN_NAME_CUTOFF);
		if (cutoff > 0) after = after.slice(0, cutoff).trim();

		// 「屋号｜別名」は屋号側を採る
		after = after.replace(PIN_ALIAS_SEPARATOR, "").trim();

		const normalized = normalizeMatchText(after);
		if (normalized.length < PIN_NAME_MIN_LENGTH || normalized.length > PIN_NAME_MAX_LENGTH) continue;
		names.push(normalized);
	}

	return names;
}

/** 裸ハンドルとして採ってよい形。英小文字始まり・`[a-z0-9._]`・2〜30 文字 */
const BARE_HANDLE_PATTERN = /^[a-z0-9][a-z0-9._]{1,29}$/;

/** 数字だけのハンドルは無い（IG のハンドルは英字を必ず含む）ので弾く判定 */
const HAS_LATIN_LETTER = /[a-z]/;

/**
 * 行まるごとが IG ハンドル（`@` なしの «裸行»）である行を返す（#1273）。**生キャプションを渡すこと。**
 *
 * `extractMentions` が `@` 必須で取りこぼす «裸ハンドル»（`cafe_fune`）を拾う。投稿者自身の
 * ハンドルは除外する（`ownHandle`。先頭 `@` は無視して比べる）。返す値は正規化済み（小文字）。
 *
 * **この関数の出力を店 ID へ解決する «ハンドル→店ID辞書» はまだ無い（別 Issue）。**
 * 現状は抽出だけを固定し、辞書が入ったところで照合へ繋ぐ。
 */
export function extractBareHandles(rawText: string | null | undefined, ownHandle?: string | null): string[] {
	if (typeof rawText !== "string" || rawText.length === 0) return [];

	const capped = rawText.length > MATCH_TEXT_MAX_LENGTH ? rawText.slice(0, MATCH_TEXT_MAX_LENGTH) : rawText;
	const own = typeof ownHandle === "string" ? normalizeMatchText(ownHandle).replace(/^@/, "") : "";
	const handles: string[] = [];

	for (const rawLine of capped.split(/\r?\n/)) {
		// normalizeMatchText で NFKC・小文字化・前後空白除去まで済ませてから形を見る
		const line = normalizeMatchText(rawLine);
		if (!BARE_HANDLE_PATTERN.test(line)) continue;
		if (!HAS_LATIN_LETTER.test(line)) continue;
		if (own.length > 0 && line === own) continue;
		handles.push(line);
	}

	return handles;
}

// ---------------------------------------------------------------------------
// 文字種の判定
//
// 「短い別名が無関係な文中で誤爆する」問題に効かせるための土台。
// Unicode のプロパティ（`\p{Script=...}`）は tsconfig の target に依存して使えないことがあるので、
// **必要な範囲だけを表として持つ**。網羅ではなく、判定を外さないことを優先している。
// ---------------------------------------------------------------------------

/** 照合で「語」を構成しうる文字かどうか。ラテン・かな・漢字・ハングル・キリル等を含む */
function isWordCodePoint(code: number): boolean {
	return (
		(code >= 0x30 && code <= 0x39) || // 0-9
		(code >= 0x41 && code <= 0x5a) || // A-Z
		(code >= 0x61 && code <= 0x7a) || // a-z
		code === 0x5f || // _
		(code >= 0xc0 && code <= 0x24f) || // Latin-1 Supplement / Latin Extended-A,B
		(code >= 0x370 && code <= 0x1fff) || // Greek / Cyrillic / Hebrew / Arabic / Devanagari / Thai / ...
		(code >= 0x2c00 && code <= 0x2dff) ||
		(code >= 0x3041 && code <= 0x30ff) || // かな
		(code >= 0x3131 && code <= 0x318e) || // ハングル字母
		(code >= 0x31f0 && code <= 0x31ff) ||
		(code >= 0x3400 && code <= 0x4dbf) || // CJK 拡張 A
		(code >= 0x4e00 && code <= 0x9fff) || // CJK 統合漢字
		(code >= 0xa000 && code <= 0xa4cf) ||
		(code >= 0xac00 && code <= 0xd7a3) || // ハングル音節
		(code >= 0xf900 && code <= 0xfaff) || // CJK 互換漢字
		(code >= 0x20000 && code <= 0x2fa1f) // CJK 拡張 B 以降
	);
}

function isLatinWordCodePoint(code: number): boolean {
	return (
		(code >= 0x30 && code <= 0x39) ||
		(code >= 0x41 && code <= 0x5a) ||
		(code >= 0x61 && code <= 0x7a) ||
		code === 0x5f ||
		(code >= 0xc0 && code <= 0x24f)
	);
}

function isHiraganaCodePoint(code: number): boolean {
	return (code >= 0x3041 && code <= 0x3096) || code === 0x309d || code === 0x309e;
}

function isKatakanaCodePoint(code: number): boolean {
	return (code >= 0x30a1 && code <= 0x30fa) || code === 0x30fd || code === 0x30fe;
}

/** 長音符。前後どちらの「かなの並び」に属するかは、隣の実体で決める */
function isProlongedCodePoint(code: number): boolean {
	return code === 0x30fc;
}

function isHanCodePoint(code: number): boolean {
	return (
		(code >= 0x3400 && code <= 0x4dbf) ||
		(code >= 0x4e00 && code <= 0x9fff) ||
		(code >= 0xf900 && code <= 0xfaff) ||
		(code >= 0x20000 && code <= 0x2fa1f)
	);
}

/**
 * 文字列全体の文字種。**本文走査の最小長を決める**のに使う。
 *
 * 漢字を 1 文字でも含めば `"han"`。漢字は無いがかなを含めば `"kana"`。
 * ラテン文字・数字・記号だけなら `"latin"`。それ以外（キリル・ハングル・アラビア等）は `"other"`。
 */
export type SurfaceScript = "han" | "kana" | "latin" | "other";

export function classifySurfaceScript(surface: string): SurfaceScript {
	let hasKana = false;
	let hasNonLatinWord = false;

	for (let i = 0; i < surface.length; ) {
		const code = surface.codePointAt(i) ?? 0;
		const width = code > 0xffff ? 2 : 1;

		if (isHanCodePoint(code)) return "han";
		if (isHiraganaCodePoint(code) || isKatakanaCodePoint(code) || isProlongedCodePoint(code)) {
			hasKana = true;
		} else if (isWordCodePoint(code) && !isLatinWordCodePoint(code)) {
			hasNonLatinWord = true;
		}

		i += width;
	}

	if (hasKana) return "kana";
	if (hasNonLatinWord) return "other";
	return "latin";
}

// ---------------------------------------------------------------------------
// 語境界
// ---------------------------------------------------------------------------

/**
 * 端の文字種。語境界の判定はこの単位で行う。
 *
 * `"katakana"` と `"hiragana"` を分けているのが要点で、`ラーメン` の直後に来る `が`（助詞）を
 * 「同じ並びの続き」と誤判定しないため。分けないと日本語の文がほぼ全部弾かれる。
 */
type EdgeKind = "latin" | "katakana" | "hiragana" | "han" | "other-word" | "non-word";

function edgeKindOfCodePoint(code: number | null): EdgeKind {
	if (code === null) return "non-word";
	if (isLatinWordCodePoint(code)) return "latin";
	if (isKatakanaCodePoint(code)) return "katakana";
	if (isHiraganaCodePoint(code)) return "hiragana";
	if (isHanCodePoint(code)) return "han";
	if (isWordCodePoint(code)) return "other-word";
	return "non-word";
}

function codePointAtSafe(text: string, index: number): number | null {
	if (index < 0 || index >= text.length) return null;
	return text.codePointAt(index) ?? null;
}

function codePointBefore(text: string, index: number): number | null {
	if (index <= 0) return null;
	const prev = text.charCodeAt(index - 1);
	if (prev >= 0xdc00 && prev <= 0xdfff && index >= 2) {
		return text.codePointAt(index - 2) ?? null;
	}
	return prev;
}

/**
 * `ー` を跨いで、その並びが本当はカタカナかひらがなかを解決する。
 *
 * `カレー` の末尾は `ー` だが並びとしてはカタカナ、`らー` の末尾は `ー` だがひらがな。
 * ここを解決しないと「`カレー` の後ろに `が` が来たら不一致」という誤った境界判定になる。
 *
 * @param step -1 なら内側（左）へ、+1 なら外側（右）へ辿る
 */
function resolveKanaEdge(text: string, from: number, step: number): EdgeKind {
	let index = from;
	for (let guard = 0; guard < 8; guard += 1) {
		const code = codePointAtSafe(text, index);
		if (code === null) return "non-word";
		if (isKatakanaCodePoint(code)) return "katakana";
		if (isHiraganaCodePoint(code)) return "hiragana";
		if (!isProlongedCodePoint(code)) return edgeKindOfCodePoint(code);
		index += step;
		if (index < 0) return "non-word";
	}
	return "non-word";
}

/** 文字列の先頭の端種別（`ー` は右へ辿って解決する） */
function leadingEdgeKind(surface: string): EdgeKind {
	const code = codePointAtSafe(surface, 0);
	if (code !== null && isProlongedCodePoint(code)) return resolveKanaEdge(surface, 1, 1);
	return edgeKindOfCodePoint(code);
}

/** 文字列の末尾の端種別（`ー` は左へ辿って解決する） */
function trailingEdgeKind(surface: string): EdgeKind {
	const code = codePointBefore(surface, surface.length);
	if (code !== null && isProlongedCodePoint(code)) {
		return resolveKanaEdge(surface, surface.length - 2, -1);
	}
	return edgeKindOfCodePoint(code);
}

/** 一致範囲の外側 1 文字の端種別（`ー` は外側へ辿って解決する） */
function outerEdgeKind(text: string, index: number, step: number): EdgeKind {
	const code = step < 0 ? codePointBefore(text, index) : codePointAtSafe(text, index);
	if (code === null) return "non-word";
	if (isProlongedCodePoint(code)) {
		const next = step < 0 ? index - 2 : index + 1;
		return resolveKanaEdge(text, next, step);
	}
	return edgeKindOfCodePoint(code);
}

/**
 * 左隣のカタカナを許してよい `surface` の最小長（#1273）。
 *
 * 2 文字のカタカナ（`パイ` `ハム` `カツ`…）まで緩めると、`スパイ`→`パイ`、`エビフライ`→`ライ` の
 * ような «たまたま末尾が一致しただけ» が通る。実測でも 2 文字ちょうどのカタカナ表記は辞書に
 * 62 件あり（`モテ` `ラク` `ソト` 等、日本語の普通の語と衝突するものを含む）、緩める価値が無い。
 */
export const KATAKANA_HEAD_RELAX_MIN_LENGTH = 3;

/**
 * 左隣のカタカナを許すために、**直前のカタカナの並び**に要求する最小長（#1273）。
 *
 * ## なぜ «直前が何文字か» で決めるのか（ストップリストを持たないための鍵）
 *
 * 複合語なら左に付くのは**語**（`フルーツ`タルト / `クリスマス`ケーキ / `スープ`カレー /
 * `ミスター`ドーナツ / `ボドゲ`カフェ）だが、誤爆はどれも**語を途中で切っている**
 * （`アド|バイス` / `アラ|フォー` / `タン|ブラー` / `ス|クランブル` / `ガス|コンロ` /
 * `マイ|クラ` / `ア|ドリア` / `テー|ブル` / `ヘル|メット` / `バー|ジョン`）。
 * 切れ端は 1〜2 文字にしかならないので、**直前の並びが 3 文字以上あることを要求する**だけで
 * 語リストを持たずに分けられる。
 *
 * 実測（skipped_no_category 148,480 投稿）: 直前の長さを見ずに緩めると +3,810 投稿だが
 * 上記の誤爆が混ざる。3 文字以上を要求すると +3,460 投稿（91% を維持）で、
 * 1/20 標本に現れた誤爆は**全て消えた**。代わりに `ミニ`クレープ `ヒレ`ステーキ のような
 * 2 文字の修飾語は落ちる（取りこぼしの側に倒す）。
 */
export const KATAKANA_MODIFIER_MIN_LENGTH = 3;

/**
 * 左隣のカタカナを**許さない**カタカナ表記（#1273）。
 * `KATAKANA_MODIFIER_MIN_LENGTH` で落ちきらなかったものだけを、**実測の件数を根拠に**置く。
 * **思い付きで足さないこと。** 増えるようなら、それは規則の側を見直す合図である。
 *
 * - `フォー`（ベトナム料理）: 直前 3 文字以上の条件を足しても 47 投稿が残り、その中身は
 *   `ツーアンドフォー`(15) `トゥエンティフォー`(9+4) `コーチャンフォー`(5) `サーティーフォー`(3) …
 *   と**数字・屋号ばかりで、本物は 2 投稿だけ**（`ベトナムフォー` `トムヤムクンフォー`）。
 *   厳格な境界のままなら誤爆はゼロ（`フォー` が付いた 156 投稿のうち 146 が単独出現）。
 */
export const KATAKANA_HEAD_RELAX_DENYLIST: ReadonlySet<string> = new Set(["フォー"]);

/** `text` の `index` の直前に続いているカタカナ（`ー` を含む）の文字数 */
function precedingKatakanaRunLength(text: string, index: number): number {
	let count = 0;
	for (let i = index - 1; i >= 0; i -= 1) {
		const code = text.charCodeAt(i);
		if (!isKatakanaCodePoint(code) && !isProlongedCodePoint(code)) break;
		count += 1;
	}
	return count;
}

/**
 * @param side `surface` のどちら側の端を見ているか。**カタカナだけ左右で規則が違う**（下の表を参照）
 * @param surface 一致した辞書側の表記。カタカナの左側の緩和が長さに依存するため受け取る
 * @param modifierLength `side === "leading"` のとき、直前に続いているカタカナの並びの長さ
 */
function edgeAllows(
	inner: EdgeKind,
	outer: EdgeKind,
	side: "leading" | "trailing",
	surface: string,
	modifierLength: number,
): boolean {
	switch (inner) {
		// ラテン文字は語の途中に埋もれてはいけない（`ice` が `nice` に当たらないように）
		case "latin":
			return outer !== "latin";
		/*
		#1273 カタカナは **左右で規則を変える**。日本語のカタカナ複合語は主要部が右端に来るので、
		`バスクチーズケーキ` は `チーズケーキ` の一種、`スープカレー` は `カレー` の一種である。
		つまり «左に何か付いている» のは上位語の具体化であって、意味は変わらない。
		逆に «右に何か付いている» と別語になる（`フォーク` は `フォー` ではない / `パイナップル`
		は `パイ` ではない）。両側を禁じていた結果、実測で skipped_no_category のうち
		«KPI カテゴリ名がキャプションに出ているのに候補ゼロ» の 82% がここで落ちていた。
		左を緩める条件は `KATAKANA_MODIFIER_MIN_LENGTH` の doc を参照。
		*/
		case "katakana":
			if (outer !== "katakana") return true;
			return (
				side === "leading" &&
				surface.length >= KATAKANA_HEAD_RELAX_MIN_LENGTH &&
				modifierLength >= KATAKANA_MODIFIER_MIN_LENGTH &&
				!KATAKANA_HEAD_RELAX_DENYLIST.has(surface)
			);
		// ひらがなには境界を課さない。日本語の助詞はひらがなで、
		// 課すと「おいしいうどん」の `うどん` すら弾いてしまうため（取りこぼしの害の方が大きい）
		case "hiragana":
			return true;
		// 漢字は複合語として自由に連結する（`絶品味噌ラーメン` の `味噌ラーメン` を弾かないため）
		case "han":
			return true;
		// その他の文字体系は、どの語構成文字にも隣接してはいけない（もっとも厳しい）
		case "other-word":
			return outer === "non-word";
		default:
			return true;
	}
}

/**
 * `text` の `[start, end)` に現れた `surface` が、**語として**当たっているかを判定する。
 *
 * 文字種ごとの規則は下表のとおり。左は `surface` の端、右は隣接する 1 文字。
 *
 * | surface の端 | 隣がこれなら不一致にする | 例 |
 * | --- | --- | --- |
 * | ラテン文字・数字・`_` | ラテン文字・数字・`_` | `ice` ⊄ `nice` |
 * | カタカナ（末尾側。`ー` は内側で解決） | カタカナ（`ー` は外側で解決） | `フォー` ⊄ `フォーク` / `パイ` ⊄ `パイナップル` |
 * | カタカナ（先頭側。3 文字以上 かつ 直前のカタカナが 3 文字以上） | 適用しない | `チーズケーキ` ⊂ `バスクチーズケーキ` |
 * | カタカナ（先頭側。それ以外） | カタカナ | `パイ` ⊄ `スパイ` / `フォー` ⊄ `アラフォー` |
 * | ひらがな | 適用しない | `うどん` ⊂ `おいしいうどん` を通すため |
 * | 漢字 | 適用しない | `味噌ラーメン` ⊂ `絶品味噌ラーメン` を通すため |
 * | その他の文字体系 | あらゆる語構成文字 | キリル・ハングル等は空白で区切られる前提 |
 */
export function isWordBoundaryMatch(text: string, start: number, end: number, surface: string): boolean {
	const modifierLength = precedingKatakanaRunLength(text, start);
	if (!edgeAllows(leadingEdgeKind(surface), outerEdgeKind(text, start, -1), "leading", surface, modifierLength))
		return false;
	if (!edgeAllows(trailingEdgeKind(surface), outerEdgeKind(text, end, 1), "trailing", surface, 0)) return false;
	return true;
}

// ---------------------------------------------------------------------------
// 類似度
// ---------------------------------------------------------------------------

/** 3-gram を作るときの前後パディング（`pg_trgm` と同じ考え方） */
function trigramSet(value: string): Set<string> {
	const padded = `  ${value} `;
	const grams = new Set<string>();
	for (let i = 0; i + 3 <= padded.length; i += 1) {
		grams.add(padded.slice(i, i + 3));
	}
	return grams;
}

/**
 * 3-gram の Jaccard 係数（0〜1）。`pg_trgm` の `similarity()` と**同じ考え方**だが、
 * 語分割の規則が違うので**同じ値にはならない**。JS 内で完結させるためにこの形にしてある。
 *
 * 完全一致なら 1、共通の 3-gram が無ければ 0。
 */
export function trigramSimilarity(a: string, b: string): number {
	if (a.length === 0 || b.length === 0) return 0;
	if (a === b) return 1;

	const left = trigramSet(a);
	const right = trigramSet(b);

	let intersection = 0;
	right.forEach((gram) => {
		if (left.has(gram)) intersection += 1;
	});

	const union = left.size + right.size - intersection;
	if (union === 0) return 0;

	return intersection / union;
}

/**
 * 2 つの信頼度の差。**必ずこれを使って閾値と比べること。**
 *
 * `0.65 - 0.55` は IEEE754 では `0.09999999999999998` になり、`< 0.1` の判定を素通りする。
 * 実際にこれで「拮抗していない 2 件」が拮抗扱いになる不具合が出たので、差の側を 4 桁で丸める。
 */
export function confidenceMargin(higher: number, lower: number): number {
	return Math.round((higher - lower) * 10000) / 10000;
}

/** 0〜1 に丸める。小数の誤差が閾値比較に漏れないよう 4 桁で切る */
export function clampConfidence(value: number): number {
	if (!Number.isFinite(value)) return 0;
	const clamped = value < 0 ? 0 : value > 1 ? 1 : value;
	return Math.round(clamped * 10000) / 10000;
}
