-- Шаблоны уведомлений
ALTER TABLE admin_settings
ADD COLUMN IF NOT EXISTS notification_payment_reminder text DEFAULT '⏰ Напоминание о списании

Через {days} дней будет списана оплата за продление подписки на канал "{channel_name}".

💰 Сумма: {amount}₽
📅 Дата списания: {payment_date}

Если хотите отключить автопродление, сделайте это в настройках подписки.',

ADD COLUMN IF NOT EXISTS notification_payment_success text DEFAULT '✅ Оплата успешна

Ваша подписка на канал "{channel_name}" успешно продлена!

💰 Списано: {amount}₽
📅 Действует до: {expires_date}

Спасибо что с нами! 💙',

ADD COLUMN IF NOT EXISTS notification_payment_failed text DEFAULT '❌ Ошибка оплаты

Не удалось списать средства за продление подписки на канал "{channel_name}".

💰 Сумма: {amount}₽
❗ Причина: {error_message}

У вас есть {grace_days} дней для продления вручную. После этого доступ к каналу будет закрыт.',

ADD COLUMN IF NOT EXISTS notification_grace_period_warning text DEFAULT '⚠️ Последнее предупреждение

Ваша подписка на канал "{channel_name}" истекла.

У вас осталось {days} дней для продления. После этого вы будете удалены из канала и потеряете доступ к архиву сообщений.

💎 Продлите сейчас, чтобы сохранить доступ.',

ADD COLUMN IF NOT EXISTS notification_subscription_expired text DEFAULT '❗ Подписка завершена

Ваша подписка на канал "{channel_name}" завершена, и вы были удалены из канала.

Чтобы вернуть доступ и историю сообщений, оформите новую подписку.';