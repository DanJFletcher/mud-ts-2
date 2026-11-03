import type { WorldPackContent } from '@mudd/contracts';
export const waterways = {
  'bellwold-river-west-reach': { requiresWaterTravel: true },
  'bellwold-river-willow-reach': { requiresWaterTravel: true },
  'bellwold-river-far-west-reach': { requiresWaterTravel: true },
  'bellwold-river-east-reach': { requiresWaterTravel: true },
  'bellwold-river-alder-reach': { requiresWaterTravel: true },
  'bellwold-river-far-east-reach': { requiresWaterTravel: true },
  'lower-rill-reed-reach': { requiresWaterTravel: true },
  'lower-rill-towpath-reach': { requiresWaterTravel: true },
  'lower-rill-west-of-rillford': { requiresWaterTravel: true },
  'lower-rill-sedge-reach': { requiresWaterTravel: true },
  'bellwold-river-bridge': {
    defaultStateId: 'on',
    states: [
      { id: 'on' },
      {
        id: 'under',
        requiresWaterTravel: true,
        name: 'Under Lower Rill Bridge',
        description: 'The river moves beneath the stone arches. The road bridge rumbles overhead as the current passes east and west.',
      },
    ],
  }
} satisfies WorldPackContent['locationContent'];
