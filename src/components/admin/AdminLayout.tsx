import { ReactNode, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { 
  Users, 
  CreditCard, 
  Settings, 
  Layers, 
  LogOut,
  LayoutDashboard,
  ScrollText,
  Menu,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface AdminLayoutProps {
  children: ReactNode;
}

const navItems = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/subscribers', label: 'Subscribers', icon: Users },
  { href: '/admin/tiers', label: 'Tiers', icon: Layers },
  { href: '/admin/payments', label: 'Payments', icon: CreditCard },
  { href: '/admin/logs', label: 'Logs', icon: ScrollText },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
];

function NavContent({ onNavigate, collapsed }: { onNavigate?: () => void; collapsed?: boolean }) {
  const location = useLocation();
  const { user, signOut } = useAuth();

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className={cn(
        "flex h-16 items-center border-b border-border",
        collapsed ? "justify-center px-2" : "px-6"
      )}>
        {!collapsed && (
          <h1 className="text-lg font-semibold text-foreground">
            Subscription Manager
          </h1>
        )}
        {collapsed && (
          <LayoutDashboard className="h-6 w-6 text-foreground" />
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-4">
        {navItems.map((item) => {
          const isActive = location.pathname === item.href;
          return (
            <Link
              key={item.href}
              to={item.href}
              onClick={onNavigate}
              title={collapsed ? item.label : undefined}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                collapsed && 'justify-center px-2',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              {!collapsed && item.label}
            </Link>
          );
        })}
      </nav>

      {/* User info & Sign out */}
      <div className="border-t border-border p-4 space-y-2">
        {!collapsed && user?.email && (
          <p className="truncate px-3 text-xs text-muted-foreground" title={user.email}>
            {user.email}
          </p>
        )}
        <Button
          variant="ghost"
          className={cn(
            "w-full gap-3 text-muted-foreground",
            collapsed ? "justify-center px-2" : "justify-start"
          )}
          onClick={signOut}
          title={collapsed ? "Sign Out" : undefined}
        >
          <LogOut className="h-5 w-5 shrink-0" />
          {!collapsed && "Sign Out"}
        </Button>
      </div>
    </div>
  );
}

export function AdminLayout({ children }: AdminLayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile Header */}
      <header className="fixed left-0 right-0 top-0 z-50 flex h-14 items-center gap-4 border-b border-border bg-card px-4 md:hidden">
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="shrink-0">
              <Menu className="h-5 w-5" />
              <span className="sr-only">Toggle menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <NavContent onNavigate={() => setMobileMenuOpen(false)} />
          </SheetContent>
        </Sheet>
        <h1 className="text-lg font-semibold">Subscription Manager</h1>
      </header>

      {/* Desktop Sidebar */}
      <aside 
        className={cn(
          "fixed left-0 top-0 z-40 hidden h-screen border-r border-border bg-card transition-all duration-300 md:block",
          sidebarCollapsed ? "w-16" : "w-64"
        )}
      >
        <NavContent collapsed={sidebarCollapsed} />
        
        {/* Collapse toggle button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="absolute -right-3 top-20 z-50 h-6 w-6 rounded-full border border-border bg-card shadow-sm hover:bg-accent"
        >
          {sidebarCollapsed ? (
            <ChevronRight className="h-3 w-3" />
          ) : (
            <ChevronLeft className="h-3 w-3" />
          )}
        </Button>
      </aside>

      {/* Main content */}
      <main 
        className={cn(
          "min-h-screen pt-14 md:pt-0 overflow-x-hidden transition-all duration-300",
          sidebarCollapsed ? "md:ml-16" : "md:ml-64"
        )}
      >
        <div className="w-full max-w-full px-4 py-6 md:px-6 md:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}