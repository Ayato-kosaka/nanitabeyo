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
    keyword: '本格ナポリピザの極上マルゲリータ',
    mediaUrl: 'https://images.pexels.com/photos/315755/pexels-photo-315755.jpeg?auto=compress&cs=tinysrgb&w=800&h=450',
    mediaType: 'image',
    reason: '薪窯で焼き上げた本格ナポリピザ。新鮮なトマトソースとモッツァレラチーズの絶妙なバランスが楽しめます。クリスピーな生地と濃厚なチーズの組み合わせが絶品です。',
    googlePlaceSearchText: '渋谷 ナポリピザ マルゲリータ',
  },
  {
    id: 'card_2',
    keyword: '手打ちパスタの濃厚カルボナーラ',
    mediaUrl: 'https://images.pexels.com/photos/4518843/pexels-photo-4518843.jpeg?auto=compress&cs=tinysrgb&w=800&h=450',
    mediaType: 'image',
    reason: '毎朝手打ちする生パスタに、濃厚な卵黄とパルミジャーノレッジャーノを絡めた本格カルボナーラ。クリーミーな口当たりと深いコクが自慢の一品です。',
    googlePlaceSearchText: '渋谷 手打ちパスタ カルボナーラ',
  },
  {
    id: 'card_3',
    keyword: '濃厚ロブスタービスクの贅沢スープ',
    mediaUrl: 'https://images.pexels.com/photos/5560763/pexels-photo-5560763.jpeg?auto=compress&cs=tinysrgb&w=800&h=450',
    mediaType: 'image',
    reason: '新鮮なロブスターの旨味を凝縮した濃厚なビスク。一口飲むだけで海の恵みを感じられる贅沢なスープで、特別な日のディナーにぴったりです。',
    googlePlaceSearchText: '渋谷 ロブスタービスク フレンチ',
  },
  {
    id: 'card_4',
    keyword: 'とろけるティラミスの至福デザート',
    mediaUrl: 'https://images.pexels.com/photos/6880219/pexels-photo-6880219.jpeg?auto=compress&cs=tinysrgb&w=800&h=450',
    mediaType: 'image',
    reason: 'マスカルポーネチーズとエスプレッソの絶妙なハーモニー。ふわふわのスポンジとクリーミーなチーズが口の中で溶け合う、本格イタリアンデザートです。',
    googlePlaceSearchText: '渋谷 ティラミス イタリアンデザート',
  },
  {
    id: 'card_5',
    keyword: 'アルデンテが自慢のペスカトーレ',
    mediaUrl: 'https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg?auto=compress&cs=tinysrgb&w=800&h=450',
    mediaType: 'image',
    reason: '新鮮な魚介類をふんだんに使用したペスカトーレ。エビ、イカ、ムール貝の旨味がトマトソースに溶け込み、アルデンテのパスタと絶妙にマッチします。',
    googlePlaceSearchText: '渋谷 ペスカトーレ 魚介パスタ',
  },
  {
    id: 'card_6',
    keyword: '香り豊かなトリュフリゾット',
    mediaUrl: 'https://images.pexels.com/photos/1279330/pexels-photo-1279330.jpeg?auto=compress&cs=tinysrgb&w=800&h=450',
    mediaType: 'image',
    reason: '黒トリュフの芳醇な香りが食欲をそそるクリーミーなリゾット。アルボリオ米の絶妙な食感と濃厚なパルミジャーノが織りなす贅沢な一皿です。',
    googlePlaceSearchText: '渋谷 トリュフリゾット 高級イタリアン',
  },
];

export const mockFeedItems = [
  {
    id: 'feed_1',
    name: 'マルゲリータピザ',
    image: 'https://images.pexels.com/photos/315755/pexels-photo-315755.jpeg?auto=compress&cs=tinysrgb&w=800&h=1200',
    description: '薪窯で焼き上げた本格ナポリピザ',
    likes: 142,
    isLiked: false,
    isSaved: false,
    comments: [
      {
        id: '1',
        username: 'foodie_sarah',
        text: 'この薪窯の香りは本当に素晴らしい！本場ナポリの味が楽しめます 🍕',
        timestamp: '2h ago',
      },
      {
        id: '2',
        username: 'chef_mike',
        text: '生地の食感が完璧！プロの技を感じます',
        timestamp: '3h ago',
      },
    ],
  },
  {
    id: 'feed_2',
    name: 'カルボナーラ',
    image: 'https://images.pexels.com/photos/4518843/pexels-photo-4518843.jpeg?auto=compress&cs=tinysrgb&w=800&h=1200',
    description: '手打ち生パスタの濃厚カルボナーラ',
    likes: 298,
    isLiked: true,
    isSaved: true,
    comments: [
      {
        id: '3',
        username: 'steak_master',
        text: 'この濃厚さは芸術品レベル！完璧な仕上がり 🍝',
        timestamp: '1h ago',
      },
    ],
  },
  {
    id: 'feed_3',
    name: 'ティラミス',
    image: 'https://images.pexels.com/photos/6880219/pexels-photo-6880219.jpeg?auto=compress&cs=tinysrgb&w=800&h=1200',
    description: 'とろけるマスカルポーネのティラミス',
    likes: 186,
    isLiked: false,
    isSaved: false,
    comments: [
      {
        id: '4',
        username: 'dessert_queen',
        text: '完璧なタイミングで提供されました！とろける食感が最高 ✨',
        timestamp: '30m ago',
      },
    ],
  },
  {
    id: 'feed_4',
    name: 'ペスカトーレ',
    image: 'https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg?auto=compress&cs=tinysrgb&w=800&h=1200',
    description: '新鮮魚介のペスカトーレパスタ',
    likes: 89,
    isLiked: false,
    isSaved: true,
    comments: [
      {
        id: '5',
        username: 'healthy_eater',
        text: '魚介の旨味が凝縮されています！トマトソースが絶品',
        timestamp: '45m ago',
      },
    ],
  },
  {
    id: 'feed_5',
    name: 'トリュフリゾット',
    image: 'https://images.pexels.com/photos/1279330/pexels-photo-1279330.jpeg?auto=compress&cs=tinysrgb&w=800&h=1200',
    description: '香り豊かな黒トリュフのリゾット',
    likes: 156,
    isLiked: false,
    isSaved: false,
    comments: [
      {
        id: '6',
        username: 'soup_lover',
        text: 'このトリュフの香りは他では味わえません！贅沢な気分になれます',
        timestamp: '1h ago',
      },
    ],
  },
];