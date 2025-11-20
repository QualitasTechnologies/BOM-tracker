
import { Calendar, DollarSign, Package, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

interface ProjectCardProps {
  id: string;
  name: string;
  client: string;
  status: 'Planning' | 'Ongoing' | 'Delayed' | 'Completed';
  progress: number;
  budget: number;
  spent: number;
  dueDate: string;
  teamSize: number;
  materialsCount: number;
}

const ProjectCard = ({
  id,
  name,
  client,
  status,
  progress,
  budget,
  spent,
  dueDate,
  teamSize,
  materialsCount
}: ProjectCardProps) => {
  const statusColors = {
    Planning: 'bg-gray-100 text-gray-800',
    Ongoing: 'bg-green-100 text-green-800',
    Delayed: 'bg-red-100 text-red-800',
    Completed: 'bg-blue-100 text-blue-800'
  };

  const budgetHealth = (spent / budget) * 100;
  const budgetColor = budgetHealth > 90 ? 'text-red-600' : budgetHealth > 75 ? 'text-amber-600' : 'text-green-600';

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{name}</h3>
          <p className="text-sm text-gray-600">{client}</p>
        </div>
        <span className={cn(
          "px-2 py-1 rounded-full text-xs font-medium",
          statusColors[status]
        )}>
          {status}
        </span>
      </div>

      <div className="space-y-4">
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-600">Progress</span>
            <span className="font-medium">{progress}%</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="flex items-center space-x-2">
            <DollarSign size={16} className={budgetColor} />
            <div>
              <p className="text-gray-600">Budget</p>
              <p className={cn("font-medium", budgetColor)}>
                ${spent.toLocaleString()} / ${budget.toLocaleString()}
              </p>
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            <Calendar size={16} className="text-gray-400" />
            <div>
              <p className="text-gray-600">Due Date</p>
              <p className="font-medium">{dueDate}</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            <Users size={16} className="text-gray-400" />
            <div>
              <p className="text-gray-600">Team</p>
              <p className="font-medium">{teamSize} members</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            <Package size={16} className="text-gray-400" />
            <div>
              <p className="text-gray-600">Materials</p>
              <p className="font-medium">{materialsCount} items</p>
            </div>
          </div>
        </div>

        <div className="flex space-x-2 pt-2">
          <Button size="sm" className="flex-1">View Details</Button>
          <Button size="sm" variant="outline">Edit</Button>
        </div>
      </div>
    </div>
  );
};

export default ProjectCard;
