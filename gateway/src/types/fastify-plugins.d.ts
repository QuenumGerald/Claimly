declare module '@fastify/cors' {
  import { FastifyPluginCallback } from 'fastify'
  const plugin: FastifyPluginCallback<any>
  export default plugin
}

declare module '@fastify/jwt' {
  import { FastifyPluginCallback } from 'fastify'
  const plugin: FastifyPluginCallback<any>
  export default plugin
}

declare module '@fastify/multipart' {
  import { FastifyPluginCallback } from 'fastify'
  const plugin: FastifyPluginCallback<any>
  export default plugin
}
