import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeManualTransfer,
  authorizeScheduledTransfer,
  type TransferAccount,
  type TransferDestination,
} from "./authorization.js";

const enabledAccount: TransferAccount = { enabled: true, mayTransfer: true };
const openDestination: TransferDestination = { blocked: false };
const blockedDestination: TransferDestination = { blocked: true };

for (const [name, authorize] of [
  ["manual", authorizeManualTransfer],
  ["scheduled", authorizeScheduledTransfer],
] as const) {
  test(`${name} transfer allows an eligible account and open destination`, () => {
    assert.equal(authorize(enabledAccount, openDestination), "allowed");
  });

  test(`${name} transfer reports a disabled account first`, () => {
    assert.equal(
      authorize({ enabled: false, mayTransfer: false }, blockedDestination),
      "account-disabled",
    );
  });

  test(`${name} transfer checks permission before destination`, () => {
    assert.equal(
      authorize({ enabled: true, mayTransfer: false }, blockedDestination),
      "transfer-not-permitted",
    );
  });

  test(`${name} transfer rejects a blocked destination`, () => {
    assert.equal(
      authorize(enabledAccount, blockedDestination),
      "destination-blocked",
    );
  });
}
