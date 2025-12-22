import { useState, useEffect } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Copy, Check } from 'lucide-react';

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
  payment_link: string | null;
  welcome_message_text: string | null;
  welcome_message_image_url: string | null;
  welcome_message_button_text: string | null;
  welcome_message_button_url: string | null;
}

export default function AdminSettings() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedBotWebhook, setCopiedBotWebhook] = useState(false);
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
    payment_link: '',
    welcome_message_text: '',
    welcome_message_image_url: '',
    welcome_message_button_text: 'Подробнее',
    welcome_message_button_url: '',
  });

  // Generate default webhook URLs
  const defaultWebhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/robokassa-webhook`;
  const botWebhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telegram-bot-webhook`;

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('admin_settings')
        .select('*')
        .limit(1)
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
          payment_link: (data as any).payment_link || '',
          welcome_message_text: (data as any).welcome_message_text || '',
          welcome_message_image_url: (data as any).welcome_message_image_url || '',
          welcome_message_button_text: (data as any).welcome_message_button_text || 'Подробнее',
          welcome_message_button_url: (data as any).welcome_message_button_url || '',
        });
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // First check if a settings row exists
      const { data: existingSettings } = await supabase
        .from('admin_settings')
        .select('id')
        .limit(1)
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
        payment_link: settings.payment_link || null,
        welcome_message_text: settings.welcome_message_text || null,
        welcome_message_image_url: settings.welcome_message_image_url || null,
        welcome_message_button_text: settings.welcome_message_button_text || 'Подробнее',
        welcome_message_button_url: settings.welcome_message_button_url || null,
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
        // Insert new row
        const result = await supabase
          .from('admin_settings')
          .insert(settingsData as any);
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
                <p className="text-xs text-muted-foreground">Установите этот URL как webhook для бота через @BotFather или API</p>
              </div>

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
                <Label htmlFor="reminder_days">Напоминание за (дней)</Label>
                <Input
                  id="reminder_days"
                  type="number"
                  min="0"
                  value={settings.reminder_days_before}
                  onChange={(e) => setSettings({ ...settings, reminder_days_before: parseInt(e.target.value) || 0 })}
                />
                <p className="text-xs text-muted-foreground">За сколько дней до окончания подписки отправить напоминание</p>
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
