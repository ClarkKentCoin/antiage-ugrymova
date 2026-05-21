import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Props {
  tenantId: string | null;
  tenantSlug: string | null;
}

interface StripeProviderStatus {
  mode: 'test' | 'live';
  is_enabled: boolean;
  publishable_key: string | null;
  has_secret_key: boolean;
  has_webhook_secret: boolean;
  configured_at: string | null;
  updated_at: string | null;
}

export function StripeProviderSettings({ tenantId, tenantSlug }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<StripeProviderStatus | null>(null);

  const [mode, setMode] = useState<'test' | 'live'>('test');
  const [publishableKey, setPublishableKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [isEnabled, setIsEnabled] = useState(false);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const webhookUrl = supabaseUrl ? `${supabaseUrl}/functions/v1/stripe-webhook` : null;

  const loadStatus = async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('tenant_payment_providers')
        .select('mode, is_enabled, public_config, configured_at, updated_at')
        .eq('tenant_id', tenantId)
        .eq('provider_code', 'stripe')
        .maybeSingle();
      if (error) throw error;
      if (data) {
        const pub = (data.public_config ?? {}) as Record<string, unknown>;
        const next: StripeProviderStatus = {
          mode: (data.mode as 'test' | 'live') ?? 'test',
          is_enabled: !!data.is_enabled,
          publishable_key: (pub.publishable_key as string) ?? null,
          has_secret_key: !!pub.has_secret_key,
          has_webhook_secret: !!pub.has_webhook_secret,
          configured_at: data.configured_at ?? null,
          updated_at: data.updated_at ?? null,
        };
        setStatus(next);
        setMode(next.mode);
        setPublishableKey(next.publishable_key ?? '');
        setIsEnabled(next.is_enabled);
      } else {
        setStatus(null);
      }
    } catch (err) {
      console.error('[StripeSettings] load failed', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        provider_code: 'stripe',
        mode,
        is_enabled: isEnabled,
      };
      if (tenantSlug) payload.tenant_slug = tenantSlug;
      if (publishableKey.trim()) payload.publishable_key = publishableKey.trim();
      if (secretKey.trim()) payload.secret_key = secretKey.trim();
      if (webhookSecret.trim()) payload.webhook_secret = webhookSecret.trim();

      const { data, error } = await supabase.functions.invoke('save-payment-provider-secrets', {
        body: payload,
      });

      if (error) {
        const msg = (data as any)?.message || (data as any)?.error || error.message;
        throw new Error(msg);
      }

      toast({ title: 'Stripe сохранён', description: 'Настройки обновлены.' });
      setSecretKey('');
      setWebhookSecret('');
      await loadStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось сохранить';
      toast({ title: 'Ошибка', description: message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const renderStatusBadge = () => {
    if (!status) return <Badge variant="outline">Не настроен</Badge>;
    const configured = !!status.publishable_key && status.has_secret_key && status.has_webhook_secret;
    if (!configured) return <Badge variant="outline">Не настроен</Badge>;
    return (
      <div className="flex gap-2">
        <Badge variant="secondary">{status.mode === 'live' ? 'Live режим' : 'Test режим'}</Badge>
        <Badge variant={status.is_enabled ? 'default' : 'outline'}>
          {status.is_enabled ? 'Включён' : 'Выключен'}
        </Badge>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <CardTitle>Stripe</CardTitle>
            <CardDescription>
              Для оплаты иностранными картами. Оплата российскими картами через Robokassa не изменяется.
            </CardDescription>
          </div>
          {renderStatusBadge()}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label>Test режим</Label>
                <p className="text-xs text-muted-foreground">
                  Использовать тестовые ключи Stripe (pk_test_ / sk_test_)
                </p>
              </div>
              <Switch
                checked={mode === 'test'}
                onCheckedChange={(checked) => setMode(checked ? 'test' : 'live')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="stripe_pk">Publishable key</Label>
              <Input
                id="stripe_pk"
                placeholder={mode === 'test' ? 'pk_test_…' : 'pk_live_…'}
                value={publishableKey}
                onChange={(e) => setPublishableKey(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="stripe_sk">Secret key</Label>
              <Input
                id="stripe_sk"
                type="password"
                autoComplete="new-password"
                placeholder={
                  status?.has_secret_key
                    ? 'Сохранён — оставьте пустым, чтобы не менять'
                    : mode === 'test'
                    ? 'sk_test_…'
                    : 'sk_live_…'
                }
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Хранится только в зашифрованном Vault. Никогда не отображается повторно.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="stripe_ws">Webhook signing secret</Label>
              <Input
                id="stripe_ws"
                type="password"
                autoComplete="new-password"
                placeholder={
                  status?.has_webhook_secret ? 'Сохранён — оставьте пустым, чтобы не менять' : 'whsec_…'
                }
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label>Включить Stripe</Label>
                <p className="text-xs text-muted-foreground">
                  Доступно после сохранения publishable key, secret key и webhook secret.
                </p>
              </div>
              <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
            </div>

            <div className="space-y-2">
              <Label>Webhook URL (для Stripe Dashboard)</Label>
              {webhookUrl ? (
                <Input readOnly value={webhookUrl} className="font-mono text-xs" />
              ) : (
                <p className="text-xs text-muted-foreground">
                  Webhook URL появится после деплоя функции stripe-webhook.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Stripe webhook функция будет добавлена в следующем шаге.
              </p>
            </div>

            <div className="pt-2">
              <Button onClick={handleSave} disabled={saving || !tenantId}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Сохранить Stripe
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
