import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import type { SessionContext } from '@mudd/contracts';
import { db } from './db/client.js';
import { players, sessions } from './db/schema.js';

const worldInstanceId = 'mudd-demo-instance';
const secret = process.env.SESSION_SECRET;
if (!secret) throw new Error('SESSION_SECRET is required to run guest sessions.');

function hashToken(token: string): string {
  return createHmac('sha256', secret!).update(token).digest('hex');
}

function readCookie(request: { headers: { cookie?: string } }): string | undefined {
  const entry = request.headers.cookie?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith('mudd_guest='));
  return entry ? decodeURIComponent(entry.slice('mudd_guest='.length)) : undefined;
}

export interface GuestIdentity {
  session: SessionContext;
  playerId: string;
  displayName: string;
  cookie?: string;
}

export async function getGuestIdentity(request: { headers: { cookie?: string } }): Promise<GuestIdentity> {
  const token = readCookie(request);
  if (token) {
    const tokenHash = hashToken(token);
    const [row] = await db.select({
      sessionId: sessions.id,
      playerId: players.id,
      displayName: players.displayName,
    }).from(sessions).innerJoin(players, eq(sessions.playerId, players.id))
      .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
      .limit(1);
    if (row) {
      return {
        session: {
          sessionId: row.sessionId,
          playerId: row.playerId,
          actorId: row.playerId,
          worldInstanceId,
          grantedPermissions: [],
          authenticated: true,
        },
        playerId: row.playerId,
        displayName: row.displayName,
      };
    }
  }

  const playerId = randomUUID();
  const sessionId = randomUUID();
  const guestToken = randomBytes(32).toString('base64url');
  const displayName = `Guest ${playerId.slice(0, 4).toUpperCase()}`;
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 90);
  await db.transaction(async (tx) => {
    await tx.insert(players).values({ id: playerId, displayName });
    await tx.insert(sessions).values({
      id: sessionId,
      playerId,
      tokenHash: hashToken(guestToken),
      expiresAt,
    });
  });
  return {
    session: {
      sessionId,
      playerId,
      actorId: playerId,
      worldInstanceId,
      grantedPermissions: [],
      authenticated: true,
    },
    playerId,
    displayName,
    cookie: `mudd_guest=${encodeURIComponent(guestToken)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=7776000${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
  };
}
