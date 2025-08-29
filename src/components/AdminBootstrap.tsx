import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Shield, Loader2 } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

interface AdminBootstrapProps {
  onSuccess: () => void;
}

const AdminBootstrap: React.FC<AdminBootstrapProps> = ({ onSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const makeFirstAdmin = httpsCallable(functions, 'makeFirstAdmin');

  const handleMakeAdmin = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    
    try {
      const result = await makeFirstAdmin();
      const data = result.data as { success: boolean; message: string };
      
      setSuccess(data.message);
      setTimeout(() => {
        onSuccess();
      }, 2000);
      
    } catch (err: any) {
      setError(err.message || 'Failed to setup admin access');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md mx-4">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <Shield className="h-12 w-12 text-blue-500" />
          </div>
          <CardTitle>First-Time Setup</CardTitle>
          <CardDescription>
            Set yourself as the system administrator
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-center">
            <p className="text-sm text-gray-600 mb-4">
              You're the first user in the system. Click below to give yourself admin privileges 
              so you can manage other users and access all features.
            </p>
            <p className="text-xs text-gray-500 mb-4">
              This is a one-time setup process.
            </p>
          </div>
          
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          
          {success && (
            <Alert>
              <AlertDescription className="text-green-600">
                {success}
              </AlertDescription>
            </Alert>
          )}
          
          <Button 
            onClick={handleMakeAdmin}
            disabled={loading || success !== null}
            className="w-full"
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {loading ? 'Setting Up...' : 'Make Me Admin'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminBootstrap;