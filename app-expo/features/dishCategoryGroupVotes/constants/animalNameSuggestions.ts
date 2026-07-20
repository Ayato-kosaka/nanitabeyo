/**
 * #856 【設計】匿名投票の名前候補。
 *
 * API は displayName 重複を禁止しないため、UI の補助として既存参加者と
 * モーダル内候補の重複を避ける。ユーザー提示リストに混入していた壊れた文字は、
 * 表示名として保存できないためここには含めない。
 */
export const DISH_CATEGORY_GROUP_VOTE_ANIMAL_NAMES = [
	"🐶",
	"🐱",
	"🐹",
	"🐰",
	"🐿️",
	"🦫",
	"🦔",
	"🐻",
	"🐻‍❄️",
	"🐼",
	"🐨",
	"🐯",
	"🦁",
	"🐺",
	"🐴",
	"🦄",
	"🦓",
	"🦌",
	"🐮",
	"🐷",
	"🐗",
	"🐑",
	"🐏",
	"🐐",
	"🐫",
	"🦙",
	"🦒",
	"🐘",
	"🦣",
	"🦏",
	"🦛",
	"🐭",
	"🦇",
	"🦦",
	"🦥",
	"🦨",
	"🦘",
	"🐵",
	"🦍",
	"🦧",
	"🐔",
	"🐥",
	"🐦",
	"🐧",
	"🕊️",
	"🦅",
	"🦆",
	"🦢",
	"🦉",
	"🦩",
	"🦚",
	"🦜",
	"🐊",
	"🐢",
	"🦎",
	"🦖",
	"🦕",
	"🐸",
	"🐳",
	"🐋",
	"🐬",
	"🦭",
] as const;

export const DISH_CATEGORY_GROUP_VOTE_NAME_SUGGESTION_COUNT = 5;

export const buildDishCategoryGroupVoteNameSuggestions = (
	usedDisplayNames: string[],
	count = DISH_CATEGORY_GROUP_VOTE_NAME_SUGGESTION_COUNT,
): string[] => {
	const used = new Set(usedDisplayNames);
	const available = DISH_CATEGORY_GROUP_VOTE_ANIMAL_NAMES.filter((name) => !used.has(name));

	// #856 【設計】候補順が毎回固定だと複数人が同じ名前を選びやすいため、表示直前にシャッフルする。
	return [...available].sort(() => Math.random() - 0.5).slice(0, count);
};
