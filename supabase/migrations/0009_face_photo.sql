-- A face photo on a business card contact, so you remember who the person is.
-- Stored in the private 'cards' bucket next to the card photos
-- (<workspace>/<contact>/face-<ms>.jpg), so the existing storage rules,
-- delete and share copy cover it. Only adds a nullable column.

alter table public.contacts add column if not exists face_path text;
