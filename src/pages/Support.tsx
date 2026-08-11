import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  FileStack,
  Headphones,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  TicketCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { CreateSupportTicketDialog } from '@/components/Support/CreateSupportTicketDialog';
import { SupportProjectDialog } from '@/components/Support/SupportProjectDialog';
import {
  CoverageBadge,
  PriorityBadge,
  StatusBadge,
} from '@/components/Support/SupportBadges';
import type {
  CreateSupportTicketInput,
  CoverageType,
  SupportPriority,
  SupportTicket,
  SupportTicketStatus,
} from '@/types/support';
import {
  createSupportTicket,
  getSupportDocumentCounts,
  subscribeToSupportTickets,
} from '@/utils/supportFirestore';
import {
  coverageExpiryLabel,
  determineCoverage,
  isOverdue,
  isTicketOpen,
  getInstalledMachines,
  needsCommercialAction,
} from '@/utils/supportLogic';
import { subscribeToProjects, type Project } from '@/utils/projectFirestore';
import { subscribeToClients, type Client } from '@/utils/settingsFirestore';

const formatDateTime = (date: Date) =>
  new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);

export default function Support() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [documentCounts, setDocumentCounts] = useState<Record<string, number>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [search, setSearch] = useState(() => searchParams.get('project') || '');
  const [statusFilter, setStatusFilter] = useState<'all' | SupportTicketStatus>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | SupportPriority>('all');
  const [coverageFilter, setCoverageFilter] = useState<'all' | CoverageType>('all');
  const [activeTab, setActiveTab] = useState('tickets');

  useEffect(
    () =>
      subscribeToProjects(
        setProjects,
        user ? { uid: user.uid, isAdmin } : undefined,
      ),
    [isAdmin, user?.uid],
  );

  useEffect(() => subscribeToClients(setClients), []);

  const serviceProjects = useMemo(
    () =>
      projects
        .filter((project) => ['Ongoing', 'Completed'].includes(project.status))
        .sort((a, b) => a.projectName.localeCompare(b.projectName)),
    [projects],
  );

  const installedAssets = useMemo(
    () => serviceProjects.flatMap((project) => {
      const machines = getInstalledMachines(project.supportProfile);
      return machines.length
        ? machines.map((machine) => ({ project, machine }))
        : [{ project, machine: undefined }];
    }),
    [serviceProjects],
  );

  useEffect(() => {
    const projectFilter = searchParams.get('project');
    const machineFilter = searchParams.get('machine');
    if (projectFilter) {
      setSearch(machineFilter || projectFilter);
      setActiveTab('tickets');
    }
  }, [searchParams]);

  useEffect(() => {
    const projectIds = serviceProjects.map((project) => project.projectId);
    const unsubscribe = subscribeToSupportTickets(projectIds, setTickets);
    getSupportDocumentCounts(projectIds).then(setDocumentCounts).catch(() => undefined);
    return unsubscribe;
  }, [serviceProjects]);

  const filteredTickets = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return tickets.filter((ticket) => {
      const matchesSearch =
        !needle ||
        [
          ticket.ticketNumber,
          ticket.title,
          ticket.projectName,
          ticket.projectId,
          ticket.clientName,
          ticket.reportedByName,
          ticket.machineName,
          ticket.machineSerialNumber,
        ].some((value) => value?.toLowerCase().includes(needle));
      return (
        matchesSearch &&
        (statusFilter === 'all' || ticket.status === statusFilter) &&
        (priorityFilter === 'all' || ticket.priority === priorityFilter) &&
        (coverageFilter === 'all' || ticket.coverageType === coverageFilter)
      );
    });
  }, [coverageFilter, priorityFilter, search, statusFilter, tickets]);

  const metrics = useMemo(() => {
    const open = tickets.filter((ticket) => isTicketOpen(ticket.status));
    return {
      open: open.length,
      overdue: open.filter((ticket) => isOverdue(ticket)).length,
      awaiting: open.filter((ticket) => ticket.status === 'waiting').length,
      commercialAction: tickets.filter(needsCommercialAction).length,
      resolvedThisMonth: tickets.filter((ticket) => {
        if (!ticket.resolvedAt) return false;
        const now = new Date();
        return (
          ticket.resolvedAt.getMonth() === now.getMonth() &&
          ticket.resolvedAt.getFullYear() === now.getFullYear()
        );
      }).length,
    };
  }, [tickets]);

  const handleCreate = async (input: CreateSupportTicketInput) => {
    if (!user) return;
    try {
      const ticket = await createSupportTicket(input, {
        uid: user.uid,
        name: user.displayName || user.email || 'Support user',
      });
      toast({
        title: `${ticket.ticketNumber} created`,
        description: 'The issue is now in the support queue.',
      });
      navigate(`/project/${ticket.projectId}/support/${ticket.id}`);
    } catch (error) {
      toast({
        title: 'Could not create ticket',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
      throw error;
    }
  };

  const openProject = (project: Project) => {
    setSelectedProject(project);
    setProjectDialogOpen(true);
  };

  const userName = user?.displayName || user?.email || 'Support user';

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="rounded-2xl bg-slate-950 px-6 py-7 text-white shadow-sm">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-cyan-300">
              <Headphones className="h-4 w-4" />
              Post-commissioning service
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">Service & Support</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">
              Triage machine-vision issues, protect response commitments, control chargeable work,
              and close every case with a documented RCA and solution.
            </p>
          </div>
          <Button size="lg" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Log support issue
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard icon={TicketCheck} label="Open tickets" value={metrics.open} />
        <MetricCard icon={AlertTriangle} label="SLA attention" value={metrics.overdue} tone={metrics.overdue ? 'danger' : 'default'} />
        <MetricCard icon={CalendarClock} label="Waiting" value={metrics.awaiting} />
        <MetricCard icon={CircleDollarSign} label="Commercial / collection" value={metrics.commercialAction} />
        <MetricCard icon={CheckCircle2} label="Resolved this month" value={metrics.resolvedThisMonth} />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="tickets">Ticket queue</TabsTrigger>
          <TabsTrigger value="installations">Installed machines</TabsTrigger>
        </TabsList>

        <TabsContent value="tickets" className="space-y-4">
          <Card>
            <CardContent className="pt-6">
              <div className="grid gap-3 md:grid-cols-[1fr_170px_150px_170px]">
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search ticket, machine, client or contact…"
                    className="pl-9"
                  />
                </div>
                <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
                  <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="waiting">Waiting</SelectItem>
                    <SelectItem value="in-progress">In progress</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={priorityFilter} onValueChange={(value) => setPriorityFilter(value as typeof priorityFilter)}>
                  <SelectTrigger><SelectValue placeholder="Priority" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All priorities</SelectItem>
                    <SelectItem value="critical">P1 Critical</SelectItem>
                    <SelectItem value="high">P2 High</SelectItem>
                    <SelectItem value="medium">P3 Normal</SelectItem>
                    <SelectItem value="low">P4 Low</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={coverageFilter} onValueChange={(value) => setCoverageFilter(value as typeof coverageFilter)}>
                  <SelectTrigger><SelectValue placeholder="Coverage" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All coverage</SelectItem>
                    <SelectItem value="warranty">Warranty</SelectItem>
                    <SelectItem value="amc">AMC</SelectItem>
                    <SelectItem value="chargeable">Chargeable</SelectItem>
                    <SelectItem value="goodwill">Goodwill</SelectItem>
                    <SelectItem value="undetermined">To be assessed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            {filteredTickets.length === 0 ? (
              <div className="py-16 text-center">
                <ClipboardCheck className="mx-auto mb-3 h-10 w-10 text-slate-300" />
                <h3 className="font-medium">No support tickets match this view</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Log the first issue or change the filters above.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ticket</TableHead>
                    <TableHead>Project / client</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Coverage</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Next target</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTickets.map((ticket) => {
                    const overdue = isOverdue(ticket);
                    const nextTarget = ticket.firstResponseAt
                      ? ticket.resolutionTargetAt
                      : ticket.firstResponseTargetAt;
                    return (
                      <TableRow
                        key={ticket.id}
                        className="cursor-pointer"
                        onClick={() => navigate(`/project/${ticket.projectId}/support/${ticket.id}`)}
                      >
                        <TableCell>
                          <div className="font-mono text-xs text-muted-foreground">{ticket.ticketNumber}</div>
                          <div className="mt-1 max-w-[320px] font-medium">{ticket.title}</div>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{ticket.projectName}</div>
                          <div className="text-xs text-muted-foreground">{ticket.clientName}</div>
                        </TableCell>
                        <TableCell><PriorityBadge priority={ticket.priority} /></TableCell>
                        <TableCell><StatusBadge status={ticket.status} /></TableCell>
                        <TableCell><CoverageBadge coverage={ticket.coverageType} /></TableCell>
                        <TableCell className="text-sm">
                          {ticket.assignee?.name || <span className="text-amber-700">Unassigned</span>}
                        </TableCell>
                        <TableCell>
                          <div className={overdue ? 'font-medium text-red-600' : 'text-sm'}>
                            {overdue && <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />}
                            {formatDateTime(nextTarget)}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="installations">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Support-ready project register</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {installedAssets.map(({ project, machine }) => {
                  const coverage = determineCoverage(project.supportProfile, new Date(), machine);
                  const ticketCount = tickets.filter((ticket) =>
                    ticket.projectId === project.projectId &&
                    (!machine || ticket.machineId === machine.id || (!ticket.machineId && machine.id === 'legacy-primary-machine'))
                  ).length;
                  return (
                    <Card key={`${project.projectId}-${machine?.id || 'unconfigured'}`} className="shadow-none">
                      <CardContent className="space-y-4 p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="font-semibold">{machine?.name || project.projectName}</h3>
                            <p className="text-sm text-muted-foreground">{project.projectName} · {project.clientName}</p>
                            <p className="mt-1 font-mono text-xs text-muted-foreground">{machine ? `S/N ${machine.serialNumber}` : 'Machine not configured'}</p>
                          </div>
                          <CoverageBadge coverage={coverage} />
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div className="rounded-md bg-slate-50 p-3">
                            <div className="flex items-center gap-1 text-muted-foreground"><FileStack className="h-3.5 w-3.5" /> Documents</div>
                            <div className="mt-1 text-lg font-semibold">{documentCounts[project.projectId] || 0}</div>
                          </div>
                          <div className="rounded-md bg-slate-50 p-3">
                            <div className="flex items-center gap-1 text-muted-foreground"><Headphones className="h-3.5 w-3.5" /> Tickets</div>
                            <div className="mt-1 text-lg font-semibold">{ticketCount}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <ShieldCheck className="h-4 w-4" />
                          {coverageExpiryLabel(project.supportProfile, new Date(), machine)}
                        </div>
                        <div className="flex gap-2">
                          <Button variant="outline" className="flex-1" onClick={() => openProject(project)}>
                            <Settings2 className="mr-2 h-4 w-4" />
                            Coverage & docs
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => {
                              const filter = machine?.serialNumber || machine?.name || project.projectId;
                              setSearch(filter);
                              setActiveTab('tickets');
                              navigate(`/support?project=${encodeURIComponent(project.projectId)}${machine ? `&machine=${encodeURIComponent(filter)}` : ''}`);
                            }}
                          >View tickets</Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <CreateSupportTicketDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projects={serviceProjects}
        clients={clients}
        onCreate={handleCreate}
      />
      <SupportProjectDialog
        open={projectDialogOpen}
        onOpenChange={setProjectDialogOpen}
        project={selectedProject}
        client={
          selectedProject
            ? clients.find(
                (client) =>
                  client.id === selectedProject.clientId ||
                  client.company.trim().toLowerCase() ===
                    selectedProject.clientName.trim().toLowerCase(),
              ) || null
            : null
        }
        userId={user?.uid || ''}
        userName={userName}
      />
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  tone = 'default',
}: {
  icon: typeof TicketCheck;
  label: string;
  value: number;
  tone?: 'default' | 'danger';
}) {
  return (
    <Card className={tone === 'danger' ? 'border-red-200 bg-red-50/50' : undefined}>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`rounded-lg p-2 ${tone === 'danger' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-2xl font-semibold">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}
