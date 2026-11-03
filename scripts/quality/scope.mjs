export function isSource(path) {
  return /\.(?:[cm]?js|tsx?)$/.test(path) && /^(apps\/|packages\/|engine-contracts\/|scripts\/quality\/|eslint.config.mjs$)/.test(path) && !/(?:^|\/)(?:dist|node_modules|coverage|storybook-static|originals)\//.test(path);
}
export function isExempt(path) {
  return /\.(?:test|spec|stories)\.[^.]+$/.test(path) || /(?:^|\/)(?:tests|__tests__)\//.test(path);
}
