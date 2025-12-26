import { useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  ActivityType,
  DealStage,
  ACTIVITY_TYPE_LABELS,
} from "@/types/crm";
import { logActivity } from "@/utils/crmFirestore";

interface LogActivityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string;
  currentStage: DealStage;
  onActivityLogged: () => void;
}

const ACTIVITY_TYPES: ActivityType[] = [
  "call",
  "meeting",
  "email",
  "demo",
  "proposal",
  "follow-up",
  "note",
];

const LogActivityDialog = ({
  open,
  onOpenChange,
  dealId,
  currentStage,
  onActivityLogged,
}: LogActivityDialogProps) => {
  const { toast } = useToast();
  const { user } = useAuth();

  const [action, setAction] = useState("");
  const [type, setType] = useState<ActivityType>("note");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setAction("");
    setType("note");
    setNotes("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!action.trim()) {
      toast({ title: "Activity description is required", variant: "destructive" });
      return;
    }

    if (!user?.uid) {
      toast({ title: "You must be logged in", variant: "destructive" });
      return;
    }

    setSaving(true);

    try {
      await logActivity(dealId, {
        action: action.trim(),
        type,
        completedAt: new Date(),
        completedBy: user.uid,
        stageAtTime: currentStage,
        notes: notes.trim() || undefined,
      });

      toast({ title: "Activity logged" });
      resetForm();
      onActivityLogged();
      onOpenChange(false);
    } catch (error) {
      console.error("Error logging activity:", error);
      toast({ title: "Error logging activity", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Log Activity</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Activity Type */}
          <div className="space-y-2">
            <Label htmlFor="type">Activity Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as ActivityType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTIVITY_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {ACTIVITY_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Action Description */}
          <div className="space-y-2">
            <Label htmlFor="action">What happened? *</Label>
            <Input
              id="action"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="e.g., Sent proposal v1, Had discovery call"
              required
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional details or outcomes..."
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Log Activity"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default LogActivityDialog;
