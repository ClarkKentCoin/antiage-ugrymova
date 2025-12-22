-- Add welcome message fields to admin_settings
ALTER TABLE admin_settings
ADD COLUMN IF NOT EXISTS welcome_message_text text DEFAULT '🌟 Добро пожаловать в АНТИЭЙДЖ ЛАБ!

Закрытый Telegram-канал для женщин о секретах молодости, здоровья и долголетия.

💎 Нажмите кнопку ниже, чтобы выбрать подписку и получить доступ к эксклюзивному контенту.';

ALTER TABLE admin_settings
ADD COLUMN IF NOT EXISTS welcome_message_image_url text;

ALTER TABLE admin_settings
ADD COLUMN IF NOT EXISTS welcome_message_button_text text DEFAULT 'Подробнее';

-- Update existing rows to have defaults if null
UPDATE admin_settings 
SET welcome_message_text = '🌟 Добро пожаловать в АНТИЭЙДЖ ЛАБ!

Закрытый Telegram-канал для женщин о секретах молодости, здоровья и долголетия.

💎 Нажмите кнопку ниже, чтобы выбрать подписку и получить доступ к эксклюзивному контенту.'
WHERE welcome_message_text IS NULL;

UPDATE admin_settings 
SET welcome_message_button_text = 'Подробнее'
WHERE welcome_message_button_text IS NULL;