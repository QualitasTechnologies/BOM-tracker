
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { subscribeToProjects } from "@/utils/projectFirestore";
import { subscribeToClients, Client } from "@/utils/settingsFirestore";

interface EditProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdateProject: (project: any) => void;
  project: any;
}

const EditProjectDialog = ({ open, onOpenChange, onUpdateProject, project }: EditProjectDialogProps) => {
  const [projectId, setProjectId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [clientName, setClientName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("");
  const [deadline, setDeadline] = useState("");
  const [error, setError] = useState("");
  const [clients, setClients] = useState<Client[]>([]);

  // Load clients when dialog opens
  useEffect(() => {
    if (open) {
      const unsubscribeClients = subscribeToClients(setClients);
      return () => unsubscribeClients();
    }
  }, [open]);

  useEffect(() => {
    if (project) {
      setProjectId(project.projectId || "");
      setProjectName(project.projectName || "");
      setClientName(project.clientName || "");
      setDescription(project.description || "");
      setStatus(project.status || "");
      setDeadline(project.deadline || "");
    }
  }, [project]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // Only check for duplicate ID if the ID has been changed
    if (projectId !== project.projectId) {
      const unsubscribe = subscribeToProjects((projects) => {
        const projectExists = projects.some(p => p.projectId === projectId);
        unsubscribe(); // Unsubscribe immediately after checking

        if (projectExists) {
          setError("Project ID already exists. Please choose a different ID.");
          return;
        }

        submitUpdate();
      });
    } else {
      submitUpdate();
    }
  };

  const submitUpdate = () => {
    onUpdateProject({
      projectId,
      projectName,
      clientName,
      description,
      status,
      deadline,
    });
    onOpenChange(false);
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
                {clients
                  .filter(clientItem => {
                    const isValid = clientItem.company && clientItem.company.trim() !== '';
                    if (!isValid) {
                      console.log('EditProjectDialog: Filtering out invalid client:', clientItem);
                    }
                    return isValid;
                  })
                  .map((clientItem) => {
                    console.log('EditProjectDialog: Creating SelectItem for client:', clientItem.company);
                    return (
                      <SelectItem key={clientItem.id} value={clientItem.company}>
                        {clientItem.company}
                      </SelectItem>
                    );
                  })}
              </SelectContent>
            </Select>
            {clients.length === 0 && (
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
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
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
            <Button type="submit" className="h-8" onClick={handleSubmit}>Update Project</Button>
          </div>
      </DialogContent>
    </Dialog>
  );
};

export default EditProjectDialog; 