import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus,
  Search,
  Filter,
  LayoutGrid,
  List,
  MoreVertical,
  Building2,
  Calendar,
  User,
  AlertTriangle,
  Archive,
  Copy,
  ExternalLink,
  ArrowRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Deal,
  DealStage,
  PipelineSummary,
  DEAL_STAGE_ORDER,
  DEAL_STAGE_LABELS,
  DEAL_SOURCE_LABELS,
  formatCurrencyValue,
  isDealStale,
  getDaysSinceActivity,
  calculateWeightedValue,
  toJsDate,
} from "@/types/crm";
import {
  subscribeToDeals,
  getPipelineSummary,
  archiveDeal,
  restoreDeal,
  duplicateDeal,
} from "@/utils/crmFirestore";
import { getClients, Client } from "@/utils/settingsFirestore";
import AddDealDialog from "@/components/CRM/AddDealDialog";

const Pipeline = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  // State
  const [deals, setDeals] = useState<Deal[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [pipelineSummary, setPipelineSummary] = useState<PipelineSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"kanban" | "table">("kanban");
  const [showArchived, setShowArchived] = useState(false);
  const [showAddDeal, setShowAddDeal] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<DealStage | "all">("all");
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");

  // Load data
  useEffect(() => {
    const loadClients = async () => {
      const clientsData = await getClients();
      setClients(clientsData);
    };
    loadClients();
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToDeals((dealsData) => {
      setDeals(dealsData);
      setLoading(false);
    }, showArchived);

    return () => unsubscribe();
  }, [showArchived]);

  useEffect(() => {
    const loadSummary = async () => {
      const summary = await getPipelineSummary();
      setPipelineSummary(summary);
    };
    loadSummary();
  }, [deals]);

  // Filtered deals
  const filteredDeals = useMemo(() => {
    return deals.filter((deal) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const client = clients.find((c) => c.id === deal.clientId);
        const matchesSearch =
          deal.name.toLowerCase().includes(query) ||
          client?.company.toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }

      // Stage filter
      if (stageFilter !== "all" && deal.stage !== stageFilter) return false;

      // Client filter
      if (clientFilter !== "all" && deal.clientId !== clientFilter) return false;

      // Assignee filter
      if (assigneeFilter !== "all" && deal.assigneeId !== assigneeFilter) return false;

      return true;
    });
  }, [deals, searchQuery, stageFilter, clientFilter, assigneeFilter, clients]);

  // Group deals by stage for kanban view
  const dealsByStage = useMemo(() => {
    const grouped: Record<DealStage, Deal[]> = {
      new: [],
      qualification: [],
      proposal: [],
      negotiation: [],
      won: [],
      lost: [],
    };

    filteredDeals.forEach((deal) => {
      grouped[deal.stage].push(deal);
    });

    return grouped;
  }, [filteredDeals]);

  // Get unique assignees for filter
  const uniqueAssignees = useMemo(() => {
    const assignees = new Set<string>();
    deals.forEach((deal) => {
      if (deal.assigneeId) assignees.add(deal.assigneeId);
    });
    return Array.from(assignees);
  }, [deals]);

  // Handlers
  const handleArchiveDeal = async (dealId: string) => {
    try {
      await archiveDeal(dealId);
      toast({ title: "Deal archived" });
    } catch (error) {
      toast({ title: "Error archiving deal", variant: "destructive" });
    }
  };

  const handleRestoreDeal = async (dealId: string) => {
    try {
      await restoreDeal(dealId);
      toast({ title: "Deal restored to pipeline" });
    } catch (error) {
      toast({ title: "Error restoring deal", variant: "destructive" });
    }
  };

  const handleDuplicateDeal = async (dealId: string) => {
    try {
      const newDealId = await duplicateDeal(dealId);
      toast({ title: "Deal duplicated" });
      navigate(`/deals/${newDealId}`);
    } catch (error) {
      toast({ title: "Error duplicating deal", variant: "destructive" });
    }
  };

  const getClientName = (clientId: string): string => {
    const client = clients.find((c) => c.id === clientId);
    return client?.company || "Unknown Client";
  };

  const getStageBadgeVariant = (stage: DealStage): "default" | "secondary" | "destructive" | "outline" => {
    switch (stage) {
      case "won":
        return "default";
      case "lost":
        return "destructive";
      case "negotiation":
        return "secondary";
      default:
        return "outline";
    }
  };

  // Render deal card for kanban view
  const renderDealCard = (deal: Deal) => {
    const isStale = isDealStale(deal.lastActivityAt);
    const daysSinceActivity = getDaysSinceActivity(deal.lastActivityAt);

    return (
      <Card
        key={deal.id}
        className={`mb-3 cursor-pointer hover:shadow-md transition-shadow ${isStale ? "border-yellow-400" : ""}`}
        onClick={() => navigate(`/deals/${deal.id}`)}
      >
        <CardContent className="p-4">
          <div className="flex justify-between items-start mb-2">
            <div className="flex-1 min-w-0">
              <h4 className="font-medium text-sm truncate">{deal.name}</h4>
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                <Building2 className="h-3 w-3" />
                {getClientName(deal.clientId)}
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="h-6 w-6">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleDuplicateDeal(deal.id); }}>
                  <Copy className="h-4 w-4 mr-2" /> Duplicate
                </DropdownMenuItem>
                {deal.driveFolderUrl && (
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); window.open(deal.driveFolderUrl, "_blank"); }}>
                    <ExternalLink className="h-4 w-4 mr-2" /> Open Drive
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                {deal.isArchived ? (
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleRestoreDeal(deal.id); }}>
                    <Archive className="h-4 w-4 mr-2" /> Restore
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleArchiveDeal(deal.id); }} className="text-destructive">
                    <Archive className="h-4 w-4 mr-2" /> Archive
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex items-center justify-between text-xs mb-2">
            <span className="font-semibold">{formatCurrencyValue(deal.expectedValue, deal.currency)}</span>
            <span className="text-muted-foreground">{deal.probability}%</span>
          </div>

          {deal.nextStep && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
              <ArrowRight className="h-3 w-3" />
              <span className="truncate">{deal.nextStep.action}</span>
            </div>
          )}

          <div className="flex items-center justify-between text-xs">
            {isStale ? (
              <span className="text-yellow-600 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {daysSinceActivity}d ago
              </span>
            ) : (
              <span className="text-muted-foreground">{daysSinceActivity}d ago</span>
            )}
            {deal.expectedCloseDate && (
              <span className="text-muted-foreground flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {toJsDate(deal.expectedCloseDate).toLocaleDateString("en-IN", { month: "short", day: "numeric" })}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  // Render pipeline stage column
  const renderStageColumn = (stage: DealStage) => {
    const stageDeals = dealsByStage[stage];
    const stageSummary = pipelineSummary?.stages.find((s) => s.stage === stage);

    // Don't show won/lost in kanban by default
    if ((stage === "won" || stage === "lost") && stageDeals.length === 0) {
      return null;
    }

    return (
      <div key={stage} className="flex-1 min-w-[280px] max-w-[320px]">
        <div className="bg-muted/50 rounded-lg p-3">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold text-sm">{DEAL_STAGE_LABELS[stage]}</h3>
              <p className="text-xs text-muted-foreground">
                {stageDeals.length} deals
                {stageSummary && ` | ${formatCurrencyValue(stageSummary.totalValue)}`}
              </p>
            </div>
            <Badge variant={getStageBadgeVariant(stage)} className="text-xs">
              {formatCurrencyValue(stageSummary?.weightedValue || 0)}
            </Badge>
          </div>

          <div className="space-y-2 max-h-[calc(100vh-350px)] overflow-y-auto">
            {stageDeals.map(renderDealCard)}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Sales Pipeline</h1>
          <p className="text-muted-foreground">
            {pipelineSummary && (
              <>
                {pipelineSummary.totalDeals} deals | Total: {formatCurrencyValue(pipelineSummary.totalValue)} | Weighted: {formatCurrencyValue(pipelineSummary.totalWeightedValue)}
              </>
            )}
          </p>
        </div>
        <Button onClick={() => setShowAddDeal(true)}>
          <Plus className="h-4 w-4 mr-2" /> New Deal
        </Button>
      </div>

      {/* Pipeline Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
        {DEAL_STAGE_ORDER.filter((s) => s !== "lost").map((stage) => {
          const summary = pipelineSummary?.stages.find((s) => s.stage === stage);
          return (
            <Card
              key={stage}
              className={`cursor-pointer hover:shadow-md transition-shadow ${stageFilter === stage ? "ring-2 ring-primary" : ""}`}
              onClick={() => setStageFilter(stageFilter === stage ? "all" : stage)}
            >
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">{DEAL_STAGE_LABELS[stage]}</p>
                <p className="text-lg font-bold">{formatCurrencyValue(summary?.totalValue || 0)}</p>
                <p className="text-xs text-muted-foreground">{summary?.count || 0} deals</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Filters & View Toggle */}
      <div className="flex flex-col md:flex-row gap-3 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search deals or clients..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        <Select value={clientFilter} onValueChange={setClientFilter}>
          <SelectTrigger className="w-[180px]">
            <Building2 className="h-4 w-4 mr-2" />
            <SelectValue placeholder="All Clients" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Clients</SelectItem>
            {clients.map((client) => (
              <SelectItem key={client.id} value={client.id}>
                {client.company}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2">
          <Button
            variant={viewMode === "kanban" ? "default" : "outline"}
            size="icon"
            onClick={() => setViewMode("kanban")}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "table" ? "default" : "outline"}
            size="icon"
            onClick={() => setViewMode("table")}
          >
            <List className="h-4 w-4" />
          </Button>
        </div>

        <Button
          variant={showArchived ? "secondary" : "outline"}
          onClick={() => setShowArchived(!showArchived)}
        >
          <Archive className="h-4 w-4 mr-2" />
          {showArchived ? "Hide Archived" : "Show Archived"}
        </Button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading deals...</p>
        </div>
      ) : viewMode === "kanban" ? (
        /* Kanban View */
        <div className="flex gap-4 overflow-x-auto pb-4">
          {DEAL_STAGE_ORDER.filter((s) => s !== "lost").map(renderStageColumn)}
        </div>
      ) : (
        /* Table View */
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Deal</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="text-right">Probability</TableHead>
                <TableHead className="text-right">Weighted</TableHead>
                <TableHead>Next Step</TableHead>
                <TableHead>Close Date</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredDeals.map((deal) => {
                const isStale = isDealStale(deal.lastActivityAt);
                return (
                  <TableRow
                    key={deal.id}
                    className={`cursor-pointer hover:bg-muted/50 ${isStale ? "bg-yellow-50" : ""}`}
                    onClick={() => navigate(`/deals/${deal.id}`)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {isStale && <AlertTriangle className="h-4 w-4 text-yellow-500" />}
                        <span className="font-medium">{deal.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>{getClientName(deal.clientId)}</TableCell>
                    <TableCell>
                      <Badge variant={getStageBadgeVariant(deal.stage)}>
                        {DEAL_STAGE_LABELS[deal.stage]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrencyValue(deal.expectedValue, deal.currency)}
                    </TableCell>
                    <TableCell className="text-right">{deal.probability}%</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatCurrencyValue(calculateWeightedValue(deal.expectedValue, deal.probability), deal.currency)}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      {deal.nextStep?.action || "-"}
                    </TableCell>
                    <TableCell>
                      {deal.expectedCloseDate
                        ? toJsDate(deal.expectedCloseDate).toLocaleDateString("en-IN")
                        : "-"}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleDuplicateDeal(deal.id); }}>
                            <Copy className="h-4 w-4 mr-2" /> Duplicate
                          </DropdownMenuItem>
                          {deal.isArchived ? (
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleRestoreDeal(deal.id); }}>
                              <Archive className="h-4 w-4 mr-2" /> Restore
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleArchiveDeal(deal.id); }} className="text-destructive">
                              <Archive className="h-4 w-4 mr-2" /> Archive
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
              {filteredDeals.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    No deals found. Create your first deal to get started.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Add Deal Dialog */}
      <AddDealDialog
        open={showAddDeal}
        onOpenChange={setShowAddDeal}
        clients={clients}
        onDealCreated={(dealId) => {
          setShowAddDeal(false);
          navigate(`/deals/${dealId}`);
        }}
      />
    </div>
  );
};

export default Pipeline;
