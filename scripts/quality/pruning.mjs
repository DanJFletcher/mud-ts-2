import { matchingSites } from './gate-sites.mjs';
export function pruneSites(ledger, findings, context) {
  const matches = findings.map(finding => matchingSites(finding, { ...context, sites: ledger.sites, headSites: ledger.sites })).filter(sites => sites.length === 1).flat();
  return { ...ledger, sites: ledger.sites.filter(site => matches.includes(site)) };
}
