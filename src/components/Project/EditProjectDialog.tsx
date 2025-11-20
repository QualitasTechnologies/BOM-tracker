
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { subscribeToProjects, getBOMData, updateProject } from "@/utils/projectFirestore";
import { subscribeToClients, Client } from "@/utils/settingsFirestore";
import { getProjectDocuments } from "@/utils/projectDocumentFirestore";
import type { EditableProjectInput, FirestoreProject } from "@/types/project";

interface EditProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdateProject: (project: EditableProjectInput) => Promise<void> | void;
  project: FirestoreProject | null;
}

const EditProjectDialog = ({ open, onOpenChange, onUpdateProject, project }: EditProjectDialogProps) => {
  const [projectId, setProjectId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [clientName, setClientName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<FirestoreProject["status"]>("Ongoing");
  const [deadline, setDeadline] = useState("");
  const [error, setError] = useState("");
  const [clients, setClients] = useState<Client[]>([]);

  // Load clients when dialog opens
  useEffect(() => {
    if (!open) return;
    const unsubscribeClients = subscribeToClients(setClients);
    return () => unsubscribeClients();
  }, [open]);

  useEffect(() => {
    if (!project) return;
    setProjectId(project.projectId);
    setProjectName(project.projectName);
    setClientName(project.clientName);
    setDescription(project.description);
    setStatus(project.status);
    setDeadline(project.deadline);
  }, [project]);

  const selectableClients = useMemo(
    () => clients.filter((clientItem) => clientItem.company?.trim()),
    [clients]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!project) {
      setError("Select a project to edit.");
      return;
    }

    const submitUpdate = async () => {
      try {
        // Check if status is changing from Planning to Ongoing
        if (project.status === "Planning" && status === "Ongoing") {
          // 1. Check for Customer PO document
          const projectDocuments = await getProjectDocuments(projectId);
          const hasCustomerPO = projectDocuments.some(doc => doc.type === 'customer-po');

          if (!hasCustomerPO) {
            setError("Customer PO document is required before changing status to Ongoing. Please upload the Customer PO in the BOM page under Project Documents.");
            return;
          }

          // 2. Take BOM snapshot
          const bomCategories = await getBOMData(projectId);
          const bomSnapshot = bomCategories.flatMap(cat => cat.items);

          // 3. Update project with snapshot and new status
          await updateProject(projectId, {
            status,
            bomSnapshot,
            bomSnapshotDate: new Date().toISOString()
          });

          // 4. Update other fields
          await onUpdateProject({
            projectId,
            projectName,
            clientName,
            description,
            status,
            deadline,
          });
        } else {
          // Normal update without snapshot
          await onUpdateProject({
            projectId,
            projectName,
            clientName,
            description,
            status,
            deadline,
          });
        }

        onOpenChange(false);
      } catch (mutationError) {
        console.error("EditProjectDialog: Failed to update project", mutationError);
        setError("Failed to update project. Please try again.");
      }
    };

    if (projectId !== project.projectId) {
      const unsubscribe = subscribeToProjects((projects) => {
        unsubscribe();
        const projectExists = projects.some((existingProject) => existingProject.projectId === projectId);
        if (projectExists) {
          setError("Project ID already exists. Please choose a different ID.");
          return;
        }
        void submitUpdate();
      });
      return;
    }

    void submitUpdate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="@container max-w-[425px] max-h-[90vh] overflow-hidden flex flex-col p-4">
        <DialogHeader className="pb-2">
          <DialogTitle>Edit Project</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto space-y-3 pr-2 -mr-2">
          {error && (
            <Alert variant="destructive" className="py-2">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1">
            <Label htmlFor="projectId">Project ID</Label>
            <Input
              id="projectId"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="Enter project ID"
              required
              className="h-8"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="projectName">Project Name</Label>
            <Input
              id="projectName"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Enter project name"
              required
              className="h-8"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="clientName">Client Name</Label>
            <Select value={clientName} onValueChange={setClientName} required>
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
          </form>
          <div className="flex justify-end gap-2 pt-4 mt-4 border-t bg-background">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="h-8">
              Cancel
            </Button>
            <Button type="submit" className="h-8">Update Project</Button>
          </div>
      </DialogContent>
    </Dialog>
  );
};

export default EditProjectDialog; 