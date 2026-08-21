import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

export interface TokenCipher {
  encrypt(value: string): string;
  decrypt(value: string): string;
}

export class AesGcmTokenCipher implements TokenCipher {
  constructor(private readonly key: Buffer) {
    if (key.byteLength !== 32) throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes");
  }

  static fromBase64Key(value: string): AesGcmTokenCipher {
    return new AesGcmTokenCipher(Buffer.from(value, "base64"));
  }

  encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(":");
  }

  decrypt(value: string): string {
    const [version, encodedIv, encodedTag, encodedData] = value.split(":");
    if (version !== VERSION || !encodedIv || !encodedTag || !encodedData) throw new Error("Unsupported encrypted token format");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(encodedIv, "base64url"));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encodedData, "base64url")), decipher.final()]).toString("utf8");
  }
}
