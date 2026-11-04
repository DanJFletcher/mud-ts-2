export interface TransferAccount {
  enabled: boolean;
  mayTransfer: boolean;
}

export interface TransferDestination {
  blocked: boolean;
}

export type TransferDecision =
  | "account-disabled"
  | "transfer-not-permitted"
  | "destination-blocked"
  | "allowed";

function accountEligibilityRejection(
  account: TransferAccount,
): "account-disabled" | "transfer-not-permitted" | undefined {
  if (!account.enabled) return "account-disabled";
  if (!account.mayTransfer) return "transfer-not-permitted";
  return undefined;
}

export function authorizeManualTransfer(
  account: TransferAccount,
  destination: TransferDestination,
): TransferDecision {
  return (
    accountEligibilityRejection(account) ??
    (destination.blocked ? "destination-blocked" : "allowed")
  );
}

export function authorizeScheduledTransfer(
  account: TransferAccount,
  destination: TransferDestination,
): TransferDecision {
  return (
    accountEligibilityRejection(account) ??
    (destination.blocked ? "destination-blocked" : "allowed")
  );
}
