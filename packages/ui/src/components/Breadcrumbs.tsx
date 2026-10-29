import type { ReactNode } from 'react';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbLinkProps {
  href: string;
  className: string;
  children: ReactNode;
}

export interface BreadcrumbsProps {
  items: readonly BreadcrumbItem[];
  label?: string;
  className?: string;
  renderLink?: (props: BreadcrumbLinkProps) => ReactNode;
}

/** Compact, accessible location hierarchy. The final item is always the current page. */
export function Breadcrumbs({ items, label = 'Breadcrumb', className, renderLink }: BreadcrumbsProps) {
  if (items.length === 0) return null;

  return <nav className={['mudd-breadcrumbs', className].filter(Boolean).join(' ')} aria-label={label}>
    <ol>{items.map((item, index) => {
      const current = index === items.length - 1;
      const itemClassName = current ? 'mudd-breadcrumbs__current' : 'mudd-breadcrumbs__link';
      const content = item.href && !current
        ? renderLink
          ? renderLink({ href: item.href, className: itemClassName, children: item.label })
          : <a className={itemClassName} href={item.href}>{item.label}</a>
        : <span className={itemClassName} aria-current={current ? 'page' : undefined}>{item.label}</span>;

      return <li key={`${index}-${item.label}`}>{content}</li>;
    })}</ol>
  </nav>;
}
