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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Deal,
  DealSource,
  Currency,
  DEAL_SOURCE_LABELS,
  CURRENCY_SYMBOLS,
  toJsDate,
} from "@/types/crm";
import { updateDeal } from "@/utils/crmFirestore";
import { Client } from "@/utils/settingsFirestore";

interface EditDealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal: Deal;
  clients: Client[];
  onDealUpdated: (updatedDeal: Partial<Deal>) => void;
}

const EditDealDialog = ({
  open,
  onOpenChange,
  deal,
  clients,
  onDealUpdated,
}: EditDealDialogProps) => {
  const { toast } = useToast();

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [clientId, setClientId] = useState("");
  const [source, setSource] = useState<DealSource>("organic");
  const [expectedValue, setExpectedValue] = useState("");
  const [currency, setCurrency] = useState<Currency>("INR");
  const [probability, setProbability] = useState("50");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [saving, setSaving] = useState(false);

  // Initialize form with deal data when dialog opens
  useEffect(() => {
    if (open && deal) {
      setName(deal.name || "");
      setDescription(deal.description || "");
      setClientId(deal.clientId || "");
      setSource(deal.source || "organic");
      setExpectedValue(deal.expectedValue?.toString() || "");
      setCurrency(deal.currency || "INR");
      setProbability(deal.probability?.toString() || "50");

      // Format date for input
      const closeDate = toJsDate(deal.expectedCloseDate);
      if (closeDate && !isNaN(closeDate.getTime())) {
        setExpectedCloseDate(closeDate.toISOString().split("T")[0]);
      } else {
        setExpectedCloseDate("");
      }
    }
  }, [open, deal]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast({ title: "Deal name is required", variant: "destructive" });
      return;
    }

    if (!clientId) {
      toast({ title: "Please select a client", variant: "destructive" });
      return;
    }

    setSaving(true);

    try {
      const updates: Partial<Deal> = {
        name: name.trim(),
        description: description.trim(),
        clientId,
        source,
        expectedValue: parseFloat(expectedValue) || 0,
        currency,
        probability: parseInt(probability) || 50,
        expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : new Date(),
        updatedAt: new Date(),
      };

      await updateDeal(deal.id, updates);

      toast({ title: "Deal updated successfully" });
      onDealUpdated(updates);
      onOpenChange(false);
    } catch (error) {
      console.error("Error updating deal:", error);
      toast({ title: "Error updating deal", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit Deal</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Deal Name */}
          <div className="space-y-2">
            <Label htmlFor="edit-name">Deal Name *</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Safety Vision AI System"
              required
            />
          </div>

          {/* Client */}
          <div className="space-y-2">
            <Label htmlFor="edit-client">Client *</Label>
            <Select value={clientId} onValueChange={setClientId} required>
              <SelectTrigger>
                <SelectValue placeholder="Select a client" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.company}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Value & Currency */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-2">
              <Label htmlFor="edit-value">Expected Value</Label>
              <Input
                id="edit-value"
                type="number"
                value={expectedValue}
                onChange={(e) => setExpectedValue(e.target.value)}
                placeholder="e.g., 2500000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-currency">Currency</Label>
              <Select value={currency} onValueChange={(v) => setCurrency(v as Currency)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="INR">{CURRENCY_SYMBOLS.INR} INR</SelectItem>
                  <SelectItem value="USD">{CURRENCY_SYMBOLS.USD} USD</SelectItem>
                  <SelectItem value="EUR">{CURRENCY_SYMBOLS.EUR} EUR</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Probability & Close Date */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="edit-probability">Win Probability (%)</Label>
              <Input
                id="edit-probability"
                type="number"
                min="0"
                max="100"
                value={probability}
                onChange={(e) => setProbability(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-closeDate">Expected Close Date</Label>
              <Input
                id="edit-closeDate"
                type="date"
                value={expectedCloseDate}
                onChange={(e) => setExpectedCloseDate(e.target.value)}
              />
            </div>
          </div>

          {/* Source */}
          <div className="space-y-2">
            <Label htmlFor="edit-source">Deal Source</Label>
            <Select value={source} onValueChange={(v) => setSource(v as DealSource)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(DEAL_SOURCE_LABELS) as DealSource[]).map((src) => (
                  <SelectItem key={src} value={src}>
                    {DEAL_SOURCE_LABELS[src]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="edit-description">Description</Label>
            <Textarea
              id="edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of the opportunity..."
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default EditDealDialog;
