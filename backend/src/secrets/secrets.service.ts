import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { AppConfigService } from '../config/app-config.service';

/**
 * AES-256-GCM encryption for test credentials.
 *
 * Rules this service exists to enforce:
 *  1. Credentials are never stored in plaintext.
 *  2. Credentials are never sent to the LLM. The model only sees reference
 *     names ("test_email", "test_password"); the browser worker swaps in the
 *     real value at the moment of typing.
 *  3. Credentials are never returned by any API endpoint.
 */
@Injectable()
export class SecretsService {
  private readonly logger = new Logger(SecretsService.name);
  private static readonly ALGO = 'aes-256-gcm';

  /** Reference names the LLM is allowed to use inside a step. */
  static readonly ALLOWED_VALUE_REFS = ['test_email', 'test_password'] as const;

  constructor(private readonly config: AppConfigService) {}

  /** Returns "iv:authTag:cipherText", all hex. */
  encrypt(plain: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(SecretsService.ALGO, this.config.secretsEncryptionKey, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), enc.toString('hex')].join(':');
  }

  decrypt(payload: string): string {
    const [ivHex, tagHex, dataHex] = payload.split(':');
    if (!ivHex || !tagHex || !dataHex) {
      throw new Error('Malformed encrypted payload');
    }
    const decipher = crypto.createDecipheriv(
      SecretsService.ALGO,
      this.config.secretsEncryptionKey,
      Buffer.from(ivHex, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  }

  /**
   * Builds the runtime lookup table the browser worker uses to resolve
   * valueRef -> real value. Called only inside the worker, never in a response.
   */
  buildRuntimeValues(secret: { emailCipher: string | null; passwordCipher: string | null } | null) {
    const values: Record<string, string> = {};
    if (!secret) return values;
    try {
      if (secret.emailCipher) values.test_email = this.decrypt(secret.emailCipher);
      if (secret.passwordCipher) values.test_password = this.decrypt(secret.passwordCipher);
    } catch (err) {
      this.logger.error('Failed to decrypt run credentials - was SECRETS_ENCRYPTION_KEY changed?');
      throw err;
    }
    return values;
  }

  /**
   * Removes secret values from any text before it is stored or displayed.
   * Applied to error messages, console logs and network URLs.
   */
  redact(text: string | null | undefined, values: Record<string, string>): string | null {
    if (!text) return text ?? null;
    let out = text;
    for (const [ref, value] of Object.entries(values)) {
      if (value && value.length >= 3) {
        out = out.split(value).join(`***${ref}***`);
      }
    }
    return out;
  }
}
