'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentProps } from 'react';

type NavLinkProps = ComponentProps<typeof Link> & {
  href: string;
  // Match the path exactly instead of also matching everything below it.
  exact?: boolean;
};

// NavLink marks the link to the current section for the design system's styles.
export function NavLink({ href, exact, ...rest }: NavLinkProps) {
  const pathname = usePathname();
  const active = pathname === href || (!exact && pathname.startsWith(`${href}/`));
  return <Link href={href} aria-current={active ? 'page' : undefined} {...rest} />;
}
