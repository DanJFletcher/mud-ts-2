import { and, eq, sql } from 'drizzle-orm';
import {
  type LocationGroupCatalogSnapshot,
  type LocationGroupCatalogStoragePort,
  type LocationGroupDefinition,
} from '@mudd/contracts';
import { db } from './db/client.js';
import {
  worldLocationGroupCatalogs,
  worldLocationGroupMemberships,
  worldLocationGroups,
} from './db/schema.js';

export class PostgresLocationGroupCatalogStore implements LocationGroupCatalogStoragePort {
  async initialize(
    packId: string,
    packVersion: string,
    initialGroups: readonly LocationGroupDefinition[],
  ): Promise<void> {
    await db.transaction(async (tx) => {
      const inserted = await tx.insert(worldLocationGroupCatalogs)
        .values({ packId, packVersion, revision: 0 })
        .onConflictDoNothing()
        .returning({ packId: worldLocationGroupCatalogs.packId });
      if (inserted.length === 0) return;
      await this.insertGroups(tx, packId, packVersion, initialGroups);
    });
  }

  async read(packId: string, packVersion: string): Promise<LocationGroupCatalogSnapshot> {
    const [catalog] = await db.select({
      revision: worldLocationGroupCatalogs.revision,
    }).from(worldLocationGroupCatalogs).where(and(
      eq(worldLocationGroupCatalogs.packId, packId),
      eq(worldLocationGroupCatalogs.packVersion, packVersion),
    )).limit(1);
    if (!catalog) {
      throw new Error(`Location group catalog ${packId}@${packVersion} has not been initialized.`);
    }

    const [groupRows, membershipRows] = await Promise.all([
      db.select({
        id: worldLocationGroups.id,
        name: worldLocationGroups.name,
        type: worldLocationGroups.type,
        description: worldLocationGroups.description,
        metadata: worldLocationGroups.metadata,
      }).from(worldLocationGroups).where(and(
        eq(worldLocationGroups.packId, packId),
        eq(worldLocationGroups.packVersion, packVersion),
      )),
      db.select({
        groupId: worldLocationGroupMemberships.groupId,
        locationId: worldLocationGroupMemberships.locationId,
        isPrimary: worldLocationGroupMemberships.isPrimary,
      }).from(worldLocationGroupMemberships).where(and(
        eq(worldLocationGroupMemberships.packId, packId),
        eq(worldLocationGroupMemberships.packVersion, packVersion),
      )),
    ]);
    const membershipsByGroup = new Map<string, LocationGroupDefinition['memberships']>();
    for (const membership of membershipRows) {
      const memberships = membershipsByGroup.get(membership.groupId) ?? [];
      memberships.push({ locationId: membership.locationId, isPrimary: membership.isPrimary });
      membershipsByGroup.set(membership.groupId, memberships);
    }
    return {
      packId,
      packVersion,
      revision: catalog.revision,
      groups: groupRows.map((group) => ({
        id: group.id,
        name: group.name,
        type: group.type,
        ...(group.description ? { description: group.description } : {}),
        ...(group.metadata ? { metadata: group.metadata } : {}),
        memberships: membershipsByGroup.get(group.id) ?? [],
      })),
    };
  }

  async replace(
    packId: string,
    packVersion: string,
    expectedRevision: number,
    groups: readonly LocationGroupDefinition[],
  ): Promise<LocationGroupCatalogSnapshot | undefined> {
    return db.transaction(async (tx) => {
      const [updatedCatalog] = await tx.update(worldLocationGroupCatalogs).set({
        revision: sql`${worldLocationGroupCatalogs.revision} + 1`,
        updatedAt: new Date(),
      }).where(and(
        eq(worldLocationGroupCatalogs.packId, packId),
        eq(worldLocationGroupCatalogs.packVersion, packVersion),
        eq(worldLocationGroupCatalogs.revision, expectedRevision),
      )).returning({ revision: worldLocationGroupCatalogs.revision });
      if (!updatedCatalog) return undefined;

      await tx.delete(worldLocationGroups).where(and(
        eq(worldLocationGroups.packId, packId),
        eq(worldLocationGroups.packVersion, packVersion),
      ));
      await this.insertGroups(tx, packId, packVersion, groups);
      return {
        packId,
        packVersion,
        revision: updatedCatalog.revision,
        groups: groups.map((group) => structuredClone(group)),
      };
    });
  }

  private async insertGroups(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    packId: string,
    packVersion: string,
    groups: readonly LocationGroupDefinition[],
  ): Promise<void> {
    if (groups.length === 0) return;
    await tx.insert(worldLocationGroups).values(groups.map((group) => ({
      packId,
      packVersion,
      id: group.id,
      name: group.name,
      type: group.type,
      description: group.description ?? null,
      metadata: group.metadata ?? null,
    })));
    const memberships = groups.flatMap((group) => group.memberships.map((membership) => ({
      packId,
      packVersion,
      groupId: group.id,
      locationId: membership.locationId,
      isPrimary: membership.isPrimary,
    })));
    if (memberships.length > 0) {
      await tx.insert(worldLocationGroupMemberships).values(memberships);
    }
  }
}
