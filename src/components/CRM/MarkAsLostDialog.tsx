import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
import { LostReasonCategory, LOST_REASON_LABELS } from "@/types/crm";
import { markDealAsLost } from "@/utils/crmFirestore";
import { AlertTriangle } from "lucide-react";

interface MarkAsLostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string;
  dealName: string;
  onDealLost: () => void;
}

const LOST_REASONS: LostReasonCategory[] = [
  "price",
  "competition",
  "timing",
  "budget",
  "requirements",
  "no-response",
  "internal",
  "other",
];

const MarkAsLostDialog = ({
  open,
  onOpenChange,
  dealId,
  dealName,
  onDealLost,
}: MarkAsLostDialogProps) => {
  const { toast } = useToast();
  const { user } = useAuth();

  const [reasonCategory, setReasonCategory] = useState<LostReasonCategory | "">("");
  const [reasonDetails, setReasonDetails] = useState("");
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setReasonCategory("");
    setReasonDetails("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!reasonCategory) {
      toast({ title: "Please select a reason", variant: "destructive" });
      return;
    }

    if (!user?.uid) {
      toast({ title: "You must be logged in", variant: "destructive" });
      return;
    }

    setSaving(true);

    try {
      await markDealAsLost(
        dealId,
        reasonCategory,
        reasonDetails.trim(),
        user.uid
      );

      toast({ title: "Deal marked as lost and archived" });
      resetForm();
      onDealLost();
      onOpenChange(false);
    } catch (error) {
      console.error("Error marking deal as lost:", error);
      toast({ title: "Error updating deal", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="h-5 w-5" />
            Mark as Lost
          </DialogTitle>
          <DialogDescription>
            This will mark "{dealName}" as lost and archive it. You can restore it later if needed.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Lost Reason Category */}
          <div className="space-y-2">
            <Label htmlFor="reason">Why was this deal lost? *</Label>
            <Select
              value={reasonCategory}
              onValueChange={(v) => setReasonCategory(v as LostReasonCategory)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {LOST_REASONS.map((reason) => (
                  <SelectItem key={reason} value={reason}>
                    {LOST_REASON_LABELS[reason]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Details */}
          <div className="space-y-2">
            <Label htmlFor="details">Additional Details</Label>
            <Textarea
              id="details"
              value={reasonDetails}
              onChange={(e) => setReasonDetails(e.target.value)}
              placeholder="Any specific details about why the deal was lost..."
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving}
              variant="destructive"
            >
              {saving ? "Processing..." : "Mark as Lost"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default MarkAsLostDialog;
