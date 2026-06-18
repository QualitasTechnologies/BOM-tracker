// src/components/Project/ProjectMembersTab.tsx
import { useState } from 'react';
import { Pencil, Trash2, UserPlus, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import {
  Project,
  ProjectMember,
  addProjectMember,
  removeProjectMember,
  updateProjectMemberScope,
} from '@/utils/projectFirestore';
import { isInternalUser } from '@/utils/accessControl';

interface AppUserOption {
  uid: string;
  email: string;
  displayName: string;
}

interface ProjectMembersTabProps {
  projectId: string;
  project: Project;
  currentUserId: string;
  isAdmin: boolean;
  categoryNames: string[];          // All canonical category names for this project
  availableUsers: AppUserOption[];  // All approved users (fetched by parent)
  onProjectUpdated: (updated: Project) => void; // Called after member changes
}

const ProjectMembersTab = ({
  projectId,
  project,
  currentUserId,
  isAdmin,
  categoryNames,
  availableUsers,
  onProjectUpdated,
}: ProjectMembersTabProps) => {
  const { toast } = useToast();
  const members: ProjectMember[] = project.members || [];

  // Add member dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [userPickerOpen, setUserPickerOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AppUserOption | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);

  // Edit scope dialog state
  const [editMember, setEditMember] = useState<ProjectMember | null>(null);
  const [editCategories, setEditCategories] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const memberIds = project.memberIds || [];
  const nonMembers = availableUsers.filter(u => !memberIds.includes(u.uid));

  const isExternal = (email: string) => !isInternalUser(email);

  const handleAddOpen = () => {
    setSelectedUser(null);
    setSelectedCategories([]);
    setAddOpen(true);
  };

  const handleUserSelect = (user: AppUserOption) => {
    setSelectedUser(user);
    setUserPickerOpen(false);
    setSelectedCategories([]);
  };

  const toggleCategory = (cat: string, checked: boolean, list: string[], setList: (v: string[]) => void) => {
    setList(checked ? [...list, cat] : list.filter(c => c !== cat));
  };

  const handleAdd = async () => {
    if (!selectedUser) return;
    setAdding(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const newMember: ProjectMember = {
        userId: selectedUser.uid,
        email: selectedUser.email,
        displayName: selectedUser.displayName || selectedUser.email,
        addedAt: today,
        addedBy: currentUserId,
        ...(isExternal(selectedUser.email) ? { categoryScope: selectedCategories } : {}),
      };
      await addProjectMember(projectId, project, newMember);
      const updatedProject: Project = {
        ...project,
        memberIds: [...(project.memberIds || []), selectedUser.uid],
        members: [...(project.members || []), newMember],
      };
      onProjectUpdated(updatedProject);
      toast({ title: 'Member added', description: selectedUser.email });
      setAddOpen(false);
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to add member', variant: 'destructive' });
    } finally {
      setAdding(false);
    }
  };

  const handleEditOpen = (member: ProjectMember) => {
    setEditMember(member);
    setEditCategories(member.categoryScope || []);
  };

  const handleSaveScope = async () => {
    if (!editMember) return;
    setSaving(true);
    try {
      await updateProjectMemberScope(projectId, project, editMember.userId, editCategories);
      const updatedProject: Project = {
        ...project,
        members: (project.members || []).map(m =>
          m.userId === editMember.userId ? { ...m, categoryScope: editCategories } : m
        ),
      };
      onProjectUpdated(updatedProject);
      toast({ title: 'Scope updated' });
      setEditMember(null);
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to update scope', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (member: ProjectMember) => {
    if (members.length === 1) {
      toast({ title: 'Cannot remove', description: 'Project must have at least one member.', variant: 'destructive' });
      return;
    }
    try {
      await removeProjectMember(projectId, project, member.userId);
      const updatedProject: Project = {
        ...project,
        memberIds: (project.memberIds || []).filter(id => id !== member.userId),
        members: (project.members || []).filter(m => m.userId !== member.userId),
      };
      onProjectUpdated(updatedProject);
      toast({ title: 'Member removed', description: member.email });
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to remove member', variant: 'destructive' });
    }
  };

  const selectedIsExternal = selectedUser ? isExternal(selectedUser.email) : false;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Members ({members.length})</h3>
        {isAdmin && (
          <Button size="sm" onClick={handleAddOpen} className="flex items-center gap-2">
            <UserPlus className="h-4 w-4" />
            Add Member
          </Button>
        )}
      </div>

      {members.length === 0 ? (
        <p className="text-sm text-gray-500 py-4 text-center">No members yet. Add members to grant project access.</p>
      ) : (
        <div className="border rounded-md divide-y">
          {members.map(member => {
            const external = isExternal(member.email);
            const isSelf = member.userId === currentUserId;
            return (
              <div key={member.userId} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{member.displayName || member.email}</span>
                      {isSelf && <Badge variant="outline" className="text-xs">You</Badge>}
                      {external && (
                        <Badge variant="secondary" className="text-xs bg-amber-50 text-amber-700">Partner</Badge>
                      )}
                    </div>
                    <span className="text-xs text-gray-500">{member.email}</span>
                    {external && member.categoryScope && member.categoryScope.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {member.categoryScope.map(cat => (
                          <Badge key={cat} variant="outline" className="text-xs px-1 py-0">{cat}</Badge>
                        ))}
                      </div>
                    )}
                    {external && (!member.categoryScope || member.categoryScope.length === 0) && (
                      <span className="text-xs text-amber-600 flex items-center gap-1 mt-0.5">
                        <AlertCircle className="h-3 w-3" /> No categories — user sees no BOM items
                      </span>
                    )}
                    {!external && (
                      <span className="text-xs text-gray-400">All categories</span>
                    )}
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-1 shrink-0 ml-4">
                    {external && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Edit category scope"
                        onClick={() => handleEditOpen(member)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-red-500 hover:text-red-700"
                      title="Remove member"
                      onClick={() => handleRemove(member)}
                      disabled={isSelf && members.length === 1}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add Member Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Member</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">User</Label>
              <Popover open={userPickerOpen} onOpenChange={setUserPickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal h-9 text-sm">
                    {selectedUser ? (
                      <span>{selectedUser.displayName || selectedUser.email} <span className="text-gray-400">({selectedUser.email})</span></span>
                    ) : (
                      <span className="text-gray-400">Search users…</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search by name or email…" />
                    <CommandList>
                      <CommandEmpty>No users found.</CommandEmpty>
                      <CommandGroup>
                        {nonMembers.map(u => (
                          <CommandItem key={u.uid} onSelect={() => handleUserSelect(u)}>
                            <div>
                              <div className="text-sm font-medium">{u.displayName || u.email}</div>
                              <div className="text-xs text-gray-400">{u.email}</div>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {selectedUser && selectedIsExternal && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Categories (partner access)</Label>
                <div className="space-y-1.5 max-h-48 overflow-y-auto border rounded-md p-2">
                  {categoryNames.map(cat => (
                    <div key={cat} className="flex items-center gap-2">
                      <Checkbox
                        id={`cat-${cat}`}
                        checked={selectedCategories.includes(cat)}
                        onCheckedChange={(checked) =>
                          toggleCategory(cat, !!checked, selectedCategories, setSelectedCategories)
                        }
                      />
                      <label htmlFor={`cat-${cat}`} className="text-sm cursor-pointer">{cat}</label>
                    </div>
                  ))}
                </div>
                {selectedCategories.length === 0 && (
                  <p className="text-xs text-amber-600 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> No categories selected — user will see no BOM items.
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={!selectedUser || adding}>
              {adding ? 'Adding…' : 'Add Member'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Scope Dialog */}
      <Dialog open={!!editMember} onOpenChange={(o) => { if (!o) setEditMember(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Category Scope — {editMember?.displayName || editMember?.email}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label className="text-sm font-medium">Categories this partner can access</Label>
            <div className="space-y-1.5 max-h-60 overflow-y-auto border rounded-md p-2">
              {categoryNames.map(cat => (
                <div key={cat} className="flex items-center gap-2">
                  <Checkbox
                    id={`edit-cat-${cat}`}
                    checked={editCategories.includes(cat)}
                    onCheckedChange={(checked) =>
                      toggleCategory(cat, !!checked, editCategories, setEditCategories)
                    }
                  />
                  <label htmlFor={`edit-cat-${cat}`} className="text-sm cursor-pointer">{cat}</label>
                </div>
              ))}
            </div>
            {editCategories.length === 0 && (
              <p className="text-xs text-amber-600 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> No categories selected — user will see no BOM items.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditMember(null)}>Cancel</Button>
            <Button onClick={handleSaveScope} disabled={saving}>
              {saving ? 'Saving…' : 'Save Scope'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProjectMembersTab;
