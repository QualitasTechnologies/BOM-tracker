import { useState } from "react";
import { mockProjects } from "@/data/mockProjects";
import { Project } from "@/types/project";
import { StatusBadge } from "@/components/StatusBadge";
import { ProgressBar } from "@/components/ProgressBar";
import { ProjectDetailModal } from "@/components/ProjectDetailModal";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, TrendingUp, TrendingDown, Search, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const Index = () => {
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Calculate summary stats
  const stats = {
    total: mockProjects.length,
    critical: mockProjects.filter(p => p.healthStatus === "critical").length,
    warning: mockProjects.filter(p => p.healthStatus === "warning").length,
    onTrack: mockProjects.filter(p => p.healthStatus === "on-track").length,
  };

  // Filter projects
  const filteredProjects = mockProjects.filter(project => {
    const matchesSearch = project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         project.owner.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === "all" || project.category === categoryFilter;
    const matchesStatus = statusFilter === "all" || project.healthStatus === statusFilter;
    
    return matchesSearch && matchesCategory && matchesStatus;
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(amount);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">CEO Engineering Dashboard</h1>
              <p className="text-muted-foreground mt-1">
                Real-time project health monitoring and exception tracking
              </p>
            </div>
            <Button variant="outline" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 py-8 space-y-8">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Active Projects
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats.total}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Across all categories
              </p>
            </CardContent>
          </Card>

          <Card 
            className="hover:shadow-md transition-shadow cursor-pointer border-status-error/20 bg-status-error-bg/50"
            onClick={() => setStatusFilter("critical")}
          >
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-status-error flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                Critical Issues
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-status-error">{stats.critical}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Require immediate attention
              </p>
            </CardContent>
          </Card>

          <Card 
            className="hover:shadow-md transition-shadow cursor-pointer border-status-warning/20 bg-status-warning-bg/50"
            onClick={() => setStatusFilter("warning")}
          >
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-status-warning flex items-center gap-2">
                ⚠️ Warnings
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-status-warning">{stats.warning}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Falling behind schedule
              </p>
            </CardContent>
          </Card>

          <Card 
            className="hover:shadow-md transition-shadow cursor-pointer border-status-success/20 bg-status-success-bg/50"
            onClick={() => setStatusFilter("on-track")}
          >
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-status-success">
                ✓ On Track
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-status-success">{stats.onTrack}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Meeting targets
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Filters & Search */}
        <Card>
          <CardHeader>
            <CardTitle>Project Health Table</CardTitle>
            <CardDescription>
              Exception-based view of all engineering projects
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by project name or owner..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  <SelectItem value="Customer">Customer</SelectItem>
                  <SelectItem value="Internal">Internal</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="on-track">On Track</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Project Table */}
            <div className="space-y-4">
              {filteredProjects.map((project) => (
                <div
                  key={project.id}
                  onClick={() => setSelectedProject(project)}
                  className="border rounded-lg p-4 hover:shadow-md transition-all cursor-pointer bg-card"
                >
                  <div className="flex flex-col lg:flex-row gap-4">
                    {/* Project Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-3 mb-2">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-lg truncate">{project.name}</h3>
                          <p className="text-sm text-muted-foreground">
                            {project.owner} • <StatusBadge status={project.category} variant="small" />
                          </p>
                        </div>
                        <StatusBadge status={project.healthStatus} />
                      </div>

                      {/* Budget & Timeline */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-sm text-muted-foreground">Budget</span>
                            <span className="text-sm font-medium">
                              {formatCurrency(project.spent)} / {formatCurrency(project.budgeted)}
                            </span>
                          </div>
                          <ProgressBar 
                            percent={project.budgetPercent} 
                            type="budget"
                            showLabel={false}
                          />
                        </div>

                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-sm text-muted-foreground">Timeline</span>
                            <span className="text-sm font-medium">
                              {project.daysElapsed}d / {project.totalDays}d ({project.progress}% complete)
                            </span>
                          </div>
                          <ProgressBar 
                            percent={project.timelinePercent} 
                            type="timeline"
                            showLabel={false}
                          />
                        </div>
                      </div>

                      {/* Last Activity */}
                      <div className="mt-3 text-sm text-muted-foreground">
                        Last activity: {formatDistanceToNow(project.lastActivity, { addSuffix: true })}
                      </div>
                    </div>

                    {/* Red Flags */}
                    {project.redFlags.length > 0 && (
                      <div className="lg:w-80 space-y-2">
                        <p className="text-sm font-medium text-muted-foreground mb-2">Alerts:</p>
                        {project.redFlags.slice(0, 3).map((flag) => (
                          <div
                            key={flag.id}
                            className={`text-xs p-2 rounded ${
                              flag.severity === "critical"
                                ? "bg-status-error-bg text-status-error"
                                : "bg-status-warning-bg text-status-warning"
                            }`}
                          >
                            {flag.severity === "critical" ? "🔴" : "⚠️"} {flag.description}
                          </div>
                        ))}
                        {project.redFlags.length > 3 && (
                          <p className="text-xs text-muted-foreground">
                            ... +{project.redFlags.length - 3} more
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {filteredProjects.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <p>No projects match your filters</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Project Detail Modal */}
      <ProjectDetailModal
        project={selectedProject}
        open={!!selectedProject}
        onOpenChange={(open) => !open && setSelectedProject(null)}
      />
    </div>
  );
};

export default Index;
