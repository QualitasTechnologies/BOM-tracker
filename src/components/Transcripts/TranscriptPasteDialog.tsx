import { useState, useEffect, useRef } from 'react';
import { Loader2, Check, AlertCircle, Trash2, Edit2, FileText, Calendar, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/hooks/useAuth';
import { getProjects } from '@/utils/projectFirestore';
import { extractActivitiesFromTranscript } from '@/utils/transcriptService';
import { buildContextPrompt, addLearnedTerm, addVendorToContext } from '@/utils/projectContextFirestore';
import {
  addTranscript,
  markTranscriptProcessed,
  addActivitiesBatch,
} from '@/utils/transcriptFirestore';
import type { ExtractedActivity, ActivityType, TranscriptActivityInput } from '@/types/transcript';
import { ACTIVITY_TYPE_LABELS, ACTIVITY_TYPE_COLORS } from '@/types/transcript';

interface TranscriptPasteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface EditableActivity extends ExtractedActivity {
  id: string;
  selected: boolean;
  projectId?: string; // Mapped project ID
}

const TranscriptPasteDialog = ({
  open,
  onOpenChange,
  onSuccess,
}: TranscriptPasteDialogProps) => {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 1: Input state
  const [transcript, setTranscript] = useState('');
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [meetingDate, setMeetingDate] = useState(
    new Date().toISOString().split('T')[0]
  );

  // Step 2: Review state
  const [step, setStep] = useState<'input' | 'review'>('input');
  const [activities, setActivities] = useState<EditableActivity[]>([]);
  const [unrecognizedProjects, setUnrecognizedProjects] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Projects for mapping
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [projectMap, setProjectMap] = useState<Map<string, string>>(new Map());

  // Loading states
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load projects when dialog opens
  useEffect(() => {
    if (open) {
      loadProjects();
      // Reset state
      setTranscript('');
      setUploadedFileName(null);
      setMeetingDate(new Date().toISOString().split('T')[0]);
      setStep('input');
      setActivities([]);
      setUnrecognizedProjects([]);
      setWarnings([]);
      setError(null);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [open]);

  const loadProjects = async () => {
    try {
      const projectList = await getProjects();
      // Project uses projectId and projectName fields
      setProjects(projectList.map((p) => ({ id: p.projectId, name: p.projectName })));

      // Build initial project name -> ID map
      const map = new Map<string, string>();
      projectList.forEach((p) => {
        // Map various forms of the name
        map.set(p.projectName.toLowerCase(), p.projectId);
        // Also map without spaces
        map.set(p.projectName.toLowerCase().replace(/\s+/g, ''), p.projectId);
      });
      setProjectMap(map);
    } catch (err) {
      console.error('Failed to load projects:', err);
    }
  };

  const findProjectId = (projectName: string): string | undefined => {
    const normalized = projectName.toLowerCase().trim();

    // Direct match
    if (projectMap.has(normalized)) {
      return projectMap.get(normalized);
    }

    // Without spaces
    const noSpaces = normalized.replace(/\s+/g, '');
    if (projectMap.has(noSpaces)) {
      return projectMap.get(noSpaces);
    }

    // Partial match
    for (const [key, id] of projectMap.entries()) {
      if (key.includes(normalized) || normalized.includes(key)) {
        return id;
      }
    }

    return undefined;
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ['text/plain', 'text/markdown', '.txt', '.md'];
    const isValidType = validTypes.some(type =>
      file.type === type || file.name.endsWith('.txt') || file.name.endsWith('.md')
    );

    if (!isValidType) {
      setError('Please upload a text file (.txt or .md)');
      return;
    }

    // Validate file size (max 1MB)
    if (file.size > 1024 * 1024) {
      setError('File is too large. Maximum size is 1MB.');
      return;
    }

    setError(null);
    const reader = new FileReader();

    reader.onload = (e) => {
      const content = e.target?.result as string;
      setTranscript(content);
      setUploadedFileName(file.name);
    };

    reader.onerror = () => {
      setError('Failed to read file. Please try again.');
    };

    reader.readAsText(file);
  };

  const handleExtract = async () => {
    if (!transcript.trim()) {
      setError('Please paste a transcript');
      return;
    }

    setIsExtracting(true);
    setError(null);

    try {
      const knownProjects = projects.map((p) => p.name);

      // Build rich context from project context files
      let projectContext: string | undefined;
      try {
        projectContext = await buildContextPrompt();
      } catch (ctxErr) {
        console.warn('Failed to load project context, falling back to simple list:', ctxErr);
      }

      const result = await extractActivitiesFromTranscript({
        transcript,
        knownProjects,
        meetingDate,
        projectContext,
      });

      // Map extracted activities to editable format with project IDs
      const editableActivities: EditableActivity[] = result.activities.map(
        (activity, index) => ({
          ...activity,
          id: `temp-${index}`,
          selected: true,
          projectId: findProjectId(activity.projectName),
        })
      );

      setActivities(editableActivities);
      setUnrecognizedProjects(result.unrecognizedProjects || []);
      setWarnings(result.warnings || []);
      setStep('review');
    } catch (err: any) {
      setError(err.message || 'Failed to extract activities');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleActivityToggle = (id: string) => {
    setActivities((prev) =>
      prev.map((a) => (a.id === id ? { ...a, selected: !a.selected } : a))
    );
  };

  const handleActivityTypeChange = (id: string, type: ActivityType) => {
    setActivities((prev) =>
      prev.map((a) => (a.id === id ? { ...a, type } : a))
    );
  };

  const handleActivityProjectChange = async (id: string, projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    const activity = activities.find((a) => a.id === id);

    // If user is changing from one project to another, learn from the correction
    if (activity && activity.projectId && activity.projectId !== projectId) {
      const originalProjectName = activity.projectName;

      // Learn that the original term should map to the new project
      // This helps future extractions
      try {
        // If the original name doesn't match the new project, it's a correction
        if (originalProjectName && project && originalProjectName !== project.name) {
          await addLearnedTerm(projectId, originalProjectName, user?.uid);
          console.log(`Learned: "${originalProjectName}" → ${project.name}`);
        }
      } catch (err) {
        // Don't block the UI if learning fails
        console.warn('Failed to save learning:', err);
      }
    }

    setActivities((prev) =>
      prev.map((a) =>
        a.id === id
          ? { ...a, projectId, projectName: project?.name || a.projectName }
          : a
      )
    );
  };

  const handleActivitySummaryChange = (id: string, summary: string) => {
    setActivities((prev) =>
      prev.map((a) => (a.id === id ? { ...a, summary } : a))
    );
  };

  const handleDeleteActivity = (id: string) => {
    setActivities((prev) => prev.filter((a) => a.id !== id));
  };

  const handleSave = async () => {
    if (!user) return;

    const selectedActivities = activities.filter((a) => a.selected && a.projectId);

    if (selectedActivities.length === 0) {
      setError('No activities selected or all activities are missing project mapping');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      // Save the transcript first
      const transcriptId = await addTranscript(
        transcript,
        meetingDate,
        'Daily Engineering Updates',
        user.uid,
        user.displayName || user.email || 'Unknown'
      );

      // Prepare activities for saving
      const activityInputs: TranscriptActivityInput[] = selectedActivities.map((a) => ({
        projectId: a.projectId!,
        projectName: a.projectName,
        type: a.type,
        summary: a.summary,
        rawExcerpt: a.rawExcerpt,
        speaker: a.speaker,
        meetingDate,
        timestamp: a.timestamp,
        source: 'transcript' as const,
        transcriptId,
      }));

      // Save all activities
      await addActivitiesBatch(
        activityInputs,
        user.uid,
        user.displayName || user.email || 'Unknown'
      );

      // Mark transcript as processed
      const projectCount = new Set(selectedActivities.map((a) => a.projectId)).size;
      await markTranscriptProcessed(transcriptId, projectCount, selectedActivities.length);

      onOpenChange(false);
      onSuccess?.();
    } catch (err: any) {
      setError(err.message || 'Failed to save activities');
    } finally {
      setIsSaving(false);
    }
  };

  const selectedCount = activities.filter((a) => a.selected).length;
  const unmappedCount = activities.filter((a) => a.selected && !a.projectId).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {step === 'input' ? 'Paste Standup Transcript' : 'Review Extracted Activities'}
          </DialogTitle>
          <DialogDescription>
            {step === 'input'
              ? 'Paste your meeting transcript to extract project activities'
              : `${activities.length} activities extracted. Review and confirm.`}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {step === 'input' ? (
          // Step 1: Input
          <div className="space-y-4 flex-1 overflow-auto">
            <div className="space-y-2">
              <Label htmlFor="meetingDate" className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Meeting Date
              </Label>
              <Input
                id="meetingDate"
                type="date"
                value={meetingDate}
                onChange={(e) => setMeetingDate(e.target.value)}
                className="w-48"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="transcript">Transcript</Label>
                <div className="flex items-center gap-2">
                  {uploadedFileName && (
                    <span className="text-xs text-green-600 flex items-center gap-1">
                      <Check className="h-3 w-3" />
                      {uploadedFileName}
                    </span>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.md,text/plain,text/markdown"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    className="h-7 text-xs"
                  >
                    <Upload className="h-3 w-3 mr-1" />
                    Upload File
                  </Button>
                </div>
              </div>
              <Textarea
                id="transcript"
                placeholder="Paste your Fathom transcript here, or upload a .txt file...

Example format:
00:00:11 - Raghava Kashyapa (qualitastech.com)
    Hello, you guys.
00:00:15 - Puneeth Raj (qualitastech.com)
    Hey, morning..."
                value={transcript}
                onChange={(e) => {
                  setTranscript(e.target.value);
                  setUploadedFileName(null); // Clear file name when manually editing
                }}
                className="min-h-[300px] font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                {transcript.length.toLocaleString()} characters
              </p>
            </div>
          </div>
        ) : (
          // Step 2: Review
          <div className="flex-1 overflow-auto space-y-4">
            {warnings.length > 0 && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {warnings.map((w, i) => (
                    <div key={i}>{w}</div>
                  ))}
                </AlertDescription>
              </Alert>
            )}

            {unrecognizedProjects.length > 0 && (
              <Alert>
                <AlertDescription>
                  <strong>Unrecognized projects:</strong>{' '}
                  {unrecognizedProjects.join(', ')}
                  <br />
                  <span className="text-xs">
                    These may be sales leads or new projects not in the system.
                  </span>
                </AlertDescription>
              </Alert>
            )}

            <div className="flex items-center justify-between text-sm">
              <span>
                {selectedCount} of {activities.length} selected
                {unmappedCount > 0 && (
                  <span className="text-amber-600 ml-2">
                    ({unmappedCount} need project mapping)
                  </span>
                )}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setActivities((prev) =>
                      prev.map((a) => ({ ...a, selected: true }))
                    )
                  }
                >
                  Select All
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setActivities((prev) =>
                      prev.map((a) => ({ ...a, selected: false }))
                    )
                  }
                >
                  Deselect All
                </Button>
              </div>
            </div>

            <div className="space-y-3 max-h-[400px] overflow-auto">
              {activities.map((activity) => (
                <div
                  key={activity.id}
                  className={`border rounded-lg p-3 space-y-2 ${
                    activity.selected ? 'bg-white' : 'bg-gray-50 opacity-60'
                  } ${!activity.projectId && activity.selected ? 'border-amber-300' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={activity.selected}
                      onCheckedChange={() => handleActivityToggle(activity.id)}
                      className="mt-1"
                    />

                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Project Select */}
                        <Select
                          value={activity.projectId || ''}
                          onValueChange={(value) =>
                            handleActivityProjectChange(activity.id, value)
                          }
                        >
                          <SelectTrigger className="w-40 h-8 text-xs">
                            <SelectValue placeholder="Select project" />
                          </SelectTrigger>
                          <SelectContent>
                            {projects.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        {/* Type Select */}
                        <Select
                          value={activity.type}
                          onValueChange={(value) =>
                            handleActivityTypeChange(
                              activity.id,
                              value as ActivityType
                            )
                          }
                        >
                          <SelectTrigger className="w-32 h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(ACTIVITY_TYPE_LABELS).map(
                              ([value, label]) => (
                                <SelectItem key={value} value={value}>
                                  {label}
                                </SelectItem>
                              )
                            )}
                          </SelectContent>
                        </Select>

                        <Badge
                          variant="outline"
                          className={`text-[10px] ${ACTIVITY_TYPE_COLORS[activity.type]}`}
                        >
                          {ACTIVITY_TYPE_LABELS[activity.type]}
                        </Badge>

                        {activity.speaker && (
                          <span className="text-xs text-muted-foreground">
                            by {activity.speaker}
                          </span>
                        )}

                        {activity.confidence < 0.7 && (
                          <Badge variant="outline" className="text-[10px] text-amber-600">
                            Low confidence
                          </Badge>
                        )}
                      </div>

                      {/* Summary - Editable */}
                      <Input
                        value={activity.summary}
                        onChange={(e) =>
                          handleActivitySummaryChange(activity.id, e.target.value)
                        }
                        className="text-sm"
                        placeholder="Activity summary"
                      />

                      {activity.rawExcerpt && (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-muted-foreground">
                            Original excerpt
                          </summary>
                          <p className="mt-1 p-2 bg-gray-50 rounded text-gray-600 whitespace-pre-wrap">
                            {activity.rawExcerpt}
                          </p>
                        </details>
                      )}
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteActivity(activity.id)}
                      className="text-red-500 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}

              {activities.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  No activities extracted. The transcript may not contain
                  recognizable project updates.
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="border-t pt-4">
          {step === 'input' ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleExtract}
                disabled={isExtracting || !transcript.trim()}
              >
                {isExtracting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Extracting...
                  </>
                ) : (
                  <>
                    <FileText className="mr-2 h-4 w-4" />
                    Extract Activities
                  </>
                )}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep('input')}>
                Back
              </Button>
              <Button
                onClick={handleSave}
                disabled={isSaving || selectedCount === 0 || unmappedCount > 0}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Save {selectedCount} Activities
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TranscriptPasteDialog;
