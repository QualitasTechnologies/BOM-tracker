import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend
} from "recharts";
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Package, 
  Clock, 
  Users, 
  AlertTriangle,
  CheckCircle,
  Activity,
  BarChart3,
  Calendar,
  FileText
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { doc, getDoc, collection, getDocs, query, orderBy, limit } from "firebase/firestore";
import { db } from "@/firebase";
import { getBOMData, getTotalBOMCost } from "@/utils/projectFirestore";
import { fetchEngineers, getTotalManHours } from "@/utils/timeTrackingFirestore";

const KPI = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<any[]>([]);
  const [totalProjects, setTotalProjects] = useState(0);
  const [activeProjects, setActiveProjects] = useState(0);
  const [completedProjects, setCompletedProjects] = useState(0);
  const [overdueProjects, setOverdueProjects] = useState(0);
  const [totalCost, setTotalCost] = useState(0);
  const [totalBudget, setTotalBudget] = useState(0);
  const [totalManHours, setTotalManHours] = useState(0);
  const [totalParts, setTotalParts] = useState(0);
  const [vendorCount, setVendorCount] = useState(0);

  useEffect(() => {
    const fetchKPIData = async () => {
      if (!user) return;
      
      try {
        // Fetch projects
        const projectsRef = collection(db, 'projects');
        const projectsQuery = query(projectsRef, orderBy('createdAt', 'desc'));
        const projectsSnapshot = await getDocs(projectsQuery);
        
        const projectsData = [];
        let totalBOMCost = 0;
        let totalBOMParts = 0;
        
        for (const doc of projectsSnapshot.docs) {
          const projectData = { id: doc.id, ...doc.data() };
          projectsData.push(projectData);
          
          // Get BOM data for cost calculation
          try {
            const bomData = await getBOMData(doc.id);
            totalBOMCost += getTotalBOMCost(bomData);
            
            // Count parts
            bomData.forEach(category => {
              totalBOMParts += category.parts.length;
            });
          } catch (error) {
            console.log(`No BOM data for project ${doc.id}`);
          }
        }
        
        setProjects(projectsData);
        setTotalProjects(projectsData.length);
        setActiveProjects(projectsData.filter(p => p.status === 'active').length);
        setCompletedProjects(projectsData.filter(p => p.status === 'completed').length);
        
        // Calculate overdue projects (simplified logic)
        const today = new Date();
        const overdue = projectsData.filter(p => {
          if (p.status === 'completed') return false;
          if (!p.deadline) return false;
          return new Date(p.deadline) < today;
        }).length;
        setOverdueProjects(overdue);
        
        // Calculate total budget
        const totalBudgetAmount = projectsData.reduce((sum, p) => sum + (p.estimatedBudget || 0), 0);
        setTotalBudget(totalBudgetAmount);
        setTotalCost(totalBOMCost);
        setTotalParts(totalBOMParts);
        
        // Fetch vendor count
        const vendorsRef = collection(db, 'vendors');
        const vendorsSnapshot = await getDocs(vendorsRef);
        setVendorCount(vendorsSnapshot.size);
        
        // Fetch total man hours (across all projects)
        let totalHours = 0;
        for (const project of projectsData) {
          try {
            const engineers = await fetchEngineers(project.id);
            totalHours += getTotalManHours(engineers);
          } catch (error) {
            console.log(`No time tracking data for project ${project.id}`);
          }
        }
        setTotalManHours(totalHours);
        
      } catch (error) {
        console.error('Error fetching KPI data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchKPIData();
  }, [user]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(amount);
  };

  // Check admin access
  if (!user || !user.isAdmin) {
    return (
      <div className="container mx-auto py-6 px-4">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h2>
            <p className="text-gray-600">You need admin privileges to access the KPI dashboard.</p>
            <Button 
              onClick={() => navigate('/projects')} 
              className="mt-4"
              variant="outline"
            >
              Back to Projects
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="container mx-auto py-6 px-4">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <Activity className="h-12 w-12 text-blue-500 mx-auto mb-4 animate-pulse" />
            <p className="text-gray-600">Loading KPI data...</p>
          </div>
        </div>
      </div>
    );
  }

  // Chart data
  const projectStatusData = [
    { name: 'Active', value: activeProjects, color: '#10B981' },
    { name: 'Completed', value: completedProjects, color: '#3B82F6' },
    { name: 'Overdue', value: overdueProjects, color: '#EF4444' },
  ];

  const costTrendData = [
    { month: 'Jan', budget: 2500000, actual: 2100000 },
    { month: 'Feb', budget: 2800000, actual: 2400000 },
    { month: 'Mar', budget: 3200000, actual: 2900000 },
    { month: 'Apr', budget: 3000000, actual: 2700000 },
    { month: 'May', budget: 3500000, actual: totalCost },
  ];

  const productivityData = [
    { project: 'ITC Vision', hours: 120, parts: 45 },
    { project: 'Inventory Portal', hours: 80, parts: 32 },
    { project: 'DevOps Pipeline', hours: 95, parts: 28 },
    { project: 'ERP Integration', hours: 150, parts: 67 },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">KPI Dashboard</h1>
              <p className="text-muted-foreground mt-1">
                Real-time project metrics and business intelligence
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => navigate('/projects')}>
                <FileText className="h-4 w-4 mr-2" />
                View Projects
              </Button>
              <Button variant="outline" onClick={() => navigate('/cost-analysis')}>
                <DollarSign className="h-4 w-4 mr-2" />
                Cost Analysis
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 py-8 space-y-8">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Total Projects
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{totalProjects}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {activeProjects} active, {completedProjects} completed
              </p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Total Budget
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{formatCurrency(totalBudget)}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {formatCurrency(totalCost)} spent
              </p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Total Hours
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{totalManHours.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Engineering hours logged
              </p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Package className="h-4 w-4" />
                Total Parts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{totalParts}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Across all BOMs
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Project Status Overview */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Project Status Distribution
              </CardTitle>
              <CardDescription>
                Current status of all projects
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={projectStatusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {projectStatusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Cost Trend Analysis
              </CardTitle>
              <CardDescription>
                Budget vs actual costs over time
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={costTrendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis tickFormatter={(value) => `₹${(value / 1000000).toFixed(1)}M`} />
                  <Tooltip 
                    formatter={(value) => formatCurrency(value as number)}
                    labelStyle={{ color: '#374151' }}
                  />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="budget" 
                    stroke="#3B82F6" 
                    strokeWidth={2}
                    name="Budget"
                  />
                  <Line 
                    type="monotone" 
                    dataKey="actual" 
                    stroke="#10B981" 
                    strokeWidth={2}
                    name="Actual"
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Productivity & Performance */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Project Productivity
              </CardTitle>
              <CardDescription>
                Hours vs parts delivered by project
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={productivityData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="project" />
                  <YAxis yAxisId="left" orientation="left" />
                  <YAxis yAxisId="right" orientation="right" />
                  <Tooltip />
                  <Legend />
                  <Bar yAxisId="left" dataKey="hours" fill="#8B5CF6" name="Hours" />
                  <Bar yAxisId="right" dataKey="parts" fill="#06B6D4" name="Parts" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Project Health Summary
              </CardTitle>
              <CardDescription>
                Key performance indicators
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="text-sm">Projects On Time</span>
                </div>
                <Badge variant="outline" className="bg-green-50 text-green-700">
                  {totalProjects > 0 ? Math.round(((totalProjects - overdueProjects) / totalProjects) * 100) : 0}%
                </Badge>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-blue-500" />
                  <span className="text-sm">Budget Utilization</span>
                </div>
                <Badge variant="outline" className="bg-blue-50 text-blue-700">
                  {totalBudget > 0 ? Math.round((totalCost / totalBudget) * 100) : 0}%
                </Badge>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-purple-500" />
                  <span className="text-sm">Parts per Project</span>
                </div>
                <Badge variant="outline" className="bg-purple-50 text-purple-700">
                  {totalProjects > 0 ? Math.round(totalParts / totalProjects) : 0}
                </Badge>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-orange-500" />
                  <span className="text-sm">Avg Hours per Project</span>
                </div>
                <Badge variant="outline" className="bg-orange-50 text-orange-700">
                  {totalProjects > 0 ? Math.round(totalManHours / totalProjects) : 0}h
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>
              Navigate to key areas of the system
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Button 
                variant="outline" 
                className="h-20 flex flex-col items-center justify-center gap-2"
                onClick={() => navigate('/projects')}
              >
                <FileText className="h-6 w-6" />
                <span>View Projects</span>
              </Button>
              
              <Button 
                variant="outline" 
                className="h-20 flex flex-col items-center justify-center gap-2"
                onClick={() => navigate('/cost-analysis')}
              >
                <DollarSign className="h-6 w-6" />
                <span>Cost Analysis</span>
              </Button>
              
              <Button 
                variant="outline" 
                className="h-20 flex flex-col items-center justify-center gap-2"
                onClick={() => navigate('/settings')}
              >
                <Users className="h-6 w-6" />
                <span>Manage Vendors</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default KPI;