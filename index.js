require("dotenv").config();

const mongoose = require("mongoose");

const { createApp } = require("./app");

mongoose.set("sanitizeFilter", true);

function parsePort(value) {
  const port = Number(value ?? 4000);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT deve ser um número entre 1 e 65535.");
  }
  return port;
}

async function start({ environment = process.env, logger = console } = {}) {
  const mongoUri = environment.MONGODB_URI;
  if (typeof mongoUri !== "string" || !mongoUri.trim()) {
    throw new Error("MONGODB_URI não foi configurada.");
  }

  const port = parsePort(environment.PORT);
  await mongoose.connect(mongoUri);
  logger.log?.("Conectado ao MongoDB com sucesso.");

  const app = createApp({ environment, logger });
  const server = await new Promise((resolve, reject) => {
    const candidate = app.listen(port);
    candidate.once("listening", () => resolve(candidate));
    candidate.once("error", reject);
  });
  logger.log?.(`Servidor rodando na porta ${port}`);
  return { app, server };
}

if (require.main === module) {
  start().catch(async (error) => {
    console.error("Não foi possível iniciar o servidor:", error);
    try {
      await mongoose.disconnect();
    } catch (disconnectError) {
      console.error("Erro ao encerrar a conexão com o MongoDB:", disconnectError);
    }
    process.exitCode = 1;
  });
}

module.exports = { parsePort, start };
