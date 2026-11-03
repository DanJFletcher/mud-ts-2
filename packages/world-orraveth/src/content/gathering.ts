import type { WorldPackContent } from '@mudd/contracts';
import type { FishingSpeciesDefinition } from '@mudd/contracts';
const lowerRillFishSpecies = [
  {
    id: 'smallmouth-bass',
    name: 'Smallmouth bass',
    itemTypeId: 'river-fish',
    weightPercent: 50,
    sizeBands: [
      { rarity: 'common', weightPercent: 35, minLengthCm: 15, maxLengthCm: 25, minWeightGrams: 100, maxWeightGrams: 300 },
      { rarity: 'uncommon', weightPercent: 59, minLengthCm: 25, maxLengthCm: 40, minWeightGrams: 300, maxWeightGrams: 1200 },
      { rarity: 'rare', weightPercent: 5, minLengthCm: 45, maxLengthCm: 55, minWeightGrams: 1800, maxWeightGrams: 3000 },
      { rarity: 'trophy', weightPercent: 1, minLengthCm: 56, maxLengthCm: 69, minWeightGrams: 3001, maxWeightGrams: 5410 },
    ],
  },
  {
    id: 'common-carp',
    name: 'Common carp',
    itemTypeId: 'river-fish',
    weightPercent: 45,
    sizeBands: [
      { rarity: 'common', weightPercent: 35, minLengthCm: 25, maxLengthCm: 40, minWeightGrams: 500, maxWeightGrams: 2000 },
      { rarity: 'uncommon', weightPercent: 59, minLengthCm: 45, maxLengthCm: 75, minWeightGrams: 2000, maxWeightGrams: 7000 },
      { rarity: 'rare', weightPercent: 5, minLengthCm: 90, maxLengthCm: 110, minWeightGrams: 15000, maxWeightGrams: 25000 },
      { rarity: 'trophy', weightPercent: 1, minLengthCm: 111, maxLengthCm: 129, minWeightGrams: 40000, maxWeightGrams: 50000 },
    ],
  },
  {
    id: 'rainbow-trout',
    name: 'Rainbow trout',
    itemTypeId: 'river-fish',
    weightPercent: 5,
    sizeBands: [
      { rarity: 'common', weightPercent: 35, minLengthCm: 20, maxLengthCm: 30, minWeightGrams: 100, maxWeightGrams: 300 },
      { rarity: 'uncommon', weightPercent: 59, minLengthCm: 30, maxLengthCm: 50, minWeightGrams: 300, maxWeightGrams: 1500 },
      { rarity: 'rare', weightPercent: 5, minLengthCm: 60, maxLengthCm: 85, minWeightGrams: 3000, maxWeightGrams: 8000 },
      { rarity: 'trophy', weightPercent: 1, minLengthCm: 86, maxLengthCm: 107, minWeightGrams: 8001, maxWeightGrams: 21770 },
    ],
  },
] satisfies FishingSpeciesDefinition[];
export const supplySources = [] satisfies WorldPackContent['supplySources'];
export const woodcuttingTrees = [{
    id: 'bellwold-southbound-pine',
    locationId: 'bellwold-southbound-track',
    label: 'pine',
    roomDescription: 'A pine tree stands beside the packed road, its resin scent sharp in the air.',
    stumpDescription: 'The stump of a pine stands beside the packed road.',
    logTypeId: 'pine-logs',
    logLabel: 'Pine Logs',
    logDescription: 'A bundled set of fresh pine logs, still carrying a sharp resin scent.',
    maximumLogs: 5,
    respawnSeconds: 60,
    experiencePerLog: 25,
    baseChancePercent: 10,
  }] satisfies WorldPackContent['woodcuttingTrees'];
export const fishingSpots = [{
    id: 'bellwold-south-bridge-fishing',
    locationId: 'bellwold-river-bridge',
    stateId: 'on',
    label: 'Lower Rill Bridge',
    tickSeconds: 1,
    species: lowerRillFishSpecies,
  }, {
    id: 'rill-towpath-mooring-fishing',
    locationId: 'rill-towpath-mooring-posts',
    label: 'Towpath mooring posts',
    tickSeconds: 1,
    species: lowerRillFishSpecies,
  }, {
    id: 'mosswake-landing-fishing',
    locationId: 'mosswake-landing',
    label: 'Mosswake landing',
    tickSeconds: 5,
    species: lowerRillFishSpecies,
  }] satisfies WorldPackContent['fishingSpots'];
