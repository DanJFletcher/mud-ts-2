export type Environment = Readonly<Record<string, string | undefined>>;

export function readE2eAuthMode(environment: Environment): boolean {
  const flag = environment.MUDD_E2E_AUTH;
  if (flag === undefined || flag === '0') return false;
  if (flag !== '1') throw new Error('MUDD_E2E_AUTH must be set to 1 or 0.');
  if (environment.NODE_ENV !== 'test') {
    throw new Error('MUDD_E2E_AUTH is only available when NODE_ENV=test.');
  }
  return true;
}
