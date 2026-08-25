// api/src/v1/dish-category-group-votes/dish-category-group-votes.ranking.ts
//
// #1505 【設計】「どの候補が勝っているか」の規則をここ 1 箇所に置く。
//
// 結果画面の rank（assembler.buildRanks）と、一覧の winnerName（repository.findMeSessions）は
// **同じ順位規則でなければならない**。結果画面で 1 位に出ている候補と、一覧の行に太字で出る
// 候補が食い違うと、ユーザーから見れば単なるバグである。規則を 2 箇所に書くと片方だけ直る
// 事故が起きるので、比較関数を共有し、双方がこれを呼ぶ形にしてある。

/** 順位付けの入力。表示に要る情報は含めない（順位規則が表示契約に引きずられないようにする） */
export interface RankableCandidate {
  candidateId: string;
  likeCount: number;
  dislikeCount: number;
  displayOrder: number;
}

/**
 * 順位規則: likeCount DESC → dislikeCount ASC → displayOrder ASC。
 *
 * displayOrder は「同点のときに並びをぶれさせない」ためだけに使い、
 * 同率判定（= 順位が同じかどうか）には含めない。含めると displayOrder が必ず一意なので
 * 同率が絶対に発生しなくなり、「同率首位なら勝者未確定」を表現できなくなる。
 */
export function compareByVoteRank(
  a: RankableCandidate,
  b: RankableCandidate,
): number {
  if (a.likeCount !== b.likeCount) return b.likeCount - a.likeCount;
  if (a.dislikeCount !== b.dislikeCount) return a.dislikeCount - b.dislikeCount;
  return a.displayOrder - b.displayOrder;
}

/** 2 件の得票が完全に同じ = 同順位、かどうか */
export function hasSameVoteScore(
  a: RankableCandidate,
  b: RankableCandidate,
): boolean {
  return a.likeCount === b.likeCount && a.dislikeCount === b.dislikeCount;
}

/**
 * 勝者（単独首位）を返す。確定していなければ null。
 *
 * 【仕様】確定条件は次の両方。どちらかでも欠ければ一覧は勝者名を出さず、候補名の要約を出す。
 * - 首位の likeCount が 1 以上。誰も投票していない投票に勝者は無い
 *   （全員 0 票だと displayOrder の若い候補が「勝った」ことになってしまう）
 * - 同率首位が居ない。2 件が並んでいる状態を「決まった」と呼ばない
 */
export function pickWinnerCandidate<T extends RankableCandidate>(
  candidates: T[],
): T | null {
  if (candidates.length === 0) return null;

  const sorted = [...candidates].sort(compareByVoteRank);
  const top = sorted[0];

  if (top.likeCount === 0) return null;
  if (sorted.length > 1 && hasSameVoteScore(top, sorted[1])) return null;

  return top;
}
