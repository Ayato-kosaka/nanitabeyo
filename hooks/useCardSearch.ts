import { useState, useCallback } from 'react';
import { FoodCard, SearchParams, CardHideReason } from '@/types/search';
import { mockFoodCards } from '@/data/searchMockData';

export const useCardSearch = () => {
  const [cards, setCards] = useState<FoodCard[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchCards = useCallback(async (params: SearchParams): Promise<FoodCard[]> => {
    setIsLoading(true);
    setError(null);

    try {
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Mock API response based on search parameters
      const shuffledCards = [...mockFoodCards]
        .sort(() => Math.random() - 0.5)
        .slice(0, 6)
        .map(card => ({
          ...card,
          id: `${card.id}_${Date.now()}_${Math.random()}`,
          isHidden: false,
        }));

      setCards(shuffledCards);
      return shuffledCards;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'カード検索に失敗しました';
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const hideCard = useCallback((cardId: string, reason: string) => {
    setCards(prevCards => 
      prevCards.map(card => 
        card.id === cardId ? { ...card, isHidden: true } : card
      )
    );

    // Log hide reason for analytics
    const hideReason: CardHideReason = {
      cardId,
      reason: reason.replace(/[^\w\s]/gi, '*'), // Simple PII masking
      timestamp: new Date().toISOString(),
    };
    
    console.log('Card hidden:', hideReason);
  }, []);

  const resetCards = useCallback(() => {
    setCards([]);
    setError(null);
  }, []);

  return {
    cards,
    isLoading,
    error,
    searchCards,
    hideCard,
    resetCards,
  };
};