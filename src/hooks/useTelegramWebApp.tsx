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

export function useTelegramWebApp() {
  const [isReady, setIsReady] = useState(false);
  const [user, setUser] = useState<TelegramUser | null>(null);
  const [colorScheme, setColorScheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    
    if (webApp) {
      webApp.ready();
      webApp.expand();
      
      setIsReady(true);
      setUser(webApp.initDataUnsafe.user || null);
      setColorScheme(webApp.colorScheme);
      
      // Apply telegram theme
      if (webApp.colorScheme === 'dark') {
        document.documentElement.classList.add('dark');
      }
    }
  }, []);

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
    isReady,
    isTelegramWebApp: !!window.Telegram?.WebApp,
    user,
    colorScheme,
    showAlert,
    showConfirm,
    hapticFeedback,
    close,
    webApp: window.Telegram?.WebApp,
  };
}
