export interface McpBomUser { uid: string; email?: string; role: string; status: string; disabled: boolean }
export interface McpAddItemInput {
  project_id: string;
  category: string;
  name: string;
  description: string;
  quantity: number;
  price?: number;
  make?: string;
  sku?: string;
  item_type?: "component" | "service";
  expected_version: string;
  operation_id: string;
}
export interface McpAddItemResult {
  item_id: string;
  category: string;
  project_id: string;
  operation_id: string;
  name: string;
  quantity: number;
  price?: number;
  replayed: boolean;
}
export interface McpMaterialWriterOptions {
  db: { collection(path: string): any; runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> };
  resolveBomUser: (authInfo: unknown) => Promise<McpBomUser>;
  getServerTimestamp: () => unknown;
}
export function createMcpMaterialWriter(options: McpMaterialWriterOptions): {
  addItem(input: McpAddItemInput | Record<string, unknown>, authInfo?: unknown): Promise<McpAddItemResult>;
};
