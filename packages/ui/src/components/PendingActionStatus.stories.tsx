import type { Meta, StoryObj } from "@storybook/react";
import { PendingActionStatus } from "./PendingActionStatus.js";

const meta = {
  title: "Feedback/PendingActionStatus",
  component: PendingActionStatus,
  args: { state: "sending", label: "Traveling north…" },
} satisfies Meta<typeof PendingActionStatus>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Sending: Story = { args: { state: "sending", label: "Sending message…" } };
export const Acknowledged: Story = { args: { state: "acknowledged", label: "Move accepted", detail: "Updating your location…" } };
export const Uncertain: Story = { args: { state: "uncertain", label: "Checking whether your message was delivered…" } };
export const Rejected: Story = { args: { state: "rejected", label: "The server could not accept that action." } };
