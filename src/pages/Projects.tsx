import { useEffect, useMemo, useState } from "react";
import { Search, Plus, Filter, Grid, List, Calendar, User, FileText, Edit, X, Wrench, Clock, DollarSign } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table as TableComponent, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import Sidebar from "@/components/Sidebar";
import AddProjectDialog from "@/components/Project/AddProjectDialog";
import EditProjectDialog from "@/components/Project/EditProjectDialog";
import DeleteProjectDialog from "@/components/Project/DeleteProjectDialog";
import { addProject, subscribeToProjects, updateProject, deleteProject } from "@/utils/projectFirestore";
import type { EditableProjectInput, FirestoreProject, NewProjectFormData, ProjectViewMode } from "@/types/project";

const Projects = () => {
  const [viewMode, setViewMode] = useState<ProjectViewMode>("cards");
  const [searchQuery, setSearchQuery] = useState("");
  const [clientFilter, setClientFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isAddProjectDialogOpen, setIsAddProjectDialogOpen] = useState(false);
  const [isEditProjectDialogOpen, setIsEditProjectDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<FirestoreProject | null>(null);
  const [projects, setProjects] = useState<FirestoreProject[]>([]);

  useEffect(() => {
    // Subscribe to Firestore projects
    const unsubscribe = subscribeToProjects((fetchedProjects) => {
      setProjects(fetchedProjects);
    });
    return () => unsubscribe();
  }, []);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "Planning":
        return <Badge className="bg-gray-100 text-gray-800 hover:bg-gray-100">📋 Planning</Badge>;
      case "Ongoing":
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">🟢 Ongoing</Badge>;
      case "Delayed":
        return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">🔴 Delayed</Badge>;
      case "Completed":
        return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">✅ Completed</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const handleAddProject = async (newProject: NewProjectFormData) => {
    // Map dialog fields to Firestore schema
    const project: FirestoreProject = {
      projectId: newProject.id,
      projectName: newProject.name,
      clientName: newProject.client,
      description: newProject.description,
      status: newProject.status,
      deadline: newProject.deadline,
    };
    await addProject(project);
  };

  const handleUpdateProject = async (updatedProject: EditableProjectInput) => {
    const { projectId, ...updates } = updatedProject;
    await updateProject(projectId, updates);
  };

  const handleDeleteProject = async () => {
    if (selectedProject) {
      await deleteProject(selectedProject.projectId);
      setIsDeleteDialogOpen(false);
      setSelectedProject(null);
    }
  };

  const handleEditClick = (project: FirestoreProject) => {
    setSelectedProject(project);
    setIsEditProjectDialogOpen(true);
  };

  const handleDeleteClick = (project: FirestoreProject) => {
    setSelectedProject(project);
    setIsDeleteDialogOpen(true);
  };

  const formatDate = (dateString: string) => {
    const safeDate = new Date(dateString);
    if (Number.isNaN(safeDate.getTime())) {
      return "No deadline";
    }
    return safeDate.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  // Derive the filtered list only when data or filters change.
  const filteredProjects = useMemo(() => {
    const normalizedQuery = searchQuery.toLowerCase().trim();
    return projects.filter((project) => {
      const projectName = project.projectName?.toLowerCase() ?? "";
      const clientName = project.clientName?.toLowerCase() ?? "";
      const projectId = project.projectId?.toLowerCase() ?? "";

      const matchesSearch =
        projectName.includes(normalizedQuery) ||
        clientName.includes(normalizedQuery) ||
        projectId.includes(normalizedQuery);

      const matchesClient = clientFilter === "all" || project.clientName === clientFilter;
      const matchesStatus = statusFilter === "all" || project.status === statusFilter;
      return matchesSearch && matchesClient && matchesStatus;
    });
  }, [clientFilter, projects, searchQuery, statusFilter]);

  // Build a deduplicated, sanitized client list for the filter dropdown.
  const clientOptions = useMemo(
    () =>
      [...new Set(projects.map((p) => p.clientName?.trim()))].filter(
        (client): client is string => Boolean(client && client.length)
      ),
    [projects]
  );

  const ProjectCard = ({ project }: { project: FirestoreProject }) => (
    <Card className="hover:shadow-lg transition-shadow duration-200 relative group overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start gap-3 mb-2">
          <div className="flex-1 min-w-0 pr-2">
            <CardTitle className="text-lg font-semibold leading-tight mb-1 break-words">
              {project.projectName}
            </CardTitle>
            {project.description && (
              <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">
                {project.description}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleEditClick(project)}
              className="h-8 w-8 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleDeleteClick(project)}
              className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex items-center">
          {getStatusBadge(project.status)}
        </div>
      </CardHeader>
      
      <CardContent className="pt-0 space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">ID:</span>
          <span className="text-muted-foreground">{project.projectId}</span>
        </div>
        
        <div className="flex items-center gap-2 text-sm">
          <User className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">Client:</span>
          <span className="text-muted-foreground">{project.clientName}</span>
        </div>
        
        <div className="flex items-center gap-2 text-sm">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">Deadline:</span>
          <span className="text-muted-foreground">{formatDate(project.deadline)}</span>
        </div>
      </CardContent>
      
      <CardFooter className="pt-0 px-4 pb-4 overflow-hidden">
        <div className="flex gap-1.5 sm:gap-2 w-full min-w-0">
          <Button 
            asChild 
            variant="outline" 
            size="sm" 
            className="flex-1 min-w-0 px-2 sm:px-3 overflow-hidden"
          >
            <Link to={`/project/${project.projectId}/bom`} className="flex items-center justify-center gap-1.5 sm:gap-2 min-w-0">
              <Wrench className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0 text-purple-600" />
              <span className="hidden sm:inline text-xs sm:text-sm">BOM</span>
            </Link>
          </Button>
          <Button 
            asChild 
            variant="outline" 
            size="sm" 
            className="flex-1 min-w-0 px-2 sm:px-3 overflow-hidden"
          >
            <Link to={`/time-tracking?project=${project.projectId}`} className="flex items-center justify-center gap-1.5 sm:gap-2 min-w-0">
              <Clock className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0 text-purple-600" />
              <span className="hidden sm:inline text-xs sm:text-sm">Time</span>
            </Link>
          </Button>
          <Button 
            asChild 
            variant="outline" 
            size="sm" 
            className="flex-1 min-w-0 px-2 sm:px-3 overflow-hidden"
          >
            <Link to={`/cost-analysis?project=${project.projectId}`} className="flex items-center justify-center gap-1.5 sm:gap-2 min-w-0">
              <DollarSign className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0 text-orange-600" />
              <span className="hidden sm:inline text-xs sm:text-sm">Cost</span>
            </Link>
          </Button>
        </div>
      </CardFooter>
    </Card>
  );

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div className={`flex-1 transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'ml-16' : 'ml-64'}`}>
        {/* Header */}
        <div className="bg-card border-b">
          <div className="container mx-auto px-6 py-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold">Projects</h1>
                <span className="text-muted-foreground">({filteredProjects.length} projects)</span>
              </div>
            </div>

            {/* Controls */}
            <div className="flex flex-col gap-4 mt-6 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3 flex-1 max-w-md">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search projects..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Button onClick={() => setIsAddProjectDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add New Project
                </Button>
                <Select value={clientFilter} onValueChange={setClientFilter}>
                  <SelectTrigger className="w-40">
                    <Filter className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="Filter by Client" />
                  </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Clients</SelectItem>
                  {clientOptions.map((client) => (
                    <SelectItem key={client} value={client}>
                      {client}
                    </SelectItem>
                  ))}
                </SelectContent>
                </Select>

                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-36">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="Planning">Planning</SelectItem>
                    <SelectItem value="Ongoing">Ongoing</SelectItem>
                    <SelectItem value="Delayed">Delayed</SelectItem>
                    <SelectItem value="Completed">Completed</SelectItem>
                  </SelectContent>
                </Select>

                <Separator orientation="vertical" className="h-6" />

                <div className="flex rounded-lg border">
                  <Button
                    variant={viewMode === "cards" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setViewMode("cards")}
                    className="rounded-r-none"
                  >
                    <Grid className="h-4 w-4 mr-2" />
                    Cards
                  </Button>
                  <Button
                    variant={viewMode === "table" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setViewMode("table")}
                    className="rounded-l-none"
                  >
                    <List className="h-4 w-4 mr-2" />
                    Table
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="container mx-auto px-6 py-8">
          {viewMode === "cards" ? (
            /* Card View */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredProjects.map((project) => (
                <ProjectCard key={project.projectId} project={project} />
              ))}
            </div>
          ) : (
            /* Table View */
            <Card>
              <TableComponent>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project Name</TableHead>
                    <TableHead>Project ID</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Deadline</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProjects.map((project) => (
                    <TableRow key={project.projectId} className="hover:bg-muted/50">
                      <TableCell>
                        <div>
                          <div className="font-medium">{project.projectName}</div>
                          <div className="text-sm text-muted-foreground">{project.description}</div>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono">{project.projectId}</TableCell>
                      <TableCell>{project.clientName}</TableCell>
                      <TableCell>{formatDate(project.deadline)}</TableCell>
                      <TableCell>{getStatusBadge(project.status)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 justify-center">
                          <Button asChild variant="outline" size="sm" title="BOM">
                            <Link to={`/project/${project.projectId}/bom`}>
                              <Wrench className="h-4 w-4 text-purple-600" />
                            </Link>
                          </Button>
                          <Button asChild variant="outline" size="sm" title="Time">
                            <Link to={`/time-tracking?project=${project.projectId}`}>
                              <Clock className="h-4 w-4 text-purple-600" />
                            </Link>
                          </Button>
                          <Button asChild variant="outline" size="sm" title="Cost">
                            <Link to={`/cost-analysis?project=${project.projectId}`}>
                              <DollarSign className="h-4 w-4 text-orange-600" />
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </TableComponent>
            </Card>
          )}

          {filteredProjects.length === 0 && (
            <div className="text-center py-12">
              <div className="text-muted-foreground text-lg">No projects found matching your criteria.</div>
              <Button className="mt-4">
                <Plus className="h-4 w-4 mr-2" />
                Create New Project
              </Button>
            </div>
          )}
        </div>
      </div>
      <AddProjectDialog
        open={isAddProjectDialogOpen}
        onOpenChange={setIsAddProjectDialogOpen}
        onAddProject={handleAddProject}
      />
      <EditProjectDialog
        open={isEditProjectDialogOpen}
        onOpenChange={setIsEditProjectDialogOpen}
        onUpdateProject={handleUpdateProject}
        project={selectedProject}
      />
      <DeleteProjectDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        onConfirm={handleDeleteProject}
        projectName={selectedProject?.projectName || ""}
      />
    </div>
  );
};

export default Projects;