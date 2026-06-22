import { useState } from 'react';
import { Pencil, Trash2, UserPlus, AlertCircle, Bell, BellOff, Mail, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { useToast } from '@/components/ui/use-toast';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/firebase';
import {
  Project,
  ProjectMember,
  ExternalRecipient,
  addProjectMember,
  removeProjectMember,
  updateProjectMemberScope,
  toggleMemberNotifications,
  addExternalRecipient,
  removeExternalRecipient,
  toggleExternalRecipientNotifications,
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
  categoryNames: string[];
  availableUsers: AppUserOption[];
  onProjectUpdated: (updated: Project) => void;
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
  const externalRecipients: ExternalRecipient[] = project.externalRecipients || [];

  // Add member dialog
  const [addOpen, setAddOpen] = useState(false);
  const [userPickerOpen, setUserPickerOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AppUserOption | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);

  // Edit scope dialog
  const [editMember, setEditMember] = useState<ProjectMember | null>(null);
  const [editCategories, setEditCategories] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Add external recipient dialog
  const [extOpen, setExtOpen] = useState(false);
  const [extName, setExtName] = useState('');
  const [extEmail, setExtEmail] = useState('');
  const [extAdding, setExtAdding] = useState(false);
  const [extError, setExtError] = useState<string | null>(null);

  // Send digest
  const [sendingDigest, setSendingDigest] = useState(false);

  const memberIds = project.memberIds || [];
  const nonMembers = availableUsers.filter(u => !memberIds.includes(u.uid));
  const isExternal = (email: string) => !isInternalUser(email);

  const toggleCategory = (
    cat: string,
    checked: boolean,
    list: string[],
    setList: (v: string[]) => void
  ) => setList(checked ? [...list, cat] : list.filter(c => c !== cat));

  // --- Member handlers ---

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
        notificationsEnabled: true,
        ...(isExternal(selectedUser.email) ? { categoryScope: selectedCategories } : {}),
      };
      await addProjectMember(projectId, project, newMember);
      onProjectUpdated({
        ...project,
        memberIds: [...(project.memberIds || []), selectedUser.uid],
        members: [...(project.members || []), newMember],
      });
      toast({ title: 'Member added', description: selectedUser.email });
      setAddOpen(false);
    } catch {
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
      onProjectUpdated({
        ...project,
        members: (project.members || []).map(m =>
          m.userId === editMember.userId ? { ...m, categoryScope: editCategories } : m
        ),
      });
      toast({ title: 'Scope updated' });
      setEditMember(null);
    } catch {
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
      onProjectUpdated({
        ...project,
        memberIds: (project.memberIds || []).filter(id => id !== member.userId),
        members: (project.members || []).filter(m => m.userId !== member.userId),
      });
      toast({ title: 'Member removed', description: member.email });
    } catch {
      toast({ title: 'Error', description: 'Failed to remove member', variant: 'destructive' });
    }
  };

  const handleToggleMemberNotifications = async (member: ProjectMember, enabled: boolean) => {
    try {
      await toggleMemberNotifications(projectId, project, member.userId, enabled);
      onProjectUpdated({
        ...project,
        members: (project.members || []).map(m =>
          m.userId === member.userId ? { ...m, notificationsEnabled: enabled } : m
        ),
      });
    } catch {
      toast({ title: 'Error', description: 'Failed to update notifications', variant: 'destructive' });
    }
  };

  // --- External recipient handlers ---

  const handleExtOpen = () => {
    setExtName('');
    setExtEmail('');
    setExtError(null);
    setExtOpen(true);
  };

  const handleAddExternal = async () => {
    if (!extName.trim()) { setExtError('Name is required'); return; }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(extEmail.trim())) { setExtError('Enter a valid email'); return; }

    setExtAdding(true);
    setExtError(null);
    try {
      await addExternalRecipient(projectId, project, { name: extName.trim(), email: extEmail.trim() });
      const newRecipient: ExternalRecipient = { name: extName.trim(), email: extEmail.trim(), notificationsEnabled: true };
      onProjectUpdated({
        ...project,
        externalRecipients: [...(project.externalRecipients || []), newRecipient],
      });
      toast({ title: 'Recipient added', description: extEmail.trim() });
      setExtOpen(false);
    } catch (err: any) {
      setExtError(err.message || 'Failed to add recipient');
    } finally {
      setExtAdding(false);
    }
  };

  const handleRemoveExternal = async (email: string) => {
    try {
      await removeExternalRecipient(projectId, project, email);
      onProjectUpdated({
        ...project,
        externalRecipients: (project.externalRecipients || []).filter(r => r.email !== email),
      });
      toast({ title: 'Recipient removed' });
    } catch {
      toast({ title: 'Error', description: 'Failed to remove recipient', variant: 'destructive' });
    }
  };

  const handleToggleExternalNotifications = async (email: string, enabled: boolean) => {
    try {
      await toggleExternalRecipientNotifications(projectId, project, email, enabled);
      onProjectUpdated({
        ...project,
        externalRecipients: (project.externalRecipients || []).map(r =>
          r.email.toLowerCase() === email.toLowerCase() ? { ...r, notificationsEnabled: enabled } : r
        ),
      });
    } catch {
      toast({ title: 'Error', description: 'Failed to update notifications', variant: 'destructive' });
    }
  };

  // --- Send digest ---

  const handleSendDigestNow = async () => {
    const hasRecipients =
      members.some(m => m.notificationsEnabled !== false) ||
      externalRecipients.some(r => r.notificationsEnabled !== false);

    if (!hasRecipients) {
      toast({ title: 'No recipients', description: 'Enable notifications for at least one member.', variant: 'destructive' });
      return;
    }
    setSendingDigest(true);
    try {
      const sendBOMDigest = httpsCallable(functions, 'sendBOMDigestNow');
      await sendBOMDigest({ projectId });
      toast({ title: 'Digest sent' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to send digest', variant: 'destructive' });
    } finally {
      setSendingDigest(false);
    }
  };

  const selectedIsExternal = selectedUser ? isExternal(selectedUser.email) : false;

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Members & Notifications</h3>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={handleSendDigestNow} disabled={sendingDigest}>
              <Send className="h-3.5 w-3.5 mr-1.5" />
              {sendingDigest ? 'Sending…' : 'Send Update Now'}
            </Button>
          )}
          {isAdmin && (
            <Button size="sm" onClick={handleAddOpen}>
              <UserPlus className="h-4 w-4 mr-1.5" />
              Add Member
            </Button>
          )}
        </div>
      </div>

      {/* Unified table */}
      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left px-4 py-2.5 font-medium">Name</th>
              <th className="text-left px-4 py-2.5 font-medium hidden sm:table-cell">Email</th>
              <th className="text-center px-4 py-2.5 font-medium">
                <span className="flex items-center justify-center gap-1"><Bell className="h-3.5 w-3.5" /> Notify</span>
              </th>
              {isAdmin && <th className="px-4 py-2.5" />}
            </tr>
          </thead>
          <tbody className="divide-y">
            {members.map(member => {
              const external = isExternal(member.email);
              const isSelf = member.userId === currentUserId;
              const notifOn = member.notificationsEnabled !== false;
              return (
                <tr key={member.userId} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{member.displayName || member.email}</span>
                      {isSelf && <Badge variant="outline" className="text-xs">You</Badge>}
                      {external && <Badge variant="secondary" className="text-xs bg-amber-50 text-amber-700">Partner</Badge>}
                    </div>
                    {external && member.categoryScope && member.categoryScope.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {member.categoryScope.map(cat => (
                          <Badge key={cat} variant="outline" className="text-xs px-1 py-0">{cat}</Badge>
                        ))}
                      </div>
                    )}
                    {external && (!member.categoryScope || member.categoryScope.length === 0) && (
                      <span className="text-xs text-amber-600 flex items-center gap-1 mt-0.5">
                        <AlertCircle className="h-3 w-3" /> No categories scoped
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground sm:hidden">{member.email}</span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{member.email}</td>
                  <td className="px-4 py-3 text-center">
                    <Switch
                      checked={notifOn}
                      onCheckedChange={enabled => handleToggleMemberNotifications(member, enabled)}
                      aria-label={notifOn ? 'Disable notifications' : 'Enable notifications'}
                    />
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        {external && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit category scope" onClick={() => handleEditOpen(member)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          title="Remove member"
                          onClick={() => handleRemove(member)}
                          disabled={isSelf && members.length === 1}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}

            {externalRecipients.map(r => (
              <tr key={r.email} className="hover:bg-muted/30">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.name}</span>
                    <Badge variant="outline" className="text-xs flex items-center gap-1">
                      <Mail className="h-3 w-3" /> Email only
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground sm:hidden">{r.email}</span>
                </td>
                <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{r.email}</td>
                <td className="px-4 py-3 text-center">
                  <Switch
                    checked={r.notificationsEnabled !== false}
                    onCheckedChange={enabled => handleToggleExternalNotifications(r.email, enabled)}
                    aria-label="Toggle notifications"
                  />
                </td>
                {isAdmin && (
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        title="Remove recipient"
                        onClick={() => handleRemoveExternal(r.email)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                )}
              </tr>
            ))}

            {members.length === 0 && externalRecipients.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 4 : 3} className="px-4 py-8 text-center text-muted-foreground">
                  No members yet. Add members to grant project access.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {isAdmin && (
          <div className="px-4 py-2 border-t bg-muted/20 flex justify-end">
            <Button variant="ghost" size="sm" onClick={handleExtOpen} className="text-xs text-muted-foreground">
              <Mail className="h-3.5 w-3.5 mr-1.5" />
              Add email-only recipient
            </Button>
          </div>
        )}
      </div>

      {/* Add Member Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Member</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">User</Label>
              <Popover open={userPickerOpen} onOpenChange={setUserPickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal h-9 text-sm">
                    {selectedUser ? (
                      <span>{selectedUser.displayName || selectedUser.email} <span className="text-muted-foreground">({selectedUser.email})</span></span>
                    ) : (
                      <span className="text-muted-foreground">Search users…</span>
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
                              <div className="text-xs text-muted-foreground">{u.email}</div>
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
                        onCheckedChange={checked => toggleCategory(cat, !!checked, selectedCategories, setSelectedCategories)}
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
      <Dialog open={!!editMember} onOpenChange={o => { if (!o) setEditMember(null); }}>
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
                    onCheckedChange={checked => toggleCategory(cat, !!checked, editCategories, setEditCategories)}
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
            <Button onClick={handleSaveScope} disabled={saving}>{saving ? 'Saving…' : 'Save Scope'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add External Recipient Dialog */}
      <Dialog open={extOpen} onOpenChange={setExtOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Email-Only Recipient</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              This person has no BOM Tracker account. They will receive BOM notification emails only.
            </p>
            {extError && <p className="text-sm text-destructive">{extError}</p>}
            <div className="space-y-1.5">
              <Label htmlFor="ext-name">Name</Label>
              <Input id="ext-name" value={extName} onChange={e => setExtName(e.target.value)} placeholder="Full name" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ext-email">Email</Label>
              <Input id="ext-email" type="email" value={extEmail} onChange={e => setExtEmail(e.target.value)} placeholder="contact@company.com" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtOpen(false)}>Cancel</Button>
            <Button onClick={handleAddExternal} disabled={extAdding || !extName.trim() || !extEmail.trim()}>
              {extAdding ? 'Adding…' : 'Add Recipient'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
};

export default ProjectMembersTab;
