-- Pointauc personal token, AES-GCM encrypted with TOKEN_ENCRYPTION_KEY (src/crypto.ts). Never sent back to the browser.
ALTER TABLE channels ADD COLUMN pointauc_token TEXT;
