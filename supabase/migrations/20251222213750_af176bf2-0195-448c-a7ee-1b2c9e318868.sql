-- Add channel info fields to admin_settings
ALTER TABLE public.admin_settings
ADD COLUMN IF NOT EXISTS channel_name text DEFAULT 'АНТИЭЙДЖ ЛАБ',
ADD COLUMN IF NOT EXISTS channel_description text DEFAULT 'Закрытый Telegram-канал для женщин: мотивация, рецепты, научные подходы к антиэйджу. Всё для энергии и молодости в одном месте.';

-- Update existing rows with default values
UPDATE public.admin_settings
SET channel_name = COALESCE(channel_name, 'АНТИЭЙДЖ ЛАБ'),
    channel_description = COALESCE(channel_description, 'Закрытый Telegram-канал для женщин: мотивация, рецепты, научные подходы к антиэйджу. Всё для энергии и молодости в одном месте.');