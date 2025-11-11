// --- START OF FILE src/hooks/useHighScore.ts ---

import { useState, useCallback, useEffect } from 'react';

const HIGHSCORE_PREFIX = 'aurora-game-highscore-';

export const useHighScore = (gameId: string) => {
  const [highScore, setHighScore] = useState<number>(0);

  const key = `${HIGHSCORE_PREFIX}${gameId}`;

  useEffect(() => {
    try {
      const storedScore = localStorage.getItem(key);
      if (storedScore !== null) {
        setHighScore(parseInt(storedScore, 10));
      }
    } catch (error) {
      console.warn(`Could not read high score for ${gameId}:`, error);
    }
  }, [key]);

  const updateHighScore = useCallback((newScore: number) => {
    if (newScore > highScore) {
      setHighScore(newScore);
      try {
        localStorage.setItem(key, newScore.toString());
      } catch (error) {
        console.warn(`Could not save high score for ${gameId}:`, error);
      }
    }
  }, [highScore, key]);

  return { highScore, updateHighScore };
};
// --- END OF FILE src/hooks/useHighScore.ts ---