-- A live single-invitation row must survive the move to multiple invitations.
insert into auth.users(id, email) values ('d8888888-8888-4888-8888-888888888888', 'legacy-multiple@example.test');
insert into public.friend_profiles(user_id, nickname) values ('d8888888-8888-4888-8888-888888888888', 'Legacy sender');
insert into public.friend_invites(user_id, code_hash, preview_id, expires_at)
values ('d8888888-8888-4888-8888-888888888888', encode(sha256(convert_to(repeat('cd', 16), 'UTF8')), 'hex'), 'LegacyPreview123', now() + interval '7 days');
