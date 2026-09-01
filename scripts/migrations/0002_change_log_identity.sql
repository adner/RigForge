-- Accountable admin mutations. The value comes only from the verified Cloudflare
-- Access JWT (normally its normalized email claim), never from a request body.
ALTER TABLE change_log ADD COLUMN actor_identity TEXT;
