import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Edit,
  Trash2,
  User,
  Mail,
  Phone,
  Briefcase,
  Loader2,
  Star,
  X,
  Save,
} from "lucide-react";
import { Contact } from "@/types/crm";
import {
  subscribeToClientContacts,
  createContact,
  updateContact,
  deleteContact,
} from "@/utils/crmFirestore";
import { Client } from "@/utils/settingsFirestore";

interface ContactsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: Client;
}

const ContactsDialog = ({ open, onOpenChange, client }: ContactsDialogProps) => {
  const { toast } = useToast();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    designation: "",
    email: "",
    phone: "",
    department: "",
    isPrimary: false,
  });

  // Subscribe to contacts for this client
  useEffect(() => {
    if (!open || !client.id) return;

    setLoading(true);
    const unsubscribe = subscribeToClientContacts(client.id, (contactsList) => {
      setContacts(contactsList);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [open, client.id]);

  const resetForm = () => {
    setFormData({
      name: "",
      designation: "",
      email: "",
      phone: "",
      department: "",
      isPrimary: false,
    });
    setEditingContact(null);
    setShowForm(false);
  };

  const handleEdit = (contact: Contact) => {
    setEditingContact(contact);
    setFormData({
      name: contact.name || "",
      designation: contact.designation || "",
      email: contact.email || "",
      phone: contact.phone || "",
      department: contact.department || "",
      isPrimary: contact.isPrimary || false,
    });
    setShowForm(true);
  };

  const handleDelete = async (contactId: string) => {
    if (!confirm("Are you sure you want to delete this contact?")) return;

    try {
      await deleteContact(contactId);
      toast({ title: "Contact deleted" });
    } catch (error) {
      console.error("Error deleting contact:", error);
      toast({ title: "Error deleting contact", variant: "destructive" });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }

    setSaving(true);

    try {
      if (editingContact) {
        // Update existing contact
        await updateContact(editingContact.id, {
          name: formData.name.trim(),
          designation: formData.designation.trim(),
          email: formData.email.trim(),
          phone: formData.phone.trim(),
          department: formData.department.trim(),
          isPrimary: formData.isPrimary,
        });
        toast({ title: "Contact updated" });
      } else {
        // Create new contact
        await createContact({
          clientId: client.id,
          name: formData.name.trim(),
          designation: formData.designation.trim(),
          email: formData.email.trim(),
          phone: formData.phone.trim(),
          department: formData.department.trim(),
          isPrimary: formData.isPrimary,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        toast({ title: "Contact added" });
      }
      resetForm();
    } catch (error) {
      console.error("Error saving contact:", error);
      toast({ title: "Error saving contact", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Contacts for {client.company}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          {/* Add/Edit Form */}
          {showForm ? (
            <form onSubmit={handleSubmit} className="space-y-4 p-4 bg-muted/50 rounded-lg mb-4">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">
                  {editingContact ? "Edit Contact" : "Add New Contact"}
                </h4>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={resetForm}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="contact-name">Name *</Label>
                  <Input
                    id="contact-name"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    placeholder="Contact name"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="contact-designation">Designation</Label>
                  <Input
                    id="contact-designation"
                    value={formData.designation}
                    onChange={(e) =>
                      setFormData({ ...formData, designation: e.target.value })
                    }
                    placeholder="e.g., Project Manager"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="contact-email">Email</Label>
                  <Input
                    id="contact-email"
                    type="email"
                    value={formData.email}
                    onChange={(e) =>
                      setFormData({ ...formData, email: e.target.value })
                    }
                    placeholder="email@company.com"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="contact-phone">Phone</Label>
                  <Input
                    id="contact-phone"
                    value={formData.phone}
                    onChange={(e) =>
                      setFormData({ ...formData, phone: e.target.value })
                    }
                    placeholder="+91 98765 43210"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="contact-department">Department</Label>
                  <Input
                    id="contact-department"
                    value={formData.department}
                    onChange={(e) =>
                      setFormData({ ...formData, department: e.target.value })
                    }
                    placeholder="e.g., Engineering"
                  />
                </div>

                <div className="flex items-center gap-3 pt-6">
                  <Switch
                    id="contact-primary"
                    checked={formData.isPrimary}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, isPrimary: checked })
                    }
                  />
                  <Label htmlFor="contact-primary" className="cursor-pointer">
                    Primary Contact
                  </Label>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  <Save className="h-4 w-4 mr-2" />
                  {editingContact ? "Update" : "Add"} Contact
                </Button>
              </div>
            </form>
          ) : (
            <div className="mb-4">
              <Button onClick={() => setShowForm(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Contact
              </Button>
            </div>
          )}

          {/* Contacts Table */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : contacts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <User className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No contacts added yet</p>
              <p className="text-sm">Add contacts to track people at this company</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Contact Info</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.map((contact) => (
                  <TableRow key={contact.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div>
                          <div className="font-medium flex items-center gap-2">
                            {contact.name}
                            {contact.isPrimary && (
                              <Badge variant="secondary" className="text-xs">
                                <Star className="h-3 w-3 mr-1" />
                                Primary
                              </Badge>
                            )}
                          </div>
                          {contact.designation && (
                            <div className="text-sm text-muted-foreground flex items-center gap-1">
                              <Briefcase className="h-3 w-3" />
                              {contact.designation}
                            </div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1 text-sm">
                        {contact.email && (
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Mail className="h-3 w-3" />
                            {contact.email}
                          </div>
                        )}
                        {contact.phone && (
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Phone className="h-3 w-3" />
                            {contact.phone}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {contact.department && (
                        <span className="text-sm text-muted-foreground">
                          {contact.department}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleEdit(contact)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() => handleDelete(contact.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ContactsDialog;
