import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, Settings, Shield, Smartphone } from 'lucide-react';

export default function Index() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="container flex h-16 items-center justify-between">
          <h1 className="text-lg font-semibold">Subscription Manager</h1>
          <Link to="/admin/login">
            <Button>Admin Login</Button>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="container py-16 md:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
            Telegram Subscription
            <br />
            <span className="text-primary">Management System</span>
          </h1>
          <p className="mt-6 text-lg text-muted-foreground">
            Easily manage paid subscriptions for your private Telegram channel. 
            Add subscribers manually, track payments, and automate member management.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link to="/admin/login">
              <Button size="lg">Get Started</Button>
            </Link>
            <Link to="/telegram-app">
              <Button size="lg" variant="outline">
                <Smartphone className="mr-2 h-4 w-4" />
                User App Demo
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="container pb-16">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <Users className="h-10 w-10 text-primary" />
              <CardTitle className="mt-4">Manual Management</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Add subscribers manually when they pay via cash, bank transfer, or any other method.
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Settings className="h-10 w-10 text-primary" />
              <CardTitle className="mt-4">Flexible Tiers</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Create multiple subscription plans with different durations and prices.
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Shield className="h-10 w-10 text-primary" />
              <CardTitle className="mt-4">Auto-Expiry</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Automatically track and manage subscription expiry dates with reminders.
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Smartphone className="h-10 w-10 text-primary" />
              <CardTitle className="mt-4">Telegram Mini App</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Users can view their subscription status and manage it via Telegram Mini App.
              </CardDescription>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="container text-center text-sm text-muted-foreground">
          <p>Telegram Subscription Manager • Phase 1: Manual Management</p>
        </div>
      </footer>
    </div>
  );
}
