import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { SessionContext } from '@mudd/contracts';
import { DEMO_WORLD_INSTANCE_ID } from '@mudd/world-demo';
import { db } from './db/client.js';
import { characters, players, sessions } from './db/schema.js';

const secret = process.env.SESSION_SECRET;
if (!secret) throw new Error('SESSION_SECRET is required to preserve existing guest accounts.');
export const GUEST_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

function hashToken(token: string): string {
  return createHmac('sha256', secret!).update(token).digest('hex');
}

function readGuestToken(request: { headers: { cookie?: string } }): string | undefined {
  const entry = request.headers.cookie?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith('mudd_guest='));
  if (!entry) return undefined;
  try {
    return decodeURIComponent(entry.slice('mudd_guest='.length));
  } catch {
    return undefined;
  }
}

export interface AccountIdentity {
  session: SessionContext;
  playerId: string;
  displayName: string;
  clearGuestCookie: boolean;
  isGuest: boolean;
}

interface ClerkIdentity {
  userId: string | null;
  sessionId: string | null;
}

export async function getAccountIdentity(
  request: { headers: { cookie?: string } },
  auth: ClerkIdentity,
): Promise<AccountIdentity | undefined> {
  const guestToken = readGuestToken(request);
  const tokenHash = guestToken ? hashToken(guestToken) : undefined;
  const guestPlayer = () => tokenHash
    ? db.select({
      id: players.id,
      displayName: players.displayName,
      sessionId: sessions.id,
    }).from(sessions)
      .innerJoin(players, eq(sessions.playerId, players.id))
      .where(and(
        eq(sessions.tokenHash, tokenHash),
        gt(sessions.expiresAt, new Date()),
        isNull(players.clerkUserId),
      )).limit(1).then((rows) => rows[0])
    : undefined;

  const guest = await guestPlayer();
  if (!auth.userId) {
    if (!guest) return undefined;
    return {
      session: {
        sessionId: guest.sessionId,
        playerId: guest.id,
        actorId: guest.id,
        worldInstanceId: DEMO_WORLD_INSTANCE_ID,
        grantedPermissions: [],
        authenticated: true,
      },
      playerId: guest.id,
      displayName: guest.displayName,
      clearGuestCookie: false,
      isGuest: true,
    };
  }

  const findAccount = () => db.select({
    id: players.id,
    displayName: players.displayName,
  }).from(players).where(eq(players.clerkUserId, auth.userId!)).limit(1);

  let [account] = await findAccount();

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
    isGuest: false,
  };
}

export async function createGuestIdentity(request: { headers: { cookie?: string } }): Promise<{
  identity: AccountIdentity;
  setCookie?: string;
}> {
  const existingToken = readGuestToken(request);
  const existingHash = existingToken ? hashToken(existingToken) : undefined;
  if (existingHash) {
    const [existing] = await db.select({
      id: players.id,
      displayName: players.displayName,
      sessionId: sessions.id,
    }).from(sessions)
      .innerJoin(players, eq(sessions.playerId, players.id))
      .where(and(
        eq(sessions.tokenHash, existingHash),
        gt(sessions.expiresAt, new Date()),
        isNull(players.clerkUserId),
      )).limit(1);
    if (existing) {
      return {
        identity: {
          session: {
            sessionId: existing.sessionId,
            playerId: existing.id,
            actorId: existing.id,
            worldInstanceId: DEMO_WORLD_INSTANCE_ID,
            grantedPermissions: [],
            authenticated: true,
          },
          playerId: existing.id,
          displayName: existing.displayName,
          clearGuestCookie: false,
          isGuest: true,
        },
      };
    }
  }

  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const playerId = randomUUID();
  const sessionId = randomUUID();
  const displayName = `Traveler ${playerId.slice(0, 4).toUpperCase()}`;
  const expiresAt = new Date(Date.now() + GUEST_SESSION_TTL_SECONDS * 1000);

  await db.transaction(async (tx) => {
    await tx.insert(players).values({ id: playerId, displayName, clerkUserId: null });
    await tx.insert(sessions).values({
      id: sessionId,
      playerId,
      tokenHash,
      expiresAt,
    });
  });

  return {
    identity: {
      session: {
        sessionId,
        playerId,
        actorId: playerId,
        worldInstanceId: DEMO_WORLD_INSTANCE_ID,
        grantedPermissions: [],
        authenticated: true,
      },
      playerId,
      displayName,
      clearGuestCookie: false,
      isGuest: true,
    },
    setCookie: guestCookie(token),
  };
}

function guestCookie(token: string): string {
  return `mudd_guest=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${GUEST_SESSION_TTL_SECONDS}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}

export const expiredGuestCookie = `mudd_guest=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
