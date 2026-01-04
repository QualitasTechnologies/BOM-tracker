import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { DelayAttribution, DelayEntityType, DelayLogInput } from '@/types/milestone';
import {
  calculateDelayDays,
  formatMilestoneDate,
  validateDelayReason,
  DELAY_ATTRIBUTION_LABELS,
  DELAY_ATTRIBUTION_DESCRIPTIONS,
} from '@/types/milestone';

interface DelayLogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: DelayEntityType;
  entityId: string;
  entityName: string;
  previousDate: string;
  newDate: string;
  onSubmit: (input: DelayLogInput) => Promise<void>;
}

const DelayLogDialog = ({
  open,
  onOpenChange,
  entityType,
  entityId,
  entityName,
  previousDate,
  newDate,
  onSubmit,
}: DelayLogDialogProps) => {
  const [reason, setReason] = useState('');
  const [attribution, setAttribution] = useState<DelayAttribution | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const delayDays = calculateDelayDays(previousDate, newDate);
  const isDelay = delayDays > 0;

  const handleSubmit = async () => {
    setError(null);

    // Validate reason
    const reasonValidation = validateDelayReason(reason);
    if (!reasonValidation.valid) {
      setError(reasonValidation.error || 'Invalid reason');
      return;
    }

    // Validate attribution
    if (!attribution) {
      setError('Please select an attribution category');
      return;
    }

    setIsSaving(true);

    try {
      const input: DelayLogInput = {
        entityType,
        entityId,
        entityName,
        previousDate,
        newDate,
        reason: reason.trim(),
        attribution,
      };

      await onSubmit(input);

      // Reset form
      setReason('');
      setAttribution('');
    } catch (error: any) {
      setError(error.message || 'Failed to log delay');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    if (!isSaving) {
      setReason('');
      setAttribution('');
      setError(null);
      onOpenChange(false);
    }
  };

  const attributionOptions: { value: DelayAttribution; label: string; description: string }[] = [
    {
      value: 'internal-team',
      label: DELAY_ATTRIBUTION_LABELS['internal-team'],
      description: DELAY_ATTRIBUTION_DESCRIPTIONS['internal-team'],
    },
    {
      value: 'internal-process',
      label: DELAY_ATTRIBUTION_LABELS['internal-process'],
      description: DELAY_ATTRIBUTION_DESCRIPTIONS['internal-process'],
    },
    {
      value: 'external-client',
      label: DELAY_ATTRIBUTION_LABELS['external-client'],
      description: DELAY_ATTRIBUTION_DESCRIPTIONS['external-client'],
    },
    {
      value: 'external-vendor',
      label: DELAY_ATTRIBUTION_LABELS['external-vendor'],
      description: DELAY_ATTRIBUTION_DESCRIPTIONS['external-vendor'],
    },
    {
      value: 'external-other',
      label: DELAY_ATTRIBUTION_LABELS['external-other'],
      description: DELAY_ATTRIBUTION_DESCRIPTIONS['external-other'],
    },
  ];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            {isDelay ? 'Delay Detected' : 'Schedule Change Detected'}
          </DialogTitle>
          <DialogDescription>
            Please provide details about this {isDelay ? 'delay' : 'schedule change'} for tracking purposes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Change Summary */}
          <div className="bg-gray-50 p-4 rounded-lg space-y-2">
            <div className="text-sm">
              <span className="text-gray-500">{entityType === 'milestone' ? 'Milestone' : 'Project'}:</span>{' '}
              <span className="font-medium">{entityName}</span>
            </div>
            <div className="text-sm">
              <span className="text-gray-500">Previous Date:</span>{' '}
              <span className="font-medium">{formatMilestoneDate(previousDate)}</span>
            </div>
            <div className="text-sm">
              <span className="text-gray-500">New Date:</span>{' '}
              <span className="font-medium">{formatMilestoneDate(newDate)}</span>
            </div>
            <div className="text-sm">
              <span className="text-gray-500">Change:</span>{' '}
              <span className={`font-bold ${delayDays > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {delayDays > 0 ? `+${delayDays}` : delayDays} days
              </span>
            </div>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Reason */}
          <div className="space-y-2">
            <Label htmlFor="reason">
              Reason <span className="text-red-500">*</span>
              <span className="text-xs text-gray-400 ml-2">(min 20 characters)</span>
            </Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Describe why this date changed. Be specific - this will be visible to clients and used for tracking."
              rows={3}
              className="resize-none"
            />
            <div className="text-xs text-gray-400 text-right">
              {reason.trim().length}/20 characters minimum
            </div>
          </div>

          {/* Attribution */}
          <div className="space-y-3">
            <Label>
              Attribution <span className="text-red-500">*</span>
            </Label>
            <RadioGroup
              value={attribution}
              onValueChange={(v) => setAttribution(v as DelayAttribution)}
              className="space-y-2"
            >
              {attributionOptions.map((option) => (
                <div
                  key={option.value}
                  className={`flex items-start space-x-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    attribution === option.value
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  onClick={() => setAttribution(option.value)}
                >
                  <RadioGroupItem value={option.value} id={option.value} className="mt-0.5" />
                  <div className="flex-1">
                    <label
                      htmlFor={option.value}
                      className="text-sm font-medium cursor-pointer"
                    >
                      {option.label}
                    </label>
                    <p className="text-xs text-gray-500">{option.description}</p>
                  </div>
                </div>
              ))}
            </RadioGroup>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Log & Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DelayLogDialog;
