export interface EngineerRate {
  email: string;          // lowercase, must end with @qualitastech.com
  name: string;
  hourlyRate: number;     // INR per hour, >= 0
  currency: 'INR';        // future-proofing; only INR for v1
  updatedAt: Date;
  updatedBy: string;      // email of admin who last edited
}

export type EngineerRateInput = Omit<EngineerRate, 'currency' | 'updatedAt'> & {
  currency?: 'INR';
};
