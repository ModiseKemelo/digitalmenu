'use client';

import type {ReactNode} from 'react';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {Armchair, Bell, ChartNoAxesCombined, LayoutDashboard, ListOrdered, NotebookPen, QrCode, ScanLine, Settings, Users} from 'lucide-react';
import Brand from './Brand';

type NavLink = {href: string; label: string; icon: typeof ListOrdered; disabled?: boolean};

const staffLinks: NavLink[] = [
  {href: '/staff', label: 'Live orders', icon: ListOrdered},
  {href: '/staff/requests', label: 'Service calls', icon: Bell},
  {href: '/staff/order/new', label: 'Take an order', icon: NotebookPen},
  {href: '/staff/scan', label: 'Open a table', icon: ScanLine},
];

const adminLinks: NavLink[] = [
  {href: '/admin', label: 'Overview', icon: LayoutDashboard},
  {href: '/admin/tables', label: 'Tables & QR', icon: QrCode},
  {href: '/admin/menu', label: 'Menu', icon: ListOrdered, disabled: true},
  {href: '/admin/staff', label: 'Staff', icon: Users, disabled: true},
  {href: '/admin/reports', label: 'Reports', icon: ChartNoAxesCombined, disabled: true},
  {href: '/admin/settings', label: 'Settings', icon: Settings, disabled: true},
];

export default function OperationsShell({
  area,
  title,
  subtitle,
  children,
  actions,
}: {
  area: 'staff' | 'admin';
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const pathname = usePathname();
  const links = area === 'admin' ? adminLinks : staffLinks;

  return (
    <main className="ops-shell">
      <aside className="ops-sidebar">
        <Brand inverse />
        <p className="ops-area">{area === 'admin' ? 'Administration' : 'Service console'}</p>
        <nav className="ops-nav" aria-label={`${area} navigation`}>
          {links.map(({href, label, icon: Icon, disabled}) => {
            const active = href === `/${area}` ? pathname === href : pathname.startsWith(href);
            return disabled ? (
              <span key={href} className="ops-navlink ops-navlink-disabled" title="Planned screen">
                <Icon size={17} /> {label}<small>Soon</small>
              </span>
            ) : (
              <Link key={href} href={href} className={`ops-navlink${active ? ' active' : ''}`}>
                <Icon size={17} /> {label}
              </Link>
            );
          })}
        </nav>
        <div className="ops-sidebar-foot">
          <Armchair size={16} />
          <span>Evening service<br /><small>Secure connection</small></span>
        </div>
      </aside>
      <section className="ops-main">
        <header className="ops-topbar">
          <div>
            <p className="ops-kicker">Bukhara Restaurant</p>
            <h1>{title}</h1>
            {subtitle && <p className="ops-subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="ops-actions">{actions}</div>}
        </header>
        <div className="ops-content">{children}</div>
      </section>
    </main>
  );
}
