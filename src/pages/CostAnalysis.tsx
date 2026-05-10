import { useState, useEffect, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, TrendingUp, TrendingDown, FileDown, Edit2, DollarSign, Package, X, ExternalLink, Upload, FileText, Trash2 } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Progress } from "@/components/ui/progress";
import Sidebar from "@/components/Sidebar";
import { doc, getDoc } from "firebase/firestore";
import { db, auth } from "@/firebase";
import { getBOMData, getTotalBOMCost, updateProject } from "@/utils/projectFirestore";
import { fetchEngineers, getTotalManHours } from "@/utils/timeTrackingFirestore";
import { WeekNavigator, weekRangeFromDate, type WeekRange } from "@/components/CostAnalysis/WeekNavigator";
import { getProjectCosts, type ProjectCostRow } from "@/utils/pulseProxyFirestore";
import { uploadProjectDocument, getProjectDocuments, deleteProjectDocument } from "@/utils/projectDocumentFirestore";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/use-toast";
import type { ProjectDocument } from "@/types/projectDocument";

// Summary View Component
const CostAnalysisSummary = ({
  sidebarCollapsed,
  setSidebarCollapsed
}: {
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
}) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [range, setRange] = useState<WeekRange>(() => weekRangeFromDate(new Date()));
  const [rows, setRows] = useState<ProjectCostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getProjectCosts(range.start, range.end)
      .then((res) => {
        setRows(res.projects);
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err.message || err));
        setLoading(false);
      });
  }, [range.start, range.end]);

  const grouped = useMemo(() => {
    const order = ['Ongoing', 'Delayed', 'Planning', 'Completed'];
    const m = new Map<string, ProjectCostRow[]>();
    for (const r of rows) {
      const arr = m.get(r.status) || [];
      arr.push(r);
      m.set(r.status, arr);
    }
    return order.filter((s) => m.has(s)).map((s) => ({ status: s, rows: m.get(s)! }));
  }, [rows]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Check admin access
  if (!user || !user.isAdmin) {
    return (
      <div className="container mx-auto py-6 px-4">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <X className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h2>
            <p className="text-gray-600">You need admin privileges to access cost analysis.</p>
            <Button
              onClick={() => navigate('/projects')}
              className="mt-4"
              variant="outline"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Projects
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div className={`flex-1 transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'ml-16' : 'ml-64'}`}>
        <div className="border-b bg-card">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold">Cost Analysis</h1>
                <p className="text-sm text-muted-foreground mt-1">Financial overview of all projects</p>
              </div>
              <WeekNavigator range={range} onChange={setRange} />
            </div>
          </div>
        </div>

        <div className="container mx-auto px-4 py-6 space-y-4">
          {loading && (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
                <p className="text-muted-foreground">Loading project costs...</p>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <X className="h-12 w-12 text-red-500 mx-auto mb-4" />
                <p className="text-red-600 font-medium">Error loading costs</p>
                <p className="text-sm text-muted-foreground mt-1">{error}</p>
              </div>
            </div>
          )}

          {!loading && !error && grouped.map((g) => (
            <Card key={g.status}>
              <CardHeader className="py-3">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-lg">{g.status}</CardTitle>
                  <Badge variant="secondary">{g.rows.length} projects</Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-3 font-medium">Project</th>
                        <th className="text-center py-2 px-3 font-medium">Link</th>
                        <th className="text-right py-2 px-3 font-medium" colSpan={3}>This Week</th>
                        <th className="text-right py-2 px-3 font-medium" colSpan={4}>Cumulative</th>
                        <th className="text-right py-2 px-3 font-medium">vs PO</th>
                      </tr>
                      <tr className="border-b text-xs text-muted-foreground">
                        <th className="text-left py-1 px-3"></th>
                        <th className="py-1 px-3"></th>
                        <th className="text-right py-1 px-3">Material</th>
                        <th className="text-right py-1 px-3">Time (hrs · ₹)</th>
                        <th className="text-right py-1 px-3">Total</th>
                        <th className="text-right py-1 px-3">Material</th>
                        <th className="text-right py-1 px-3">Time</th>
                        <th className="text-right py-1 px-3">Misc</th>
                        <th className="text-right py-1 px-3">Total</th>
                        <th className="text-right py-1 px-3">GP%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((r) => (
                        <tr
                          key={r.projectId}
                          className="border-b hover:bg-muted/30 cursor-pointer"
                          onClick={() => navigate(`/cost-analysis?project=${r.projectId}`)}
                        >
                          <td className="py-3 px-3 font-medium">{r.projectName}</td>
                          <td className="py-3 px-3 text-center">
                            {r.pulseProjectId ? (
                              <span title="Linked to Pulse">🔗</span>
                            ) : (
                              <span title="Not linked — using fallback hours" className="text-amber-600">⚠️</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right">{formatCurrency(r.thisWeek.materialCost)}</td>
                          <td className="py-3 px-3 text-right">{r.thisWeek.timeHours.toFixed(1)}h · {formatCurrency(r.thisWeek.timeCost)}</td>
                          <td className="py-3 px-3 text-right font-semibold">{formatCurrency(r.thisWeek.total)}</td>
                          <td className="py-3 px-3 text-right">{formatCurrency(r.cumulative.materialCost)}</td>
                          <td className="py-3 px-3 text-right">{formatCurrency(r.cumulative.timeCost)}</td>
                          <td className="py-3 px-3 text-right">{formatCurrency(r.cumulative.miscCost)}</td>
                          <td className="py-3 px-3 text-right font-semibold">{formatCurrency(r.cumulative.total)}</td>
                          <td className="py-3 px-3 text-right">
                            {r.cumulative.profitMargin === null ? '—' : `${r.cumulative.profitMargin.toFixed(0)}%`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
};

// Detailed View Component (existing functionality)
const CostAnalysisDetail = ({
  projectIdParam,
  sidebarCollapsed,
  setSidebarCollapsed
}: {
  projectIdParam: string;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
}) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [costPerHour, setCostPerHour] = useState(0);
  const [estimatedBudget, setEstimatedBudget] = useState(600000);
  const [isEditingBudget, setIsEditingBudget] = useState(false);
  const [isEditingRate, setIsEditingRate] = useState(false);
  const [miscCost, setMiscCost] = useState(0);
  const [isEditingMisc, setIsEditingMisc] = useState(false);
  const [poValue, setPoValue] = useState(0);
  const [isEditingPO, setIsEditingPO] = useState(false);

  const [materialCost, setMaterialCost] = useState(0);
  const [totalManHours, setTotalManHours] = useState(0);
  const [currentBOM, setCurrentBOM] = useState<any[]>([]);

  const [projectDetails, setProjectDetails] = useState<{ projectName: string; projectId: string; clientName: string; deadline: string; status: string; bomSnapshot?: any[]; bomSnapshotDate?: string } | null>(null);

  // Customer PO document state
  const [customerPODocs, setCustomerPODocs] = useState<ProjectDocument[]>([]);
  const [uploadingPO, setUploadingPO] = useState(false);
  const { toast } = useToast();

  // Load Customer PO documents
  const loadCustomerPODocs = async () => {
    try {
      const docs = await getProjectDocuments(projectIdParam);
      setCustomerPODocs(docs.filter(doc => doc.type === 'customer-po'));
    } catch (error) {
      console.error('Error loading Customer PO documents:', error);
    }
  };

  // Handle Customer PO upload
  const handleCustomerPOUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0]) return;

    const file = e.target.files[0];
    setUploadingPO(true);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('User not authenticated');

      await uploadProjectDocument(file, projectIdParam, 'customer-po', user.uid);
      await loadCustomerPODocs();

      toast({
        title: 'Success',
        description: 'Customer PO uploaded successfully'
      });
    } catch (error) {
      console.error('Error uploading Customer PO:', error);
      toast({
        title: 'Upload Failed',
        description: error instanceof Error ? error.message : 'Failed to upload document',
        variant: 'destructive'
      });
    } finally {
      setUploadingPO(false);
      e.target.value = '';
    }
  };

  // Handle Customer PO delete
  const handleDeleteCustomerPO = async (doc: ProjectDocument) => {
    if (!window.confirm(`Delete "${doc.name}"?`)) return;

    try {
      await deleteProjectDocument(doc.id, doc.url);
      await loadCustomerPODocs();

      toast({
        title: 'Success',
        description: 'Customer PO deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting Customer PO:', error);
      toast({
        title: 'Delete Failed',
        description: 'Failed to delete document',
        variant: 'destructive'
      });
    }
  };

  useEffect(() => {
    const fetchAllData = async () => {
      if (!projectIdParam) return;
      // Fetch project details and editable fields
      const projectRef = doc(db, 'projects', projectIdParam);
      const projectSnap = await getDoc(projectRef);
      if (projectSnap.exists()) {
        const data = projectSnap.data();
        setProjectDetails({
          projectName: data.projectName || '',
          projectId: data.projectId || '',
          clientName: data.clientName || '',
          deadline: data.deadline || '',
          status: data.status || '',
          bomSnapshot: data.bomSnapshot || null,
          bomSnapshotDate: data.bomSnapshotDate || null,
        });
        setCostPerHour(data.costPerHour || 0);
        setMiscCost(data.miscCost || 0);
        setPoValue(data.poValue || 0);
        setEstimatedBudget(
          typeof data.estimatedBudget === 'number' && !isNaN(data.estimatedBudget)
            ? data.estimatedBudget
            : 0
        );
      }
      // Fetch BOM and calculate material cost
      const bomCategories = await getBOMData(projectIdParam);
      const bomItems = bomCategories.flatMap(cat => cat.items);
      setCurrentBOM(bomItems);
      setMaterialCost(getTotalBOMCost(bomCategories));
      // Fetch engineers and calculate total man hours
      const engineers = await fetchEngineers(projectIdParam);
      setTotalManHours(getTotalManHours(engineers));

      // Fetch Customer PO documents
      const docs = await getProjectDocuments(projectIdParam);
      setCustomerPODocs(docs.filter(d => d.type === 'customer-po'));
    };
    fetchAllData();
  }, [projectIdParam]);

  // Update cost per hour in Firestore
  const handleCostPerHourBlur = async () => {
    if (!projectIdParam) return;
    await updateProject(projectIdParam, { costPerHour });
    setIsEditingRate(false);
  };

  // Update misc cost in Firestore
  const handleMiscCostBlur = async () => {
    if (!projectIdParam) return;
    await updateProject(projectIdParam, { miscCost });
    setIsEditingMisc(false);
  };

  // Update estimated budget in Firestore
  const handleEstimatedBudgetBlur = async () => {
    if (!projectIdParam) return;
    await updateProject(projectIdParam, { estimatedBudget });
    setIsEditingBudget(false);
  };

  // Update PO value in Firestore
  const handlePOValueBlur = async () => {
    if (!projectIdParam) return;
    await updateProject(projectIdParam, { poValue });
    setIsEditingPO(false);
  };

  const engineerCost = totalManHours * costPerHour;
  const totalCost = materialCost + engineerCost + miscCost;
  const grossProfit = poValue - totalCost;
  const isProfit = grossProfit > 0;
  const profitMargin = poValue ? ((grossProfit / poValue) * 100) : 0;
  const budgetUsage = (totalCost / estimatedBudget) * 100;

  const getStatusBadge = () => {
    if (budgetUsage <= 80) return { label: "On Track", variant: "default" as const };
    if (budgetUsage <= 100) return { label: "Near Budget", variant: "secondary" as const };
    return { label: "Over Budget", variant: "destructive" as const };
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Editable descriptions for cost items
  const [costDescriptions, setCostDescriptions] = useState([
    "Material and component costs",
    `${totalManHours} hrs @ ₹${costPerHour}/hr`,
    "Transport, overhead",
  ]);
  const [editingDescIdx, setEditingDescIdx] = useState<number | null>(null);
  const descInputRef = useRef<HTMLInputElement>(null);

  // Update engineer description if hours or rate changes
  useEffect(() => {
    setCostDescriptions((prev) => [
      prev[0],
      `${totalManHours} hrs @ ₹${costPerHour}/hr`,
      prev[2],
    ]);
  }, [totalManHours, costPerHour]);

  const handleDescChange = (idx: number, value: string) => {
    setCostDescriptions((prev) => prev.map((desc, i) => (i === idx ? value : desc)));
  };

  const handleDescBlur = () => setEditingDescIdx(null);

  const statusBadge = getStatusBadge();

  const costItemsData = [
    { category: "BOM", description: costDescriptions[0], cost: materialCost, notes: "From BOM tab" },
    { category: "Engineer", description: costDescriptions[1], cost: engineerCost, notes: "Auto-calculated" },
    { category: "Miscellaneous", description: costDescriptions[2], cost: miscCost, notes: "Manually added" },
  ];

  // Check admin access
  if (!user || !user.isAdmin) {
    return (
      <div className="container mx-auto py-6 px-4">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <X className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h2>
            <p className="text-gray-600">You need admin privileges to access cost analysis.</p>
            <Button
              onClick={() => navigate('/projects')}
              className="mt-4"
              variant="outline"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Projects
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div className={`flex-1 transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'ml-16' : 'ml-64'}`}>
        <div className="border-b bg-card">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={() => navigate('/cost-analysis')}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                All Projects
              </Button>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold">Cost Analysis</h1>
                {projectDetails && (
                  <Badge variant="outline">{projectDetails.projectName}</Badge>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="container mx-auto px-4 py-6 space-y-6">
          {/* Project Snapshot */}
          <Card>
            <CardHeader>
              <CardTitle>Project Snapshot</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Project Name</p>
                  <p className="font-semibold">{projectDetails ? projectDetails.projectName : ''}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Project ID</p>
                  <p className="font-semibold">{projectDetails ? projectDetails.projectId : ''}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Client</p>
                  <p className="font-semibold">{projectDetails ? projectDetails.clientName : ''}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Deadline</p>
                  <p className="font-semibold text-sm">{projectDetails ? projectDetails.deadline : ''}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Cost Breakdown Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Cost Breakdown Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm font-medium">Material Cost</span>
                    <span className="font-semibold">{formatCurrency(materialCost)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm font-medium">Total Man Hours</span>
                    <span className="font-semibold">{totalManHours} hrs</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm font-medium">Cost per Hour</span>
                    <div className="flex items-center gap-2">
                      {isEditingRate ? (
                        <Input
                          type="number"
                          value={costPerHour}
                          onChange={(e) => setCostPerHour(parseInt(e.target.value) || 0)}
                          onBlur={handleCostPerHourBlur}
                          className="w-24 h-8"
                          autoFocus
                        />
                      ) : (
                        <>
                          <span className="font-semibold">₹{costPerHour}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setIsEditingRate(true)}
                            className="h-6 w-6 p-0"
                          >
                            <Edit2 className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm font-medium">Miscellaneous Cost</span>
                    <div className="flex items-center gap-2">
                      {isEditingMisc ? (
                        <Input
                          type="number"
                          value={miscCost}
                          onChange={(e) => setMiscCost(parseInt(e.target.value) || 0)}
                          onBlur={handleMiscCostBlur}
                          className="w-24 h-8"
                          autoFocus
                        />
                      ) : (
                        <>
                          <span className="font-semibold">{formatCurrency(miscCost)}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setIsEditingMisc(true)}
                            className="h-6 w-6 p-0"
                          >
                            <Edit2 className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm font-medium">Engineering Cost</span>
                    <span className="font-semibold">{formatCurrency(engineerCost)}</span>
                  </div>
                </div>
                <div className="bg-muted p-6 rounded-lg text-center">
                  <p className="text-sm text-muted-foreground mb-2">Total Project Cost</p>
                  <p className="text-3xl font-bold text-primary">{formatCurrency(totalCost)}</p>
                  <p className="text-xs text-muted-foreground mt-2">BOM + Engineer + Misc</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* PO Value & Profitability Summary */}
          <Card>
            <CardHeader>
              <CardTitle>PO Value & Profitability</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* PO Value Card */}
                <div className="text-center p-4 bg-blue-50 rounded-lg border-2 border-blue-200">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <DollarSign className="h-4 w-4 text-blue-600" />
                    <span className="text-sm font-medium text-blue-900">Customer PO Value</span>
                    {!isEditingPO && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setIsEditingPO(true)}
                        className="h-6 w-6 p-0"
                      >
                        <Edit2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  {isEditingPO ? (
                    <Input
                      type="number"
                      value={poValue === 0 ? '' : poValue}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        setPoValue(isNaN(val) ? 0 : val);
                      }}
                      onBlur={handlePOValueBlur}
                      className="text-xl font-bold text-center"
                      autoFocus
                    />
                  ) : (
                    <p className="text-3xl font-bold text-blue-900">{formatCurrency(poValue)}</p>
                  )}
                </div>

                {/* Total Cost Card */}
                <div className="text-center p-4 bg-gray-50 rounded-lg border-2 border-gray-200">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <Package className="h-4 w-4 text-gray-600" />
                    <span className="text-sm font-medium text-gray-700">Total Project Cost</span>
                  </div>
                  <p className="text-3xl font-bold text-gray-900">{formatCurrency(totalCost)}</p>
                  <p className="text-xs text-gray-500 mt-1">BOM + Engineer + Misc</p>
                </div>

                {/* Gross Profit Card */}
                <div className={`text-center p-4 rounded-lg border-2 ${isProfit ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  <div className="flex items-center justify-center gap-2 mb-2">
                    {isProfit ? (
                      <TrendingUp className="h-4 w-4 text-green-600" />
                    ) : (
                      <TrendingDown className="h-4 w-4 text-red-600" />
                    )}
                    <span className={`text-sm font-medium ${isProfit ? 'text-green-900' : 'text-red-900'}`}>
                      Gross {isProfit ? 'Profit' : 'Loss'}
                    </span>
                  </div>
                  <p className={`text-3xl font-bold ${isProfit ? 'text-green-900' : 'text-red-900'}`}>
                    {formatCurrency(Math.abs(grossProfit))}
                  </p>
                  <p className={`text-sm font-medium mt-1 ${isProfit ? 'text-green-700' : 'text-red-700'}`}>
                    {profitMargin.toFixed(1)}% margin
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Customer PO Document */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-blue-500" />
                  <CardTitle>Customer PO</CardTitle>
                  <Badge variant="outline">{customerPODocs.length} file{customerPODocs.length !== 1 ? 's' : ''}</Badge>
                </div>
                <label className="cursor-pointer">
                  <input
                    type="file"
                    className="hidden"
                    onChange={handleCustomerPOUpload}
                    disabled={uploadingPO}
                    accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                  />
                  <Button variant="outline" size="sm" disabled={uploadingPO} asChild>
                    <span>
                      <Upload className="mr-2 h-4 w-4" />
                      {uploadingPO ? 'Uploading...' : 'Upload PO'}
                    </span>
                  </Button>
                </label>
              </div>
              <p className="text-sm text-muted-foreground mt-1">Purchase orders received from customer (required before changing status to Ongoing)</p>
            </CardHeader>
            <CardContent>
              {customerPODocs.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm italic bg-gray-50 rounded border border-dashed">
                  No Customer PO uploaded yet
                </div>
              ) : (
                <div className="space-y-2">
                  {customerPODocs.map(doc => (
                    <div
                      key={doc.id}
                      className="flex items-center gap-3 p-3 bg-gray-50 rounded border border-gray-200 hover:bg-gray-100 transition-colors"
                    >
                      <FileText className="text-blue-600 flex-shrink-0" size={20} />
                      <div className="flex-1 min-w-0">
                        <a
                          href={doc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-blue-700 hover:underline truncate block"
                          title={doc.name}
                        >
                          {doc.name}
                        </a>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {new Date(doc.uploadedAt).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' })}
                          {doc.fileSize && ` • ${(doc.fileSize / (1024 * 1024)).toFixed(2)} MB`}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteCustomerPO(doc)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        title="Delete document"
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Cost Items Table */}
          <Card>
            <CardHeader>
              <CardTitle>Detailed Cost Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4">Category</th>
                      <th className="text-left py-3 px-4">Description</th>
                      <th className="text-right py-3 px-4">Cost</th>
                      <th className="text-left py-3 px-4">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {costItemsData.map((item, index) => (
                      <tr
                        key={index}
                        className={`border-b ${index === 0 ? 'cursor-pointer hover:bg-muted/50 transition-colors' : ''}`}
                        onClick={index === 0 ? () => navigate(`/project/${projectIdParam}/bom`) : undefined}
                      >
                        <td className="py-3 px-4 font-medium">
                          {index === 0 ? (
                            <span className="flex items-center gap-2 text-primary">
                              {item.category}
                              <ExternalLink className="h-3 w-3" />
                            </span>
                          ) : (
                            item.category
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {index === 2 ? (
                            editingDescIdx === index ? (
                              <Input
                                ref={descInputRef}
                                value={costDescriptions[index]}
                                onChange={e => handleDescChange(index, e.target.value)}
                                onBlur={handleDescBlur}
                                onKeyDown={e => { if (e.key === 'Enter') handleDescBlur(); }}
                                className="w-full h-8"
                                autoFocus
                              />
                            ) : (
                              <span className="flex items-center">
                                {item.description}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setEditingDescIdx(index)}
                                  className="h-6 w-6 p-0 ml-2"
                                >
                                  <Edit2 className="h-3 w-3" />
                                </Button>
                              </span>
                            )
                          ) : (
                            item.description
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-semibold">{formatCurrency(item.cost)}</td>
                        <td className="py-3 px-4 text-sm text-muted-foreground">{item.notes}</td>
                      </tr>
                    ))}
                    <tr className="border-b-2 border-primary bg-muted/50">
                      <td className="py-3 px-4 font-bold">Total</td>
                      <td className="py-3 px-4"></td>
                      <td className="py-3 px-4 text-right font-bold text-lg">{formatCurrency(totalCost)}</td>
                      <td className="py-3 px-4"></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* BOM Changes Since Ongoing Status */}
          {projectDetails?.bomSnapshot && projectDetails.bomSnapshot.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>BOM Changes Since Order Won</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Snapshot taken on: {projectDetails.bomSnapshotDate ? new Date(projectDetails.bomSnapshotDate).toLocaleDateString() : 'N/A'}
                </p>
              </CardHeader>
              <CardContent>
                {(() => {
                  const snapshot = projectDetails.bomSnapshot || [];
                  const current = currentBOM;

                  // Calculate added items
                  const addedItems = current.filter(item =>
                    !snapshot.some(snap => snap.id === item.id)
                  );

                  // Calculate removed items
                  const removedItems = snapshot.filter(snap =>
                    !current.some(item => item.id === snap.id)
                  );

                  // Calculate changed items (price or quantity changes)
                  const changedItems = current
                    .filter(item => {
                      const snapItem = snapshot.find(snap => snap.id === item.id);
                      if (!snapItem) return false;
                      return (snapItem.price !== item.price) || (snapItem.quantity !== item.quantity);
                    })
                    .map(item => {
                      const snapItem = snapshot.find(snap => snap.id === item.id)!;
                      return {
                        ...item,
                        oldPrice: snapItem.price,
                        oldQuantity: snapItem.quantity,
                        priceDiff: (item.price || 0) - (snapItem.price || 0),
                        quantityDiff: item.quantity - snapItem.quantity
                      };
                    });

                  // Calculate cost difference
                  const snapshotCost = snapshot.reduce((sum, item) => sum + (item.price || 0) * item.quantity, 0);
                  const currentCost = materialCost;
                  const costDiff = currentCost - snapshotCost;

                  if (addedItems.length === 0 && removedItems.length === 0 && changedItems.length === 0) {
                    return (
                      <div className="text-center py-6 text-muted-foreground">
                        <p>No changes to BOM since order was won</p>
                        <p className="text-sm mt-1">BOM Cost: {formatCurrency(currentCost)}</p>
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-4">
                      {/* Cost Summary */}
                      <div className={`p-4 rounded-lg border-2 ${costDiff > 0 ? 'bg-red-50 border-red-200' : costDiff < 0 ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                        <div className="text-sm font-medium mb-1">Cost Change</div>
                        <div className="flex items-center justify-between">
                          <span>Original BOM Cost: {formatCurrency(snapshotCost)}</span>
                          <span>Current BOM Cost: {formatCurrency(currentCost)}</span>
                          <span className={`font-bold ${costDiff > 0 ? 'text-red-600' : costDiff < 0 ? 'text-green-600' : ''}`}>
                            {costDiff > 0 ? '+' : ''}{formatCurrency(costDiff)}
                          </span>
                        </div>
                      </div>

                      {/* Added Items */}
                      {addedItems.length > 0 && (
                        <div>
                          <h4 className="font-medium text-green-700 mb-2">Added Items ({addedItems.length})</h4>
                          <div className="space-y-1">
                            {addedItems.map(item => (
                              <div key={item.id} className="text-sm bg-green-50 p-2 rounded flex justify-between">
                                <span>{item.name}</span>
                                <span>{formatCurrency((item.price || 0) * item.quantity)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Removed Items */}
                      {removedItems.length > 0 && (
                        <div>
                          <h4 className="font-medium text-red-700 mb-2">Removed Items ({removedItems.length})</h4>
                          <div className="space-y-1">
                            {removedItems.map(item => (
                              <div key={item.id} className="text-sm bg-red-50 p-2 rounded flex justify-between line-through">
                                <span>{item.name}</span>
                                <span>-{formatCurrency((item.price || 0) * item.quantity)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Changed Items */}
                      {changedItems.length > 0 && (
                        <div>
                          <h4 className="font-medium text-blue-700 mb-2">Modified Items ({changedItems.length})</h4>
                          <div className="space-y-2">
                            {changedItems.map(item => (
                              <div key={item.id} className="text-sm bg-blue-50 p-2 rounded">
                                <div className="font-medium">{item.name}</div>
                                <div className="text-xs text-gray-600 flex justify-between">
                                  <span>
                                    Qty: {item.oldQuantity} → {item.quantity} {item.quantityDiff !== 0 && `(${item.quantityDiff > 0 ? '+' : ''}${item.quantityDiff})`}
                                  </span>
                                  <span>
                                    Price: {formatCurrency(item.oldPrice)} → {formatCurrency(item.price || 0)} {item.priceDiff !== 0 && `(${item.priceDiff > 0 ? '+' : ''}${formatCurrency(item.priceDiff)})`}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          )}

          {/* Export Options */}
          <Card>
            <CardHeader>
              <CardTitle>Export & Reports</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4">
                <Button className="flex-1">
                  <FileDown className="h-4 w-4 mr-2" />
                  Export Summary (PDF)
                </Button>
                <Button variant="outline" className="flex-1">
                  <FileDown className="h-4 w-4 mr-2" />
                  Export Detailed Report (CSV)
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

// Main Component - decides which view to show
const CostAnalysis = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchParams] = useSearchParams();
  const projectIdParam = searchParams.get('project');

  if (projectIdParam) {
    return (
      <CostAnalysisDetail
        projectIdParam={projectIdParam}
        sidebarCollapsed={sidebarCollapsed}
        setSidebarCollapsed={setSidebarCollapsed}
      />
    );
  }

  return (
    <CostAnalysisSummary
      sidebarCollapsed={sidebarCollapsed}
      setSidebarCollapsed={setSidebarCollapsed}
    />
  );
};

export default CostAnalysis;
