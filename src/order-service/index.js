const fastify = require("fastify")({ address: "0.0.0.0" });
fastify.get("/health", async () => ({ status: "ok" }));
fastify.listen({ port: 3000, host: "0.0.0.0" }).then(() => console.log("order-service on 3000"));
