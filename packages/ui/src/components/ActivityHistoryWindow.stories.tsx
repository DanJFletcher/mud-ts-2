import type { Meta, StoryObj } from "@storybook/react";
import { ActivityHistoryWindow } from "./ActivityHistoryWindow.js";
const entries = Array.from({ length: 1000 }, (_, index) => ({
  id: String(index), kind: "narration" as const,
  text: `Activity ${index + 1}: A long passage describes the quiet road and the people travelling through it.`,
}));
const meta = {
  title: "Exploration/ActivityHistoryWindow", component: ActivityHistoryWindow,
  args: { entries, label: "Session history" },
  parameters: { a11y: { test: "error" } },
} satisfies Meta<typeof ActivityHistoryWindow>;
export default meta;
type Story = StoryObj<typeof meta>;
export const LongHistory: Story = {};
export const Narrow: Story = { decorators: [(Story) => <div style={{ width: 320 }}><Story /></div>] };
export const Dark: Story = { globals: { theme: "dark" } };
export const Light: Story = { globals: { theme: "light" } };
export const ReverseNotes: Story = { args: { reverse: true, label: "Field notes" } };
export const Empty: Story = { args: { entries: [] } };
