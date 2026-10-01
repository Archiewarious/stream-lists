// AES-GCM for secrets stored in D1 (the Pointauc token). Key: TOKEN_ENCRYPTION_KEY, 32 random bytes in base64.

const base64ToBytes = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
const bytesToBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

const importKey = (keyBase64: string) =>
  crypto.subtle.importKey('raw', base64ToBytes(keyBase64), 'AES-GCM', false, ['encrypt', 'decrypt']);

/** base64(iv ‖ ciphertext); a fresh random IV every time. */
export const encryptText = async (text: string, keyBase64: string) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await importKey(keyBase64), new TextEncoder().encode(text));
  return bytesToBase64(new Uint8Array([...iv, ...new Uint8Array(encrypted)]));
};

export const decryptText = async (stored: string, keyBase64: string) => {
  const bytes = base64ToBytes(stored);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, 12) },
    await importKey(keyBase64),
    bytes.slice(12),
  );
  return new TextDecoder().decode(decrypted);
};
