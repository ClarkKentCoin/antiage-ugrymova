import { useState, useEffect, useRef } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { Loader2, Copy, Check, Upload, X } from 'lucide-react';
import logoFallback from '@/assets/logo-ugrymova.png';


interface AdminSettingsData {
  telegram_bot_token: string | null;
  telegram_channel_id: string | null;
  robokassa_merchant_login: string | null;
  robokassa_password1: string | null;
  robokassa_password2: string | null;
  robokassa_test_mode: boolean;
  robokassa_result_url: string | null;
  grace_period_days: number;
  reminder_days_before: number;
  single_reminder_days_before: number | null;
  payment_link: string | null;
  welcome_message_text: string | null;
  welcome_message_image_url: string | null;
  welcome_message_button_text: string | null;
  welcome_message_button_url: string | null;
  // Notification templates
  notification_payment_reminder: string | null;
  notification_payment_success: string | null;
  notification_payment_failed: string | null;
  notification_grace_period_warning: string | null;
  notification_subscription_expired: string | null;
  notification_subscription_expiring_single: string | null;
  // Admin notifications
  telegram_admin_notifications_enabled: boolean;
  telegram_admin_notifications_channel_id: string;
}

export default function AdminSettings() {
  const { toast } = useToast();
  const { tenantId, tenantSlug, tenantLoading } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSettingBotWebhook, setIsSettingBotWebhook] = useState(false);
  const [isResettingBotWebhook, setIsResettingBotWebhook] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedBotWebhook, setCopiedBotWebhook] = useState(false);
  const [copiedMiniAppUrl, setCopiedMiniAppUrl] = useState(false);
  const [copiedTenantSlug, setCopiedTenantSlug] = useState(false);
  const [canonicalBase, setCanonicalBase] = useState<string | null>(null);
  const [settings, setSettings] = useState<AdminSettingsData>({
    telegram_bot_token: '',
    telegram_channel_id: '',
    robokassa_merchant_login: '',
    robokassa_password1: '',
    robokassa_password2: '',
    robokassa_test_mode: true,
    robokassa_result_url: '',
    grace_period_days: 0,
    reminder_days_before: 3,
    single_reminder_days_before: null,
    payment_link: '',
    welcome_message_text: '',
    welcome_message_image_url: '',
    welcome_message_button_text: 'Подробнее',
    welcome_message_button_url: '',
    notification_payment_reminder: '',
    notification_payment_success: '',
    notification_payment_failed: '',
    notification_grace_period_warning: '',
    notification_subscription_expired: '',
    notification_subscription_expiring_single: '',
    telegram_admin_notifications_enabled: false,
    telegram_admin_notifications_channel_id: '',
  });

  // Generate default webhook URLs
  const defaultWebhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/robokassa-webhook`;
  const botWebhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telegram-bot-webhook`;
  const miniAppUrl = (canonicalBase && tenantSlug)
    ? `${canonicalBase}/telegram-app?t=${encodeURIComponent(tenantSlug)}`
    : null;

  // Fetch canonical base URL from backend
  useEffect(() => {
    if (!tenantSlug) return;
    supabase.functions.invoke('get-public-app-config', {
      body: { tenant_slug: tenantSlug },
    }).then(({ data }) => {
      if (data?.canonical_base_url) {
        setCanonicalBase(data.canonical_base_url);
      }
    }).catch(err => console.warn('Failed to fetch canonical base URL:', err));
  }, [tenantSlug]);

  useEffect(() => {
    if (!tenantLoading) {
      loadSettings();
    }
  }, [tenantLoading, tenantId]);

  const loadSettings = async () => {
    if (!tenantId) {
      toast({ title: 'Tenant not found for this user', variant: 'destructive' });
      setIsLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('admin_settings')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setSettings({
          telegram_bot_token: data.telegram_bot_token || '',
          telegram_channel_id: data.telegram_channel_id || '',
          robokassa_merchant_login: data.robokassa_merchant_login || '',
          robokassa_password1: data.robokassa_password1 || '',
          robokassa_password2: data.robokassa_password2 || '',
          robokassa_test_mode: (data as any).robokassa_test_mode ?? true,
          robokassa_result_url: (data as any).robokassa_result_url || defaultWebhookUrl,
          grace_period_days: data.grace_period_days || 0,
          reminder_days_before: data.reminder_days_before || 3,
          single_reminder_days_before: (data as any).single_reminder_days_before ?? null,
          payment_link: (data as any).payment_link || '',
          welcome_message_text: (data as any).welcome_message_text || '',
          welcome_message_image_url: (data as any).welcome_message_image_url || '',
          welcome_message_button_text: (data as any).welcome_message_button_text || 'Подробнее',
          welcome_message_button_url: (data as any).welcome_message_button_url || '',
          notification_payment_reminder: (data as any).notification_payment_reminder || '',
          notification_payment_success: (data as any).notification_payment_success || '',
          notification_payment_failed: (data as any).notification_payment_failed || '',
          notification_grace_period_warning: (data as any).notification_grace_period_warning || '',
          notification_subscription_expired: (data as any).notification_subscription_expired || '',
          notification_subscription_expiring_single: (data as any).notification_subscription_expiring_single || '',
          telegram_admin_notifications_enabled: (data as any).telegram_admin_notifications_enabled ?? false,
          telegram_admin_notifications_channel_id: (data as any).telegram_admin_notifications_channel_id || '',
        });
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!tenantId) {
      toast({ title: 'Cannot save: tenant not found', variant: 'destructive' });
      return;
    }

    setIsSaving(true);
    try {
      // First check if a settings row exists for this tenant
      const { data: existingSettings } = await supabase
        .from('admin_settings')
        .select('id')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      const settingsData = {
        telegram_bot_token: settings.telegram_bot_token || null,
        telegram_channel_id: settings.telegram_channel_id || null,
        robokassa_merchant_login: settings.robokassa_merchant_login || null,
        robokassa_password1: settings.robokassa_password1 || null,
        robokassa_password2: settings.robokassa_password2 || null,
        robokassa_test_mode: settings.robokassa_test_mode,
        robokassa_result_url: settings.robokassa_result_url || defaultWebhookUrl,
        grace_period_days: settings.grace_period_days,
        reminder_days_before: settings.reminder_days_before,
        single_reminder_days_before: settings.single_reminder_days_before,
        payment_link: settings.payment_link || null,
        welcome_message_text: settings.welcome_message_text || null,
        welcome_message_image_url: settings.welcome_message_image_url || null,
        welcome_message_button_text: settings.welcome_message_button_text || 'Подробнее',
        welcome_message_button_url: settings.welcome_message_button_url || null,
        notification_payment_reminder: settings.notification_payment_reminder || null,
        notification_payment_success: settings.notification_payment_success || null,
        notification_payment_failed: settings.notification_payment_failed || null,
        notification_grace_period_warning: settings.notification_grace_period_warning || null,
        notification_subscription_expired: settings.notification_subscription_expired || null,
        notification_subscription_expiring_single: settings.notification_subscription_expiring_single || null,
        telegram_admin_notifications_enabled: settings.telegram_admin_notifications_enabled,
        telegram_admin_notifications_channel_id: settings.telegram_admin_notifications_channel_id || null,
      };

      let error;
      if (existingSettings?.id) {
        // Update existing row
        const result = await supabase
          .from('admin_settings')
          .update(settingsData as any)
          .eq('id', existingSettings.id);
        error = result.error;
      } else {
        // Insert new row with tenant_id
        const result = await supabase
          .from('admin_settings')
          .insert({ ...settingsData, tenant_id: tenantId } as any);
        error = result.error;
      }

      if (error) throw error;

      toast({ title: 'Настройки сохранены' });
    } catch (error) {
      console.error('Error saving settings:', error);
      toast({ title: 'Ошибка сохранения настроек', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const copyWebhookUrl = () => {
    const url = settings.robokassa_result_url || defaultWebhookUrl;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: 'URL скопирован' });
  };

  const copyBotWebhookUrl = () => {
    navigator.clipboard.writeText(botWebhookUrl);
    setCopiedBotWebhook(true);
    setTimeout(() => setCopiedBotWebhook(false), 2000);
    toast({ title: 'URL для Telegram webhook скопирован' });
  };

  const setTelegramBotWebhook = async () => {
    setIsSettingBotWebhook(true);
    try {
      const { data, error } = await supabase.functions.invoke('set-telegram-webhook', {
        body: {
          allowed_updates: ['message'],
        },
      });

      if (error) throw error;

      toast({
        title: 'Webhook установлен',
        description: (data as any)?.description || undefined,
      });
    } catch (error) {
      console.error('Error setting Telegram webhook:', error);
      toast({
        title: 'Не удалось установить webhook',
        description: 'Проверьте Bot Token (сохранён в настройках) и что TELEGRAM_WEBHOOK_SECRET задан.',
        variant: 'destructive',
      });
    } finally {
      setIsSettingBotWebhook(false);
    }
  };

  const resetTelegramBotWebhook = async () => {
    if (!window.confirm('Reset webhook? This will delete and set webhook again (drop pending updates).')) {
      return;
    }

    setIsResettingBotWebhook(true);
    try {
      const { data, error } = await supabase.functions.invoke('set-telegram-webhook', {
        body: { reset: true },
      });

      if (error) throw error;

      const response = data as { ok: boolean; description?: string; deleteResult?: { ok: boolean }; setResult?: { ok: boolean } };

      if (response.ok) {
        toast({
          title: 'Webhook reset successfully',
          description: `deleteWebhook: ${response.deleteResult?.ok ? 'ok' : 'failed'}, setWebhook: ${response.setResult?.ok ? 'ok' : 'failed'}`,
        });
      } else {
        toast({
          title: 'Reset failed',
          description: response.description || 'Unknown error',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Error resetting Telegram webhook:', error);
      toast({
        title: 'Не удалось сбросить webhook',
        description: 'Проверьте Bot Token и TELEGRAM_WEBHOOK_SECRET.',
        variant: 'destructive',
      });
    } finally {
      setIsResettingBotWebhook(false);
    }
  };

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-muted rounded" />
          <div className="h-64 bg-muted rounded-lg" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Настройки</h1>
          <p className="text-muted-foreground">Настройте бота и платёжную систему</p>
        </div>

        <div className="grid gap-6 max-w-2xl">
          {/* Telegram Settings */}
          <Card>
            <CardHeader>
              <CardTitle>Telegram Bot</CardTitle>
              <CardDescription>Подключите Telegram бота для управления каналом</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="bot_token">Bot Token</Label>
                <Input
                  id="bot_token"
                  type="password"
                  placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                  value={settings.telegram_bot_token || ''}
                  onChange={(e) => setSettings({ ...settings, telegram_bot_token: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">Получите токен у @BotFather</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="bot_webhook">Bot Webhook URL</Label>
                <div className="flex gap-2">
                  <Input
                    id="bot_webhook"
                    value={botWebhookUrl}
                    readOnly
                    className="flex-1 text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={copyBotWebhookUrl}
                  >
                    {copiedBotWebhook ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Установите этот URL как webhook для бота через @BotFather или API.
                </p>

                <div className="pt-2 space-y-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={setTelegramBotWebhook}
                    disabled={isSettingBotWebhook || isResettingBotWebhook}
                    className="w-full"
                  >
                    {isSettingBotWebhook ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Устанавливаю webhook…
                      </span>
                    ) : (
                      'Set Telegram Webhook (with secret_token)'
                    )}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Кнопка вызовет Telegram API setWebhook с secret_token из backend переменной TELEGRAM_WEBHOOK_SECRET.
                  </p>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={resetTelegramBotWebhook}
                    disabled={isSettingBotWebhook || isResettingBotWebhook}
                    className="w-full"
                  >
                    {isResettingBotWebhook ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Сбрасываю webhook…
                      </span>
                    ) : (
                      'Reset Telegram Webhook'
                    )}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Удаляет webhook (drop pending updates) и устанавливает заново.
                  </p>
                </div>
              </div>

              {/* Mini App URL Setup */}
              {miniAppUrl && (
                <div className="space-y-3 rounded-lg border p-4 bg-muted/30">
                  <h4 className="text-sm font-semibold">Mini App URL (для BotFather)</h4>

                  <div className="space-y-1">
                    <Label className="text-xs">Tenant slug</Label>
                    <div className="flex gap-2">
                      <Input value={tenantSlug || ''} readOnly className="flex-1 text-xs font-mono" />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => {
                          navigator.clipboard.writeText(tenantSlug || '');
                          setCopiedTenantSlug(true);
                          setTimeout(() => setCopiedTenantSlug(false), 2000);
                        }}
                      >
                        {copiedTenantSlug ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Mini App URL</Label>
                    <div className="flex gap-2">
                      <Input value={miniAppUrl} readOnly className="flex-1 text-xs font-mono" />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => {
                          navigator.clipboard.writeText(miniAppUrl);
                          setCopiedMiniAppUrl(true);
                          setTimeout(() => setCopiedMiniAppUrl(false), 2000);
                          toast({ title: 'Mini App URL скопирован' });
                        }}
                      >
                        {copiedMiniAppUrl ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>

                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>📋 Вставьте этот URL в BotFather → <strong>Bot Settings → Menu Button</strong></p>
                    <p>📋 Вставьте этот URL в BotFather → <strong>Bot Settings → Main Mini App</strong></p>
                  </div>

                  <div className="space-y-2 rounded border p-3 bg-background">
                    <p className="text-sm font-medium">Кнопка приветствия в сообщении бота</p>
                    <p className="text-xs text-muted-foreground">
                      Обычно здесь используется тот же Mini App URL.
                      Нажмите кнопку ниже, чтобы автоматически подставить этот URL.
                      Если хотите, чтобы кнопка открывала другую страницу — укажите свой URL вручную в поле ниже.
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setSettings({ ...settings, welcome_message_button_url: miniAppUrl });
                        toast({ title: 'Mini App URL подставлен в кнопку приветствия' });
                      }}
                    >
                      Подставить Mini App URL в кнопку приветствия
                    </Button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="channel_id">Channel ID</Label>
                <Input
                  id="channel_id"
                  placeholder="-1001234567890"
                  value={settings.telegram_channel_id || ''}
                  onChange={(e) => setSettings({ ...settings, telegram_channel_id: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">ID вашего приватного канала/группы</p>
              </div>
            </CardContent>
          </Card>

          {/* Admin Notifications */}
          <Card>
            <CardHeader>
              <CardTitle>Уведомления администратора в Telegram</CardTitle>
              <CardDescription>Уведомления о платежах и изменениях подписок для администратора</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label>Включить уведомления администратору</Label>
                  <p className="text-xs text-muted-foreground">
                    Получать уведомления о платежах, окончании подписок и т.д.
                  </p>
                </div>
                <Switch
                  checked={settings.telegram_admin_notifications_enabled}
                  onCheckedChange={(checked) => setSettings({ ...settings, telegram_admin_notifications_enabled: checked })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="admin_channel_id">Telegram канал для уведомлений</Label>
                <Input
                  id="admin_channel_id"
                  placeholder="-1001234567890"
                  value={settings.telegram_admin_notifications_channel_id}
                  onChange={(e) => setSettings({ ...settings, telegram_admin_notifications_channel_id: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Бот должен быть администратором в этом канале
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Robokassa Settings */}
          <Card>
            <CardHeader>
              <CardTitle>Robokassa</CardTitle>
              <CardDescription>Настройки платёжного шлюза для автоматических платежей</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="merchant_login">Идентификатор магазина (MerchantLogin)</Label>
                <Input
                  id="merchant_login"
                  placeholder="your_shop_login"
                  value={settings.robokassa_merchant_login || ''}
                  onChange={(e) => setSettings({ ...settings, robokassa_merchant_login: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password1">Пароль #1</Label>
                <Input
                  id="password1"
                  type="password"
                  placeholder="Для генерации платежных ссылок"
                  value={settings.robokassa_password1 || ''}
                  onChange={(e) => setSettings({ ...settings, robokassa_password1: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">Используется для формирования подписи при создании платежа</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password2">Пароль #2</Label>
                <Input
                  id="password2"
                  type="password"
                  placeholder="Для проверки уведомлений"
                  value={settings.robokassa_password2 || ''}
                  onChange={(e) => setSettings({ ...settings, robokassa_password2: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">Используется для проверки подписи входящих уведомлений</p>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label>Тестовый режим</Label>
                  <p className="text-xs text-muted-foreground">
                    Использовать тестовые пароли Robokassa
                  </p>
                </div>
                <Switch
                  checked={settings.robokassa_test_mode}
                  onCheckedChange={(checked) => setSettings({ ...settings, robokassa_test_mode: checked })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="result_url">Result URL (Webhook)</Label>
                <div className="flex gap-2">
                  <Input
                    id="result_url"
                    placeholder={defaultWebhookUrl}
                    value={settings.robokassa_result_url || defaultWebhookUrl}
                    onChange={(e) => setSettings({ ...settings, robokassa_result_url: e.target.value })}
                    className="flex-1"
                  />
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="icon"
                    onClick={copyWebhookUrl}
                  >
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Укажите этот URL в настройках Robokassa → Технические настройки → Result Url
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Welcome Message */}
          <Card>
            <CardHeader>
              <CardTitle>Приветственное сообщение бота</CardTitle>
              <CardDescription>Сообщение, которое бот отправляет при команде /start</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="welcome_image">Картинка (URL)</Label>
                <Input
                  id="welcome_image"
                  placeholder="https://example.com/image.jpg"
                  value={settings.welcome_message_image_url || ''}
                  onChange={(e) => setSettings({ ...settings, welcome_message_image_url: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">Загрузите картинку на хостинг и вставьте ссылку</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="welcome_text">Текст сообщения</Label>
                <Textarea
                  id="welcome_text"
                  placeholder="🌟 Добро пожаловать в АНТИЭЙДЖ ЛАБ!..."
                  value={settings.welcome_message_text || ''}
                  onChange={(e) => setSettings({ ...settings, welcome_message_text: e.target.value })}
                  rows={5}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="welcome_button">Текст кнопки</Label>
                <Input
                  id="welcome_button"
                  placeholder="Подробнее"
                  value={settings.welcome_message_button_text || ''}
                  onChange={(e) => setSettings({ ...settings, welcome_message_button_text: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="welcome_button_url">Ссылка кнопки (URL)</Label>
                <Input
                  id="welcome_button_url"
                  placeholder="https://t.me/your_bot/app"
                  value={settings.welcome_message_button_url || ''}
                  onChange={(e) => setSettings({ ...settings, welcome_message_button_url: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">URL для кнопки (например, ссылка на Mini App или сайт)</p>
              </div>
            </CardContent>
          </Card>

          {/* Notification Templates */}
          <Card>
            <CardHeader>
              <CardTitle>Шаблоны уведомлений</CardTitle>
              <CardDescription>
                Используйте переменные в фигурных скобках: {'{channel_name}'}, {'{days}'}, {'{amount}'}, {'{payment_date}'}, {'{expires_date}'}, {'{grace_days}'}, {'{error_message}'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="notification_payment_reminder">Напоминание о списании (за N дней)</Label>
                <Textarea
                  id="notification_payment_reminder"
                  placeholder="⏰ Напоминание о списании..."
                  value={settings.notification_payment_reminder || ''}
                  onChange={(e) => setSettings({ ...settings, notification_payment_reminder: e.target.value })}
                  rows={6}
                />
                <p className="text-xs text-muted-foreground">
                  Переменные: {'{channel_name}'}, {'{days}'}, {'{days_word}'} (день/дня/дней), {'{days_label}'} (N день/дня/дней), {'{amount}'}, {'{payment_date}'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  💡 Для правильного склонения используйте {'{days} {days_word}'} вместо {'{days} дней'}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notification_payment_success">Успешная оплата</Label>
                <Textarea
                  id="notification_payment_success"
                  placeholder="✅ Оплата успешна..."
                  value={settings.notification_payment_success || ''}
                  onChange={(e) => setSettings({ ...settings, notification_payment_success: e.target.value })}
                  rows={6}
                />
                <p className="text-xs text-muted-foreground">Переменные: {'{channel_name}'}, {'{amount}'}, {'{expires_date}'}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notification_payment_failed">Ошибка оплаты</Label>
                <Textarea
                  id="notification_payment_failed"
                  placeholder="❌ Ошибка оплаты..."
                  value={settings.notification_payment_failed || ''}
                  onChange={(e) => setSettings({ ...settings, notification_payment_failed: e.target.value })}
                  rows={6}
                />
                <p className="text-xs text-muted-foreground">Переменные: {'{channel_name}'}, {'{amount}'}, {'{error_message}'}, {'{grace_days}'}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notification_grace_period_warning">Предупреждение Grace Period</Label>
                <Textarea
                  id="notification_grace_period_warning"
                  placeholder="⚠️ Последнее предупреждение..."
                  value={settings.notification_grace_period_warning || ''}
                  onChange={(e) => setSettings({ ...settings, notification_grace_period_warning: e.target.value })}
                  rows={6}
                />
                <p className="text-xs text-muted-foreground">
                  Переменные: {'{channel_name}'}, {'{days}'}, {'{days_word}'} (день/дня/дней), {'{days_label}'} (N день/дня/дней)
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  💡 Для правильного склонения используйте {'{days} {days_word}'} вместо {'{days} дней'}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notification_subscription_expired">Подписка завершена</Label>
                <Textarea
                  id="notification_subscription_expired"
                  placeholder="❗ Подписка завершена..."
                  value={settings.notification_subscription_expired || ''}
                  onChange={(e) => setSettings({ ...settings, notification_subscription_expired: e.target.value })}
                  rows={6}
                />
                <p className="text-xs text-muted-foreground">Переменные: {'{channel_name}'}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notification_subscription_expiring_single">Напоминание об окончании подписки (Single/manual)</Label>
                <Textarea
                  id="notification_subscription_expiring_single"
                  placeholder="⏳ Подписка скоро закончится..."
                  value={settings.notification_subscription_expiring_single || ''}
                  onChange={(e) => setSettings({ ...settings, notification_subscription_expiring_single: e.target.value })}
                  rows={6}
                />
                <p className="text-xs text-muted-foreground">
                  Переменные: {'{channel_name}'}, {'{days}'}, {'{days_word}'} (день/дня/дней), {'{days_label}'} (N день/дня/дней), {'{expires_date}'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  💡 Для правильного склонения используйте {'{days} {days_word}'} вместо {'{days} дней'}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Payment Link */}
          <Card>
            <CardHeader>
              <CardTitle>Ручная ссылка на оплату</CardTitle>
              <CardDescription>Ссылка для оплаты до интеграции Robokassa (например, на банковский перевод)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="payment_link">Payment Link</Label>
                <Input
                  id="payment_link"
                  placeholder="https://..."
                  value={settings.payment_link || ''}
                  onChange={(e) => setSettings({ ...settings, payment_link: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">Эта ссылка будет показана пользователям в Mini App</p>
              </div>
            </CardContent>
          </Card>

          {/* Subscription Settings */}
          <Card>
            <CardHeader>
              <CardTitle>Настройки подписки</CardTitle>
              <CardDescription>Напоминания и период отсрочки</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reminder_days">Напоминание за (дней) — рекуррентные</Label>
                <Input
                  id="reminder_days"
                  type="number"
                  min="0"
                  value={settings.reminder_days_before}
                  onChange={(e) => setSettings({ ...settings, reminder_days_before: parseInt(e.target.value) || 0 })}
                />
                <p className="text-xs text-muted-foreground">За сколько дней до окончания рекуррентной подписки отправить напоминание о списании</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="single_reminder_days">Напоминание Single/manual (дней)</Label>
                <Input
                  id="single_reminder_days"
                  type="number"
                  min="0"
                  max="90"
                  value={settings.single_reminder_days_before ?? ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSettings({ 
                      ...settings, 
                      single_reminder_days_before: val === '' ? null : parseInt(val) || 0 
                    });
                  }}
                  placeholder="По умолчанию как рекуррентные"
                />
                <p className="text-xs text-muted-foreground">За сколько дней до окончания single/manual подписки отправить напоминание. Если пусто — используется значение для рекуррентных.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="grace_period">Grace Period (дней)</Label>
                <Input
                  id="grace_period"
                  type="number"
                  min="0"
                  value={settings.grace_period_days}
                  onChange={(e) => setSettings({ ...settings, grace_period_days: parseInt(e.target.value) || 0 })}
                />
                <p className="text-xs text-muted-foreground">Сколько дней после окончания подписки до удаления из канала</p>
              </div>
            </CardContent>
          </Card>

          <Button onClick={handleSave} disabled={isSaving} className="w-fit">
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Сохранить настройки
          </Button>
        </div>
      </div>
    </AdminLayout>
  );
}
