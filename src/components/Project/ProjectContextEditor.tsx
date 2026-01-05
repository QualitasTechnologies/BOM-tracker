// Project Context Editor
// Displays and allows editing of the project context file for transcript intelligence

import { useState, useEffect } from 'react';
import { RefreshCw, Save, AlertCircle, Check, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import {
  getProjectContext,
  saveProjectContext,
  autoGenerateAndSaveContext,
  subscribeToProjectContext,
} from '@/utils/projectContextFirestore';
import { validateContextContent, parseContextContent } from '@/types/projectContext';
import type { ProjectContext } from '@/types/projectContext';
import type { Project } from '@/utils/projectFirestore';
import type { BOMItem, BOMCategory } from '@/types/bom';

interface ProjectContextEditorProps {
  projectId: string;
  project: Project;
  bomCategories: BOMCategory[];
  ownerName?: string;
}

const ProjectContextEditor = ({
  projectId,
  project,
  bomCategories,
  ownerName,
}: ProjectContextEditorProps) => {
  const { user } = useAuth();
  const { toast } = useToast();

  const [context, setContext] = useState<ProjectContext | null>(null);
  const [editedContent, setEditedContent] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Flatten BOM items from categories
  const bomItems: BOMItem[] = bomCategories.flatMap((cat) => cat.items);

  // Subscribe to context changes
  useEffect(() => {
    const unsubscribe = subscribeToProjectContext(projectId, (ctx) => {
      setContext(ctx);
      if (ctx) {
        setEditedContent(ctx.content);
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [projectId]);

  // Check for changes
  useEffect(() => {
    if (context) {
      setHasChanges(editedContent !== context.content);
    }
  }, [editedContent, context]);

  // Validate content on change
  useEffect(() => {
    if (editedContent) {
      const { errors } = validateContextContent(editedContent);
      setValidationErrors(errors);
    } else {
      setValidationErrors([]);
    }
  }, [editedContent]);

  // Handle save
  const handleSave = async () => {
    if (validationErrors.length > 0) {
      toast({
        title: 'Validation errors',
        description: 'Please fix the errors before saving.',
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);
    try {
      await saveProjectContext(projectId, editedContent, user?.uid);
      setHasChanges(false);
      toast({
        title: 'Context saved',
        description: 'Project context has been updated.',
      });
    } catch (error) {
      toast({
        title: 'Save failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Handle regenerate from BOM
  const handleRegenerate = async () => {
    if (hasChanges) {
      const confirmed = window.confirm(
        'You have unsaved changes. Regenerating will preserve learned terms but may overwrite other edits. Continue?'
      );
      if (!confirmed) return;
    }

    setIsRegenerating(true);
    try {
      await autoGenerateAndSaveContext(project, bomItems, ownerName, true);
      toast({
        title: 'Context regenerated',
        description: 'Context has been rebuilt from BOM data. Learned terms preserved.',
      });
    } catch (error) {
      toast({
        title: 'Regeneration failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsRegenerating(false);
    }
  };

  // Handle initial generation
  const handleGenerate = async () => {
    setIsRegenerating(true);
    try {
      await autoGenerateAndSaveContext(project, bomItems, ownerName, false);
      toast({
        title: 'Context generated',
        description: 'Initial context created from project and BOM data.',
      });
    } catch (error) {
      toast({
        title: 'Generation failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsRegenerating(false);
    }
  };

  // Parse context for preview
  const parsedPreview = editedContent ? parseContextContent(editedContent) : null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <RefreshCw className="animate-spin h-6 w-6 text-muted-foreground" />
      </div>
    );
  }

  // No context exists yet
  if (!context) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5" />
            Project Context
          </CardTitle>
          <CardDescription>
            Context helps the AI understand your project when parsing meeting transcripts.
            It identifies project aliases, team members, and vendors.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-4">
              No context file exists for this project yet.
            </p>
            <Button onClick={handleGenerate} disabled={isRegenerating}>
              {isRegenerating ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Generate from BOM Data
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            Project Context
            {context.autoGenerated && (
              <Badge variant="secondary">Auto-generated</Badge>
            )}
          </h3>
          <p className="text-sm text-muted-foreground">
            Last modified: {new Date(context.lastModified).toLocaleString()}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleRegenerate}
            disabled={isRegenerating}
          >
            {isRegenerating ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Regenerating...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Regenerate
              </>
            )}
          </Button>
          <Button
            onClick={handleSave}
            disabled={!hasChanges || isSaving || validationErrors.length > 0}
          >
            {isSaving ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Validation Errors */}
      {validationErrors.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <ul className="list-disc list-inside">
              {validationErrors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Editor */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Text Editor */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Context File</label>
          <Textarea
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
            className="font-mono text-sm min-h-[500px]"
            placeholder="# Project Context..."
          />
          <p className="text-xs text-muted-foreground">
            Edit the YAML-like content above. Changes are not saved until you click Save.
          </p>
        </div>

        {/* Preview */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Parsed Preview</label>
          <Card className="min-h-[500px] overflow-auto">
            <CardContent className="pt-4">
              {parsedPreview ? (
                <div className="space-y-4 text-sm">
                  {/* Project & Client */}
                  <div>
                    <span className="font-semibold">Project:</span> {parsedPreview.project}
                    <br />
                    <span className="font-semibold">Client:</span> {parsedPreview.client}
                  </div>

                  {/* Aliases */}
                  {parsedPreview.aliases.length > 0 && (
                    <div>
                      <span className="font-semibold">Aliases:</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {parsedPreview.aliases.map((alias, i) => (
                          <Badge key={i} variant="outline">
                            {alias}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Owners */}
                  {parsedPreview.owners.length > 0 && (
                    <div>
                      <span className="font-semibold">Owners:</span>
                      <ul className="list-disc list-inside mt-1">
                        {parsedPreview.owners.map((owner, i) => (
                          <li key={i}>
                            {owner.name} ({owner.role})
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Vendors */}
                  {parsedPreview.vendors.length > 0 && (
                    <div>
                      <span className="font-semibold">Vendors:</span>
                      <ul className="list-disc list-inside mt-1">
                        {parsedPreview.vendors.map((vendor, i) => (
                          <li key={i}>
                            {vendor.name}
                            {vendor.context && (
                              <span className="text-muted-foreground">
                                {' '}
                                - {vendor.context}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Keywords */}
                  {parsedPreview.keywords.length > 0 && (
                    <div>
                      <span className="font-semibold">Keywords:</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {parsedPreview.keywords.map((kw, i) => (
                          <Badge key={i} variant="secondary">
                            {kw}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Learned */}
                  {parsedPreview.learned.length > 0 && (
                    <div>
                      <span className="font-semibold">Learned from corrections:</span>
                      <ul className="list-disc list-inside mt-1">
                        {parsedPreview.learned.map((item, i) => (
                          <li key={i}>
                            <code className="bg-muted px-1 rounded">"{item.term}"</code>
                            {' '}&rarr; this project
                            <span className="text-muted-foreground text-xs ml-2">
                              ({item.learnedOn})
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground">
                  Enter content to see preview
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Info */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          <strong>How this works:</strong> When you parse a meeting transcript, the AI uses this context to:
          <ul className="list-disc list-inside mt-1">
            <li>Identify which project updates belong to (via aliases)</li>
            <li>Know that vendor names (like "Somotec") refer to this project</li>
            <li>Attribute updates based on who typically works on this project (owners)</li>
            <li>The "learned" section grows automatically when you correct misattributions</li>
          </ul>
        </AlertDescription>
      </Alert>
    </div>
  );
};

export default ProjectContextEditor;
