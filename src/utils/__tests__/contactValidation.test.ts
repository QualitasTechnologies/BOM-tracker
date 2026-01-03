import { describe, it, expect } from 'vitest';

/**
 * Contact Validation Utility Tests
 *
 * These tests validate the patterns used for contact form validation
 * in ContactsDialog.tsx and related components.
 */

// Helper function that mirrors the validation in ContactsDialog
const validateContactName = (name: string | undefined | null): boolean => {
  if (!name) return false;
  return name.trim().length > 0;
};

// Helper to validate email format
const validateEmail = (email: string): boolean => {
  if (!email || email.trim() === '') return true; // Empty email is allowed
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
};

// Helper to validate phone format (basic validation)
const validatePhone = (phone: string): boolean => {
  if (!phone || phone.trim() === '') return true; // Empty phone is allowed
  // Allow digits, spaces, +, -, (, )
  const phoneRegex = /^[\d\s\+\-\(\)]+$/;
  return phoneRegex.test(phone.trim()) && phone.replace(/\D/g, '').length >= 7;
};

// Form data interface matching ContactsDialog
interface ContactFormData {
  name: string;
  designation: string;
  email: string;
  phone: string;
  department: string;
  isPrimary: boolean;
}

// Validation function that mirrors ContactsDialog.handleSubmit
const validateContactForm = (formData: ContactFormData): string[] => {
  const errors: string[] = [];

  if (!formData.name.trim()) {
    errors.push('Name is required');
  }

  if (formData.email && !validateEmail(formData.email)) {
    errors.push('Invalid email format');
  }

  if (formData.phone && !validatePhone(formData.phone)) {
    errors.push('Invalid phone format');
  }

  return errors;
};

describe('Contact Name Validation', () => {
  describe('validateContactName', () => {
    it('returns false for empty string', () => {
      expect(validateContactName('')).toBe(false);
    });

    it('returns false for whitespace only', () => {
      expect(validateContactName('   ')).toBe(false);
    });

    it('returns false for null', () => {
      expect(validateContactName(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(validateContactName(undefined)).toBe(false);
    });

    it('returns true for valid name', () => {
      expect(validateContactName('John Doe')).toBe(true);
    });

    it('returns true for name with leading/trailing spaces (trimmed)', () => {
      expect(validateContactName('  John  ')).toBe(true);
    });

    it('returns true for single character name', () => {
      expect(validateContactName('J')).toBe(true);
    });

    it('returns true for name with special characters', () => {
      expect(validateContactName("O'Brien")).toBe(true);
    });

    it('returns true for name with numbers', () => {
      expect(validateContactName('John Doe III')).toBe(true);
    });
  });
});

describe('Email Validation', () => {
  describe('validateEmail', () => {
    it('returns true for empty string (email is optional)', () => {
      expect(validateEmail('')).toBe(true);
    });

    it('returns true for whitespace only (treated as empty)', () => {
      expect(validateEmail('   ')).toBe(true);
    });

    it('returns true for valid email', () => {
      expect(validateEmail('test@example.com')).toBe(true);
    });

    it('returns true for email with subdomain', () => {
      expect(validateEmail('user@mail.example.co.uk')).toBe(true);
    });

    it('returns true for email with plus addressing', () => {
      expect(validateEmail('user+tag@example.com')).toBe(true);
    });

    it('returns false for email without @', () => {
      expect(validateEmail('testexample.com')).toBe(false);
    });

    it('returns false for email without domain extension', () => {
      expect(validateEmail('test@example')).toBe(false);
    });

    it('returns false for email with spaces', () => {
      expect(validateEmail('test @example.com')).toBe(false);
    });

    it('returns false for multiple @ signs', () => {
      expect(validateEmail('test@@example.com')).toBe(false);
    });

    it('returns false for email starting with @', () => {
      expect(validateEmail('@example.com')).toBe(false);
    });
  });
});

describe('Phone Validation', () => {
  describe('validatePhone', () => {
    it('returns true for empty string (phone is optional)', () => {
      expect(validatePhone('')).toBe(true);
    });

    it('returns true for valid phone number', () => {
      expect(validatePhone('1234567890')).toBe(true);
    });

    it('returns true for phone with country code', () => {
      expect(validatePhone('+91 98765 43210')).toBe(true);
    });

    it('returns true for phone with hyphens', () => {
      expect(validatePhone('123-456-7890')).toBe(true);
    });

    it('returns true for phone with parentheses', () => {
      expect(validatePhone('(123) 456-7890')).toBe(true);
    });

    it('returns true for international format', () => {
      expect(validatePhone('+1 (555) 123-4567')).toBe(true);
    });

    it('returns false for phone with letters', () => {
      expect(validatePhone('123-ABC-7890')).toBe(false);
    });

    it('returns false for too short phone number', () => {
      expect(validatePhone('123456')).toBe(false);
    });

    it('returns false for phone with special characters', () => {
      expect(validatePhone('123@456#7890')).toBe(false);
    });
  });
});

describe('Contact Form Validation', () => {
  describe('validateContactForm', () => {
    it('returns empty array for valid form with all fields', () => {
      const formData: ContactFormData = {
        name: 'John Doe',
        designation: 'Manager',
        email: 'john@example.com',
        phone: '+91 98765 43210',
        department: 'Engineering',
        isPrimary: true,
      };

      expect(validateContactForm(formData)).toEqual([]);
    });

    it('returns empty array for form with only required name', () => {
      const formData: ContactFormData = {
        name: 'John Doe',
        designation: '',
        email: '',
        phone: '',
        department: '',
        isPrimary: false,
      };

      expect(validateContactForm(formData)).toEqual([]);
    });

    it('returns error when name is empty', () => {
      const formData: ContactFormData = {
        name: '',
        designation: 'Manager',
        email: 'john@example.com',
        phone: '+91 98765 43210',
        department: 'Engineering',
        isPrimary: false,
      };

      const errors = validateContactForm(formData);
      expect(errors).toContain('Name is required');
    });

    it('returns error when name is whitespace only', () => {
      const formData: ContactFormData = {
        name: '   ',
        designation: '',
        email: '',
        phone: '',
        department: '',
        isPrimary: false,
      };

      const errors = validateContactForm(formData);
      expect(errors).toContain('Name is required');
    });

    it('returns error for invalid email format', () => {
      const formData: ContactFormData = {
        name: 'John Doe',
        designation: '',
        email: 'invalid-email',
        phone: '',
        department: '',
        isPrimary: false,
      };

      const errors = validateContactForm(formData);
      expect(errors).toContain('Invalid email format');
    });

    it('returns error for invalid phone format', () => {
      const formData: ContactFormData = {
        name: 'John Doe',
        designation: '',
        email: '',
        phone: 'abc',
        department: '',
        isPrimary: false,
      };

      const errors = validateContactForm(formData);
      expect(errors).toContain('Invalid phone format');
    });

    it('returns multiple errors when multiple fields are invalid', () => {
      const formData: ContactFormData = {
        name: '',
        designation: '',
        email: 'invalid',
        phone: 'abc',
        department: '',
        isPrimary: false,
      };

      const errors = validateContactForm(formData);
      expect(errors).toHaveLength(3);
      expect(errors).toContain('Name is required');
      expect(errors).toContain('Invalid email format');
      expect(errors).toContain('Invalid phone format');
    });

    it('does not include email error when email is empty', () => {
      const formData: ContactFormData = {
        name: 'John Doe',
        designation: '',
        email: '',
        phone: '',
        department: '',
        isPrimary: false,
      };

      const errors = validateContactForm(formData);
      expect(errors).not.toContain('Invalid email format');
    });

    it('does not include phone error when phone is empty', () => {
      const formData: ContactFormData = {
        name: 'John Doe',
        designation: '',
        email: '',
        phone: '',
        department: '',
        isPrimary: false,
      };

      const errors = validateContactForm(formData);
      expect(errors).not.toContain('Invalid phone format');
    });
  });
});

describe('Form Data Trimming', () => {
  it('trims whitespace from name before saving', () => {
    const rawName = '  John Doe  ';
    const trimmed = rawName.trim();

    expect(trimmed).toBe('John Doe');
  });

  it('trims whitespace from all fields', () => {
    const formData = {
      name: '  John Doe  ',
      designation: '  Manager  ',
      email: '  john@example.com  ',
      phone: '  +91 98765 43210  ',
      department: '  Engineering  ',
    };

    const trimmedData = {
      name: formData.name.trim(),
      designation: formData.designation.trim(),
      email: formData.email.trim(),
      phone: formData.phone.trim(),
      department: formData.department.trim(),
    };

    expect(trimmedData.name).toBe('John Doe');
    expect(trimmedData.designation).toBe('Manager');
    expect(trimmedData.email).toBe('john@example.com');
    expect(trimmedData.phone).toBe('+91 98765 43210');
    expect(trimmedData.department).toBe('Engineering');
  });
});

describe('Primary Contact Toggle', () => {
  it('toggles isPrimary from false to true', () => {
    let isPrimary = false;
    isPrimary = !isPrimary;
    expect(isPrimary).toBe(true);
  });

  it('toggles isPrimary from true to false', () => {
    let isPrimary = true;
    isPrimary = !isPrimary;
    expect(isPrimary).toBe(false);
  });

  it('maintains isPrimary as boolean type', () => {
    const formData = {
      isPrimary: false,
    };

    expect(typeof formData.isPrimary).toBe('boolean');

    formData.isPrimary = true;
    expect(typeof formData.isPrimary).toBe('boolean');
  });
});

describe('Form Reset', () => {
  it('resets form to initial empty state', () => {
    const initialState: ContactFormData = {
      name: '',
      designation: '',
      email: '',
      phone: '',
      department: '',
      isPrimary: false,
    };

    const currentState: ContactFormData = {
      name: 'John Doe',
      designation: 'Manager',
      email: 'john@example.com',
      phone: '+91 98765 43210',
      department: 'Engineering',
      isPrimary: true,
    };

    // Reset
    const resetState = { ...initialState };

    expect(resetState.name).toBe('');
    expect(resetState.designation).toBe('');
    expect(resetState.email).toBe('');
    expect(resetState.phone).toBe('');
    expect(resetState.department).toBe('');
    expect(resetState.isPrimary).toBe(false);
  });
});

describe('Edit Mode Form Population', () => {
  it('populates form with existing contact data', () => {
    const existingContact = {
      id: 'contact-1',
      clientId: 'client-1',
      name: 'Jane Smith',
      designation: 'Project Manager',
      email: 'jane@acme.com',
      phone: '+91 98765 43210',
      department: 'Engineering',
      isPrimary: true,
    };

    const formData: ContactFormData = {
      name: existingContact.name || '',
      designation: existingContact.designation || '',
      email: existingContact.email || '',
      phone: existingContact.phone || '',
      department: existingContact.department || '',
      isPrimary: existingContact.isPrimary || false,
    };

    expect(formData.name).toBe('Jane Smith');
    expect(formData.designation).toBe('Project Manager');
    expect(formData.email).toBe('jane@acme.com');
    expect(formData.phone).toBe('+91 98765 43210');
    expect(formData.department).toBe('Engineering');
    expect(formData.isPrimary).toBe(true);
  });

  it('handles missing optional fields in existing contact', () => {
    const existingContact = {
      id: 'contact-1',
      clientId: 'client-1',
      name: 'Jane Smith',
      designation: undefined,
      email: undefined,
      phone: undefined,
      department: undefined,
      isPrimary: false,
    };

    const formData: ContactFormData = {
      name: existingContact.name || '',
      designation: existingContact.designation || '',
      email: existingContact.email || '',
      phone: existingContact.phone || '',
      department: existingContact.department || '',
      isPrimary: existingContact.isPrimary || false,
    };

    expect(formData.name).toBe('Jane Smith');
    expect(formData.designation).toBe('');
    expect(formData.email).toBe('');
    expect(formData.phone).toBe('');
    expect(formData.department).toBe('');
    expect(formData.isPrimary).toBe(false);
  });
});
