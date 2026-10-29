import { Link } from 'wouter';
import { Breadcrumbs, type BreadcrumbItem } from '@mudd/ui';

export function LobbyBreadcrumbs({ items }: { items: readonly BreadcrumbItem[] }) {
  return <Breadcrumbs items={items} renderLink={({ href, className, children }) =>
    <Link href={href} className={className}>{children}</Link>} />;
}
