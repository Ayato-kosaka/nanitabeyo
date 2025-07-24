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
    keyword: 'やっぱり旨い！こってりとんこつ系ラーメン。',
    mediaUrl: 'https://images.pexels.com/photos/4518843/pexels-photo-4518843.jpeg?auto=compress&cs=tinysrgb&w=800&h=450',
    mediaType: 'image',
    reason: '繁華街としても知られ、ラーメン店も多数ある渋谷で、とんこつベースのこってりラーメンがやっぱり旨いです。濃厚なスープと太麺の組み合わせが絶妙で、一度食べたら忘れられない味わいです。',
    googlePlaceSearchText: '渋谷 こってり豚骨ラーメン',
  },
  {
    id: 'card_2',
    keyword: '贅沢な時間を演出する極上和牛ステーキ',
    mediaUrl: 'https://images.pexels.com/photos/3535383/pexels-photo-3535383.jpeg?auto=compress&cs=tinysrgb&w=800&h=450',
    mediaType: 'image',
    reason: '特別な日にふさわしいA5ランクの和牛を使用した贅沢な一品。口の中でとろける柔らかな食感と深い旨味が楽しめ、記念日やデートにも最適です。',
    googlePlaceSearchText: '渋谷 A5和牛ステーキ 高級',
  },
  {
    id: 'card_3',
    keyword: 'ふわふわ食感の絶品チョコレートスフレ',
    mediaUrl: 'https://images.pexels.com/photos/3026804/pexels-photo-3026804.jpeg?auto=compress&cs=tinysrgb&w=800&h=450',
    mediaType: 'image',
    reason: 'ふわふわの食感と濃厚なチョコレートの味わいが絶妙にマッチした、デザート好きにはたまらない逸品。温かいスフレと冷たいアイスクリームのコントラストが最高です。',
    googlePlaceSearchText: '渋谷 チョコレートスフレ デザート',
  },
  {
    id: 'card_4',
    keyword: '新鮮野菜たっぷりのヘルシーシーザーサラダ',
    mediaUrl: 'https://images.pexels.com/photos/2097090/pexels-photo-2097090.jpeg?auto=compress&cs=tinysrgb&w=800&h=450',
    mediaType: 'image',
    reason: '新鮮な野菜とクリーミーなドレッシングの絶妙なバランスが楽しめる一品。ヘルシーでありながら満足感もあり、軽めのランチにも最適です。',
    googlePlaceSearchText: '渋谷 シーザーサラダ ヘルシー',
  },
  {
    id: 'card_5',
    keyword: '濃厚な旨味が凝縮されたロブスタービスク',
    mediaUrl: 'https://images.pexels.com/photos/5560763/pexels-photo-5560763.jpeg?auto=compress&cs=tinysrgb&w=800&h=450',
    mediaType: 'image',
    reason: '濃厚なロブスターの旨味が凝縮された贅沢なスープ。一口飲むだけで海の恵みを感じられ、特別な時間を演出してくれる逸品です。',
    googlePlaceSearchText: '渋谷 ロブスタービスク フレンチ',
  },
  {
    id: 'card_6',
    keyword: 'シンプルながら奥深いマルゲリータピザ',
    mediaUrl: 'https://images.pexels.com/photos/315755/pexels-photo-315755.jpeg?auto=compress&cs=tinysrgb&w=800&h=450',
    mediaType: 'image',
    reason: 'シンプルながら奥深い味わいのクラシックピザ。新鮮なトマトソースとモッツァレラチーズの濃厚さが魅力で、本格的なイタリアンの味を楽しめます。',
    googlePlaceSearchText: '渋谷 マルゲリータピザ イタリアン',
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