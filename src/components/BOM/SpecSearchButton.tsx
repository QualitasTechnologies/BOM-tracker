import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Search, Loader2, FileCheck, ExternalLink } from 'lucide-react';
import { triggerSpecSearch } from '@/utils/complianceService';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

interface SpecSearchButtonProps {
  itemId: string;
  itemName: string;
  projectId: string;
  make?: string;
  sku?: string;
  specificationUrl?: string;
  linkedSpecDocumentId?: string;
  size?: 'sm' | 'default' | 'icon';
}

export function SpecSearchButton({
  itemId,
  itemName,
  projectId,
  make,
  sku,
  specificationUrl,
  linkedSpecDocumentId,
  size = 'icon'
}: SpecSearchButtonProps) {
  const [isSearching, setIsSearching] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();

  const handleSearch = async (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row click

    if (!projectId || !itemId) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Missing project or item information'
      });
      return;
    }

    setIsSearching(true);

    try {
      const response = await triggerSpecSearch({
        bomItemId: itemId,
        projectId,
        itemName,
        make,
        sku,
        userId: user?.uid || 'anonymous'
      });

      if (response.success) {
        if (response.status === 'not_configured') {
          toast({
            title: 'Spec Search Not Configured',
            description: 'n8n workflow needs to be configured for spec sheet search.',
            variant: 'default'
          });
        } else if (response.status === 'completed' && response.specificationUrl) {
          toast({
            title: 'Spec Sheet Found!',
            description: 'Specification sheet has been linked to this item.'
          });
        } else if (response.status === 'completed') {
          toast({
            title: 'Search Complete',
            description: 'No specification sheet found for this item.',
            variant: 'default'
          });
        } else {
          toast({
            title: 'Search Initiated',
            description: 'Looking for specification sheets. Results will appear automatically when found.'
          });
        }
      } else {
        throw new Error(response.errorMessage || 'Search failed');
      }
    } catch (error) {
      console.error('Spec search error:', error);
      toast({
        variant: 'destructive',
        title: 'Search Failed',
        description: error instanceof Error ? error.message : 'An error occurred'
      });
    } finally {
      setIsSearching(false);
    }
  };

  // If spec is already found, show a link to it
  if (specificationUrl || linkedSpecDocumentId) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size={size}
            className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50"
            onClick={(e) => {
              e.stopPropagation();
              if (specificationUrl) {
                window.open(specificationUrl, '_blank');
              }
            }}
          >
            <FileCheck className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Spec sheet found</p>
          {specificationUrl && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <ExternalLink className="h-3 w-3" />
              Click to open
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size={size}
          className="h-7 w-7"
          onClick={handleSearch}
          disabled={isSearching}
        >
          {isSearching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>Search for specification sheet</p>
        {(make || sku) && (
          <p className="text-xs text-muted-foreground">
            {make && `${make}`}
            {make && sku && ' | '}
            {sku && `${sku}`}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

export default SpecSearchButton;
