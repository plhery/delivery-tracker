-- A live invitation issued before short previews must retain its token and hash.
insert into auth.users(id, email) values ('a9999999-9999-4999-8999-999999999999', 'legacy-preview@example.test');
insert into public.friend_profiles(user_id, nickname) values ('a9999999-9999-4999-8999-999999999999', 'Legacy sender');
insert into public.friend_invites(user_id, code_hash, expires_at)
values ('a9999999-9999-4999-8999-999999999999', encode(sha256(convert_to(repeat('ab', 16), 'UTF8')), 'hex'), now() + interval '7 days');
