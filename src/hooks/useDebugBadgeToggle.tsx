import { useState, useEffect, useCallback, useRef } from 'react';

const STORAGE_KEY = 'miniapp_debug_badge';
const TAP_COUNT_REQUIRED = 7;
const TAP_WINDOW_MS = 3000;

export function useDebugBadgeToggle() {
  const [isEnabled, setIsEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<number | null>(null);

  const toggle = useCallback(() => {
    setIsEnabled((prev) => {
      const newValue = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, newValue ? '1' : '0');
      } catch {
        // localStorage not available
      }
      return newValue;
    });
  }, []);

  const handleTap = useCallback(() => {
    tapCountRef.current += 1;

    // Clear existing timer and start a new one
    if (tapTimerRef.current !== null) {
      window.clearTimeout(tapTimerRef.current);
    }

    tapTimerRef.current = window.setTimeout(() => {
      tapCountRef.current = 0;
      tapTimerRef.current = null;
    }, TAP_WINDOW_MS);

    // Check if we've reached the required tap count
    if (tapCountRef.current >= TAP_COUNT_REQUIRED) {
      tapCountRef.current = 0;
      if (tapTimerRef.current !== null) {
        window.clearTimeout(tapTimerRef.current);
        tapTimerRef.current = null;
      }
      toggle();
      return true; // Signal that toggle happened
    }
    return false;
  }, [toggle]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (tapTimerRef.current !== null) {
        window.clearTimeout(tapTimerRef.current);
      }
    };
  }, []);

  return {
    isEnabled,
    handleTap,
    toggle,
  };
}
