-- Grant admin role to the user with the specified email (if they already signed up)
insert into public.user_roles (user_id, role)
select u.id, 'admin'::public.app_role
from auth.users u
where lower(u.email) = lower('clarkkentcoin@gmail.com')
  and not exists (
    select 1
    from public.user_roles ur
    where ur.user_id = u.id
      and ur.role = 'admin'::public.app_role
  );