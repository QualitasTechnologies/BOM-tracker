import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  ArrowLeft,
  Building2,
  Calendar,
  Phone,
  Mail,
  User,
  Clock,
  CheckCircle2,
  XCircle,
  Plus,
  Edit2,
  Trash2,
  ExternalLink,
  AlertCircle,
} from "lucide-react";
import {
  Deal,
  DealStage,
  ActivityLogEntry,
  Contact,
  DEAL_STAGE_LABELS,
  DEAL_STAGE_ORDER,
  DEAL_SOURCE_LABELS,
  ACTIVITY_TYPE_LABELS,
  CURRENCY_SYMBOLS,
  formatCurrencyValue,
  isDealStale,
  getDaysSinceActivity,
} from "@/types/crm";
import {
  getDeal,
  updateDeal,
  subscribeToActivityLog,
  logActivity,
  logStageChange,
  getContactsByClient,
} from "@/utils/crmFirestore";
import { subscribeToClients, Client } from "@/utils/settingsFirestore";
import LogActivityDialog from "@/components/CRM/LogActivityDialog";
import NextStepDialog from "@/components/CRM/NextStepDialog";
import MarkAsLostDialog from "@/components/CRM/MarkAsLostDialog";
import EditDealDialog from "@/components/CRM/EditDealDialog";
import { useCRMAccess } from "@/hooks/useCRMAccess";
import { Loader2, Lock } from "lucide-react";

const DealDetail = () => {
  const { dealId } = useParams<{ dealId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const { hasCRMAccess, loading: crmLoading } = useCRMAccess();

  // State
  const [deal, setDeal] = useState<Deal | null>(null);
  const [loading, setLoading] = useState(true);
  const [activities, setActivities] = useState<ActivityLogEntry[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [showAllActivities, setShowAllActivities] = useState(false);

  // Dialog states
  const [logActivityOpen, setLogActivityOpen] = useState(false);
  const [nextStepOpen, setNextStepOpen] = useState(false);
  const [markAsLostOpen, setMarkAsLostOpen] = useState(false);
  const [editDealOpen, setEditDealOpen] = useState(false);

  // Fetch deal
  useEffect(() => {
    if (!dealId) return;

    const fetchDeal = async () => {
      setLoading(true);
      try {
        const dealData = await getDeal(dealId);
        if (dealData) {
          setDeal(dealData);
          // Fetch contacts for this client
          if (dealData.clientId) {
            const clientContacts = await getContactsByClient(dealData.clientId);
            setContacts(clientContacts);
          }
        } else {
          toast({ title: "Deal not found", variant: "destructive" });
          navigate("/pipeline");
        }
      } catch (error) {
        console.error("Error fetching deal:", error);
        toast({ title: "Error loading deal", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    };

    fetchDeal();
  }, [dealId, navigate, toast]);

  // Subscribe to activity log
  useEffect(() => {
    if (!dealId) return;

    const unsubscribe = subscribeToActivityLog(dealId, (entries) => {
      setActivities(entries);
    });

    return () => unsubscribe();
  }, [dealId]);

  // Subscribe to clients
  useEffect(() => {
    const unsubscribe = subscribeToClients((clientList) => {
      setClients(clientList);
    });
    return () => unsubscribe();
  }, []);

  // Get client for this deal
  const client = useMemo(() => {
    if (!deal) return null;
    return clients.find((c) => c.id === deal.clientId) || null;
  }, [deal, clients]);

  // Handle stage change
  const handleStageChange = async (newStage: DealStage) => {
    if (!deal || !user?.uid || !dealId) return;

    const oldStage = deal.stage;
    if (oldStage === newStage) return;

    try {
      await updateDeal(dealId, { stage: newStage });
      await logStageChange(dealId, oldStage, newStage, user.uid);
      setDeal({ ...deal, stage: newStage });
      toast({ title: `Stage updated to ${DEAL_STAGE_LABELS[newStage]}` });
    } catch (error) {
      console.error("Error updating stage:", error);
      toast({ title: "Error updating stage", variant: "destructive" });
    }
  };

  // Handle probability change
  const handleProbabilityChange = async (probability: string) => {
    if (!deal || !dealId) return;

    try {
      const newProb = parseInt(probability);
      await updateDeal(dealId, { probability: newProb });
      setDeal({ ...deal, probability: newProb });
      toast({ title: `Probability updated to ${newProb}%` });
    } catch (error) {
      console.error("Error updating probability:", error);
      toast({ title: "Error updating probability", variant: "destructive" });
    }
  };

  // Complete next step
  const handleCompleteNextStep = async () => {
    if (!deal || !user?.uid || !dealId || !deal.nextStep) return;

    try {
      // Log the completed activity
      await logActivity(dealId, {
        action: deal.nextStep.action,
        type: "follow-up",
        completedAt: new Date(),
        completedBy: user.uid,
        stageAtTime: deal.stage,
      });

      // Clear the next step
      await updateDeal(dealId, { nextStep: null });
      setDeal({ ...deal, nextStep: null });
      toast({ title: "Step completed!" });
    } catch (error) {
      console.error("Error completing step:", error);
      toast({ title: "Error completing step", variant: "destructive" });
    }
  };

  // Clear next step
  const handleClearNextStep = async () => {
    if (!deal || !dealId) return;

    try {
      await updateDeal(dealId, { nextStep: null });
      setDeal({ ...deal, nextStep: null });
      toast({ title: "Next step cleared" });
    } catch (error) {
      console.error("Error clearing step:", error);
      toast({ title: "Error clearing step", variant: "destructive" });
    }
  };

  // Convert Firestore Timestamp or Date to JS Date
  const toDate = (date: any): Date => {
    if (!date) return new Date();
    // Firestore Timestamp has toDate() method
    if (date?.toDate && typeof date.toDate === 'function') {
      return date.toDate();
    }
    // Already a Date
    if (date instanceof Date) {
      return date;
    }
    // ISO string or other
    return new Date(date);
  };

  // Format date
  const formatDate = (date: any) => {
    if (!date) return "—";
    const d = toDate(date);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  // Format date short (for activity log)
  const formatDateShort = (date: any) => {
    const d = toDate(date);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
    });
  };

  // Activity type badge color
  const getActivityTypeBadge = (type: string) => {
    const colors: Record<string, string> = {
      call: "bg-blue-100 text-blue-800",
      meeting: "bg-purple-100 text-purple-800",
      email: "bg-green-100 text-green-800",
      demo: "bg-orange-100 text-orange-800",
      proposal: "bg-yellow-100 text-yellow-800",
      "follow-up": "bg-gray-100 text-gray-800",
      "stage-change": "bg-indigo-100 text-indigo-800",
      note: "bg-slate-100 text-slate-800",
    };
    return colors[type] || "bg-gray-100 text-gray-800";
  };

  // Displayed activities (limited or all)
  const displayedActivities = showAllActivities
    ? activities
    : activities.slice(0, 5);

  // CRM access loading
  if (crmLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Access denied
  if (!hasCRMAccess) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Lock className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
          <p className="text-muted-foreground">
            You don't have access to the CRM module.
          </p>
          <p className="text-muted-foreground text-sm mt-1">
            Contact an administrator to request access.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-muted-foreground">Loading deal...</div>
      </div>
    );
  }

  if (!deal) {
    return null;
  }

  const isStale = isDealStale(new Date(deal.lastActivityAt));
  const daysSinceActivity = getDaysSinceActivity(new Date(deal.lastActivityAt));

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/pipeline")}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          {client?.logo && (
            <img
              src={client.logo}
              alt={client.company}
              className="h-12 w-12 object-contain rounded"
            />
          )}
          <div>
            <h1 className="text-2xl font-bold">{deal.name}</h1>
            {client && (
              <p className="text-muted-foreground">{client.company}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Edit Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditDealOpen(true)}
          >
            <Edit2 className="h-4 w-4 mr-1" />
            Edit
          </Button>

          {/* Stage Selector */}
          <Select value={deal.stage} onValueChange={handleStageChange}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DEAL_STAGE_ORDER.filter((s) => s !== "won" && s !== "lost").map(
                (stage) => (
                  <SelectItem key={stage} value={stage}>
                    {DEAL_STAGE_LABELS[stage]}
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>

          {/* Probability Selector */}
          <Select
            value={deal.probability.toString()}
            onValueChange={handleProbabilityChange}
          >
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((p) => (
                <SelectItem key={p} value={p.toString()}>
                  {p}%
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Stale Warning */}
      {isStale && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-yellow-600" />
          <span className="text-yellow-800 text-sm">
            No activity in {daysSinceActivity} days. Consider following up.
          </span>
        </div>
      )}

      {/* Info Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Deal Info Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Deal Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Expected Value</span>
              <span className="font-semibold">
                {CURRENCY_SYMBOLS[deal.currency]}
                {deal.expectedValue.toLocaleString("en-IN")}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Weighted Value</span>
              <span>
                {formatCurrencyValue(
                  deal.expectedValue * (deal.probability / 100),
                  deal.currency
                )}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Expected Close</span>
              <span>{formatDate(deal.expectedCloseDate)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Source</span>
              <span>{DEAL_SOURCE_LABELS[deal.source]}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Created</span>
              <span>{formatDate(deal.createdAt)}</span>
            </div>
            {deal.description && (
              <div className="pt-2 border-t">
                <span className="text-muted-foreground block mb-1">
                  Description
                </span>
                <p className="text-sm">{deal.description}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Customer Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Customer
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {client ? (
              <>
                <div className="flex items-center gap-3">
                  {client.logo && (
                    <img
                      src={client.logo}
                      alt={client.company}
                      className="w-14 h-14 object-contain rounded border p-1"
                    />
                  )}
                  <div>
                    <p className="font-semibold">{client.company}</p>
                    {client.contactPerson && (
                      <p className="text-muted-foreground">
                        {client.contactPerson}
                      </p>
                    )}
                  </div>
                </div>
                {client.phone && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="h-3.5 w-3.5" />
                    <span>{client.phone}</span>
                  </div>
                )}
                {client.email && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Mail className="h-3.5 w-3.5" />
                    <span>{client.email}</span>
                  </div>
                )}
                {/* Show additional contacts if any */}
                {contacts.length > 0 && (
                  <div className="pt-2 border-t">
                    <p className="text-xs text-muted-foreground mb-2">
                      Contacts
                    </p>
                    {contacts.slice(0, 2).map((contact) => (
                      <div
                        key={contact.id}
                        className="flex items-center gap-2 text-xs py-1"
                      >
                        <User className="h-3 w-3" />
                        <span>
                          {contact.name}
                          {contact.designation && ` (${contact.designation})`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">No client assigned</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Next Step Section */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Next Step
            </CardTitle>
            {!deal.nextStep && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setNextStepOpen(true)}
              >
                <Plus className="h-4 w-4 mr-1" />
                Set Next Step
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {deal.nextStep ? (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium">{deal.nextStep.action}</p>
                  {deal.nextStep.dueDate && (
                    <p className="text-sm text-muted-foreground mt-1">
                      <Calendar className="h-3.5 w-3.5 inline mr-1" />
                      Due: {formatDate(deal.nextStep.dueDate)}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="default"
                    onClick={handleCompleteNextStep}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    Complete
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setNextStepOpen(true)}
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleClearNextStep}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              No next step defined. Set one to track your progress.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Activity Log */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Activity Log</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLogActivityOpen(true)}
            >
              <Plus className="h-4 w-4 mr-1" />
              Log Activity
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {activities.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No activities logged yet.
            </p>
          ) : (
            <div className="space-y-3">
              {displayedActivities.map((activity) => (
                <div
                  key={activity.id}
                  className="flex items-start gap-3 py-2 border-b last:border-b-0"
                >
                  <div className="text-xs text-muted-foreground w-16 shrink-0 pt-0.5">
                    {formatDateShort(activity.completedAt)}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">
                        {activity.action}
                      </span>
                      <Badge
                        variant="secondary"
                        className={`text-xs ${getActivityTypeBadge(
                          activity.type
                        )}`}
                      >
                        {ACTIVITY_TYPE_LABELS[activity.type]}
                      </Badge>
                    </div>
                    {activity.notes && (
                      <p className="text-sm text-muted-foreground mt-1">
                        "{activity.notes}"
                      </p>
                    )}
                  </div>
                  <Badge variant="outline" className="text-xs shrink-0">
                    {DEAL_STAGE_LABELS[activity.stageAtTime]}
                  </Badge>
                </div>
              ))}

              {activities.length > 5 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => setShowAllActivities(!showAllActivities)}
                >
                  {showAllActivities
                    ? "Show less"
                    : `Show ${activities.length - 5} more...`}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Draft BOM Section (placeholder) */}
      {deal.stage === "proposal" || deal.stage === "negotiation" ? (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Draft BOM</CardTitle>
              <Badge variant="outline">
                {deal.hasDraftBOM
                  ? `${formatCurrencyValue(
                      deal.draftBOMTotalCost,
                      deal.currency
                    )} estimated`
                  : "Not started"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Draft BOM builder coming soon. Build your cost estimation for
              proposals.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Action Buttons */}
      <div className="flex gap-3 justify-end pt-4 border-t">
        <Button
          variant="outline"
          className="text-red-600 border-red-200 hover:bg-red-50"
          onClick={() => setMarkAsLostOpen(true)}
        >
          <XCircle className="h-4 w-4 mr-2" />
          Mark as Lost
        </Button>
        <Button
          variant="default"
          className="bg-green-600 hover:bg-green-700"
          onClick={() => {
            toast({
              title: "Coming soon",
              description:
                "Deal to Project conversion will be implemented next.",
            });
          }}
        >
          <CheckCircle2 className="h-4 w-4 mr-2" />
          Mark as Won
        </Button>
      </div>

      {/* Dialogs */}
      <LogActivityDialog
        open={logActivityOpen}
        onOpenChange={setLogActivityOpen}
        dealId={dealId!}
        currentStage={deal.stage}
        onActivityLogged={() => {
          // Activities update via subscription
        }}
      />

      <NextStepDialog
        open={nextStepOpen}
        onOpenChange={setNextStepOpen}
        dealId={dealId!}
        currentNextStep={deal.nextStep}
        onNextStepSaved={(nextStep) => {
          setDeal({ ...deal, nextStep });
        }}
      />

      <MarkAsLostDialog
        open={markAsLostOpen}
        onOpenChange={setMarkAsLostOpen}
        dealId={dealId!}
        dealName={deal.name}
        onDealLost={() => {
          navigate("/pipeline");
        }}
      />

      <EditDealDialog
        open={editDealOpen}
        onOpenChange={setEditDealOpen}
        deal={deal}
        clients={clients}
        onDealUpdated={(updates) => {
          setDeal({ ...deal, ...updates });
          // Refetch contacts if client changed
          if (updates.clientId && updates.clientId !== deal.clientId) {
            getContactsByClient(updates.clientId).then(setContacts);
          }
        }}
      />
    </div>
  );
};

export default DealDetail;
