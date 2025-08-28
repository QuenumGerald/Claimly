declare module 'qdrant-client' {
  export class QdrantClient {
    constructor(config: { url: string; apiKey?: string })
    getCollections(): Promise<any>
    createCollection(name: string, config: any): Promise<any>
    upsert(collection: string, points: any): Promise<any>
    search(collection: string, params: any): Promise<any>
  }
}

declare module '@xenova/transformers' {
  export function pipeline(task: string, model?: string): Promise<(input: string, options?: any) => Promise<any>>
}
