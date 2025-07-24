import { FoodCard, GooglePlacesPrediction } from '@/types/search';

export const mockGooglePlacesPredictions: GooglePlacesPrediction[] = [
  {
    place_id: 'place_1',
    description: '渋谷駅, 東京都渋谷区',
    structured_formatting: {
      main_text: '渋谷駅',
      secondary_text: '東京都渋谷区',
    },
  },
  {
    place_id: 'place_2',
    description: '新宿駅, 東京都新宿区',
    structured_formatting: {
      main_text: '新宿駅',
      secondary_text: '東京都新宿区',
    },
  },
  {
    place_id: 'place_3',
    description: '銀座, 東京都中央区',
    structured_formatting: {
      main_text: '銀座',
      secondary_text: '東京都中央区',
    },
  },
  {
    place_id: 'place_4',
    description: '原宿駅, 東京都渋谷区',
    structured_formatting: {
      main_text: '原宿駅',
      secondary_text: '東京都渋谷区',
    },
  },
  {
    place_id: 'place_5',
    description: '六本木, 東京都港区',
    structured_formatting: {
      main_text: '六本木',
      secondary_text: '東京都港区',
    },
  },
];

export const mockFoodCards: FoodCard[] = [
  {
    id: 'card_1',
    keyword: 'トリュフパスタ',
    mediaUrl: 'https://images.pexels.com/photos/4518843/pexels-photo-4518843.jpeg?auto=compress&cs=tinysrgb&w=800&h=450',
    mediaType: 'image',
    reason: '高級感のある雰囲気で特別な時間を演出。黒トリュフの香りが食欲をそそります。',
    googlePlaceSearchText: 'トリュフパスタ 渋谷 イタリアン',
  },
  {
    id: 'card_2',
    keyword: '和牛ステーキ',
    mediaUrl: 'https://images.pexels.com/photos/3535383/pexels-photo-3535383.jpeg?auto=compress&cs=tinysrgb&w=800&h=450',
    mediaType: 'image',
    reason: 'A5ランクの和牛を使用した贅沢な一品。柔らかな食感と深い旨味が楽しめます。',
    googlePlaceSearchText: '和牛ステーキ 渋谷 高級',
  },
  {
    id: 'card_3',
    keyword: 'チョコレートスフレ',
    mediaUrl: 'https://images.pexels.com/photos/3026804/pexels-photo-3026804.jpeg?auto=compress&cs=tinysrgb&w=800&h=450',
    mediaType: 'image',
    reason: 'ふわふわの食感と濃厚なチョコレートの味わい。デザート好きにはたまらない逸品。',
    googlePlaceSearchText: 'チョコレートスフレ 渋谷 デザート',
  },
  {
    id: 'card_4',
    keyword: 'シーザーサラダ',
    mediaUrl: 'https://images.pexels.com/photos/2097090/pexels-photo-2097090.jpeg?auto=compress&cs=tinysrgb&w=800&h=450',
    mediaType: 'image',
    reason: '新鮮な野菜とクリーミーなドレッシングの絶妙なバランス。ヘルシーで満足感も◎',
    googlePlaceSearchText: 'シーザーサラダ 渋谷 サラダ',
  },
  {
    id: 'card_5',
    keyword: 'ロブスタービスク',
    mediaUrl: 'https://images.pexels.com/photos/5560763/pexels-photo-5560763.jpeg?auto=compress&cs=tinysrgb&w=800&h=450',
    mediaType: 'image',
    reason: '濃厚なロブスターの旨味が凝縮されたスープ。贅沢な気分を味わえます。',
    googlePlaceSearchText: 'ロブスタービスク 渋谷 フレンチ',
  },
  {
    id: 'card_6',
    keyword: 'マルゲリータピザ',
    mediaUrl: 'https://images.pexels.com/photos/315755/pexels-photo-315755.jpeg?auto=compress&cs=tinysrgb&w=800&h=450',
    mediaType: 'image',
    reason: 'シンプルながら奥深い味わいのクラシックピザ。モッツァレラチーズの濃厚さが魅力。',
    googlePlaceSearchText: 'マルゲリータピザ 渋谷 ピザ',
  },
];

export const mockFeedItems = [
  {
    id: 'feed_1',
    name: 'トリュフパスタ',
    image: 'https://images.pexels.com/photos/4518843/pexels-photo-4518843.jpeg?auto=compress&cs=tinysrgb&w=800&h=1200',
    description: '黒トリュフとパルミジャーノレッジャーノの贅沢な組み合わせ',
    likes: 142,
    isLiked: false,
    isSaved: false,
    comments: [
      {
        id: '1',
        username: 'foodie_sarah',
        text: 'この香りは本当に素晴らしい！トリュフの風味が口いっぱいに広がります 🤤',
        timestamp: '2h ago',
      },
      {
        id: '2',
        username: 'chef_mike',
        text: 'パスタの茹で加減が完璧！プロの技を感じます',
        timestamp: '3h ago',
      },
    ],
  },
  {
    id: 'feed_2',
    name: '和牛ステーキ',
    image: 'https://images.pexels.com/photos/3535383/pexels-photo-3535383.jpeg?auto=compress&cs=tinysrgb&w=800&h=1200',
    description: 'A5ランク和牛の極上ステーキ',
    likes: 298,
    isLiked: true,
    isSaved: true,
    comments: [
      {
        id: '3',
        username: 'steak_master',
        text: 'このマーブリングは芸術品レベル！完璧なミディアムレア 🥩',
        timestamp: '1h ago',
      },
    ],
  },
  {
    id: 'feed_3',
    name: 'チョコレートスフレ',
    image: 'https://images.pexels.com/photos/3026804/pexels-photo-3026804.jpeg?auto=compress&cs=tinysrgb&w=800&h=1200',
    description: 'ふわふわ食感の濃厚チョコレートスフレ',
    likes: 186,
    isLiked: false,
    isSaved: false,
    comments: [
      {
        id: '4',
        username: 'dessert_queen',
        text: '完璧なタイミングで提供されました！ふわふわ感が最高 ✨',
        timestamp: '30m ago',
      },
    ],
  },
  {
    id: 'feed_4',
    name: 'シーザーサラダ',
    image: 'https://images.pexels.com/photos/2097090/pexels-photo-2097090.jpeg?auto=compress&cs=tinysrgb&w=800&h=1200',
    description: '新鮮野菜とクリーミードレッシングの絶妙バランス',
    likes: 89,
    isLiked: false,
    isSaved: true,
    comments: [
      {
        id: '5',
        username: 'healthy_eater',
        text: 'ヘルシーなのに満足感があります！ドレッシングが絶品',
        timestamp: '45m ago',
      },
    ],
  },
  {
    id: 'feed_5',
    name: 'ロブスタービスク',
    image: 'https://images.pexels.com/photos/5560763/pexels-photo-5560763.jpeg?auto=compress&cs=tinysrgb&w=800&h=1200',
    description: '濃厚なロブスターエキスが凝縮されたスープ',
    likes: 156,
    isLiked: false,
    isSaved: false,
    comments: [
      {
        id: '6',
        username: 'soup_lover',
        text: 'この濃厚さは他では味わえません！贅沢な気分になれます',
        timestamp: '1h ago',
      },
    ],
  },
];