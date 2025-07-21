
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface AddProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddProject: (project: any) => void;
}

const AddProjectDialog = ({ open, onOpenChange, onAddProject }: AddProjectDialogProps) => {
  const [projectName, setProjectName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [description, setDescription] = useState("");
  const [clientName, setClientName] = useState("");
  const [deadline, setDeadline] = useState<Date | undefined>();

  const handleSubmit = () => {
    if (!projectName || !projectId || !clientName || !deadline) {
      // Basic validation
      alert("Please fill all required fields.");
      return;
    }
    onAddProject({
      id: projectId,
      name: projectName,
      client: clientName,
      deadline: format(deadline, "yyyy-MM-dd"),
      status: "ongoing", // Default status
      description,
    });
    // Reset form
    setProjectName("");
    setProjectId("");
    setDescription("");
    setClientName("");
    setDeadline(undefined);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add New Project</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="projectName">Project Name</Label>
            <Input id="projectName" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="projectId">Project ID</Label>
            <Input id="projectId" value={projectId} onChange={(e) => setProjectId(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="clientName">Client Name</Label>
            <Input id="clientName" value={clientName} onChange={(e) => setClientName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="deadline">Deadline</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant={"outline"}
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !deadline && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {deadline ? format(deadline, "PPP") : <span>Pick a date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={deadline}
                  onSelect={setDeadline}
                  initialFocus
                  disabled={(date) => date < new Date()}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" onClick={handleSubmit}>
            Add Project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddProjectDialog; 