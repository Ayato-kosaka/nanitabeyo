import { Topic, GooglePlacesPrediction } from '@/types/search';

export const mockGooglePlacesPredictions: GooglePlacesPrediction[] = [
  {
    placeId: 'place_1',
    description: '渋谷駅, 東京都渋谷区',
    structured_formatting: {
      main_text: '渋谷駅',
      secondary_text: '東京都渋谷区',
    },
  },
  {
    placeId: 'place_2',
    description: '新宿駅, 東京都新宿区',
    structured_formatting: {
      main_text: '新宿駅',
      secondary_text: '東京都新宿区',
    },
  },
  {
    placeId: 'place_3',
    description: '銀座, 東京都中央区',
    structured_formatting: {
      main_text: '銀座',
      secondary_text: '東京都中央区',
    },
  },
  {
    placeId: 'place_4',
    description: '原宿駅, 東京都渋谷区',
    structured_formatting: {
      main_text: '原宿駅',
      secondary_text: '東京都渋谷区',
    },
  },
  {
    placeId: 'place_5',
    description: '六本木, 東京都港区',
    structured_formatting: {
      main_text: '六本木',
      secondary_text: '東京都港区',
    },
  },
];

export const mockTopicCards: Topic[] = [
  {
    "id": "card_1",
    "googlePlaceSearchText": "味噌ラーメン",
    "topicTitle": "濃厚味噌ラーメン",
    "reason": "コクのある味噌スープと香ばしい炒め野菜が夜の食欲をかき立てる。",
    feedItems: [
      {
        id: 'feed_1',
        name: '炙り味噌らーめん 麺匠真武咲弥 渋谷店',
        image: 'https://lh3.googleusercontent.com/gps-cs-s/AC9h4nqgnYqPr-Q73EMitftL7WnRGlMjcZBdSU-1fhcEsVTC3wdineaj4P_lVEUHHdXvOnPwhG7_ako4TS3pNDSwhVv_Dmx5yB2ZDR5f5_0bEQwkXWftHEWnljDb0fT9z8bYuL1JOmI=w426-h240-k-no',
        likes: 142,
        isLiked: false,
        isSaved: false,
        comments: [
          { id: 'c1', username: 'ramen_lover', text: '香ばしい味噌の香りが最高！', timestamp: '1h ago' },
          { id: 'c2', username: 'foodie123', text: 'スープが濃厚で飲み干しちゃった', timestamp: '3h ago' },
          { id: 'c3', username: 'tokyo_gourmet', text: '炙りの香りがたまらない', timestamp: '5h ago' },
        ]
      },
      {
        id: 'feed_2',
        name: '俺流塩らーめん 渋谷三丁目店',
        image: 'https://lh3.googleusercontent.com/gps-cs-s/AC9h4nruv-h2vCDAJumBtmRitcsUoQQjnlPPm6IT02ijQO_NK7O2eTVJaK8RPQViyvSircZEl760RUAQfXlmr0gywjVxKewBHj22zPr_ojiVJpUUhmTE1M-Wn2qrcSj8DWTlWC918Nux=w408-h306-k-no',
        likes: 98,
        isLiked: false,
        isSaved: false,
        comments: [
          { id: 'c4', username: 'noodle_fan', text: '塩味が上品で飽きない', timestamp: '2h ago' },
          { id: 'c5', username: 'ramen_king', text: '優しいスープに癒された', timestamp: '4h ago' },
          { id: 'c6', username: 'sio_master', text: '澄んだスープが美しい', timestamp: '6h ago' },
        ]
      },
      {
        id: 'feed_3',
        name: 'らーめん ぎょうざ 大穀',
        image: 'https://lh3.googleusercontent.com/gps-cs-s/AC9h4nqezqcFVVLLs85pwH220HKYcZrOOC8aJPeQKlY3GRt6DitAygLgBQJheWQYq_HxlMUBQoX-ZgfM2ssNg74-tsrM3UDw-WVHmlC0r2UOujFap0ixM33Nv90k6-AcuwQNMdLQ7amN=w408-h306-k-no',
        likes: 76,
        isLiked: false,
        isSaved: false,
        comments: [
          { id: 'c7', username: 'gyoza_freak', text: '餃子もジューシーで美味しい', timestamp: '30m ago' },
          { id: 'c8', username: 'ramenholic', text: 'ボリューム満点で満腹', timestamp: '3h ago' },
          { id: 'c9', username: 'tokyo_ramen', text: '昔ながらの味で安心する', timestamp: '7h ago' },
        ]
      },
      {
        id: 'feed_4',
        name: '蒙古タンメン中本 渋谷',
        image: 'https://lh3.googleusercontent.com/gps-cs-s/AC9h4nqk_LMB9f9uWO7OOQIz4amoVSWhX-No0_UnWZFjaH_UPMTPlKIeyOPa6cfVkkwum8k_-CiuAvAE5OXRlwX-kEBhUDVLiqhEO7D6BUZC_8eJL0HiNzWfOlND_05yJDpWGo_frKCS=w408-h306-k-no',
        likes: 210,
        isLiked: false,
        isSaved: false,
        comments: [
          { id: 'c10', username: 'spicy_addict', text: '辛さと旨味のバランスが神！', timestamp: '1h ago' },
          { id: 'c11', username: 'ramen_fever', text: '辛いのにスープを飲み干した', timestamp: '4h ago' },
          { id: 'c12', username: 'hotspice', text: 'クセになる辛さで汗が止まらない', timestamp: '8h ago' },
        ]
      },
      {
        id: 'feed_5',
        name: 'らーめん金伝丸 渋谷本店',
        image: 'https://lh3.googleusercontent.com/gps-cs-s/AC9h4nqSeSqkDVI3GgKjVxWLabC0QEyTOmPu1F3XXR0HIrdhlDEoFuQsuJNfreJbPYvjd6UYhINlbFyOQoqkowAXeVo49WmK2lKYDr5XGFWZIhFan4VI6B2NHBHgAF_uSujCAqzT1WaH_Q=w426-h240-k-no',
        likes: 134,
        isLiked: false,
        isSaved: false,
        comments: [
          { id: 'c13', username: 'tokyo_foodie', text: '深夜のラーメンに最高', timestamp: '2h ago' },
          { id: 'c14', username: 'ramen_addict', text: '背脂たっぷりでパンチがある', timestamp: '5h ago' },
          { id: 'c15', username: 'midnight_snacker', text: '深いコクで癖になる味', timestamp: '9h ago' },
        ]
      }
    ],
    "imageUrl": "https://lh3.googleusercontent.com/gps-cs-s/AC9h4nqgnYqPr-Q73EMitftL7WnRGlMjcZBdSU-1fhcEsVTC3wdineaj4P_lVEUHHdXvOnPwhG7_ako4TS3pNDSwhVv_Dmx5yB2ZDR5f5_0bEQwkXWftHEWnljDb0fT9z8bYuL1JOmI=w426-h240-k-no"
  },
  {
    "id": "card_2",
    "googlePlaceSearchText": "一人焼肉",
    "topicTitle": "ソロ焼肉で至福の夜",
    "reason": "誰にも気兼ねせず、自分のペースで焼き上げる肉は格別のご褒美。",
    feedItems: [],
    "imageUrl": "https://lh3.googleusercontent.com/p/AF1QipN7p6dRdFPv6mJZkpvoya8MZlJb23fME9KRF9Fg=w408-h271-k-no"
  },
  {
    "id": "card_3",
    "googlePlaceSearchText": "油そば",
    "topicTitle": "旨タレ絡む油そば",
    "reason": "濃いめの特製タレと麺の食感で一口ごとに満足感が増す。",
    feedItems: [],
    "imageUrl": "https://lh3.googleusercontent.com/gps-cs-s/AC9h4npr2MUHlL9tLu1_mMfU3vSvsUlffxoYTRZPwMz-OgG6yzByp7Id0OOrEe7aXaw_FCZ8yl8_YxdeYWcK8lLOAVgahObUJBr1wn94TJO958BI2Us4C537404w4kd__KGV2_EMtsUt=w408-h306-k-no"
  },
  {
    "id": "card_4",
    "googlePlaceSearchText": "唐揚げ定食",
    "topicTitle": "ジューシー唐揚げ定食",
    "reason": "カリッと揚がった唐揚げからあふれる肉汁が食欲を直撃。",
    feedItems: [],
    "imageUrl": "https://lh3.googleusercontent.com/p/AF1QipMCK846QdzWMTFmIIib1hCRNvGjsmgQ08tdbjRp=w408-h326-k-no"
  },
  {
    "id": "card_5",
    "googlePlaceSearchText": "ハンバーグ",
    "topicTitle": "肉汁あふれるハンバーグ",
    "reason": "ナイフを入れた瞬間に溢れる肉汁と香ばしさで贅沢な満足感を。",
    feedItems: [],
    "imageUrl": "https://lh3.googleusercontent.com/gps-cs-s/AC9h4npFJRl34iWIfASQQ-4YKpjHxuLb6ILDUPoEYdtici0y0lvH4WyEO9vZobZvqdtZB5OLp_lpNRVnR_0YCOCIdHfnHaMF2y2Wc0mOTCbwKntJ4v03vQAFsOeFnAMyqu-w65UwBiXP5g=w408-h306-k-no"
  },
  {
    "id": "card_6",
    "googlePlaceSearchText": "韓国料理",
    "topicTitle": "ピリ辛韓国料理",
    "reason": "甘辛ダレや香ばしい風味がクセになる。疲れた夜に元気をチャージ。",
    feedItems: [],
    "imageUrl": "https://lh3.googleusercontent.com/p/AF1QipPW3SRWwsAxuNRdSd479pA-pNL67QaYY6mxpEAt=w408-h326-k-no"
  }
];