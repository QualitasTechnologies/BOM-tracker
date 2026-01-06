import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Sidebar from '@/components/Sidebar';
import { MilestoneList } from '@/components/Milestones';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/firebase';

const Milestones = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [projectDetails, setProjectDetails] = useState<{ projectName: string; projectId: string; clientName: string } | null>(null);

  // Load project details
  useEffect(() => {
    const loadProject = async () => {
      if (!projectId) return;
      try {
        const docRef = doc(db, 'projects', projectId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setProjectDetails({
            projectName: data.projectName || 'Untitled Project',
            projectId: data.projectId || projectId,
            clientName: data.clientName || 'Unknown Client',
          });
        }
      } catch (error) {
        console.error('Error loading project:', error);
      }
    };
    loadProject();
  }, [projectId]);

  if (!projectId) {
    return <div className="p-8 text-center text-muted-foreground">Project not found</div>;
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div className={`flex-1 transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'ml-16' : 'ml-64'}`}>
        {/* Header */}
        <div className="bg-card border-b">
          <div className="container mx-auto px-6 py-4">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" asChild>
                <Link to="/projects">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Projects
                </Link>
              </Button>
              <div className="h-6 w-px bg-border" />
              <div className="flex-1">
                <h1 className="text-xl font-semibold">
                  {projectDetails?.projectName || 'Loading...'}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {projectDetails?.clientName} • {projectDetails?.projectId}
                </p>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link to={`/project/${projectId}/bom`}>
                  <Wrench className="h-4 w-4 mr-2 text-purple-600" />
                  BOM
                </Link>
              </Button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="container mx-auto px-6 py-6">
          <MilestoneList projectId={projectId} />
        </div>
      </div>
    </div>
  );
};

export default Milestones;
