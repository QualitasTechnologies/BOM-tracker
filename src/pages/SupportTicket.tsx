import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Headphones,
  Loader2,
  Mail,
  MapPin,
  FileText,
  Save,
  Send,
  UserRound,
  Wrench,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { CoverageBadge, PriorityBadge, StatusBadge } from '@/components/Support/SupportBadges';
import { SupportDocuments } from '@/components/Support/SupportDocuments';
import type {
  CommercialStatus,
  CoverageType,
  CustomerConfirmation,
  SupportActivity,
  SupportAssignee,
  SupportDocument,
  SupportTicket as SupportTicketType,
  SupportTicketStatus,
  SupportPaymentStatus,
} from '@/types/support';
import {
  addSupportActivity,
  sendSupportCommunication,
  subscribeToSupportActivities,
  subscribeToSupportDocuments,
  subscribeToSupportTicket,
  updateSupportTicket,
} from '@/utils/supportFirestore';
import {
  COMMERCIAL_STATUS_LABELS,
  COVERAGE_LABELS,
  getTransitionBlocker,
  isOverdue,
  shouldShowInvoiceTracking,
  SUPPORT_STATUS_LABELS,
  SUPPORT_STATUS_ORDER,
  getInstalledMachines,
  validatePaymentTracking,
} from '@/utils/supportLogic';
import { getProject, type Project } from '@/utils/projectFirestore';
import {
  getClientContacts,
  getPrimaryClientContact,
  subscribeToClients,
  type Client,
  type ClientContact,
} from '@/utils/settingsFirestore';
import { AddClientContactDialog } from '@/components/Support/AddClientContactDialog';
import { SupportEngineerFollowUpDialog } from '@/components/Support/SupportEngineerFollowUpDialog';
import { SupportQuotationDialog } from '@/components/Support/SupportQuotationDialog';

const formatDateTime = (date?: Date) =>
  date
    ? new Intl.DateTimeFormat('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date)
    : 'Not recorded';

const formatDateTimeInput = (date?: Date) => {
  if (!date) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

export default function SupportTicket() {
  const { projectId = '', ticketId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [ticket, setTicket] = useState<SupportTicketType | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [activities, setActivities] = useState<SupportActivity[]>([]);
  const [documents, setDocuments] = useState<SupportDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [rootCause, setRootCause] = useState('');
  const [correctiveAction, setCorrectiveAction] = useState('');
  const [preventiveAction, setPreventiveAction] = useState('');
  const [resolutionSummary, setResolutionSummary] = useState('');
  const [coverageType, setCoverageType] = useState<CoverageType>('undetermined');
  const [coverageNotes, setCoverageNotes] = useState('');
  const [commercialStatus, setCommercialStatus] = useState<CommercialStatus>('assessment-required');
  const [acceptanceReference, setAcceptanceReference] = useState('');
  const [acceptedOrderValue, setAcceptedOrderValue] = useState('');
  const [contactId, setContactId] = useState('');
  const [quotationOpen, setQuotationOpen] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [serviceStartedAt, setServiceStartedAt] = useState('');
  const [serviceCompletedAt, setServiceCompletedAt] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<SupportPaymentStatus>('not-invoiced');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [invoiceDueDate, setInvoiceDueDate] = useState('');
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [amountReceived, setAmountReceived] = useState('');
  const [paymentReceivedDate, setPaymentReceivedDate] = useState('');
  const [paymentReference, setPaymentReference] = useState('');

  const actor = useMemo(
    () => ({
      uid: user?.uid || '',
      name: user?.displayName || user?.email || 'Support user',
    }),
    [user],
  );

  useEffect(() => {
    if (!projectId || !ticketId) return;
    const unsubscribeTicket = subscribeToSupportTicket(projectId, ticketId, (value) => {
      setTicket(value);
      setLoading(false);
    });
    const unsubscribeActivities = subscribeToSupportActivities(projectId, ticketId, setActivities);
    const unsubscribeDocuments = subscribeToSupportDocuments(projectId, setDocuments);
    const unsubscribeClients = subscribeToClients(setClients);
    getProject(projectId).then(setProject);
    return () => {
      unsubscribeTicket();
      unsubscribeActivities();
      unsubscribeDocuments();
      unsubscribeClients();
    };
  }, [projectId, ticketId]);

  useEffect(() => {
    if (!ticket) return;
    setRootCause(ticket.rootCause || '');
    setCorrectiveAction(ticket.correctiveAction || '');
    setPreventiveAction(ticket.preventiveAction || '');
    setResolutionSummary(ticket.resolutionSummary || '');
    setCoverageType(ticket.coverageType);
    setCoverageNotes(ticket.coverageNotes || '');
    setCommercialStatus(ticket.commercialStatus);
    setAcceptanceReference(ticket.acceptanceReference || '');
    setAcceptedOrderValue(ticket.estimatedAmount?.toString() || ticket.quotation?.total.toString() || '');
    setPaymentStatus(ticket.paymentStatus || 'not-invoiced');
    setInvoiceNumber(ticket.invoiceNumber || '');
    setInvoiceDate(ticket.invoiceDate || '');
    setInvoiceDueDate(ticket.invoiceDueDate || '');
    setInvoiceAmount(
      ticket.invoiceAmount?.toString() ||
        ticket.quotation?.total.toString() ||
        ticket.estimatedAmount?.toString() ||
        '',
    );
    setAmountReceived(ticket.amountReceived?.toString() || '');
    setPaymentReceivedDate(ticket.paymentReceivedDate || '');
    setPaymentReference(ticket.paymentReference || '');
    setServiceStartedAt(formatDateTimeInput(ticket.serviceStartedAt));
    setServiceCompletedAt(formatDateTimeInput(ticket.serviceCompletedAt));
  }, [ticket]);

  const client = useMemo(
    () =>
      project
        ? clients.find(
            (item) =>
              item.id === project.clientId ||
              item.id === ticket?.clientId ||
              item.company.trim().toLowerCase() ===
                project.clientName.trim().toLowerCase(),
          )
        : undefined,
    [clients, project, ticket?.clientId],
  );
  const clientContacts = useMemo(() => getClientContacts(client), [client]);
  const selectedContact = useMemo(
    () => clientContacts.find((contact) => contact.id === contactId),
    [clientContacts, contactId],
  );

  useEffect(() => {
    if (!ticket) return;
    const matchedContact =
      clientContacts.find(
        (contact) =>
          contact.id === ticket.reportedByContactId ||
          (!!ticket.reportedByEmail &&
            contact.email.toLowerCase() === ticket.reportedByEmail.toLowerCase()) ||
          contact.name.toLowerCase() === ticket.reportedByName.toLowerCase(),
      ) || getPrimaryClientContact(client);
    setContactId(matchedContact?.id || '');
  }, [client, clientContacts, ticket]);

  const ticketDocuments = useMemo(
    () => documents.filter((document) => document.ticketId === ticketId),
    [documents, ticketId],
  );

  const installedMachines = useMemo(
    () => getInstalledMachines(project?.supportProfile),
    [project],
  );
  const selectedMachine = installedMachines.find((machine) => machine.id === ticket?.machineId);
  const assignedEngineerEmail = ticket?.assignee?.email || project?.members?.find(
    (member) => member.userId === ticket?.assignee?.userId,
  )?.email;

  const quotationDocument = ticketDocuments.find((document) => document.id === ticket?.quotationDocumentId) ||
    ticketDocuments.find((document) => document.category === 'quotation');
  const invoiceDocument = ticketDocuments.find((document) => document.id === ticket?.invoiceDocumentId) ||
    ticketDocuments.find((document) => document.category === 'tax-invoice');
  const resolutionDocument = ticketDocuments.find((document) =>
    ['rca-report', 'solution-report'].includes(document.category),
  );

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-amber-500" />
        <h1 className="text-xl font-semibold">Support ticket not found</h1>
        <Button className="mt-4" onClick={() => navigate('/support')}>Return to support</Button>
      </div>
    );
  }

  const log = async (
    type: SupportActivity['type'],
    message: string,
    metadata?: SupportActivity['metadata'],
  ) => addSupportActivity(projectId, ticketId, {
    type,
    message,
    createdBy: actor.uid,
    createdByName: actor.name,
    metadata,
  });

  const handleStatusChange = async (nextStatus: SupportTicketStatus) => {
    const blocker = getTransitionBlocker(ticket, nextStatus);
    if (blocker) {
      toast({ title: 'Complete the SOP step first', description: blocker, variant: 'destructive' });
      return;
    }
    const updates: Partial<SupportTicketType> = { status: nextStatus };
    if (!ticket.firstResponseAt && nextStatus !== 'open') updates.firstResponseAt = new Date();
    if (nextStatus === 'resolved') updates.resolvedAt = new Date();
    if (nextStatus === 'closed') updates.closedAt = new Date();
    await updateSupportTicket(projectId, ticketId, updates);
    await log('status-change', `Status changed from ${SUPPORT_STATUS_LABELS[ticket.status]} to ${SUPPORT_STATUS_LABELS[nextStatus]}`, {
      from: ticket.status,
      to: nextStatus,
    });
    toast({ title: `Status updated to ${SUPPORT_STATUS_LABELS[nextStatus]}` });
  };

  const handleAssign = async (assignee?: SupportAssignee) => {
    await updateSupportTicket(projectId, ticketId, {
      assignee: assignee || (null as unknown as SupportAssignee),
    });
    await log('assignment', assignee ? `Assigned to ${assignee.name}` : 'Ticket unassigned');
  };

  const handleAddNote = async () => {
    if (!note.trim()) return;
    await log('note', note.trim());
    setNote('');
    toast({ title: 'Internal note added' });
  };

  const handleSaveCoverage = async () => {
    setSaving(true);
    try {
      await updateSupportTicket(projectId, ticketId, {
        coverageType,
        coverageNotes: coverageNotes.trim(),
        commercialStatus,
        acceptanceReference: acceptanceReference.trim(),
        estimatedAmount:
          coverageType === 'chargeable'
            ? Math.max(0, Number(acceptedOrderValue) || 0)
            : ticket.estimatedAmount,
        quotationAcceptedAt:
          commercialStatus === 'accepted' && !ticket.quotationAcceptedAt
            ? new Date()
            : ticket.quotationAcceptedAt,
      });
      await log('commercial', `Coverage set to ${COVERAGE_LABELS[coverageType]}; commercial status: ${COMMERCIAL_STATUS_LABELS[commercialStatus]}`);
      toast({ title: 'Commercial assessment saved' });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveResolution = async () => {
    setSaving(true);
    try {
      await updateSupportTicket(projectId, ticketId, {
        rootCause: rootCause.trim(),
        correctiveAction: correctiveAction.trim(),
        preventiveAction: preventiveAction.trim(),
        resolutionSummary: resolutionSummary.trim(),
      });
      await log('resolution', 'RCA and solution record updated');
      toast({ title: 'RCA and solution saved' });
    } finally {
      setSaving(false);
    }
  };

  const handleMachineChange = async (machineId: string) => {
    const machine = installedMachines.find((item) => item.id === machineId);
    if (!machine) return;
    await updateSupportTicket(projectId, ticketId, {
      machineId: machine.id,
      machineName: machine.name,
      machineSerialNumber: machine.serialNumber,
    });
    await log('note', `Ticket tagged to ${machine.name} · S/N ${machine.serialNumber}`);
    toast({ title: 'Machine updated', description: `${machine.name} · ${machine.serialNumber}` });
  };

  const handleSaveServiceDates = async () => {
    const started = serviceStartedAt ? new Date(serviceStartedAt) : undefined;
    const completed = serviceCompletedAt ? new Date(serviceCompletedAt) : undefined;
    if (started && completed && completed.getTime() < started.getTime()) {
      toast({
        title: 'Check the service dates',
        description: 'Service completion cannot be before service start.',
        variant: 'destructive',
      });
      return;
    }
    setSaving(true);
    try {
      await updateSupportTicket(projectId, ticketId, {
        serviceStartedAt: started || (null as unknown as Date),
        serviceCompletedAt: completed || (null as unknown as Date),
      });
      await log(
        'note',
        `Service dates updated: started ${formatDateTime(started)}; completed ${formatDateTime(completed)}`,
      );
      toast({ title: 'Service dates saved' });
    } finally {
      setSaving(false);
    }
  };

  const handleSavePayment = async () => {
    const received = Math.max(0, Number(amountReceived) || 0);
    const total = Math.max(0, Number(invoiceAmount) || 0);
    const validationError = validatePaymentTracking({
      paymentStatus,
      invoiceNumber,
      invoiceDate,
      invoiceDueDate,
      invoiceAmount: total,
      amountReceived: received,
      paymentReceivedDate,
      paymentReference,
    });
    if (validationError) {
      toast({
        title: 'Complete the invoice or payment details',
        description: validationError,
        variant: 'destructive',
      });
      return;
    }
    setSaving(true);
    try {
      await updateSupportTicket(projectId, ticketId, {
        paymentStatus,
        invoiceNumber: invoiceNumber.trim(),
        invoiceDate,
        invoiceDueDate,
        invoiceAmount: total,
        amountReceived: received,
        paymentReceivedDate,
        paymentReference: paymentReference.trim(),
        commercialStatus: ['invoice-raised', 'partially-paid', 'paid'].includes(paymentStatus)
          ? 'invoiced'
          : ticket.commercialStatus,
      });
      await log(
        'commercial',
        `Payment status updated to ${paymentStatus.replace('-', ' ')}${invoiceNumber.trim() ? ` for invoice ${invoiceNumber.trim()}` : ''}${received ? `; INR ${received.toLocaleString('en-IN')} received` : ''}`,
      );
      toast({ title: 'Payment tracking updated' });
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmation = async (value: CustomerConfirmation) => {
    await updateSupportTicket(projectId, ticketId, {
      customerConfirmation: value,
      customerConfirmedAt: value === 'confirmed' ? new Date() : undefined,
    });
    await log('resolution', `Customer confirmation set to ${value.replace('-', ' ')}`);
  };

  const handleCommunication = async (
    kind: 'acknowledgement' | 'quotation' | 'resolution',
  ) => {
    if (!selectedContact?.email) {
      toast({ title: 'Customer email is missing', description: 'Add an email before sending.', variant: 'destructive' });
      return;
    }
    if (ticket.reportedByContactId !== selectedContact.id) {
      toast({
        title: 'Save the CRM contact first',
        description: 'The selected recipient has not been saved to this ticket.',
        variant: 'destructive',
      });
      return;
    }
    if (kind === 'quotation' && !quotationDocument) {
      toast({ title: 'Prepare the quotation first', description: 'Use Prepare quotation in Coverage & commercials.', variant: 'destructive' });
      return;
    }
    if (kind === 'resolution' && (!ticket.rootCause || !ticket.resolutionSummary)) {
      toast({ title: 'Complete the RCA and solution first', variant: 'destructive' });
      return;
    }
    setSending(kind);
    try {
      await sendSupportCommunication({
        projectId,
        ticketId,
        kind,
        documentId:
          kind === 'quotation'
            ? quotationDocument?.id
            : kind === 'resolution'
              ? resolutionDocument?.id
              : undefined,
      });
      toast({ title: `${kind === 'acknowledgement' ? 'Acknowledgement' : kind === 'quotation' ? 'Quotation' : 'Resolution report'} sent` });
    } catch (error) {
      toast({
        title: 'Email could not be sent',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSending(null);
    }
  };

  const applyTicketContact = async (contact: ClientContact) => {
    setContactId(contact.id);
    setSaving(true);
    try {
      await updateSupportTicket(projectId, ticketId, {
        clientId: client?.id,
        reportedByContactId: contact.id,
        reportedByName: contact.name,
        reportedByEmail: contact.email,
        reportedByPhone: contact.phone,
      });
      await log('note', 'Ticket contact set to ' + contact.name + ' from the client CRM');
      toast({ title: 'Ticket contact updated', description: contact.name });
    } catch (error) {
      toast({
        title: 'Could not update ticket contact',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleContactChange = (nextContactId: string) => {
    const contact = clientContacts.find((item) => item.id === nextContactId);
    if (contact) void applyTicketContact(contact);
  };

  const handleDocumentUploaded = async (document: SupportDocument) => {
    await log('document', `${document.name} uploaded as ${document.category}`, { documentId: document.id });
    if (document.category === 'quotation') {
      await updateSupportTicket(projectId, ticketId, {
        quotationDocumentId: document.id,
        commercialStatus: ['accepted', 'invoiced'].includes(ticket.commercialStatus)
          ? ticket.commercialStatus
          : 'quotation-prepared',
      });
    }
    if (document.category === 'tax-invoice') {
      await updateSupportTicket(projectId, ticketId, { invoiceDocumentId: document.id });
    }
  };

  const overdue = isOverdue(ticket);
  const nextTarget = ticket.firstResponseAt ? ticket.resolutionTargetAt : ticket.firstResponseTargetAt;
  const invoiceTrackingVisible = shouldShowInvoiceTracking(ticket);
  const trackedInvoiceTotal = Math.max(
    0,
    Number(invoiceAmount) || ticket.invoiceAmount || ticket.quotation?.total || ticket.estimatedAmount || 0,
  );
  const outstandingBalance = Math.max(0, trackedInvoiceTotal - (Number(amountReceived) || 0));
  const invoiceOverdue = Boolean(
    invoiceDueDate &&
      outstandingBalance > 0 &&
      new Date(`${invoiceDueDate}T23:59:59`).getTime() < Date.now(),
  );

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <Button asChild variant="ghost" className="-ml-3">
        <Link to="/support"><ArrowLeft className="mr-2 h-4 w-4" />Back to support queue</Link>
      </Button>

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-muted-foreground">{ticket.ticketNumber}</span>
              <PriorityBadge priority={ticket.priority} />
              <StatusBadge status={ticket.status} />
              <CoverageBadge coverage={ticket.coverageType} />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">{ticket.title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {ticket.projectName} · {ticket.clientName} · Reported by {ticket.reportedByName}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                handleAssign(
                  ticket.assignee?.userId === actor.uid
                    ? undefined
                    : { userId: actor.uid, name: actor.name, email: user?.email || undefined },
                )
              }
            >
              <UserRound className="mr-2 h-4 w-4" />
              {ticket.assignee?.userId === actor.uid ? 'Unassign me' : 'Assign to me'}
            </Button>
            <Select value={ticket.status} onValueChange={(value) => handleStatusChange(value as SupportTicketStatus)}>
              <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SUPPORT_STATUS_ORDER.map((status) => (
                  <SelectItem key={status} value={status}>{SUPPORT_STATUS_LABELS[status]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {overdue && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Service target needs attention</AlertTitle>
          <AlertDescription>
            The current {ticket.firstResponseAt ? 'resolution' : 'first-response'} target was {formatDateTime(nextTarget)}.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle className="text-lg">Issue statement</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="whitespace-pre-wrap text-sm leading-6">{ticket.description}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Flag label="Machine stopped" active={ticket.machineStopped} />
                <Flag label="Production downtime" active={ticket.downtime} />
                <Flag label="Site visit indicated" active={ticket.siteVisitRequired} />
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="activity">
            <TabsList>
              <TabsTrigger value="activity">Activity & notes</TabsTrigger>
              <TabsTrigger value="documents">Documents</TabsTrigger>
              <TabsTrigger value="resolution">RCA & solution</TabsTrigger>
            </TabsList>

            <TabsContent value="activity" className="space-y-4">
              <Card>
                <CardContent className="space-y-3 pt-6">
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add an internal diagnostic note, observation, remote-support step, or customer update…" />
                  <div className="flex justify-end"><Button onClick={handleAddNote} disabled={!note.trim()}>Add note</Button></div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="space-y-5">
                    {activities.map((activity, index) => (
                      <div key={activity.id} className="relative flex gap-3">
                        {index < activities.length - 1 && <div className="absolute left-[15px] top-8 h-[calc(100%+4px)] w-px bg-border" />}
                        <div className="z-10 mt-0.5 rounded-full border bg-white p-2"><Clock3 className="h-3.5 w-3.5 text-slate-500" /></div>
                        <div className="min-w-0 flex-1 pb-2">
                          <p className="text-sm font-medium">{activity.message}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {activity.createdByName} · {formatDateTime(activity.createdAt)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="documents">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Ticket evidence & project document pack</CardTitle>
                </CardHeader>
                <CardContent>
                  <SupportDocuments
                    projectId={projectId}
                    ticketId={ticketId}
                    userId={actor.uid}
                    userName={actor.name}
                    onUploaded={handleDocumentUploaded}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="resolution">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Root cause analysis and solution record</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-2"><Label>Root cause</Label><Textarea rows={4} value={rootCause} onChange={(e) => setRootCause(e.target.value)} placeholder="Confirmed technical cause, not only the observed symptom." /></div>
                  <div className="grid gap-2"><Label>Corrective action</Label><Textarea rows={4} value={correctiveAction} onChange={(e) => setCorrectiveAction(e.target.value)} placeholder="What was changed, repaired, restored, tuned, or replaced." /></div>
                  <div className="grid gap-2"><Label>Preventive action</Label><Textarea rows={3} value={preventiveAction} onChange={(e) => setPreventiveAction(e.target.value)} placeholder="Optional: design, maintenance, backup, training, or monitoring action that reduces recurrence." /></div>
                  <div className="grid gap-2"><Label>Customer-facing solution summary</Label><Textarea rows={4} value={resolutionSummary} onChange={(e) => setResolutionSummary(e.target.value)} placeholder="Plain-language result, validation performed, and current machine status." /></div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Label>Customer confirmation</Label>
                      <Select value={ticket.customerConfirmation} onValueChange={(value) => handleConfirmation(value as CustomerConfirmation)}>
                        <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pending">Pending</SelectItem>
                          <SelectItem value="confirmed">Confirmed</SelectItem>
                          <SelectItem value="not-required">Not required</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button onClick={handleSaveResolution} disabled={saving}><Save className="mr-2 h-4 w-4" />Save RCA & solution</Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle className="text-base">Service control</CardTitle></CardHeader>
            <CardContent className="space-y-4 text-sm">
              <InfoRow icon={UserRound} label="Owner" value={ticket.assignee?.name || 'Unassigned'} />
              <InfoRow icon={CalendarClock} label={ticket.firstResponseAt ? 'Resolution target' : 'First response target'} value={formatDateTime(nextTarget)} danger={overdue} />
              <InfoRow icon={Clock3} label="First response" value={formatDateTime(ticket.firstResponseAt)} />
              <InfoRow icon={Clock3} label="Last engineer follow-up" value={formatDateTime(ticket.lastEngineerFollowUpAt)} />
              <InfoRow icon={MapPin} label="Installed site" value={selectedMachine?.siteLocation || project?.supportProfile?.siteLocation || 'Not configured'} />
              <div>
                <Label>Machine / line</Label>
                <Select value={ticket.machineId || ''} onValueChange={handleMachineChange} disabled={!installedMachines.length}>
                  <SelectTrigger className="mt-2"><SelectValue placeholder="Tag this ticket to a machine" /></SelectTrigger>
                  <SelectContent>
                    {installedMachines.map((machine) => (
                      <SelectItem key={machine.id} value={machine.id}>{machine.name}{machine.lineName ? ` · ${machine.lineName}` : ''} · S/N {machine.serialNumber}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Separator />
              <div>
                <Label>Assigned engineer</Label>
                <Select
                  value={ticket.assignee?.userId || 'unassigned'}
                  onValueChange={(value) => {
                    if (value === 'unassigned') return handleAssign(undefined);
                    const member = project?.members?.find((item) => item.userId === value);
                    if (member) handleAssign({ userId: member.userId, name: member.displayName, email: member.email });
                  }}
                >
                  <SelectTrigger className="mt-2"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {project?.members?.map((member) => (
                      <SelectItem key={member.userId} value={member.userId}>{member.displayName || member.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <div className="grid gap-2">
                  <Label>Service started</Label>
                  <Input
                    type="datetime-local"
                    value={serviceStartedAt}
                    onChange={(event) => setServiceStartedAt(event.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Service completed</Label>
                  <Input
                    type="datetime-local"
                    value={serviceCompletedAt}
                    min={serviceStartedAt || undefined}
                    onChange={(event) => setServiceCompletedAt(event.target.value)}
                  />
                </div>
              </div>
              <Button className="w-full" variant="outline" onClick={handleSaveServiceDates} disabled={saving}>
                <Save className="mr-2 h-4 w-4" />Save service dates
              </Button>
              <Separator />
              <Button
                className="w-full"
                onClick={() => setFollowUpOpen(true)}
                disabled={!assignedEngineerEmail}
              >
                <Mail className="mr-2 h-4 w-4" />Follow up with engineer
              </Button>
              {!assignedEngineerEmail && (
                <p className="text-xs text-amber-700">Assign a project member with an email address before following up.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CircleDollarSign className="h-4 w-4" />Coverage & commercials</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label>Coverage decision</Label>
                <Select value={coverageType} onValueChange={(value) => setCoverageType(value as CoverageType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(COVERAGE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Commercial status</Label>
                <Select value={commercialStatus} onValueChange={(value) => setCommercialStatus(value as CommercialStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(COMMERCIAL_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2"><Label>Acceptance / customer PO</Label><Input value={acceptanceReference} onChange={(e) => setAcceptanceReference(e.target.value)} /></div>
              {coverageType === 'chargeable' && (
                <div className="grid gap-2">
                  <Label>Accepted order value (INR)</Label>
                  <Input type="number" min="0" value={acceptedOrderValue} onChange={(event) => setAcceptedOrderValue(event.target.value)} />
                  <p className="text-xs text-muted-foreground">Use the customer PO total, including tax, for external quotations.</p>
                </div>
              )}
              <div className="grid gap-2"><Label>Assessment notes</Label><Textarea value={coverageNotes} onChange={(e) => setCoverageNotes(e.target.value)} /></div>
              <Button className="w-full" variant="outline" onClick={handleSaveCoverage} disabled={saving}><Save className="mr-2 h-4 w-4" />Save commercial assessment</Button>
              <Separator />
              {ticket.quotation ? (
                <div className="rounded-lg border bg-slate-50 p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div><div className="font-semibold">{ticket.quotation.quotationNumber}</div><div className="text-xs text-muted-foreground">{ticket.quotation.billingEntityName} · Valid until {ticket.quotation.validUntil}</div></div>
                    <div className="font-semibold">{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(ticket.quotation.total)}</div>
                  </div>
                  <Button asChild size="sm" variant="link" className="mt-2 h-auto p-0"><a href={ticket.quotation.pdfUrl} target="_blank" rel="noreferrer"><FileText className="mr-1.5 h-3.5 w-3.5" />Open PDF</a></Button>
                </div>
              ) : quotationDocument || ['accepted', 'invoiced'].includes(ticket.commercialStatus) ? (
                <div className="rounded-lg border bg-slate-50 p-3 text-sm">
                  <div className="font-semibold">External quotation / customer PO</div>
                  <div className="mt-1 text-xs text-muted-foreground">{acceptanceReference || 'Commercial acceptance recorded outside the app.'}</div>
                  {ticket.estimatedAmount ? <div className="mt-2 font-semibold">{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(ticket.estimatedAmount)}</div> : null}
                  {quotationDocument ? <Button asChild size="sm" variant="link" className="mt-2 h-auto p-0"><a href={quotationDocument.url} target="_blank" rel="noreferrer"><FileText className="mr-1.5 h-3.5 w-3.5" />Open external quotation</a></Button> : null}
                </div>
              ) : <p className="text-xs text-muted-foreground">No quotation has been prepared or uploaded for this ticket.</p>}
              <Button className="w-full" onClick={() => setQuotationOpen(true)} disabled={!project || !client}><FileText className="mr-2 h-4 w-4" />{ticket.quotation || ['accepted', 'invoiced'].includes(ticket.commercialStatus) ? 'Prepare revised quotation' : 'Prepare quotation'}</Button>
            </CardContent>
          </Card>

          {invoiceTrackingVisible && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CircleDollarSign className="h-4 w-4" />Invoice & payment tracking</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">Track invoices created in the accounting system, including external-quotation and customer-PO cases.</p>
                <div className="grid gap-2"><Label>Payment status</Label><Select value={paymentStatus} onValueChange={(value) => setPaymentStatus(value as SupportPaymentStatus)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="not-invoiced">Not invoiced</SelectItem><SelectItem value="invoice-raised">Invoice raised</SelectItem><SelectItem value="partially-paid">Partially paid</SelectItem><SelectItem value="paid">Paid</SelectItem><SelectItem value="waived">Waived</SelectItem></SelectContent></Select></div>
                <div className="grid grid-cols-2 gap-3"><div className="grid gap-2"><Label>Invoice number</Label><Input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} /></div><div className="grid gap-2"><Label>Invoice date</Label><Input type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} /></div></div>
                <div className="grid grid-cols-2 gap-3"><div className="grid gap-2"><Label>Invoice amount (INR)</Label><Input type="number" min="0" value={invoiceAmount} onChange={(event) => setInvoiceAmount(event.target.value)} /></div><div className="grid gap-2"><Label>Payment due date</Label><Input type="date" value={invoiceDueDate} onChange={(event) => setInvoiceDueDate(event.target.value)} /></div></div>
                <div className="grid grid-cols-2 gap-3"><div className="grid gap-2"><Label>Amount received (INR)</Label><Input type="number" min="0" value={amountReceived} onChange={(event) => setAmountReceived(event.target.value)} /></div><div className="grid gap-2"><Label>Received date</Label><Input type="date" value={paymentReceivedDate} onChange={(event) => setPaymentReceivedDate(event.target.value)} /></div></div>
                <div className="grid gap-2"><Label>Payment reference</Label><Input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="UTR, cheque or receipt reference" /></div>
                {invoiceDocument ? <Button asChild size="sm" variant="link" className="h-auto justify-start p-0"><a href={invoiceDocument.url} target="_blank" rel="noreferrer"><FileText className="mr-1.5 h-3.5 w-3.5" />Open tax invoice</a></Button> : <p className="text-xs text-amber-700">Upload the accounting-system invoice under Documents → Tax invoice.</p>}
                <div className={`flex justify-between rounded-md p-3 text-sm ${invoiceOverdue ? 'bg-red-50 text-red-700' : 'bg-slate-50'}`}><span>{invoiceOverdue ? 'Overdue balance' : 'Outstanding balance'}</span><span className="font-semibold">{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(outstandingBalance)}</span></div>
                <Button className="w-full" variant="outline" onClick={handleSavePayment} disabled={saving}><Save className="mr-2 h-4 w-4" />Save payment status</Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Mail className="h-4 w-4" />Customer communication</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Messages use the selected client CRM contact and are recorded in the activity trail.
              </p>
              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-3">
                  <Label>CRM contact for this ticket</Label>
                  <AddClientContactDialog
                    projectId={projectId}
                    client={client}
                    onAdded={(contact) => void applyTicketContact(contact)}
                  />
                </div>
                <Select value={contactId} onValueChange={handleContactChange} disabled={saving}>
                  <SelectTrigger><SelectValue placeholder="Choose a client contact" /></SelectTrigger>
                  <SelectContent>
                    {clientContacts.map((contact) => (
                      <SelectItem key={contact.id} value={contact.id}>
                        {contact.name}
                        {contact.designation ? ` · ${contact.designation}` : ''}
                        {contact.email ? ` · ${contact.email}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedContact ? (
                  <div className="grid gap-1 rounded-md border bg-slate-50 p-3 text-sm">
                    <div><span className="text-muted-foreground">Email:</span> {selectedContact.email || 'Not provided'}</div>
                    <div><span className="text-muted-foreground">Phone:</span> {selectedContact.phone || 'Not provided'}</div>
                  </div>
                ) : (
                  <p className="text-xs text-amber-700">Use Add CRM contact to create a contact for this client.</p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Selecting a contact immediately associates it with this ticket. New contacts are saved to the client CRM.
              </p>
              <div className="border-t pt-3 space-y-2">
                <CommunicationButton label="Send acknowledgement" loading={sending === 'acknowledgement'} onClick={() => handleCommunication('acknowledgement')} />
                <CommunicationButton label="Send quotation" loading={sending === 'quotation'} onClick={() => handleCommunication('quotation')} />
                <CommunicationButton label="Send RCA & solution" loading={sending === 'resolution'} onClick={() => handleCommunication('resolution')} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      {project && (
        <SupportQuotationDialog
          open={quotationOpen}
          onOpenChange={setQuotationOpen}
          project={project}
          ticket={ticket}
          client={client || null}
        />
      )}
      <SupportEngineerFollowUpDialog
        open={followUpOpen}
        onOpenChange={setFollowUpOpen}
        projectId={projectId}
        ticket={ticket}
      />
    </div>
  );
}

function Flag({ label, active }: { label: string; active: boolean }) {
  return (
    <div className={`rounded-lg border p-3 text-sm ${active ? 'border-amber-200 bg-amber-50 text-amber-800' : 'bg-slate-50 text-muted-foreground'}`}>
      {active ? <AlertTriangle className="mr-2 inline h-4 w-4" /> : <CheckCircle2 className="mr-2 inline h-4 w-4" />}
      {label}
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  danger = false,
}: {
  icon: typeof Headphones;
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className={`mt-0.5 h-4 w-4 ${danger ? 'text-red-600' : 'text-slate-500'}`} />
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`mt-0.5 break-words ${danger ? 'font-medium text-red-600' : ''}`}>{value}</div>
      </div>
    </div>
  );
}

function CommunicationButton({
  label,
  loading,
  onClick,
}: {
  label: string;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <Button variant="outline" className="w-full justify-start" onClick={onClick} disabled={loading}>
      {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
      {label}
    </Button>
  );
}
