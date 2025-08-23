export const PROFILE_TABS = {
  reviews: 'reviews',
  savedPosts: 'saved-posts',
  savedTopics: 'saved-topics',
  liked: 'liked',
  walletDeposit: 'wallet-deposit',
  walletEarning: 'wallet-earning',
} as const;

export type ProfileTabRoute = typeof PROFILE_TABS[keyof typeof PROFILE_TABS];

export const PROFILE_TAB_GROUPS = {
  reviews: [PROFILE_TABS.reviews],
  saved: [PROFILE_TABS.savedPosts, PROFILE_TABS.savedTopics],
  liked: [PROFILE_TABS.liked],
  wallet: [PROFILE_TABS.walletDeposit, PROFILE_TABS.walletEarning],
} as const;

export type TopLevelTab = keyof typeof PROFILE_TAB_GROUPS;
