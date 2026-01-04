import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  User,
  Mail,
  Phone,
  Briefcase,
  Loader2,
  Star,
} from "lucide-react";
import { Contact } from "@/types/crm";
import { getContactsByClient, updateDeal } from "@/utils/crmFirestore";

interface AssignContactsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string;
  clientId: string;
  assignedContactIds: string[];
  onContactsUpdated: (contactIds: string[]) => void;
}

const AssignContactsDialog = ({
  open,
  onOpenChange,
  dealId,
  clientId,
  assignedContactIds,
  onContactsUpdated,
}: AssignContactsDialogProps) => {
  const { toast } = useToast();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Fetch contacts for this client
  useEffect(() => {
    if (!open || !clientId) return;

    const fetchContacts = async () => {
      setLoading(true);
      try {
        const contactsList = await getContactsByClient(clientId);
        setContacts(contactsList);
        setSelectedIds(assignedContactIds || []);
      } catch (error) {
        console.error("Error fetching contacts:", error);
        toast({ title: "Error loading contacts", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    };

    fetchContacts();
  }, [open, clientId, assignedContactIds, toast]);

  const toggleContact = (contactId: string) => {
    setSelectedIds((prev) =>
      prev.includes(contactId)
        ? prev.filter((id) => id !== contactId)
        : [...prev, contactId]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateDeal(dealId, { assignedContactIds: selectedIds });
      onContactsUpdated(selectedIds);
      toast({ title: "Contacts updated" });
      onOpenChange(false);
    } catch (error) {
      console.error("Error updating contacts:", error);
      toast({ title: "Error updating contacts", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Assign Contacts to Deal
          </DialogTitle>
        </DialogHeader>

        <div className="py-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : contacts.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              <User className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No contacts available for this client</p>
              <p className="text-sm">
                Add contacts in Settings → Clients first
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {contacts.map((contact) => (
                <label
                  key={contact.id}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedIds.includes(contact.id)
                      ? "bg-blue-50 border-blue-200"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <Checkbox
                    checked={selectedIds.includes(contact.id)}
                    onCheckedChange={() => toggleContact(contact.id)}
                    className="mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{contact.name}</span>
                      {contact.isPrimary && (
                        <Badge variant="secondary" className="text-xs">
                          <Star className="h-3 w-3 mr-1" />
                          Primary
                        </Badge>
                      )}
                    </div>
                    {contact.designation && (
                      <div className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Briefcase className="h-3 w-3" />
                        {contact.designation}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
                      {contact.email && (
                        <span className="flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {contact.email}
                        </span>
                      )}
                      {contact.phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {contact.phone}
                        </span>
                      )}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save ({selectedIds.length} selected)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AssignContactsDialog;
