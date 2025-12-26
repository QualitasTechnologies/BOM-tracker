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
  Deal,
  DealSource,
  Currency,
  DEAL_SOURCE_LABELS,
  CURRENCY_SYMBOLS,
} from "@/types/crm";
import { createDeal, logActivity } from "@/utils/crmFirestore";
import { Client } from "@/utils/settingsFirestore";

interface AddDealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: Client[];
  onDealCreated: (dealId: string) => void;
  preselectedClientId?: string;
}

const AddDealDialog = ({
  open,
  onOpenChange,
  clients,
  onDealCreated,
  preselectedClientId,
}: AddDealDialogProps) => {
  const { toast } = useToast();
  const { user } = useAuth();

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [clientId, setClientId] = useState(preselectedClientId || "");
  const [source, setSource] = useState<DealSource>("organic");
  const [expectedValue, setExpectedValue] = useState("");
  const [currency, setCurrency] = useState<Currency>("INR");
  const [probability, setProbability] = useState("50");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setName("");
    setDescription("");
    setClientId(preselectedClientId || "");
    setSource("organic");
    setExpectedValue("");
    setCurrency("INR");
    setProbability("50");
    setExpectedCloseDate("");
  };

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

    if (!user?.uid) {
      toast({ title: "You must be logged in", variant: "destructive" });
      return;
    }

    setSaving(true);

    try {
      const dealData: Omit<Deal, "id"> = {
        name: name.trim(),
        description: description.trim(),
        clientId,
        assignedContactIds: [],
        stage: "new",
        probability: parseInt(probability) || 50,
        expectedValue: parseFloat(expectedValue) || 0,
        currency,
        expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : new Date(),
        source,
        assigneeId: user.uid,
        hasDraftBOM: false,
        draftBOMTotalCost: 0,
        nextStep: null,
        createdAt: new Date(),
        createdBy: user.uid,
        updatedAt: new Date(),
        lastActivityAt: new Date(),
        isArchived: false,
      };

      const dealId = await createDeal(dealData);

      // Log the creation activity
      await logActivity(dealId, {
        action: "Deal created",
        type: "note",
        completedAt: new Date(),
        completedBy: user.uid,
        stageAtTime: "new",
      });

      toast({ title: "Deal created successfully" });
      resetForm();
      onDealCreated(dealId);
    } catch (error) {
      console.error("Error creating deal:", error);
      toast({ title: "Error creating deal", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create New Deal</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Deal Name */}
          <div className="space-y-2">
            <Label htmlFor="name">Deal Name *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Safety Vision AI System"
              required
            />
          </div>

          {/* Client */}
          <div className="space-y-2">
            <Label htmlFor="client">Client *</Label>
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
            {clients.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No clients found. Add clients in Settings first.
              </p>
            )}
          </div>

          {/* Value & Currency */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-2">
              <Label htmlFor="value">Expected Value</Label>
              <Input
                id="value"
                type="number"
                value={expectedValue}
                onChange={(e) => setExpectedValue(e.target.value)}
                placeholder="e.g., 2500000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="currency">Currency</Label>
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
              <Label htmlFor="probability">Win Probability (%)</Label>
              <Input
                id="probability"
                type="number"
                min="0"
                max="100"
                value={probability}
                onChange={(e) => setProbability(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="closeDate">Expected Close Date</Label>
              <Input
                id="closeDate"
                type="date"
                value={expectedCloseDate}
                onChange={(e) => setExpectedCloseDate(e.target.value)}
              />
            </div>
          </div>

          {/* Source */}
          <div className="space-y-2">
            <Label htmlFor="source">Deal Source</Label>
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
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
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
              {saving ? "Creating..." : "Create Deal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AddDealDialog;
