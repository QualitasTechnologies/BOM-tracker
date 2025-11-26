
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { subscribeToProjects } from "@/utils/projectFirestore";
import { subscribeToClients, Client } from "@/utils/settingsFirestore";
import type { FirestoreProject, NewProjectFormData } from "@/types/project";

interface AddProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddProject: (project: NewProjectFormData) => Promise<void> | void;
}

const AddProjectDialog = ({ open, onOpenChange, onAddProject }: AddProjectDialogProps) => {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<FirestoreProject["status"]>("Planning");
  const [deadline, setDeadline] = useState("");
  const [error, setError] = useState("");
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);

  // Generate a unique project ID
  const generateProjectId = (existingProjects: FirestoreProject[]): string => {
    const prefix = "PRJ";
    let counter = 1;
    
    // Find the highest existing project number
    const existingIds = existingProjects
      .map(p => p.projectId)
      .filter(id => id && typeof id === 'string' && id.startsWith(prefix))
      .map(id => {
        const match = id.match(new RegExp(`${prefix}-(\\d+)`));
        return match ? parseInt(match[1]) : 0;
      })
      .filter(num => !isNaN(num) && num > 0);
    
    if (existingIds.length > 0) {
      counter = Math.max(...existingIds) + 1;
    }
    
    // Ensure counter is at least 1 and handle very large numbers
    counter = Math.max(1, Math.min(counter, 999999));
    
    return `${prefix}-${counter.toString().padStart(3, '0')}`;
  };

  // Load clients when dialog opens
  useEffect(() => {
    if (!open) return;
    const unsubscribeClients = subscribeToClients(setClients);
    return () => unsubscribeClients();
  }, [open]);

  // Generate project ID when dialog opens or when projects change
  useEffect(() => {
    if (!open) return;
    const unsubscribe = subscribeToProjects((projects) => {
      setId(generateProjectId(projects));
    });
    return () => unsubscribe();
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const unsubscribe = subscribeToProjects(async (projects) => {
        unsubscribe();

        const projectExists = projects.some((project) => project.projectId === id);
        if (projectExists) {
          setError("Project ID already exists. Please try again.");
          setLoading(false);
          return;
        }

        try {
          await onAddProject({
            id,
            name,
            client,
            description,
            status,
            deadline,
          });
          setId("");
          setName("");
          setClient("");
          setDescription("");
          setStatus("Planning");
          setDeadline("");
          onOpenChange(false);
        } catch (mutationError) {
          console.error("AddProjectDialog: Failed to add project", mutationError);
          setError("Failed to create project. Please try again.");
        } finally {
          setLoading(false);
        }
      });
    } catch (err) {
      console.error("AddProjectDialog: Subscription error", err);
      setError("Failed to create project. Please try again.");
      setLoading(false);
    }
  };

  const selectableClients = useMemo(
    () => clients.filter((clientItem) => clientItem.company?.trim()),
    [clients]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="@container max-w-[425px] max-h-[90vh] overflow-hidden flex flex-col p-4">
        <DialogHeader className="pb-2">
          <DialogTitle>Add New Project</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto space-y-3 pr-2 -mr-2">
          {error && (
            <Alert variant="destructive" className="py-2">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1">
            <Label htmlFor="id">Project ID</Label>
            <Input
              id="id"
              value={id}
              placeholder="Auto-generated"
              disabled
              className="h-8 bg-gray-50"
            />
            <p className="text-xs text-muted-foreground">Project ID is automatically generated</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="name">Project Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter project name"
              required
              className="h-8"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="client">Client Name</Label>
            <Select value={client} onValueChange={setClient} required>
              <SelectTrigger className="h-8">
                <SelectValue placeholder="Select a client" />
              </SelectTrigger>
              <SelectContent>
                {selectableClients.map((clientItem) => (
                  <SelectItem key={clientItem.id} value={clientItem.company}>
                    {clientItem.company}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectableClients.length === 0 && (
              <p className="text-xs text-muted-foreground">No clients available. Add clients in Settings first.</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter project description"
              required
              className="h-16 min-h-[64px] resize-none"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="status">Status</Label>
            <Select value={status} onValueChange={(value) => setStatus(value as FirestoreProject["status"])}>
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Planning">Planning</SelectItem>
                <SelectItem value="Ongoing">Ongoing</SelectItem>
                <SelectItem value="Delayed">Delayed</SelectItem>
                <SelectItem value="Completed">Completed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="deadline">Deadline</Label>
            <Input
              id="deadline"
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              required
              className="h-8"
            />
          </div>
          <div className="flex justify-end gap-2 pt-4 mt-4 border-t bg-background">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="h-8">
              Cancel
            </Button>
            <Button type="submit" className="h-8" disabled={loading || clients.length === 0}>
              {loading ? "Creating..." : "Add Project"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AddProjectDialog; 