import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

export default function AdminLogin() {
  const { user, isAdmin, isLoading, signIn, signUp, signOut } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [signUpSuccess, setSignUpSuccess] = useState(false);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (user && isAdmin) {
    return <Navigate to="/admin" replace />;
  }

  if (user && !isAdmin) {
    const handleLogout = async () => {
      await signOut();
      window.location.href = '/admin/login';
    };

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You don't have admin privileges. Please contact the administrator.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button variant="destructive" onClick={handleLogout}>
              Log out
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    setSignUpSuccess(false);

    if (mode === 'signup') {
      const { error } = await signUp(email, password);
      if (error) {
        setError(error.message);
      } else {
        setSignUpSuccess(true);
      }
    } else {
      const { error } = await signIn(email, password);
      if (error) {
        setError(error.message);
      }
    }
    
    setIsSubmitting(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">{mode === 'login' ? 'Admin Login' : 'Sign Up'}</CardTitle>
          <CardDescription>
            {mode === 'login'
              ? 'Sign in to access the subscription manager'
              : 'Create a new account'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {signUpSuccess ? (
            <div className="space-y-4 text-center">
              <div className="rounded-lg p-3 text-sm bg-primary/10 text-primary">
                Account created! Please check your email to confirm, then sign in.
              </div>
              <Button variant="outline" className="w-full" onClick={() => { setMode('login'); setSignUpSuccess(false); }}>
                Back to Login
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-lg p-3 text-sm bg-destructive/10 text-destructive">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {mode === 'login' ? 'Sign In' : 'Sign Up'}
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                {mode === 'login' ? (
                  <>Don't have an account?{' '}
                    <button type="button" className="text-primary underline" onClick={() => { setMode('signup'); setError(''); }}>
                      Sign up
                    </button>
                  </>
                ) : (
                  <>Already have an account?{' '}
                    <button type="button" className="text-primary underline" onClick={() => { setMode('login'); setError(''); }}>
                      Sign in
                    </button>
                  </>
                )}
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}