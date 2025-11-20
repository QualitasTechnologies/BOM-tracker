import type { Project } from "@/utils/projectFirestore";

export type FirestoreProject = Project;

export type ProjectViewMode = "cards" | "table";

export interface NewProjectFormData {
  id: string;
  name: string;
  client: string;
  description: string;
  status: FirestoreProject["status"];
  deadline: string;
}

export interface EditableProjectInput {
  projectId: string;
  projectName: string;
  clientName: string;
  description: string;
  status: FirestoreProject["status"];
  deadline: string;
}

