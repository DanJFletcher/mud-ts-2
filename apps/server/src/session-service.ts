import { createHmac, randomUUID } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { SessionContext } from '@mudd/contracts';
import { DEMO_WORLD_INSTANCE_ID } from '@mudd/world-demo';
import { db } from './db/client.js';
import { characters, players, sessions } from './db/schema.js';

const secret = process.env.SESSION_SECRET;
if (!secret) throw new Error('SESSION_SECRET is required to preserve existing guest accounts.');

function hashToken(token: string): string {
  return createHmac('sha256', secret!).update(token).digest('hex');
}

function readGuestToken(request: { headers: { cookie?: string } }): string | undefined {
  const entry = request.headers.cookie?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith('mudd_guest='));
  return entry ? decodeURIComponent(entry.slice('mudd_guest='.length)) : undefined;
}

export interface AccountIdentity {
  session: SessionContext;
  playerId: string;
  displayName: string;
  clearGuestCookie: boolean;
}

interface ClerkIdentity {
  userId: string | null;
  sessionId: string | null;
}

export async function getAccountIdentity(
  request: { headers: { cookie?: string } },
  auth: ClerkIdentity,
): Promise<AccountIdentity | undefined> {
  if (!auth.userId) return undefined;

  const guestToken = readGuestToken(request);
  const tokenHash = guestToken ? hashToken(guestToken) : undefined;

  const findAccount = () => db.select({
    id: players.id,
    displayName: players.displayName,
  }).from(players).where(eq(players.clerkUserId, auth.userId!)).limit(1);

  let [account] = await findAccount();

  const guestPlayer = () => tokenHash
    ? db.select({ id: players.id }).from(sessions)
      .innerJoin(players, eq(sessions.playerId, players.id))
      .where(and(
        eq(sessions.tokenHash, tokenHash),
        gt(sessions.expiresAt, new Date()),
        isNull(players.clerkUserId),
      )).limit(1).then((rows) => rows[0])
    : undefined;

  const guest = await guestPlayer();

  if (!account) {
    const newId = guest?.id ?? randomUUID();
    try {
      account = await db.transaction(async (tx) => {
        const [existing] = await tx.select({
          id: players.id,
          displayName: players.displayName,
        }).from(players).where(eq(players.clerkUserId, auth.userId!)).limit(1);
        if (existing) return existing;

        if (guest) {
          const [claimed] = await tx.update(players)
            .set({ clerkUserId: auth.userId! })
            .where(and(eq(players.id, guest.id), isNull(players.clerkUserId)))
            .returning({ id: players.id, displayName: players.displayName });
          if (claimed) {
            await tx.delete(sessions).where(eq(sessions.playerId, claimed.id));
            return claimed;
          }
          const [raced] = await tx.select({
            id: players.id,
            displayName: players.displayName,
          }).from(players).where(eq(players.clerkUserId, auth.userId!)).limit(1);
          if (raced) return raced;
        }

        await tx.insert(players).values({
          id: newId,
          displayName: `Traveler ${newId.slice(0, 4).toUpperCase()}`,
          clerkUserId: auth.userId!,
        }).onConflictDoNothing();
        const [created] = await tx.select({
          id: players.id,
          displayName: players.displayName,
        }).from(players).where(eq(players.clerkUserId, auth.userId!)).limit(1);
        if (!created) throw new Error('Could not create the account profile.');
        return created;
      });
    } catch (error) {
      [account] = await findAccount();
      if (!account) throw error;
    }
  }

  if (guest && guest.id !== account.id) {
    await db.transaction(async (tx) => {
      const [unclaimed] = await tx.select({ id: players.id }).from(players)
        .where(and(eq(players.id, guest.id), isNull(players.clerkUserId))).limit(1);
      if (!unclaimed) return;
      await tx.update(characters).set({ playerId: account!.id }).where(eq(characters.playerId, guest.id));
      await tx.delete(sessions).where(eq(sessions.playerId, guest.id));
      await tx.delete(players).where(and(eq(players.id, guest.id), isNull(players.clerkUserId)));
    });
  }

  return {
    session: {
      sessionId: auth.sessionId || auth.userId,
      playerId: account.id,
      actorId: account.id,
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      grantedPermissions: [],
      authenticated: true,
    },
    playerId: account.id,
    displayName: account.displayName,
    clearGuestCookie: Boolean(guestToken),
  };
}

export const expiredGuestCookie = `mudd_guest=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
