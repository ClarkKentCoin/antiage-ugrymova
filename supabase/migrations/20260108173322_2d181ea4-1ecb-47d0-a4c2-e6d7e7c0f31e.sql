-- Admin-only tier: long duration (10 years), 0 price, no constraint changes

INSERT INTO public.subscription_tiers (
  name,
  description,
  duration_days,
  price,
  is_active,
  interval_unit,
  interval_count,
  billing_timezone
)
SELECT
  'Добавлен админом',
  'Доступ выдан администратором (10 лет, 0₽)',
  3650,
  0,
  true,
  'day',
  3650,
  'Europe/Moscow'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.subscription_tiers
  WHERE lower(name) = lower('Добавлен админом')
);