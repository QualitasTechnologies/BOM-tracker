import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { DealNextStep } from "@/types/crm";
import { updateDeal } from "@/utils/crmFirestore";

interface NextStepDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string;
  currentNextStep: DealNextStep | null;
  onNextStepSaved: (nextStep: DealNextStep | null) => void;
}

const NextStepDialog = ({
  open,
  onOpenChange,
  dealId,
  currentNextStep,
  onNextStepSaved,
}: NextStepDialogProps) => {
  const { toast } = useToast();
  const { user } = useAuth();

  const [action, setAction] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  // Initialize form when dialog opens or currentNextStep changes
  useEffect(() => {
    if (open) {
      if (currentNextStep) {
        setAction(currentNextStep.action || "");
        if (currentNextStep.dueDate) {
          const date = currentNextStep.dueDate instanceof Date
            ? currentNextStep.dueDate
            : new Date(currentNextStep.dueDate);
          setDueDate(date.toISOString().split("T")[0]);
        } else {
          setDueDate("");
        }
      } else {
        setAction("");
        setDueDate("");
      }
    }
  }, [open, currentNextStep]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!action.trim()) {
      toast({ title: "Action is required", variant: "destructive" });
      return;
    }

    if (!user?.uid) {
      toast({ title: "You must be logged in", variant: "destructive" });
      return;
    }

    setSaving(true);

    try {
      const nextStep: DealNextStep = {
        action: action.trim(),
        dueDate: dueDate ? new Date(dueDate) : undefined,
        assigneeId: user.uid,
      };

      await updateDeal(dealId, { nextStep });

      toast({ title: "Next step saved" });
      onNextStepSaved(nextStep);
      onOpenChange(false);
    } catch (error) {
      console.error("Error saving next step:", error);
      toast({ title: "Error saving next step", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>
            {currentNextStep ? "Edit Next Step" : "Set Next Step"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Action */}
          <div className="space-y-2">
            <Label htmlFor="action">What's the next action? *</Label>
            <Input
              id="action"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="e.g., Send revised proposal, Schedule demo"
              required
            />
          </div>

          {/* Due Date */}
          <div className="space-y-2">
            <Label htmlFor="dueDate">Due Date (optional)</Label>
            <Input
              id="dueDate"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default NextStepDialog;
