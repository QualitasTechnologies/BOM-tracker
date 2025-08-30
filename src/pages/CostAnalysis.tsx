import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, TrendingUp, TrendingDown, FileDown, Edit2, DollarSign, Clock, Package, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LineChart, Line, ResponsiveContainer, Legend } from "recharts";
import { Progress } from "@/components/ui/progress";
import Sidebar from "@/components/Sidebar";
import ProfitLossGauge from "@/components/ProfitLossGauge";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/firebase";
import { getBOMData, getTotalBOMCost, updateProject } from "@/utils/projectFirestore";
import { fetchEngineers, getTotalManHours } from "@/utils/timeTrackingFirestore";
import { useAuth } from "@/hooks/useAuth";

const CostAnalysis = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [costPerHour, setCostPerHour] = useState(0);
  const [estimatedBudget, setEstimatedBudget] = useState(600000);
  const [isEditingBudget, setIsEditingBudget] = useState(false);
  const [isEditingRate, setIsEditingRate] = useState(false);
  const [miscCost, setMiscCost] = useState(0);
  const [isEditingMisc, setIsEditingMisc] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [materialCost, setMaterialCost] = useState(0);
  const [totalManHours, setTotalManHours] = useState(0);

  const [searchParams] = useSearchParams();
  const projectIdParam = searchParams.get('project');
  const [projectDetails, setProjectDetails] = useState<{ projectName: string; projectId: string; clientName: string; deadline: string } | null>(null);

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
        });
        setCostPerHour(data.costPerHour || 0);
        setMiscCost(data.miscCost || 0);
        setEstimatedBudget(
          typeof data.estimatedBudget === 'number' && !isNaN(data.estimatedBudget)
            ? data.estimatedBudget
            : 0
        );
      }
      // Fetch BOM and calculate material cost
      const bomCategories = await getBOMData(projectIdParam);
      setMaterialCost(getTotalBOMCost(bomCategories));
      // Fetch engineers and calculate total man hours
      const engineers = await fetchEngineers(projectIdParam);
      setTotalManHours(getTotalManHours(engineers));
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

  const engineerCost = totalManHours * costPerHour;
  const totalCost = materialCost + engineerCost + miscCost;
  const profitLoss = estimatedBudget - totalCost;
  const isProfit = profitLoss > 0;
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

  // Chart data
  const costCompositionData = [
    { name: "Material Cost", value: materialCost, color: "#8B5CF6" },
    { name: "Engineering Cost", value: engineerCost, color: "#06B6D4" },
    { name: "Miscellaneous Cost", value: miscCost, color: "#F59E42" },
  ];

  // Dummy distribution of total working hours across 3 months
  const engineerHoursDist = [45, 55, 35];
  const months = ["Jan", "Feb", "Mar"];
  const monthlyCostData = months.map((month, i) => ({
    month,
    engineerHours: engineerHoursDist[i],
    engineerCost: engineerHoursDist[i] * costPerHour,
  }));

  const budgetVsActualData = [
    {
      label: "Budget vs Actual",
      estimated: estimatedBudget,
      actual: totalCost,
    },
  ];

  const profitabilityData = [
    { week: "Week 1", profit: 50000 },
    { week: "Week 2", profit: 35000 },
    { week: "Week 3", profit: 25000 },
    { week: "Week 4", profit: profitLoss },
  ];

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
              {/* Removed Back to Dashboard button */}
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold">Cost Analysis</h1>
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

          {/* Budget & Profitability */}
          <Card>
            <CardHeader>
              <CardTitle>Budget & Profitability</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="text-center p-4 bg-muted rounded-lg">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <span className="text-sm text-muted-foreground">Estimated Budget</span>
                    {!isEditingBudget && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setIsEditingBudget(true)}
                        className="h-6 w-6 p-0"
                      >
                        <Edit2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  {isEditingBudget ? (
                    <Input
                      type="number"
                      value={estimatedBudget === 0 ? '' : estimatedBudget}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        setEstimatedBudget(isNaN(val) ? 0 : val);
                      }}
                      onBlur={handleEstimatedBudgetBlur}
                      className="text-xl font-bold text-center"
                      autoFocus
                    />
                  ) : (
                    <p className="text-2xl font-bold">{formatCurrency(estimatedBudget)}</p>
                  )}
                </div>
                {/* Material vs Engineer Card */}
                <div className="text-center p-4 bg-muted rounded-lg flex flex-col items-center justify-center">
                  <span className="text-sm text-muted-foreground mb-1">Material vs Engineer</span>
                  <span className="text-2xl font-bold">
                    {(() => {
                      const mat = materialCost;
                      const eng = engineerCost;
                      const misc = miscCost;
                      const total = mat + eng + misc;
                      const matPct = total ? Math.round((mat / total) * 100) : 0;
                      const engPct = total ? Math.round((eng / total) * 100) : 0;
                      return <>{matPct}% <span className="text-base font-normal">/</span> {engPct}%</>;
                    })()}
                  </span>
                </div>
                {/* Profit Margin Card */}
                <div className="text-center p-4 bg-muted rounded-lg flex flex-col items-center justify-center">
                  <span className="text-sm text-muted-foreground mb-1">Profit Margin</span>
                  <span className={`text-2xl font-bold ${profitLoss < 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {(() => {
                      const margin = estimatedBudget ? ((profitLoss / estimatedBudget) * 100) : 0;
                      return `${margin >= 0 ? '' : '-'}${Math.abs(margin).toFixed(1)}%`;
                    })()}
                  </span>
                </div>
                <div className={`text-center p-4 rounded-lg ${isProfit ? 'bg-green-50' : 'bg-red-50'}`}>
                  <div className="flex items-center justify-center gap-2 mb-2">
                    {isProfit ? (
                      <TrendingUp className="h-4 w-4 text-green-600" />
                    ) : (
                      <TrendingDown className="h-4 w-4 text-red-600" />
                    )}
                    <span className="text-sm text-muted-foreground">
                      {isProfit ? 'Profit' : 'Loss'}
                    </span>
                  </div>
                  <p className={`text-2xl font-bold ${isProfit ? 'text-green-600' : 'text-red-600'}`}>
                    {formatCurrency(Math.abs(profitLoss))}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Visual Insights */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Cost Composition Pie Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Cost Composition</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={costCompositionData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      dataKey="value"
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    >
                      {costCompositionData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => formatCurrency(value as number)} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Monthly Cost Trend */}
            <Card>
              <CardHeader>
                <CardTitle>Monthly Cost Trend</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={monthlyCostData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis yAxisId="left" orientation="left" tickFormatter={(value) => `${value}h`} />
                    <YAxis yAxisId="right" orientation="right" tickFormatter={(value) => `₹${(value / 1000).toFixed(0)}K`} />
                    <Tooltip formatter={(value, name) => {
                      if (name === 'Engineer Cost') return formatCurrency(value as number);
                      if (name === 'Engineer Hours') return `${value} hrs`;
                      return value;
                    }} />
                    <Bar yAxisId="left" dataKey="engineerHours" fill="#8B5CF6" name="Engineer Hours" barSize={30} />
                    <Bar yAxisId="right" dataKey="engineerCost" fill="#06B6D4" name="Engineer Cost" barSize={30} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Budget vs Actual */}
            <Card>
              <CardHeader>
                <CardTitle>Budget vs Actual Cost</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={budgetVsActualData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fontWeight: 600 }} />
                    <YAxis tickFormatter={(value) => value.toLocaleString()} />
                    <Tooltip formatter={(value) => formatCurrency(value as number)} />
                    <Bar dataKey="estimated" fill="#22c55e" name="Estimated Budget" barSize={60} />
                    <Bar dataKey="actual" fill="#ef4444" name="Actual Cost" barSize={60} />
                    <Legend iconType="rect" wrapperStyle={{ top: 0 }} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Profitability Over Time */}
            <Card>
              <CardHeader>
                <CardTitle>Profit & Loss Meter</CardTitle>
              </CardHeader>
              <CardContent>
                {(() => {
                  const percent = (profitLoss / estimatedBudget) * 100;
                  const isProfitMeter = profitLoss >= 0;
                  return <ProfitLossGauge percent={percent} isProfit={isProfitMeter} />;
                })()}
              </CardContent>
            </Card>
          </div>

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
                      <tr key={index} className="border-b">
                        <td className="py-3 px-4 font-medium">{item.category}</td>
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

export default CostAnalysis;