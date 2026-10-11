// Base64 for the Web Crypto code (JWT, the stored Pointauc token). Shared with the extension, so no Workers-only APIs.

export const base64ToBytes = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
export const bytesToBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
