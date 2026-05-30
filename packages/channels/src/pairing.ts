import { randomBytes } from 'node:crypto';

const PAIRING_CODE_LENGTH = 8;
const PAIRING_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function generatePairingCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = randomBytes(PAIRING_CODE_LENGTH);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

interface PairingSession {
  code: string;
  adminId: string;
  expiresAt: Date;
  used: boolean;
}

export class PairingStore {
  private readonly sessions = new Map<string, PairingSession>();

  create(adminId: string): { code: string; expiresAt: string } {
    const code = generatePairingCode();
    const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);

    this.sessions.set(code, { code, adminId, expiresAt, used: false });

    return { code, expiresAt: expiresAt.toISOString() };
  }

  consume(code: string): string | null {
    this.purgeExpired();
    const session = this.sessions.get(code);

    if (!session || session.used || session.expiresAt < new Date()) {
      return null;
    }

    session.used = true;
    this.sessions.delete(code);

    return session.adminId;
  }

  private purgeExpired(): void {
    const now = new Date();
    for (const [key, session] of this.sessions) {
      if (session.expiresAt < now) {
        this.sessions.delete(key);
      }
    }
  }
}
