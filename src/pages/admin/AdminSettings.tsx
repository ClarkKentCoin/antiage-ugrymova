import { useState, useEffect } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

interface AdminSettings {
  telegram_bot_token: string | null;
  telegram_channel_id: string | null;
  robokassa_merchant_login: string | null;
  robokassa_password1: string | null;
  robokassa_password2: string | null;
  grace_period_days: number;
  reminder_days_before: number;
}

export default function AdminSettings() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [settings, setSettings] = useState<AdminSettings>({
    telegram_bot_token: '',
    telegram_channel_id: '',
    robokassa_merchant_login: '',
    robokassa_password1: '',
    robokassa_password2: '',
    grace_period_days: 0,
    reminder_days_before: 3,
  });

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
          grace_period_days: data.grace_period_days || 0,
          reminder_days_before: data.reminder_days_before || 3,
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
      const { error } = await supabase
        .from('admin_settings')
        .update({
          telegram_bot_token: settings.telegram_bot_token || null,
          telegram_channel_id: settings.telegram_channel_id || null,
          robokassa_merchant_login: settings.robokassa_merchant_login || null,
          robokassa_password1: settings.robokassa_password1 || null,
          robokassa_password2: settings.robokassa_password2 || null,
          grace_period_days: settings.grace_period_days,
          reminder_days_before: settings.reminder_days_before,
        })
        .not('id', 'is', null);

      if (error) throw error;

      toast({ title: 'Settings saved successfully' });
    } catch (error) {
      console.error('Error saving settings:', error);
      toast({ title: 'Error saving settings', variant: 'destructive' });
    } finally {
      setIsSaving(false);
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
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-muted-foreground">Configure your bot and payment settings</p>
        </div>

        <div className="grid gap-6 max-w-2xl">
          {/* Telegram Settings */}
          <Card>
            <CardHeader>
              <CardTitle>Telegram Bot</CardTitle>
              <CardDescription>Connect your Telegram bot to manage channel members</CardDescription>
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
                <p className="text-xs text-muted-foreground">Get this from @BotFather</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="channel_id">Channel ID</Label>
                <Input
                  id="channel_id"
                  placeholder="-1001234567890"
                  value={settings.telegram_channel_id || ''}
                  onChange={(e) => setSettings({ ...settings, telegram_channel_id: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">Your private channel/group ID</p>
              </div>
            </CardContent>
          </Card>

          {/* Robokassa Settings */}
          <Card>
            <CardHeader>
              <CardTitle>Robokassa (Phase 2)</CardTitle>
              <CardDescription>Payment gateway settings - configure when ready</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="merchant_login">Merchant Login</Label>
                <Input
                  id="merchant_login"
                  placeholder="Your merchant login"
                  value={settings.robokassa_merchant_login || ''}
                  onChange={(e) => setSettings({ ...settings, robokassa_merchant_login: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password1">Password #1</Label>
                <Input
                  id="password1"
                  type="password"
                  placeholder="For payment initiation"
                  value={settings.robokassa_password1 || ''}
                  onChange={(e) => setSettings({ ...settings, robokassa_password1: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password2">Password #2</Label>
                <Input
                  id="password2"
                  type="password"
                  placeholder="For result URL verification"
                  value={settings.robokassa_password2 || ''}
                  onChange={(e) => setSettings({ ...settings, robokassa_password2: e.target.value })}
                />
              </div>
            </CardContent>
          </Card>

          {/* Subscription Settings */}
          <Card>
            <CardHeader>
              <CardTitle>Subscription Settings</CardTitle>
              <CardDescription>Configure expiry reminders and grace periods</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reminder_days">Reminder Days Before</Label>
                <Input
                  id="reminder_days"
                  type="number"
                  min="0"
                  value={settings.reminder_days_before}
                  onChange={(e) => setSettings({ ...settings, reminder_days_before: parseInt(e.target.value) || 0 })}
                />
                <p className="text-xs text-muted-foreground">Days before expiry to send reminder</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="grace_period">Grace Period (days)</Label>
                <Input
                  id="grace_period"
                  type="number"
                  min="0"
                  value={settings.grace_period_days}
                  onChange={(e) => setSettings({ ...settings, grace_period_days: parseInt(e.target.value) || 0 })}
                />
                <p className="text-xs text-muted-foreground">Days after expiry before removal</p>
              </div>
            </CardContent>
          </Card>

          <Button onClick={handleSave} disabled={isSaving} className="w-fit">
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Settings
          </Button>
        </div>
      </div>
    </AdminLayout>
  );
}
