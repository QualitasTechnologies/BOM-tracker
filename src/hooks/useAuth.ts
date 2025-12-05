import { useState, useEffect } from 'react';
import { User, signInWithPopup, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';

export interface UserClaims {
  role?: 'admin' | 'user' | 'viewer';
  status?: 'approved' | 'pending' | 'rejected' | 'suspended';
  createdAt?: string;
  approvedAt?: string;
  approvedBy?: string;
}

export interface AuthUser extends User {
  claims: UserClaims;
  isApproved: boolean;
  isPending: boolean;
  isAdmin: boolean;
}

export const useAuth = () => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Sign in with Google
  const signInWithGoogle = async () => {
    try {
      // Clear any existing auth state first
      await signOut(auth);
      
      // Create a fresh provider instance for each sign-in attempt
      const freshProvider = new GoogleAuthProvider();
      freshProvider.setCustomParameters({
        prompt: 'select_account',
        access_type: 'offline',
        include_granted_scopes: 'true'
      });
      
      console.log('Starting Google sign-in...');
      const result = await signInWithPopup(auth, freshProvider);
      console.log('Sign-in successful:', result.user.email);
      // Update user state immediately
      setUser(result.user);
      return { success: true, user: result.user };
    } catch (error: any) {
      console.error('Google sign-in error:', error);
      return { 
        success: false, 
        error: error.code === 'auth/popup-closed-by-user' 
          ? 'Sign-in was cancelled' 
          : error.code === 'auth/popup-blocked'
          ? 'Pop-up was blocked. Please allow pop-ups for this site.'
          : error.code === 'auth/unauthorized-domain'
          ? 'Domain not authorized. Please check Firebase settings.'
          : 'Sign-in failed. Please try again.' 
      };
    }
  };

  // Sign in with Email and Password
  const signInWithEmail = async (email: string, password: string) => {
    try {
      console.log('Starting email sign-in...');
      const result = await signInWithEmailAndPassword(auth, email, password);
      console.log('Email sign-in successful:', result.user.email);
      setUser(result.user);
      return { success: true, user: result.user };
    } catch (error: any) {
      console.error('Email sign-in error:', error);
      let errorMessage = 'Sign-in failed. Please try again.';
      
      switch (error.code) {
        case 'auth/user-not-found':
          errorMessage = 'No account found with this email.';
          break;
        case 'auth/wrong-password':
          errorMessage = 'Incorrect password.';
          break;
        case 'auth/invalid-email':
          errorMessage = 'Invalid email address.';
          break;
        case 'auth/user-disabled':
          errorMessage = 'This account has been disabled.';
          break;
        case 'auth/too-many-requests':
          errorMessage = 'Too many failed attempts. Please try again later.';
          break;
      }
      
      return { success: false, error: errorMessage };
    }
  };

  // Sign up with Email and Password
  const signUpWithEmail = async (email: string, password: string) => {
    try {
      console.log('Starting email sign-up...');
      const result = await createUserWithEmailAndPassword(auth, email, password);
      console.log('Email sign-up successful:', result.user.email);
      setUser(result.user);
      return { success: true, user: result.user };
    } catch (error: any) {
      console.error('Email sign-up error:', error);
      let errorMessage = 'Sign-up failed. Please try again.';
      
      switch (error.code) {
        case 'auth/email-already-in-use':
          errorMessage = 'An account with this email already exists.';
          break;
        case 'auth/invalid-email':
          errorMessage = 'Invalid email address.';
          break;
        case 'auth/weak-password':
          errorMessage = 'Password should be at least 6 characters.';
          break;
        case 'auth/operation-not-allowed':
          errorMessage = 'Email/password sign-up is not enabled.';
          break;
      }
      
      return { success: false, error: errorMessage };
    }
  };

  // Sign out
  const signOutUser = async () => {
    try {
      await signOut(auth);
      return { success: true };
    } catch (error: any) {
      console.error('Sign out error:', error);
      return { success: false, error: 'Sign out failed' };
    }
  };

  // Helper function to create AuthUser with claims
  const createAuthUser = async (firebaseUser: User): Promise<AuthUser> => {
    const tokenResult = await firebaseUser.getIdTokenResult();
    const claims = tokenResult.claims as UserClaims;
    
    return {
      ...firebaseUser,
      claims,
      isApproved: claims.status === 'approved',
      // User is pending if status is 'pending' OR if no status is set (new user)
      isPending: claims.status === 'pending' || !claims.status,
      isAdmin: claims.role === 'admin' && claims.status === 'approved'
    } as AuthUser;
  };

  // Listen for auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const authUser = await createAuthUser(firebaseUser);
          setUser(authUser);
        } catch (error) {
          console.error('Error getting user claims:', error);
          setUser(null);
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Function to refresh user claims (useful after admin approval)
  const refreshUser = async () => {
    if (auth.currentUser) {
      try {
        await auth.currentUser.getIdToken(true); // Force token refresh
        const authUser = await createAuthUser(auth.currentUser);
        setUser(authUser);
      } catch (error) {
        console.error('Error refreshing user:', error);
      }
    }
  };

  return {
    user,
    loading,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    signOutUser,
    refreshUser,
    isAdmin: user?.isAdmin || false,
  };
}; 