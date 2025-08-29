import React from 'react';
import { useAuth } from '../hooks/useAuth';
import Login from './Login';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Clock, XCircle, AlertTriangle, RefreshCw } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { user, loading, signOutUser, refreshUser } = useAuth();

  // Show loading spinner while checking auth state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto"></div>
          <p className="mt-2 text-sm text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Show login if user is not authenticated
  if (!user) {
    return <Login />;
  }

  // Check user approval status
  if (user.isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md mx-4">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <Clock className="h-12 w-12 text-yellow-500" />
            </div>
            <CardTitle>Account Pending Approval</CardTitle>
            <CardDescription>
              Your account has been created successfully but is pending admin approval.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-center">
              <p className="text-sm text-gray-600 mb-4">
                Hi <strong>{user.displayName || user.email}</strong>, your account is waiting for admin approval. 
                You'll receive access once an administrator reviews your request.
              </p>
              <p className="text-xs text-gray-500 mb-4">
                This usually takes 24-48 hours during business days.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Button 
                variant="outline" 
                onClick={refreshUser}
                className="flex items-center gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Check Status
              </Button>
              <Button 
                variant="ghost" 
                onClick={signOutUser}
                className="text-gray-600"
              >
                Sign Out
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check if user was rejected
  if (user.claims.status === 'rejected') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md mx-4">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <XCircle className="h-12 w-12 text-red-500" />
            </div>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              Your account request has been declined.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-center">
              <p className="text-sm text-gray-600 mb-4">
                Unfortunately, your access request for this system has been declined by an administrator.
              </p>
              <p className="text-xs text-gray-500 mb-4">
                Please contact your system administrator if you believe this is an error.
              </p>
            </div>
            <Button 
              variant="outline" 
              onClick={signOutUser}
              className="w-full"
            >
              Sign Out
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check if user is suspended
  if (user.claims.status === 'suspended') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md mx-4">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <AlertTriangle className="h-12 w-12 text-orange-500" />
            </div>
            <CardTitle>Account Suspended</CardTitle>
            <CardDescription>
              Your account has been temporarily suspended.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-center">
              <p className="text-sm text-gray-600 mb-4">
                Your account access has been temporarily suspended. Please contact your system administrator for more information.
              </p>
            </div>
            <Button 
              variant="outline" 
              onClick={signOutUser}
              className="w-full"
            >
              Sign Out
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show protected content if user is approved
  if (user.isApproved) {
    return <>{children}</>;
  }

  // Fallback for any other status
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md mx-4">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <AlertTriangle className="h-12 w-12 text-gray-500" />
          </div>
          <CardTitle>Access Restricted</CardTitle>
          <CardDescription>
            Unable to verify account status.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-center">
            <p className="text-sm text-gray-600 mb-4">
              There seems to be an issue with your account status. Please try refreshing or contact support.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Button 
              variant="outline" 
              onClick={refreshUser}
              className="flex items-center gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh Status
            </Button>
            <Button 
              variant="ghost" 
              onClick={signOutUser}
              className="text-gray-600"
            >
              Sign Out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ProtectedRoute; 