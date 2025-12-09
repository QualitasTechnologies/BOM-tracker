
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface BOMHeaderProps {
  projectName: string;
  projectId: string;
  clientName: string;
  totalCost: number;
  itemsPriced: number;
  totalItems: number;
}

const BOMHeader = ({ projectName, projectId, clientName, totalCost, itemsPriced, totalItems }: BOMHeaderProps) => {
  const navigate = useNavigate();
  const pricingPercentage = totalItems > 0 ? Math.round((itemsPriced / totalItems) * 100) : 0;

  return (
    <div className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm mb-4">
      <div className="px-4 py-3">
        {/* Line 1: Project Identity */}
        <div className="flex flex-wrap items-center gap-3 text-sm mb-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/projects')}
            className="h-8 px-2 -ml-2"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Projects
          </Button>
          <span className="text-gray-400">|</span>
          <h1 className="text-lg font-bold text-gray-900">{projectName} - BOM</h1>
          <span className="text-gray-400">|</span>
          <span className="text-gray-600">Client: <span className="font-medium">{clientName}</span></span>
          <span className="text-gray-400">|</span>
          <Badge variant="outline" className="text-xs">ID: {projectId}</Badge>
        </div>

        {/* Line 2: Financial Info */}
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-gray-600">Total BOM Cost:</span>
            <span className="text-xl font-bold text-green-600">
              ₹{totalCost.toLocaleString('en-IN')}
            </span>
          </div>
          <span className="text-gray-400">|</span>
          <div className="flex items-center gap-2">
            <span className="text-gray-600">{itemsPriced} of {totalItems} items priced</span>
            <Badge
              variant={pricingPercentage >= 75 ? "default" : pricingPercentage >= 50 ? "secondary" : "destructive"}
              className="text-xs"
            >
              {pricingPercentage}%
            </Badge>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BOMHeader;
