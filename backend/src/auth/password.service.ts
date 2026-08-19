import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

/**
 * PASSWORD HASHING — scrypt, from Node's own crypto module.
 *
 * Why not bcrypt: bcrypt needs a native build step that breaks on some Windows
 * and CI setups. scrypt is memory-hard, built into Node, needs no dependency,
 * and is an accepted choice for password storage.
 *
 * Format stored in the database: scrypt$N$r$p$salt$hash  (salt and hash in hex)
 * The parameters are stored WITH the hash, so they can be raised later without
 * invalidating existing passwords.
 */
@Injectable()
export class PasswordService {
  // ~100ms per hash on a normal laptop: slow enough to hurt brute force, fast
  // enough that a login does not feel laggy.
  private static readonly N = 16384; // CPU/memory cost
  private static readonly R = 8; // block size
  private static readonly P = 1; // parallelisation
  private static readonly KEYLEN = 64;

  async hash(plain: string): Promise<string> {
    const salt = crypto.randomBytes(16);
    const derived = await this.derive(plain, salt, {
      N: PasswordService.N,
      r: PasswordService.R,
      p: PasswordService.P,
    });
    return [
      'scrypt',
      PasswordService.N,
      PasswordService.R,
      PasswordService.P,
      salt.toString('hex'),
      derived.toString('hex'),
    ].join('$');
  }

  /** Constant-time comparison. Never short-circuits on a mismatch. */
  async verify(plain: string, stored: string): Promise<boolean> {
    try {
      const [scheme, n, r, p, saltHex, hashHex] = stored.split('$');
      if (scheme !== 'scrypt') return false;

      const expected = Buffer.from(hashHex, 'hex');
      const derived = await this.derive(plain, Buffer.from(saltHex, 'hex'), {
        N: Number(n),
        r: Number(r),
        p: Number(p),
        keylen: expected.length,
      });
      return crypto.timingSafeEqual(derived, expected);
    } catch {
      return false;
    }
  }

  private derive(
    plain: string,
    salt: Buffer,
    opts: { N: number; r: number; p: number; keylen?: number },
  ): Promise<Buffer> {
    const keylen = opts.keylen ?? PasswordService.KEYLEN;
    return new Promise((resolve, reject) => {
      crypto.scrypt(
        plain,
        salt,
        keylen,
        // maxmem must be raised explicitly or Node rejects these cost params.
        { N: opts.N, r: opts.r, p: opts.p, maxmem: 64 * 1024 * 1024 },
        (err, derived) => (err ? reject(err) : resolve(derived)),
      );
    });
  }
}
