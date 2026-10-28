import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    select: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock('./db/client.js', () => ({ db: mockDb }));

import {
  createGuestIdentity,
  expiredGuestCookie,
  getAccountIdentity,
  GUEST_SESSION_TTL_SECONDS,
} from './session-service.js';

type Row = Record<string, unknown>;

let dbSelectRows: Row[][];
let txSelectRows: Row[][];
let updateReturningRows: Row[][];

function selectQuery(rows: Row[]) {
  const builder: Record<string, any> = {};
  builder.from = vi.fn(() => builder);
  builder.innerJoin = vi.fn(() => builder);
  builder.where = vi.fn(() => builder);
  builder.limit = vi.fn(async () => rows);
  return builder;
}

const tx = {
  select: vi.fn(() => selectQuery(txSelectRows.shift() ?? [])),
  update: vi.fn(() => {
    const builder: Record<string, any> = {};
    builder.set = vi.fn(() => builder);
    builder.where = vi.fn(() => ({
      returning: vi.fn(async () => updateReturningRows.shift() ?? []),
    }));
    return builder;
  }),
  delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
  insert: vi.fn(() => ({
    values: vi.fn(() => ({ onConflictDoNothing: vi.fn(async () => undefined) })),
  })),
};

const clerk = { userId: 'clerk-user-1', sessionId: 'clerk-session-1' };

function guestRow(overrides: Partial<Row> = {}): Row {
  return { id: 'guest-player-1', displayName: 'Traveler GUEST', sessionId: 'guest-session-1', ...overrides };
}

function cookie(token: string): string {
  return `mudd_guest=${encodeURIComponent(token)}`;
}

describe('account and guest session identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbSelectRows = [];
    txSelectRows = [];
    updateReturningRows = [];
    mockDb.select.mockImplementation(() => selectQuery(dbSelectRows.shift() ?? []));
    mockDb.transaction.mockImplementation(async (run: (transaction: typeof tx) => Promise<unknown>) => run(tx));
  });

  it('refuses to load guest identity handling without a session secret', async () => {
    vi.stubEnv('SESSION_SECRET', '');
    vi.resetModules();
    try {
      await expect(import('./session-service.js'))
        .rejects.toThrow('SESSION_SECRET is required to preserve existing guest accounts.');
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('returns no identity for an unauthenticated request without a guest cookie', async () => {
    await expect(getAccountIdentity({ headers: {} }, { userId: null, sessionId: null }))
      .resolves.toBeUndefined();
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('ignores a malformed guest cookie instead of failing identity lookup', async () => {
    await expect(getAccountIdentity(
      { headers: { cookie: 'mudd_guest=%E0%A4%A' } },
      { userId: null, sessionId: null },
    )).resolves.toBeUndefined();
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('resolves a valid guest session without granting account permissions', async () => {
    dbSelectRows.push([guestRow()]);

    const identity = await getAccountIdentity(
      { headers: { cookie: cookie('guest-token') } },
      { userId: null, sessionId: null },
    );

    expect(identity).toMatchObject({
      playerId: 'guest-player-1',
      displayName: 'Traveler GUEST',
      clearGuestCookie: false,
      isGuest: true,
      session: {
        sessionId: 'guest-session-1',
        playerId: 'guest-player-1',
        actorId: 'guest-player-1',
        grantedPermissions: [],
        authenticated: true,
      },
    });
  });

  it('uses the existing Clerk profile and falls back to the user ID for a missing session ID', async () => {
    dbSelectRows.push([{ id: 'account-1', displayName: 'Existing Traveler' }]);

    const identity = await getAccountIdentity({ headers: {} }, { userId: 'clerk-user-1', sessionId: null });

    expect(identity).toMatchObject({
      playerId: 'account-1',
      displayName: 'Existing Traveler',
      clearGuestCookie: false,
      isGuest: false,
      session: { sessionId: 'clerk-user-1', actorId: 'account-1' },
    });
  });

  it('claims a guest profile for a new Clerk account and deletes the guest session', async () => {
    dbSelectRows.push([guestRow()], []);
    txSelectRows.push([]);
    updateReturningRows.push([{ id: 'guest-player-1', displayName: 'Traveler GUEST' }]);

    const identity = await getAccountIdentity(
      { headers: { cookie: cookie('guest-token') } },
      clerk,
    );

    expect(identity).toMatchObject({
      playerId: 'guest-player-1',
      clearGuestCookie: true,
      isGuest: false,
    });
    expect(tx.update).toHaveBeenCalledTimes(1);
    expect(tx.delete).toHaveBeenCalledTimes(1);
  });

  it('migrates an unclaimed guest character to an already existing Clerk profile', async () => {
    dbSelectRows.push([guestRow()], [{ id: 'account-2', displayName: 'Account Traveler' }]);
    txSelectRows.push([{ id: 'guest-player-1' }]);

    const identity = await getAccountIdentity(
      { headers: { cookie: cookie('guest-token') } },
      clerk,
    );

    expect(identity).toMatchObject({
      playerId: 'account-2',
      displayName: 'Account Traveler',
      clearGuestCookie: true,
      isGuest: false,
    });
    expect(tx.update).toHaveBeenCalledTimes(1);
    expect(tx.delete).toHaveBeenCalledTimes(2);
  });

  it('does not migrate a guest profile that another request already claimed', async () => {
    dbSelectRows.push(
      [guestRow()],
      [{ id: 'account-2', displayName: 'Account Traveler' }],
    );
    txSelectRows.push([]);

    const identity = await getAccountIdentity(
      { headers: { cookie: cookie('guest-token') } },
      clerk,
    );

    expect(identity).toMatchObject({ playerId: 'account-2', clearGuestCookie: true });
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.delete).not.toHaveBeenCalled();
  });

  it('creates a Clerk profile when the transaction finds no prior profile', async () => {
    const created = { id: 'new-account', displayName: 'Traveler ABCD' };
    dbSelectRows.push([]);
    txSelectRows.push([], [created]);

    const identity = await getAccountIdentity({ headers: {} }, clerk);

    expect(identity).toMatchObject({ playerId: created.id, displayName: created.displayName });
    expect(tx.insert).toHaveBeenCalledTimes(1);
  });

  it('fails explicitly when a newly inserted Clerk profile cannot be read back', async () => {
    dbSelectRows.push([], []);
    txSelectRows.push([], []);

    await expect(getAccountIdentity({ headers: {} }, clerk))
      .rejects.toThrow('Could not create the account profile.');
  });

  it('uses a profile created by a racing transaction', async () => {
    const raced = { id: 'raced-account', displayName: 'Raced Traveler' };
    dbSelectRows.push([]);
    txSelectRows.push([raced]);

    const identity = await getAccountIdentity({ headers: {} }, clerk);

    expect(identity).toMatchObject({ playerId: raced.id, displayName: raced.displayName });
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('uses a raced guest claim when another request claims the guest first', async () => {
    dbSelectRows.push([guestRow()], []);
    txSelectRows.push([], [{ id: 'guest-player-1', displayName: 'Traveler GUEST' }]);
    updateReturningRows.push([]);

    const identity = await getAccountIdentity(
      { headers: { cookie: cookie('guest-token') } },
      clerk,
    );

    expect(identity).toMatchObject({ playerId: 'guest-player-1', clearGuestCookie: true });
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('recovers if profile creation races outside its transaction, but rethrows without a profile', async () => {
    const recovered = { id: 'recovered-account', displayName: 'Recovered Traveler' };
    dbSelectRows.push([], [recovered]);
    mockDb.transaction.mockRejectedValueOnce(new Error('unique profile race'));

    await expect(getAccountIdentity({ headers: {} }, clerk))
      .resolves.toMatchObject({ playerId: recovered.id });

    dbSelectRows.push([], []);
    mockDb.transaction.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(getAccountIdentity({ headers: {} }, clerk))
      .rejects.toThrow('database unavailable');
  });

  it('returns an existing guest session without rotating its cookie', async () => {
    dbSelectRows.push([guestRow()]);

    const result = await createGuestIdentity({ headers: { cookie: cookie('guest-token') } });

    expect(result).toMatchObject({
      identity: { playerId: 'guest-player-1', isGuest: true, clearGuestCookie: false },
    });
    expect(result.setCookie).toBeUndefined();
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it('replaces an expired guest cookie with a new guest identity', async () => {
    dbSelectRows.push([]);

    const result = await createGuestIdentity({ headers: { cookie: cookie('expired-token') } });

    expect(result.identity).toMatchObject({ isGuest: true, clearGuestCookie: false });
    expect(result.identity.session.sessionId).toMatch(/^[\da-f-]{36}$/i);
    expect(result.setCookie).toContain(`Max-Age=${GUEST_SESSION_TTL_SECONDS}`);
    expect(result.setCookie).toContain('HttpOnly; SameSite=Strict');
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(tx.insert).toHaveBeenCalledTimes(2);
  });

  it('creates a guest identity and exposes the expired-cookie header', async () => {
    const result = await createGuestIdentity({ headers: {} });

    expect(result.identity).toMatchObject({
      playerId: expect.any(String),
      isGuest: true,
      session: { playerId: expect.any(String), actorId: expect.any(String), authenticated: true },
    });
    expect(result.setCookie).toContain('mudd_guest=');
    expect(result.setCookie).toContain(`Max-Age=${GUEST_SESSION_TTL_SECONDS}`);
    expect(expiredGuestCookie).toContain('mudd_guest=;');
    expect(expiredGuestCookie).toContain('Max-Age=0');
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
  });
});
