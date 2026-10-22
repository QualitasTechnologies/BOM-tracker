
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { deleteField, doc, updateDoc } from "firebase/firestore";
import { db } from "@/firebase";
import { subscribeToProjects, getBOMData, updateProject } from "@/utils/projectFirestore";
import { subscribeToClients, Client, subscribeToBillingEntities, getDefaultBillingEntity, type BillingEntity } from "@/utils/settingsFirestore";
import { getProjectDocuments } from "@/utils/projectDocumentFirestore";
import { listPulseProjects, type PulseProjectOption } from "@/utils/pulseProxyFirestore";
import type { EditableProjectInput, FirestoreProject } from "@/types/project";
import { useAuth } from "@/hooks/useAuth";
import { isScopedProjectReadEnabled } from '@/utils/projectReadMode';
import { isNativeMaterialCommandEnabled } from '@/utils/nativeMaterialCommands';
import { createNativeProjectWorkspace, type NativeProjectPatch, type NativeProjectCommand } from '@/utils/nativeProjectOperations';
import DelayLogDialog from '@/components/Milestones/DelayLogDialog';
import type {DelayLogInput} from '@/types/milestone';
import {useToast} from '@/components/ui/use-toast';

interface EditProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdateProject: (project: EditableProjectInput) => Promise<void> | void;
  project: FirestoreProject | null;
}

type NativeProjectOpening = {
  projectId: string; projectName: string; clientName: string; clientId?: string;
  billingEntityId?: string; description: string; status: FirestoreProject['status'];
  deadline: string; pulseProjectId?: number | null; isBaselined?: boolean;
};

const readNativeProjectOpening = (value: Record<string, unknown>, expectedProjectId: string): NativeProjectOpening => {
  const statuses: readonly FirestoreProject['status'][] = ['Planning', 'Procurement', 'Ongoing', 'Delayed', 'Completed', 'Archived'];
  if (value.projectId !== expectedProjectId || typeof value.projectName !== 'string' || typeof value.clientName !== 'string'
    || typeof value.description !== 'string' || typeof value.deadline !== 'string'
    || !statuses.includes(value.status as FirestoreProject['status'])) {
    throw new Error('The native project details are incomplete. Reload the project before editing.');
  }
  return {
    projectId: expectedProjectId,
    projectName: value.projectName,
    clientName: value.clientName,
    ...(typeof value.clientId === 'string' ? { clientId: value.clientId } : {}),
    ...(typeof value.billingEntityId === 'string' ? { billingEntityId: value.billingEntityId } : {}),
    description: value.description,
    status: value.status as FirestoreProject['status'],
    deadline: value.deadline,
    ...(value.pulseProjectId === null || typeof value.pulseProjectId === 'number' && Number.isSafeInteger(value.pulseProjectId)
      ? { pulseProjectId: value.pulseProjectId as number | null } : {}),
    ...(typeof value.isBaselined === 'boolean' ? { isBaselined: value.isBaselined } : {}),
  };
};

const EditProjectDialog = ({ open, onOpenChange, onUpdateProject, project }: EditProjectDialogProps) => {
  const { user, isAdmin } = useAuth();
  const {toast}=useToast();
  const [projectId, setProjectId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [clientName, setClientName] = useState("");
  const [billingEntityId, setBillingEntityId] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<FirestoreProject["status"]>("Ongoing");
  const [deadline, setDeadline] = useState("");
  const [error, setError] = useState("");
  const [clients, setClients] = useState<Client[]>([]);
  const [billingEntities, setBillingEntities] = useState<BillingEntity[]>([]);
  const [pulseOptions, setPulseOptions] = useState<PulseProjectOption[]>([]);
  const [pulseFilter, setPulseFilter] = useState('');
  const [pulseProjectId, setPulseProjectId] = useState<number | undefined>(undefined);
  // Keep the existing safe-edit route available while Projects gates the new
  // lifecycle entry points on the complete scoped/native rollout pair.
  const native = isNativeMaterialCommandEnabled();
  const legacyEditingUnavailable = isScopedProjectReadEnabled() && !native;
  const workspaceRef = useRef<ReturnType<typeof createNativeProjectWorkspace> | null>(null);
  const actionRef = useRef<ReturnType<ReturnType<typeof createNativeProjectWorkspace>['capture']> | null>(null);
  const openingRef = useRef<NativeProjectOpening | null>(null);
  const busyRef = useRef(false);
  const contextRef = useRef('');
  contextRef.current = JSON.stringify([open, project?.projectId, user?.uid]);
  const [nativeReady, setNativeReady] = useState(false);
  const [nativeSaving, setNativeSaving] = useState(false);
  const [deadlineDelayOpen,setDeadlineDelayOpen]=useState(false);
  const [hasPendingProject,setHasPendingProject]=useState(false);
  type DeadlineRequest={context:string;workspace:NonNullable<typeof workspaceRef.current>;action:NonNullable<typeof actionRef.current>;patch:NativeProjectPatch;previousDate:string;newDate:string;command?:NativeProjectCommand};
  const deadlineRef=useRef<DeadlineRequest|null>(null);

  useEffect(() => {
    if (!native || !open || !project) return;
    const context = contextRef.current;
    const workspace = createNativeProjectWorkspace(project.projectId, undefined, user?.uid || '');
    workspaceRef.current = workspace; actionRef.current = null; openingRef.current = null;
    deadlineRef.current=null;setDeadlineDelayOpen(false);
    setHasPendingProject(false);
    busyRef.current = false; setNativeSaving(false); setNativeReady(false); setError('');
    workspace.load().then(snapshot => {
      if (contextRef.current !== context || workspaceRef.current !== workspace) return;
      const current = readNativeProjectOpening(snapshot.project, project.projectId);
      openingRef.current = current;
      setProjectId(current.projectId); setProjectName(current.projectName || '');
      setClientName(current.clientName || ''); setBillingEntityId(current.billingEntityId || '');
      setDescription(current.description || ''); setStatus(current.status); setDeadline(current.deadline || '');
      setPulseProjectId(current.pulseProjectId);
      const action=workspace.capture('metadata');actionRef.current=action;const pending=action.pendingCommand;setHasPendingProject(!!pending);
      if(pending?.kind==='metadata'){
        const patch=pending.patch;
        if(patch.projectName!==undefined)setProjectName(patch.projectName);if(patch.clientName!==undefined)setClientName(patch.clientName);if(patch.description!==undefined)setDescription(patch.description);
        if(patch.status!==undefined)setStatus(patch.status as FirestoreProject['status']);if(patch.deadline!==undefined)setDeadline(patch.deadline);if(patch.billingEntityId!==undefined)setBillingEntityId(patch.billingEntityId);if(patch.pulseProjectId!==undefined)setPulseProjectId(patch.pulseProjectId??undefined);
      }
      if (!snapshot.permissions.edit) { setError('Project editing is not enabled for this account here. Pending requests can still be resolved.'); return; }
      setNativeReady(true);
    }).catch(error => {
      if (contextRef.current === context && workspaceRef.current === workspace) setError((error as Error).message);
    });
    return () => { workspace.invalidate(); if (workspaceRef.current === workspace) workspaceRef.current = null; };
  }, [native, open, project?.projectId, user?.uid]);

  useEffect(() => {
    if (native && nativeReady && billingEntities.length) {
      setBillingEntityId(current => current || getDefaultBillingEntity(billingEntities)?.id || 'company');
    }
  }, [native, nativeReady, billingEntities]);

  // Load clients when dialog opens
  useEffect(() => {
    if (!open) return;
    const unsubscribeClients = subscribeToClients(setClients);
    const unsubscribeBillingEntities = subscribeToBillingEntities(setBillingEntities);
    return () => {
      unsubscribeClients();
      unsubscribeBillingEntities();
    };
  }, [open]);

  // Load Pulse projects once when dialog opens
  useEffect(() => {
    if (!open) return;
    let alive = true;
    listPulseProjects()
      .then((opts) => { if (alive) setPulseOptions(opts); })
      .catch((err) => console.error('listPulseProjects failed', err));
    return () => { alive = false; };
  }, [open]);

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setProjectId("");
      setProjectName("");
      setClientName("");
      setBillingEntityId("");
      setDescription("");
      setStatus("Ongoing");
      setDeadline("");
      setError("");
      setPulseProjectId(undefined);
      setPulseFilter('');
    }
  }, [open]);

  // Set form values when project changes
  useEffect(() => {
    if (native) return;
    if (!project || !open) return;

    setProjectId(project.projectId);
    setProjectName(project.projectName);
    setDescription(project.description);
    setStatus(project.status);
    setDeadline(project.deadline);
    setPulseProjectId(project.pulseProjectId);
    setBillingEntityId(project.billingEntityId || getDefaultBillingEntity(billingEntities)?.id || 'company');
  }, [project, open, billingEntities, native]);

  // Set clientName after clients are loaded to ensure exact match
  useEffect(() => {
    if (native) return;
    if (!project || !open || clients.length === 0) return;
    
    if (project.clientName) {
      // Find exact match (case and whitespace sensitive)
      const matchingClient = clients.find(
        (client) => client.company === project.clientName
      );
      
      if (matchingClient) {
        // Use the exact value from the client list to ensure Select can match it
        setClientName(matchingClient.company);
      } else {
        // Try case-insensitive match with trimmed values
        const caseInsensitiveMatch = clients.find(
          (client) => client.company && project.clientName && 
            client.company.trim().toLowerCase() === project.clientName.trim().toLowerCase()
        );
        
        if (caseInsensitiveMatch) {
          setClientName(caseInsensitiveMatch.company);
        } else {
          // Client might have been deleted or renamed - set empty to force user to select
          setClientName("");
        }
      }
    }
  }, [project, clients, open, native]);

  const selectableClients = useMemo(
    () => clients.filter((clientItem) => clientItem.company?.trim()),
    [clients]
  );
  const submitNative=async(command:NativeProjectCommand,source:{context:string;workspace:NonNullable<typeof workspaceRef.current>;action:NonNullable<typeof actionRef.current>})=>{
    if(source.context!==contextRef.current||source.workspace!==workspaceRef.current)throw new Error('The project context changed. Reopen it before continuing.');
    if(busyRef.current)return;
    busyRef.current=true;setNativeSaving(true);
    try{
      await source.action.submit(command);
      if(contextRef.current===source.context&&workspaceRef.current===source.workspace){setDeadlineDelayOpen(false);onOpenChange(false);}
    }catch(error){if(contextRef.current===source.context&&workspaceRef.current===source.workspace){setError((error as Error).message);try{setHasPendingProject(!!source.action.pendingCommand);}catch{setHasPendingProject(true);}}throw error;}
    finally{if(contextRef.current===source.context&&workspaceRef.current===source.workspace){busyRef.current=false;setNativeSaving(false);}}
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (legacyEditingUnavailable) return;

    if (!project) {
      setError("Select a project to edit.");
      return;
    }

    if (native) {
      if (!nativeReady || !actionRef.current || busyRef.current) return;
      const context = contextRef.current, workspace = workspaceRef.current;
      if(actionRef.current.pendingCommand){await submitNative(actionRef.current.pendingCommand,{context,workspace:workspace!,action:actionRef.current}).catch(()=>{});return;}
      const patch: NativeProjectPatch = {
        projectName, clientName, description, status, deadline,
        ...(clients.find(client => client.company === clientName)?.id
          ? { clientId: clients.find(client => client.company === clientName)!.id }
          : openingRef.current?.clientName === clientName && openingRef.current?.clientId ? { clientId: openingRef.current.clientId } : {}),
        ...(billingEntityId ? { billingEntityId } : {}), pulseProjectId: pulseProjectId ?? null,
      };
      if(deadlineRef.current?.command){setDeadlineDelayOpen(true);return;}
      if(openingRef.current?.isBaselined&&deadline!==openingRef.current.deadline){
        deadlineRef.current={context,workspace:workspace!,action:actionRef.current,patch:structuredClone(patch),previousDate:openingRef.current.deadline,newDate:deadline};setDeadlineDelayOpen(true);return;
      }
      await submitNative({kind:'metadata',patch},{context,workspace:workspace!,action:actionRef.current}).catch(()=>{});
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
            setError("Customer PO document is required before changing status to Ongoing. Please upload the Customer PO in the Cost Analysis page.");
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
            clientId: clients.find((clientItem) => clientItem.company === clientName)?.id,
            billingEntityId: billingEntityId || undefined,
            description,
            status,
            deadline,
            ...(pulseProjectId !== undefined ? { pulseProjectId } : {}),
          });
        } else {
          // Normal update without snapshot
          await onUpdateProject({
            projectId,
            projectName,
            clientName,
            clientId: clients.find((clientItem) => clientItem.company === clientName)?.id,
            billingEntityId: billingEntityId || undefined,
            description,
            status,
            deadline,
            ...(pulseProjectId !== undefined ? { pulseProjectId } : {}),
          });
        }

        // If unlinking a previously linked Pulse project, explicitly delete the field
        if (pulseProjectId === undefined && project?.pulseProjectId !== undefined) {
          await updateDoc(doc(db, 'projects', projectId), {
            pulseProjectId: deleteField(),
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
      }, user ? { uid: user.uid, isAdmin } : undefined);
      return;
    }

    void submitUpdate();
  };

  const deadlineRequest=deadlineRef.current;
  return (<>
    <Dialog open={open} onOpenChange={value => { if (!native || !busyRef.current) onOpenChange(value); }}>
      <DialogContent className="@container max-w-[425px] max-h-[90vh] overflow-hidden flex flex-col p-4">
        <DialogHeader className="pb-2">
          <DialogTitle>Edit Project</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto space-y-3 pr-2 -mr-2">
          {legacyEditingUnavailable && <Alert><AlertDescription>Project editing is temporarily unavailable here. Reopen the project to use its safe editing actions.</AlertDescription></Alert>}
          {error && (
            <Alert variant="destructive" className="py-2">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {native&&hasPendingProject&&<Alert><AlertDescription>An earlier save was not confirmed. Retry the same request or resolve it before making another change.</AlertDescription></Alert>}
          <fieldset disabled={legacyEditingUnavailable || (native && (!nativeReady || nativeSaving || deadlineDelayOpen || hasPendingProject || !!deadlineRequest?.command))} className="contents">
          <div className="space-y-1">
            <Label htmlFor="projectId">Project ID</Label>
            <Input
              id="projectId"
              disabled={native}
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
            <Label>Billing entity</Label>
            <Select value={billingEntityId} onValueChange={setBillingEntityId}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Select billing entity" /></SelectTrigger>
              <SelectContent>
                {billingEntities.map((entity) => (
                  <SelectItem key={entity.id} value={entity.id}>{entity.displayName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">This entity issues support quotations for the project.</p>
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
          <div className="space-y-2">
            <Label>Link to Pulse Project</Label>
            {pulseProjectId !== undefined ? (
              <div className="flex items-center gap-2">
                <span className="text-sm">
                  🔗 {pulseOptions.find((o) => o.id === pulseProjectId)?.name ?? `id ${pulseProjectId}`}
                </span>
                <Button type="button" size="sm" variant="ghost" onClick={() => setPulseProjectId(undefined)}>
                  Unlink
                </Button>
              </div>
            ) : (
              <>
                <Input
                  placeholder="Type to search Pulse projects..."
                  value={pulseFilter}
                  onChange={(e) => setPulseFilter(e.target.value)}
                  className="h-8"
                />
                {pulseFilter && (
                  <div className="border rounded max-h-40 overflow-auto">
                    {pulseOptions
                      .filter((o) => o.name.toLowerCase().includes(pulseFilter.toLowerCase()))
                      .slice(0, 20)
                      .map((o) => (
                        <button
                          type="button"
                          key={o.id}
                          className="block w-full text-left px-2 py-1 hover:bg-muted text-sm"
                          onClick={() => { setPulseProjectId(o.id); setPulseFilter(''); }}
                        >
                          {o.name} <span className="text-xs text-muted-foreground">(id {o.id})</span>
                        </button>
                      ))}
                    {pulseOptions.filter((o) => o.name.toLowerCase().includes(pulseFilter.toLowerCase())).length === 0 && (
                      <p className="px-2 py-1 text-sm text-muted-foreground">No matching projects</p>
                    )}
                  </div>
                )}
              </>
            )}
            <p className="text-xs text-muted-foreground">
              Live time data from Pulse will be used in Cost Analysis when this is set.
            </p>
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
          </fieldset>
          <div className="flex justify-end gap-2 pt-4 mt-4 border-t bg-background">
            {native&&hasPendingProject&&<Button type="button" variant="outline" disabled={nativeSaving} onClick={async()=>{
              if(!actionRef.current||busyRef.current)return;const context=contextRef.current,workspace=workspaceRef.current;busyRef.current=true;setNativeSaving(true);
              try{const result=await actionRef.current.resolve();if(contextRef.current===context&&workspaceRef.current===workspace){toast({title:result.resolution==='committed'?'Project save confirmed':'Project save cancelled'});onOpenChange(false);}}
              catch(error){if(contextRef.current===context&&workspaceRef.current===workspace)setError((error as Error).message);}
              finally{if(contextRef.current===context&&workspaceRef.current===workspace){busyRef.current=false;setNativeSaving(false);}}
            }}>Resolve project request</Button>}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={native && nativeSaving} className="h-8">
              Cancel
            </Button>
            <Button type="submit" disabled={legacyEditingUnavailable || (native && (!nativeReady || nativeSaving || deadlineDelayOpen))} className="h-8">Update Project</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
    {native&&deadlineRequest&&<DelayLogDialog key={`${project?.projectId}:${user?.uid}`} open={deadlineDelayOpen}
      onOpenChange={value=>{if(!nativeSaving&&deadlineRequest.context===contextRef.current)setDeadlineDelayOpen(value);}}
      entityType="project" entityId={project?.projectId||''} entityName={deadlineRequest.patch.projectName||project?.projectName||''} previousDate={deadlineRequest.previousDate} newDate={deadlineRequest.newDate}
      onSubmit={async(input:DelayLogInput)=>{
        deadlineRequest.command??={kind:'metadata',patch:deadlineRequest.patch,delay:{reason:input.reason,attribution:input.attribution}};
        await submitNative(deadlineRequest.command,deadlineRequest);
      }}/>} </>
  );
};

export default EditProjectDialog;
