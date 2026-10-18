export interface McpBomUser { uid: string; email?: string; role: string; status: string; disabled: boolean }
export function createMcpBomUserResolver(options: { auth: { getUser(uid: string): Promise<any> } }): (authInfo: unknown) => Promise<McpBomUser>;
