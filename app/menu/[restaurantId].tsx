import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  SafeAreaView,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { 
  ArrowLeft, 
  MapPin, 
  Camera, 
  Send, 
  X,
  MessageCircle,
  Video
} from 'lucide-react-native';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';

const { width, height } = Dimensions.get('window');

interface MenuItem {
  id: string;
  name: string;
  image: string;
  description: string;
  price: string;
  category: string;
}

interface ChatMessage {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
}

const menuItems: MenuItem[] = [
  {
    id: '1',
    name: 'Truffle Pasta',
    image: 'https://images.pexels.com/photos/4518843/pexels-photo-4518843.jpeg?auto=compress&cs=tinysrgb&w=800',
    description: 'Handmade pasta with black truffle shavings, parmesan cheese, and a touch of cream. Our signature dish made with imported Italian truffles.',
    price: '$28',
    category: 'Main Course'
  },
  {
    id: '2',
    name: 'Wagyu Steak',
    image: 'https://images.pexels.com/photos/3535383/pexels-photo-3535383.jpeg?auto=compress&cs=tinysrgb&w=800',
    description: 'Premium A5 Wagyu beef grilled to perfection, served with seasonal vegetables and our house-made sauce.',
    price: '$85',
    category: 'Main Course'
  },
  {
    id: '3',
    name: 'Chocolate Soufflé',
    image: 'https://images.pexels.com/photos/3026804/pexels-photo-3026804.jpeg?auto=compress&cs=tinysrgb&w=800',
    description: 'Classic French chocolate soufflé served warm with vanilla ice cream and berry compote.',
    price: '$16',
    category: 'Dessert'
  },
  {
    id: '4',
    name: 'Caesar Salad',
    image: 'https://images.pexels.com/photos/2097090/pexels-photo-2097090.jpeg?auto=compress&cs=tinysrgb&w=800',
    description: 'Fresh romaine lettuce with house-made caesar dressing, parmesan cheese, and garlic croutons.',
    price: '$14',
    category: 'Appetizer'
  },
  {
    id: '5',
    name: 'Lobster Bisque',
    image: 'https://images.pexels.com/photos/5560763/pexels-photo-5560763.jpeg?auto=compress&cs=tinysrgb&w=800',
    description: 'Rich and creamy lobster bisque with fresh herbs and a touch of cognac.',
    price: '$18',
    category: 'Appetizer'
  }
];

export default function MenuScreen() {
  const { restaurantId } = useLocalSearchParams();
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      text: 'Hello! I\'m your AI assistant. Ask me anything about our menu, ingredients, or recommendations!',
      isUser: false,
      timestamp: new Date()
    }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [cameraFacing, setCameraFacing] = useState<CameraType>('back');
  const [permission, requestPermission] = useCameraPermissions();
  const scrollViewRef = useRef<ScrollView>(null);

  const restaurantName = "Bella Vista Restaurant";

  const handleItemPress = (item: MenuItem) => {
    setSelectedItem(item);
  };

  const handleCloseDetail = () => {
    setSelectedItem(null);
    setShowChat(false);
  };

  const handleSendMessage = () => {
    if (!chatInput.trim()) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      text: chatInput,
      isUser: true,
      timestamp: new Date()
    };

    setChatMessages(prev => [...prev, userMessage]);
    setChatInput('');

    // Simulate AI response
    setTimeout(() => {
      const aiResponse: ChatMessage = {
        id: (Date.now() + 1).toString(),
        text: generateAIResponse(chatInput),
        isUser: false,
        timestamp: new Date()
      };
      setChatMessages(prev => [...prev, aiResponse]);
    }, 1000);
  };

  const generateAIResponse = (input: string): string => {
    const responses = [
      "That's a great choice! This dish is one of our most popular items.",
      "I'd be happy to help! This dish contains fresh, locally sourced ingredients.",
      "Excellent question! Our chef recommends pairing this with our house wine.",
      "This dish is perfect for sharing and has a wonderful blend of flavors.",
      "Great pick! This is made fresh daily with premium ingredients."
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  };

  const handleOpenMaps = () => {
    console.log('Opening Google Maps...');
  };

  const handleCameraCapture = () => {
    console.log('Photo captured!');
    setShowCamera(false);
  };

  const toggleCameraFacing = () => {
    setCameraFacing(current => (current === 'back' ? 'front' : 'back'));
  };

  const handleScroll = (event: any) => {
    const contentOffset = event.nativeEvent.contentOffset;
    const viewSize = event.nativeEvent.layoutMeasurement;
    const pageNum = Math.floor(contentOffset.x / viewSize.width);
    setCurrentIndex(pageNum);
  };

  if (!permission) {
    return <View style={styles.container} />;
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={24} color="#000" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.restaurantName}>{restaurantName}</Text>
        </View>
        <TouchableOpacity onPress={handleOpenMaps} style={styles.mapButton}>
          <MapPin size={20} color="#007AFF" />
          <Text style={styles.mapButtonText}>Maps</Text>
        </TouchableOpacity>
      </View>

      {/* Menu Items Horizontal Scroll */}
      <ScrollView
        ref={scrollViewRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        style={styles.menuScroll}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
        {menuItems.map((item, index) => (
          <View key={item.id} style={styles.menuItem}>
            <Image source={{ uri: item.image }} style={styles.menuImage} />
            <View style={styles.menuOverlay}>
              <TouchableOpacity
                style={styles.menuItemNameContainer}
                onPress={() => handleItemPress(item)}
              >
                <Text style={[
                  styles.menuItemName,
                  currentIndex === index && styles.menuItemNameHighlighted
                ]}>
                  {item.name}
                </Text>
              </TouchableOpacity>
              <Text style={styles.menuItemPrice}>{item.price}</Text>
              <Text style={styles.menuItemCategory}>{item.category}</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Page Indicator */}
      <View style={styles.pageIndicator}>
        {menuItems.map((_, index) => (
          <View
            key={index}
            style={[
              styles.pageIndicatorDot,
              currentIndex === index && styles.pageIndicatorDotActive
            ]}
          />
        ))}
      </View>

      {/* Menu Item Detail Modal */}
      <Modal
        visible={!!selectedItem}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        {selectedItem && (
          <SafeAreaView style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={handleCloseDetail}>
                <X size={24} color="#000" />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>{selectedItem.name}</Text>
              <TouchableOpacity onPress={() => setShowChat(!showChat)}>
                <MessageCircle size={24} color="#007AFF" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalContent}>
              <Image source={{ uri: selectedItem.image }} style={styles.detailImage} />
              
              <View style={styles.detailInfo}>
                <View style={styles.priceCategory}>
                  <Text style={styles.detailPrice}>{selectedItem.price}</Text>
                  <Text style={styles.detailCategory}>{selectedItem.category}</Text>
                </View>
                <Text style={styles.detailDescription}>{selectedItem.description}</Text>
              </View>

              {/* Camera Section */}
              <View style={styles.cameraSection}>
                <Text style={styles.sectionTitle}>Share Your Experience</Text>
                <View style={styles.cameraButtons}>
                  <TouchableOpacity 
                    style={styles.cameraButton}
                    onPress={() => setShowCamera(true)}
                  >
                    <Camera size={20} color="#007AFF" />
                    <Text style={styles.cameraButtonText}>Take Photo</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.cameraButton}>
                    <Video size={20} color="#007AFF" />
                    <Text style={styles.cameraButtonText}>Record Video</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>

            {/* AI Chat Section */}
            {showChat && (
              <KeyboardAvoidingView 
                style={styles.chatContainer}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              >
                <View style={styles.chatHeader}>
                  <Text style={styles.chatTitle}>Ask AI Assistant</Text>
                </View>
                
                <ScrollView style={styles.chatMessages}>
                  {chatMessages.map((message) => (
                    <View
                      key={message.id}
                      style={[
                        styles.messageContainer,
                        message.isUser ? styles.userMessage : styles.aiMessage
                      ]}
                    >
                      <Text style={[
                        styles.messageText,
                        message.isUser ? styles.userMessageText : styles.aiMessageText
                      ]}>
                        {message.text}
                      </Text>
                    </View>
                  ))}
                </ScrollView>

                <View style={styles.chatInputContainer}>
                  <TextInput
                    style={styles.chatInput}
                    placeholder="Ask about ingredients, recommendations..."
                    value={chatInput}
                    onChangeText={setChatInput}
                    multiline
                  />
                  <TouchableOpacity 
                    style={styles.sendButton}
                    onPress={handleSendMessage}
                    disabled={!chatInput.trim()}
                  >
                    <Send size={20} color={chatInput.trim() ? "#007AFF" : "#999"} />
                  </TouchableOpacity>
                </View>
              </KeyboardAvoidingView>
            )}
          </SafeAreaView>
        )}
      </Modal>

      {/* Camera Modal */}
      <Modal
        visible={showCamera}
        animationType="slide"
        presentationStyle="fullScreen"
      >
        <SafeAreaView style={styles.cameraContainer}>
          {!permission.granted ? (
            <View style={styles.permissionContainer}>
              <Text style={styles.permissionText}>Camera permission required</Text>
              <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
                <Text style={styles.permissionButtonText}>Grant Permission</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.cameraHeader}>
                <TouchableOpacity onPress={() => setShowCamera(false)}>
                  <X size={24} color="#FFF" />
                </TouchableOpacity>
                <Text style={styles.cameraTitle}>Share Your Dish</Text>
                <TouchableOpacity onPress={toggleCameraFacing}>
                  <Text style={styles.flipText}>Flip</Text>
                </TouchableOpacity>
              </View>

              <CameraView style={styles.camera} facing={cameraFacing}>
                <View style={styles.cameraControls}>
                  <TouchableOpacity 
                    style={styles.captureButton}
                    onPress={handleCameraCapture}
                  >
                    <View style={styles.captureButtonInner} />
                  </TouchableOpacity>
                </View>
              </CameraView>
            </>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  backButton: {
    padding: 8,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  restaurantName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
  },
  mapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F8FF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  mapButtonText: {
    fontSize: 14,
    color: '#007AFF',
    marginLeft: 4,
    fontWeight: '500',
  },
  menuScroll: {
    flex: 1,
  },
  menuItem: {
    width: width,
    height: '100%',
    position: 'relative',
  },
  menuImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  menuOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    padding: 20,
  },
  menuItemNameContainer: {
    marginBottom: 8,
  },
  menuItemName: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFF',
    marginBottom: 4,
  },
  menuItemNameHighlighted: {
    color: '#FFD700',
    textShadowColor: 'rgba(255, 215, 0, 0.5)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  menuItemPrice: {
    fontSize: 20,
    color: '#FFF',
    fontWeight: '600',
    marginBottom: 4,
  },
  menuItemCategory: {
    fontSize: 16,
    color: '#CCCCCC',
    fontWeight: '400',
  },
  pageIndicator: {
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pageIndicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
    marginHorizontal: 4,
  },
  pageIndicatorDotActive: {
    backgroundColor: '#FFF',
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#FFF',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
  },
  modalContent: {
    flex: 1,
  },
  detailImage: {
    width: '100%',
    height: 300,
    resizeMode: 'cover',
  },
  detailInfo: {
    padding: 16,
  },
  priceCategory: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  detailPrice: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000',
  },
  detailCategory: {
    fontSize: 14,
    color: '#666',
    backgroundColor: '#F5F5F5',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  detailDescription: {
    fontSize: 16,
    lineHeight: 24,
    color: '#333',
  },
  cameraSection: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E5E5',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
    marginBottom: 12,
  },
  cameraButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  cameraButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0F8FF',
    paddingVertical: 12,
    borderRadius: 8,
  },
  cameraButtonText: {
    fontSize: 14,
    color: '#007AFF',
    marginLeft: 8,
    fontWeight: '500',
  },
  chatContainer: {
    height: height * 0.5,
    backgroundColor: '#F8F9FA',
    borderTopWidth: 1,
    borderTopColor: '#E5E5E5',
  },
  chatHeader: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
    backgroundColor: '#FFF',
  },
  chatTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  chatMessages: {
    flex: 1,
    padding: 16,
  },
  messageContainer: {
    marginBottom: 12,
    maxWidth: '80%',
  },
  userMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#007AFF',
    borderRadius: 16,
    padding: 12,
  },
  aiMessage: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  messageText: {
    fontSize: 14,
    lineHeight: 20,
  },
  userMessageText: {
    color: '#FFF',
  },
  aiMessageText: {
    color: '#000',
  },
  chatInputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 16,
    backgroundColor: '#FFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E5E5',
  },
  chatInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    fontSize: 16,
    maxHeight: 100,
    marginRight: 12,
  },
  sendButton: {
    padding: 8,
  },
  cameraContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  permissionText: {
    fontSize: 18,
    color: '#FFF',
    textAlign: 'center',
    marginBottom: 20,
  },
  permissionButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  permissionButtonText: {
    fontSize: 16,
    color: '#FFF',
    fontWeight: '600',
  },
  cameraHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  cameraTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFF',
  },
  flipText: {
    fontSize: 16,
    color: '#FFF',
    fontWeight: '500',
  },
  camera: {
    flex: 1,
  },
  cameraControls: {
    position: 'absolute',
    bottom: 50,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButtonInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FFF',
  },
});