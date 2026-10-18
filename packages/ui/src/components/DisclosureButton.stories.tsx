import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { DisclosureButton } from './DisclosureButton.js';

function InteractiveDisclosure() {
  const [expanded, setExpanded] = useState(true);
  return (
    <div style={{ maxWidth: 360 }}>
      <DisclosureButton
        controls="quest-details-preview"
        expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        Current quests
      </DisclosureButton>
      <div id="quest-details-preview" hidden={!expanded} style={{ padding: 12 }}>
        The quest objectives appear here.
      </div>
    </div>
  );
}

const meta = {
  title: 'Foundation/DisclosureButton',
  component: DisclosureButton,
} satisfies Meta<typeof DisclosureButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Interactive: Story = {
  args: { controls: 'quest-details-preview', expanded: true, children: 'Current quests' },
  render: () => <InteractiveDisclosure />,
};
