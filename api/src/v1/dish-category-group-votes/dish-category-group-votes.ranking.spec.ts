// api/src/v1/dish-category-group-votes/dish-category-group-votes.ranking.spec.ts
//
// #1505 順位規則は結果画面の rank と一覧の winnerName で共有されている。
// 「勝者が決まっている / まだ決まっていない」の境目はユーザーから見える仕様（行が
// 勝者名で出るか候補名の要約で出るかが変わる）なので、境目をここで固定する。

import {
  compareByVoteRank,
  pickWinnerCandidate,
} from './dish-category-group-votes.ranking';

const c = (
  candidateId: string,
  likeCount: number,
  dislikeCount: number,
  displayOrder: number,
) => ({ candidateId, likeCount, dislikeCount, displayOrder });

describe('compareByVoteRank', () => {
  it('like が多い順に並ぶ', () => {
    const sorted = [c('a', 1, 0, 0), c('b', 3, 0, 1)].sort(compareByVoteRank);
    expect(sorted.map((i) => i.candidateId)).toEqual(['b', 'a']);
  });

  it('like が同数なら dislike が少ない順に並ぶ', () => {
    const sorted = [c('a', 2, 3, 0), c('b', 2, 1, 1)].sort(compareByVoteRank);
    expect(sorted.map((i) => i.candidateId)).toEqual(['b', 'a']);
  });

  it('得票が完全に同じなら displayOrder で並びを安定させる', () => {
    const sorted = [c('a', 2, 1, 5), c('b', 2, 1, 2)].sort(compareByVoteRank);
    expect(sorted.map((i) => i.candidateId)).toEqual(['b', 'a']);
  });
});

describe('pickWinnerCandidate', () => {
  it('単独首位が居れば、その候補を返す', () => {
    expect(
      pickWinnerCandidate([c('a', 1, 0, 0), c('b', 2, 0, 1)])?.candidateId,
    ).toBe('b');
  });

  it('同率首位が居れば null（並んでいる状態は「決まった」ではない）', () => {
    expect(pickWinnerCandidate([c('a', 2, 1, 0), c('b', 2, 1, 1)])).toBeNull();
  });

  it('dislike の数で差が付いていれば、同 like 数でも決まる', () => {
    expect(
      pickWinnerCandidate([c('a', 2, 2, 0), c('b', 2, 0, 1)])?.candidateId,
    ).toBe('b');
  });

  it('誰も like していなければ null（0 票同士で先頭を勝たせない）', () => {
    expect(pickWinnerCandidate([c('a', 0, 3, 0), c('b', 0, 0, 1)])).toBeNull();
  });

  it('候補が 1 件だけでも、like が入っていれば決まる', () => {
    expect(pickWinnerCandidate([c('a', 1, 0, 0)])?.candidateId).toBe('a');
  });

  it('候補が 0 件なら null', () => {
    expect(pickWinnerCandidate([])).toBeNull();
  });

  it('入力の配列を破壊しない（呼び出し側の表示順を壊さない）', () => {
    const input = [c('a', 1, 0, 0), c('b', 5, 0, 1)];
    pickWinnerCandidate(input);
    expect(input.map((i) => i.candidateId)).toEqual(['a', 'b']);
  });
});
