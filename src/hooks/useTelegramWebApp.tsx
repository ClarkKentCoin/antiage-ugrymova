import { useState, useEffect } from 'react';

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        initDataUnsafe: {
          user?: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
            language_code?: string;
            is_premium?: boolean;
          };
          auth_date: number;
          hash: string;
        };
        ready: () => void;
        close: () => void;
        expand: () => void;
        MainButton: {
          text: string;
          color: string;
          textColor: string;
          isVisible: boolean;
          isActive: boolean;
          show: () => void;
          hide: () => void;
          onClick: (callback: () => void) => void;
          offClick: (callback: () => void) => void;
          setText: (text: string) => void;
          enable: () => void;
          disable: () => void;
        };
        BackButton: {
          isVisible: boolean;
          show: () => void;
          hide: () => void;
          onClick: (callback: () => void) => void;
          offClick: (callback: () => void) => void;
        };
        themeParams: {
          bg_color?: string;
          text_color?: string;
          hint_color?: string;
          link_color?: string;
          button_color?: string;
          button_text_color?: string;
        };
        colorScheme: 'light' | 'dark';
        isExpanded: boolean;
        viewportHeight: number;
        viewportStableHeight: number;
        setHeaderColor: (color: string) => void;
        setBackgroundColor: (color: string) => void;
        showAlert: (message: string, callback?: () => void) => void;
        showConfirm: (message: string, callback?: (confirmed: boolean) => void) => void;
        openLink: (url: string) => void;
        openTelegramLink: (url: string) => void;
        HapticFeedback: {
          impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
          notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
          selectionChanged: () => void;
        };
      };
    };
  }
}

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export type TelegramDetectStatus = 'pending' | 'ready' | 'not_telegram';

export function useTelegramWebApp() {
  const [detectStatus, setDetectStatus] = useState<TelegramDetectStatus>('pending');
  const [user, setUser] = useState<TelegramUser | null>(null);
  const [colorScheme, setColorScheme] = useState<'light' | 'dark'>('light');

  // Check if test mode is active (skip detection)
  const testMode = typeof window !== 'undefined' && (
    import.meta.env.DEV || new URLSearchParams(window.location.search).has('test')
  );

  useEffect(() => {
    // In test mode, mark as ready immediately without requiring Telegram SDK
    if (testMode) {
      setDetectStatus('ready');
      return;
    }

    let tries = 0;
    const maxTries = 80; // ~8s — enough for slow devices

    const tryInit = () => {
      const webApp = window.Telegram?.WebApp;
      if (!webApp?.initData && !webApp?.initDataUnsafe?.user) return false;

      try {
        webApp.ready();
        webApp.expand();
      } catch (e) {
        console.warn('[useTelegramWebApp] SDK ready/expand failed:', e);
      }

      setDetectStatus('ready');
      setUser(webApp.initDataUnsafe.user || null);
      setColorScheme(webApp.colorScheme);

      // Apply telegram theme
      document.documentElement.classList.toggle('dark', webApp.colorScheme === 'dark');
      return true;
    };

    if (tryInit()) return;

    const interval = window.setInterval(() => {
      tries += 1;
      if (tryInit() || tries >= maxTries) {
        if (tries >= maxTries) {
          console.warn('[useTelegramWebApp] Telegram SDK not detected after', maxTries * 100, 'ms');
          setDetectStatus('not_telegram');
        }
        window.clearInterval(interval);
      }
    }, 100);

    return () => window.clearInterval(interval);
  }, [testMode]);

  const showAlert = (message: string) => {
    window.Telegram?.WebApp.showAlert(message);
  };

  const showConfirm = (message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      window.Telegram?.WebApp.showConfirm(message, (confirmed) => {
        resolve(confirmed);
      });
    });
  };

  const hapticFeedback = (type: 'success' | 'error' | 'warning') => {
    window.Telegram?.WebApp.HapticFeedback.notificationOccurred(type);
  };

  const close = () => {
    window.Telegram?.WebApp.close();
  };

  return {
    isReady: detectStatus !== 'pending',
    isTelegramWebApp: detectStatus === 'ready',
    telegramDetectStatus: detectStatus,
    user,
    colorScheme,
    showAlert,
    showConfirm,
    hapticFeedback,
    close,
    webApp: window.Telegram?.WebApp,
  };
}
